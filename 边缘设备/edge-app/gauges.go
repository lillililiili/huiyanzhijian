package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"math"
	"net/http"
	"strings"
	"syscall"
	"time"
)

const sheathMethod = "sheath-a-mean-minus-b-mean.v1"

type SheathResult struct {
	MeterRecordID string    `json:"meterRecordId,omitempty"`
	MeterSource   string    `json:"meterSource,omitempty"`
	DistanceMM    *int64    `json:"distanceMm,omitempty"`
	SyncRevision  string    `json:"syncRevision,omitempty"`
	DelayMS       *float64  `json:"delayMs,omitempty"`
	ToleranceMS   float64   `json:"toleranceMs"`
	UpstreamGauge string    `json:"upstreamGauge,omitempty"`
	ResidualMS    float64   `json:"residualMs"`
	TargetAt      time.Time `json:"targetAt"`
	Value         *float64  `json:"value"`
	Method        string    `json:"method"`
	Status        string    `json:"status"`
	AID           uint64    `json:"aId"`
	BID           uint64    `json:"bId"`
	AAt           time.Time `json:"aAt"`
	BAt           time.Time `json:"bAt"`
	AMean         *float64  `json:"aMean"`
	BMean         *float64  `json:"bMean"`
	DeltaMS       float64   `json:"deltaMs"`
	WindowMS      int       `json:"windowMs"`
}
type GaugeInput struct {
	RunID    string    `json:"runId"`
	RecordID string    `json:"recordId"`
	Gauge    string    `json:"gauge"`
	At       time.Time `json:"at"`
	Values   []float64 `json:"values"`
	Status   string    `json:"status"`
	Source   string    `json:"source"`
}
type gaugeReceipt struct {
	Digest string `json:"digest"`
	ID     uint64 `json:"id"`
}

func gaugeOf(s Sample) string {
	if s.Gauge == "B" {
		return "B"
	}
	return "A"
}
func gaugeMean(s Sample) *float64 {
	if !s.Valid || s.X == nil {
		return nil
	}
	if s.Y == nil {
		if gaugeOf(s) == "B" {
			return s.X
		}
		return nil
	}
	return ptr((*s.X + *s.Y) / 2)
}
func pairWindow(c Config) int {
	if c.PairWindowMS == 0 {
		return 100
	}
	return c.PairWindowMS
}

func (e *Engine) publishSample(s Sample) {
	// All callers publish only after the durable sample transaction succeeds.
	if e.liveWake != nil { close(e.liveWake); e.liveWake = make(chan struct{}) }
	copy := s
	e.latest = &copy
	if gaugeOf(s) == "B" {
		e.latestB = &copy
	} else {
		e.latestA = &copy
	}
	e.recent = append(e.recent, s)
	if len(e.recent) > 30000 {
		e.recent = e.recent[len(e.recent)-30000:]
	}
}
func (e *Engine) resetGauges() { e.latestA = nil; e.latestB = nil; e.bError = ""; e.bConnected = false }

func (e *Engine) acceptGauge(in GaugeInput) (uint64, error) {
	if in.Gauge != "A" && in.Gauge != "B" {
		return 0, fmt.Errorf("测径仪须为A或B")
	}
	if strings.TrimSpace(in.RecordID) == "" || len(in.RecordID) > 128 || strings.ContainsAny(in.RecordID, "\r\n") {
		return 0, fmt.Errorf("需要稳定且不超过128字节的记录ID")
	}
	if in.At.IsZero() {
		return 0, fmt.Errorf("需要带时区的采样时间")
	}
	if in.Status != "VALID" && in.Status != "INVALID" && in.Status != "MISSING" {
		return 0, fmt.Errorf("状态须为VALID/INVALID/MISSING")
	}
	if len(in.Values) > 2 || in.Status == "VALID" && (len(in.Values) < 1 || in.Gauge == "A" && len(in.Values) != 2) {
		return 0, fmt.Errorf("A需要X/Y两值，B需要X一值或X/Y两值")
	}
	for _, v := range in.Values {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, fmt.Errorf("轴值必须是有限数值")
		}
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	key := in.RunID + "/" + in.Gauge + "/" + in.RecordID
	digest := fmt.Sprintf("%x", sha256.Sum256(marshal(in)))
	var old gaugeReceipt
	if err := e.store.db.View(func(tx *bolt.Tx) error {
		v := tx.Bucket([]byte("gaugeInputs")).Get([]byte(key))
		if v != nil {
			return json.Unmarshal(v, &old)
		}
		return nil
	}); err != nil {
		return 0, err
	}
	if old.Digest != "" {
		if old.Digest != digest {
			return 0, fmt.Errorf("相同记录ID内容冲突，原记录保留")
		}
		return old.ID, nil
	}
	if e.state != "RUNNING" || e.run == nil || e.run.ID != in.RunID {
		return 0, fmt.Errorf("需扫码开始对应本盘；暂停、结束或其他盘不能接收新数据")
	}
	if in.Source != e.run.Source {
		return 0, fmt.Errorf("输入来源须与本盘一致，模拟和真实输入不能配对")
	}
	if in.Gauge == "A" && (e.run.Config.Transport != "input" || e.run.Source == "SIMULATED") {
		return 0, fmt.Errorf("A已有采集通道；轴值接口需独立的数据接口本盘，不能混入串口或模拟器的A流")
	}
	if in.Gauge == "B" && e.run.Source != "SIMULATED" && e.run.Config.B != nil && e.run.Config.B.Enabled {
		return 0, fmt.Errorf("B已启用Modbus采集，不能混入轴值接口")
	}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(e.dir, &disk); err == nil && disk.Bavail*uint64(disk.Bsize) < 512*1024*1024 {
		return 0, fmt.Errorf("磁盘不足512MB，记录未接收")
	}
	s := Sample{RunID: in.RunID, DeviceID: e.run.Config.DeviceID, Gauge: in.Gauge, At: in.At, Received: time.Now().UTC(), InputValues: in.Values, Raw: string(marshal(in)), Source: in.Source, Method: method, Verdict: "UNDETERMINED"}
	if in.Gauge == "B" {
		s.Method = "diameter-axis-mean.v1"
	}
	s.Valid = in.Status == "VALID"
	if !s.Valid {
		s.Reason = in.Status
	}
	if s.Valid {
		for _, v := range in.Values {
			if v <= 0 {
				s.Valid = false
				s.Reason = "轴直径无效"
			}
		}
	}
	if s.Valid {
		s.X = ptr(in.Values[0])
		if len(in.Values) == 2 {
			s.Y = ptr(in.Values[1])
		}
		s.Mean = gaugeMean(s)
		if in.Gauge == "A" {
			s.Ratio = ptr(math.Min(*s.X, *s.Y) / math.Max(*s.X, *s.Y))
			if e.run.Config.Lower != nil {
				s.Verdict = "PASS"
				if *s.Ratio < *e.run.Config.Lower {
					s.Verdict = "FAIL"
				}
			}
		}
	}
	r := *e.run
	err := e.store.db.Update(func(tx *bolt.Tx) error {
		if err := appendSample(tx, &s, &r); err != nil {
			return err
		}
		return tx.Bucket([]byte("gaugeInputs")).Put([]byte(key), marshal(gaugeReceipt{Digest: digest, ID: s.ID}))
	})
	if err != nil {
		return 0, err
	}
	e.run = &r
	e.publishSample(s)
	return s.ID, nil
}

func (e *Engine) gaugeRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /edge/v1/gauges", func(w http.ResponseWriter, r *http.Request) {
		var in GaugeInput
		if err := decode(w, r, &in); err != nil {
			fail(w, err)
			return
		}
		id, err := e.acceptGauge(in)
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, map[string]any{"accepted": true, "id": id, "runId": in.RunID})
	})
}
