package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type SyncConfig struct {
	DistanceMM    *int64   `json:"distanceMm,omitempty"`
	DeviceID      string   `json:"deviceId"`
	Revision      string   `json:"revision"`
	DelayMS       *float64 `json:"delayMs"`
	ToleranceMS   float64  `json:"toleranceMs"`
	UpstreamGauge string   `json:"upstreamGauge"`
}

func (c SyncConfig) validate() error {
	v, err := strconv.ParseUint(c.Revision, 10, 64)
	if err != nil || v == 0 || strconv.FormatUint(v, 10) != c.Revision {
		return fmt.Errorf("同步配置版本须为正整数")
	}
	if c.DistanceMM == nil || *c.DistanceMM < 1 || *c.DistanceMM > 2147483647 {
		return fmt.Errorf("需要测径仪间距，范围1～2147483647整数mm；旧时间配置不再使用")
	}
	if math.IsNaN(c.ToleranceMS) || math.IsInf(c.ToleranceMS, 0) || c.ToleranceMS < 0 || c.ToleranceMS > 5000 {
		return fmt.Errorf("取点容差须为0～5000ms")
	}
	if c.UpstreamGauge != "" && c.UpstreamGauge != "A" && c.UpstreamGauge != "B" {
		return fmt.Errorf("需要明确先经过A还是B")
	}
	return nil
}
func (e *Engine) syncFor(device string) *SyncConfig {
	var c *SyncConfig
	if e.store.meta("sync:"+device, &c) != nil {
		return nil
	}
	return c
}
func (e *Engine) syncAllowed(id string) bool {
	if id == e.cfg.DeviceID {
		return true
	}
	for _, s := range strings.Split(os.Getenv("EDGE_SYNC_DEVICE_IDS"), ",") {
		if id != "" && strings.TrimSpace(s) == id {
			return true
		}
	}
	return false
}
func (e *Engine) acceptSync(c SyncConfig) (map[string]any, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.syncAllowed(c.DeviceID) {
		return nil, fmt.Errorf("同步配置设备不属于此边缘终端")
	}
	old := e.syncFor(c.DeviceID)
	if old != nil {
		before, _ := strconv.ParseUint(old.Revision, 10, 64)
		next, _ := strconv.ParseUint(c.Revision, 10, 64)
		if next < before {
			return nil, fmt.Errorf("拒绝旧版本同步配置")
		}
		if next == before && !bytes.Equal(marshal(old), marshal(c)) {
			return nil, fmt.Errorf("同版本同步配置内容冲突")
		}
	}
	if old == nil || old.Revision != c.Revision {
		if err := e.store.set("sync:"+c.DeviceID, c); err != nil {
			return nil, err
		}
		e.store.event("SYNC_CONFIG_RECEIVED", c)
	}
	active := ""
	state := "NEXT_RUN"
	if e.run != nil && e.run.Config.DeviceID == c.DeviceID && (e.state == "RUNNING" || e.state == "PAUSED") {
		if e.run.Config.Sync != nil {
			active = e.run.Config.Sync.Revision
		}
		if active == c.Revision {
			state = "ACTIVE"
		}
	}
	return map[string]any{"accepted": true, "deviceId": c.DeviceID, "revision": c.Revision, "state": state, "activeRevision": active}, nil
}
func (e *Engine) syncRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /edge/v1/sync-config", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			DeviceID   string `json:"deviceId"`
			Revision   string `json:"revision"`
			DistanceMM *int64 `json:"distanceMm"`
		}
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		v, err := e.acceptSync(SyncConfig{DeviceID: in.DeviceID, Revision: in.Revision, DistanceMM: in.DistanceMM})
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, v)
	})
}

func sampleTimeKey(t time.Time) []byte { return key(uint64(t.UnixNano()) ^ (uint64(1) << 63)) }

// Index includes invalid readings so nearest invalid data cannot be silently
// replaced by a more distant valid point. Matching never crosses run/source.
func pairSampleTx(tx *bolt.Tx, s *Sample, r *Run) error {
	s.Mean = gaugeMean(*s)
	p := &SheathResult{Method: "sheath-a-mean-minus-b-mean.time-compensated.v2", Status: "SYNC_NOT_CONFIGURED"}
	s.Sheath = p
	root, err := tx.Bucket([]byte("gaugeTimes")).CreateBucketIfNotExists([]byte(r.ID))
	if err != nil {
		return err
	}
	ix, err := root.CreateBucketIfNotExists([]byte(gaugeOf(*s)))
	if err != nil {
		return err
	}
	if err = ix.Put(sampleTimeKey(s.At), key(s.ID)); err != nil {
		return err
	}
	c := r.Config.Sync
	if c == nil || c.validate() != nil || c.DeviceID != s.DeviceID {
		return nil
	}
	p.SyncRevision = c.Revision
	p.DistanceMM = c.DistanceMM
	p.UpstreamGauge = "B" // cable-in B -> extruder -> cable-out A
	if gaugeOf(*s) == "B" {
		p.Status = "WAITING_DOWNSTREAM"
		return nil
	}
	m := s.Meter
	if m == nil {
		p.Status = "METER_TIME_UNAVAILABLE"
		return nil
	}
	if m.Source != s.Source || m.Source != "SIMULATED" || !m.At.Equal(s.At) || m.DelayMS < 0 || m.DelayMS > 3600000 || m.RecordID == "" {
		p.Status = "METER_INVALID"
		return nil
	}
	if m.DistanceMM != *c.DistanceMM || m.SyncRevision != c.Revision {
		p.Status = "METER_CONFIG_MISMATCH"
		return nil
	}
	p.DelayMS = ptr(float64(m.DelayMS))
	p.MeterRecordID = m.RecordID
	p.MeterSource = m.Source
	p.Method = "sheath-a-mean-minus-b-mean.meter-time.v3"
	// Simulator explicitly provides B at the target timestamp; require exact
	// agreement rather than guessing a physical acquisition tolerance.
	p.ToleranceMS = 0
	p.WindowMS = 0
	if s.Mean == nil {
		p.Status = "INVALID_CURRENT"
		return nil
	}
	upstream := root.Bucket([]byte(p.UpstreamGauge))
	if upstream == nil {
		p.Status = "WAITING_OTHER"
		return nil
	}
	target := s.At.Add(-time.Duration(*p.DelayMS * float64(time.Millisecond)))
	p.TargetAt = target
	cursor := upstream.Cursor()
	k, v := cursor.Seek(sampleTimeKey(target))
	var candidates []Sample
	read := func(v []byte) error {
		if v == nil {
			return nil
		}
		var point Sample
		if err := json.Unmarshal(tx.Bucket([]byte("samples")).Get(v), &point); err != nil {
			return err
		}
		candidates = append(candidates, point)
		return nil
	}
	if err = read(v); err != nil {
		return err
	}
	if k == nil {
		_, v = cursor.Last()
	} else {
		_, v = cursor.Prev()
	}
	if err = read(v); err != nil {
		return err
	}
	best := math.Inf(1)
	var other *Sample
	for i := range candidates {
		point := &candidates[i]
		if point.At.After(s.At) || point.RunID != s.RunID || point.Source != s.Source {
			continue
		}
		delta := math.Abs(float64(point.At.Sub(target)) / float64(time.Millisecond))
		if delta < best {
			best = delta
			other = point
		}
	}
	if other == nil {
		p.Status = "WAITING_OTHER"
		return nil
	}
	p.ResidualMS = best
	if best > p.ToleranceMS {
		p.Status = "OUT_OF_WINDOW"
		return nil
	}
	if gaugeMean(*other) == nil {
		p.Status = "INVALID_OTHER"
		return nil
	}
	a, b := *s, *other
	if gaugeOf(*s) == "B" {
		a, b = *other, *s
	}
	p.AID, p.BID = a.ID, b.ID
	p.AAt, p.BAt = a.At, b.At
	p.AMean, p.BMean = gaugeMean(a), gaugeMean(b)
	p.DeltaMS = float64(b.At.Sub(a.At)) / float64(time.Millisecond)
	p.Value = ptr(*p.AMean - *p.BMean)
	p.Status = "TIME_COMPENSATED"
	return nil
}

func (e *Engine) allSyncConfigs() []SyncConfig {
	out := []SyncConfig{}
	e.store.db.View(func(tx *bolt.Tx) error {
		cur := tx.Bucket([]byte("meta")).Cursor()
		for k, v := cur.Seek([]byte("sync:")); k != nil && bytes.HasPrefix(k, []byte("sync:")); k, v = cur.Next() {
			var c SyncConfig
			if json.Unmarshal(v, &c) == nil {
				out = append(out, c)
			}
		}
		return nil
	})
	return out
}
