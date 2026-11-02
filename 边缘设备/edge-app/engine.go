package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"os"
	"sync"
	"syscall"
	"time"
)

type Engine struct {
	lifecycleMu sync.Mutex
	mu          sync.Mutex
	store       *Store
	cfg         Config
	run         *Run
	state       string
	connected   bool
	lastError   string
	latest      *Sample
	latestA     *Sample
	latestB     *Sample
	recent      []Sample
	liveWake chan struct{}
	liveClients int
	done        chan struct{}
	cancel      context.CancelFunc
	dir         string
	tsError     string
	tsCursorKey string
	centerError string
	bError      string
	bConnected  bool
	frequency   float64
}

func newEngine(s *Store, dir string) *Engine {
	c := defaultConfig()
	s.meta("config", &c)
	e := &Engine{store: s, cfg: c, state: "IDLE", recent: []Sample{}, dir: dir}
	for _, r := range s.runs() {
		if r.State == "RUNNING" || r.State == "PAUSED" {
			r.State = "INTERRUPTED"
			t := time.Now().UTC()
			r.Ended = &t
			s.saveRun(r)
			s.event("RECOVERY", map[string]string{"run": r.ID, "reason": "服务重启，检测已中断；记录保留"})
		}
	}
	var pending *lifecycleIntent
	s.meta("lifecycleIntent", &pending)
	if pending != nil {
		e.state = "SYNC_PENDING"
		e.run = pending.Old
	}
	return e
}
func uid() string {
	b := make([]byte, 12)
	rand.Read(b)
	return time.Now().UTC().Format("20060102T150405") + "-" + hex.EncodeToString(b)
}
func (e *Engine) start(o Order) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == "RUNNING" || e.state == "PAUSED" || e.state == "STOPPING" {
		return fmt.Errorf("请先结束当前盘")
	}
	if err := o.validate(); err != nil {
		return err
	}
	if err := e.cfg.validate(); err != nil {
		return err
	}
	c := e.cfg
	c.Sync = e.syncFor(c.DeviceID)
	r := Run{ID: uid(), Order: o, Config: c, Method: method, Started: time.Now().UTC(), State: "RUNNING", Source: "MODBUS"}
	if e.cfg.Transport == "input" {
		r.Source = "DEVICE_INPUT"
	}
	if err := e.store.saveRun(r); err != nil {
		return err
	}
	e.store.event("START", r.ID)
	e.run = &r
	e.state = "RUNNING"
	e.latest = nil
	e.resetGauges()
	e.recent = []Sample{}
	e.lastError = ""
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.done = make(chan struct{})
	go e.collectRun(ctx, e.done, r.Config, r.ID)
	return nil
}
func (e *Engine) pause() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != "RUNNING" {
		return fmt.Errorf("当前不在采集中")
	}
	r := *e.run
	r.State = "PAUSED"
	if err := e.store.saveRun(r); err != nil {
		return err
	}
	e.run = &r
	e.state = "PAUSED"
	e.connected = false
	return e.store.event("PAUSE", r.ID)
}
func (e *Engine) resume() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != "PAUSED" {
		return fmt.Errorf("当前未暂停")
	}
	r := *e.run
	r.State = "RUNNING"
	if err := e.store.saveRun(r); err != nil {
		return err
	}
	e.run = &r
	e.state = "RUNNING"
	return e.store.event("RESUME", r.ID)
}
func (e *Engine) stop() error {
	e.mu.Lock()
	if e.state == "WAITING_SCAN" {
		e.state = "IDLE"
		e.mu.Unlock()
		return e.store.event("SCAN_CANCELLED", nil)
	}
	if e.run == nil || (e.state != "RUNNING" && e.state != "PAUSED" && e.state != "FAULT") {
		e.mu.Unlock()
		return fmt.Errorf("没有可结束的盘")
	}
	e.state = "STOPPING"
	if e.cancel != nil {
		e.cancel()
	}
	done := e.done
	e.mu.Unlock()
	if done != nil {
		<-done
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	r := *e.run
	t := time.Now().UTC()
	r.Ended = &t
	r.State = "ENDED"
	if err := e.store.saveRun(r); err != nil {
		e.state = "FAULT"
		return err
	}
	e.run = &r
	e.state = "ENDED"
	e.connected = false
	e.frequency = 0
	return e.store.event("END", r.ID)
}
func (e *Engine) setConfig(c Config) error {
	c.Sync = nil // Only authenticated platform pushes may set synchronization.
	if err := c.validate(); err != nil {
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == "RUNNING" || e.state == "PAUSED" || e.state == "STOPPING" || e.state == "WAITING_SCAN" {
		return fmt.Errorf("请结束本盘后修改参数")
	}
	if err := e.store.set("config", c); err != nil {
		return err
	}
	e.cfg = c
	return e.store.event("CONFIG", c)
}
func (e *Engine) collectRun(ctx context.Context, done chan struct{}, c Config, id string) {
	defer close(done)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); e.collect(ctx, c, id, "A") }()
	if c.B != nil && c.B.Enabled {
		wg.Add(1)
		go func() { defer wg.Done(); e.collect(ctx, c.B.config(c.DeviceID), id, "B") }()
	}
	wg.Wait()
}
func (e *Engine) collect(ctx context.Context, c Config, id string, gauge string) {
	if c.Transport == "input" {
		<-ctx.Done()
		return
	}
	var d *Device
	defer func() {
		if d != nil {
			d.Close()
		}
	}()
	tick := time.NewTicker(time.Duration(c.IntervalMS) * time.Millisecond)
	defer tick.Stop()
	lastRate := time.Now()
	num := 0
	retry := time.Time{}
	lastDisk := time.Time{}
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		e.mu.Lock()
		active := e.state == "RUNNING"
		e.mu.Unlock()
		if !active {
			if d != nil {
				d.Close()
				d = nil
			}
			continue
		}
		if time.Now().Before(retry) {
			continue
		}
		if time.Since(lastDisk) > time.Second {
			var st syscall.Statfs_t
			if err := syscall.Statfs(e.dir, &st); err == nil && st.Bavail*uint64(st.Bsize) < 512*1024*1024 {
				e.fail("磁盘剩余不足512MB，已停止采集以保留现有数据", true)
				return
			}
			lastDisk = time.Now()
		}
		if d == nil {
			var err error
			d, err = connect(c)
			if err != nil {
				e.gaugeFail(gauge, "连接失败："+err.Error())
				retry = time.Now().Add(time.Second)
				continue
			}
		}
		reg, raw, err := d.Read()
		if err != nil {
			e.gaugeFail(gauge, "采集失败："+err.Error())
			d.Close()
			d = nil
			retry = time.Now().Add(time.Second)
			continue
		}
		s := calculate(reg, c, id, raw)
		if gauge == "B" {
			s = calculateB(reg, c, id, raw)
		}
		e.mu.Lock()
		if e.state != "RUNNING" {
			e.mu.Unlock()
			continue
		}
		r := *e.run
		s.Source = r.Source
		err = e.store.append(&s, &r)
		if err != nil {
			e.mu.Unlock()
			e.fail("数据保存失败，采集已停止："+err.Error(), true)
			return
		}
		e.run = &r
		e.publishSample(s)
		if gauge == "A" {
			e.connected = true
			e.lastError = ""
		} else {
			e.bConnected = true
			e.bError = ""
		}
		cut := time.Now().Add(-60 * time.Second)
		n := 0
		for n < len(e.recent) && e.recent[n].At.Before(cut) {
			n++
		}
		e.recent = e.recent[n:]
		if len(e.recent) > 30000 {
			e.recent = e.recent[len(e.recent)-30000:]
		}
		num++
		if gauge == "A" && time.Since(lastRate) >= time.Second {
			e.frequency = float64(num) / time.Since(lastRate).Seconds()
			num = 0
			lastRate = time.Now()
		}
		e.mu.Unlock()
	}
}
func (e *Engine) gaugeFail(gauge, msg string) {
	if gauge == "A" {
		e.fail(msg, false)
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.bError = msg
	e.bConnected = false
}
func (e *Engine) fail(msg string, fatal bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.lastError != msg {
		e.store.event("ERROR", msg)
	}
	e.lastError = msg
	e.connected = false
	e.frequency = 0
	if fatal {
		e.state = "FAULT"
		if e.run != nil {
			e.run.State = "FAULT"
			e.store.saveRun(*e.run)
		}
	}
}
func (e *Engine) status() map[string]any {
	e.mu.Lock()
	defer e.mu.Unlock()
	var center uint64
	var projection influxCursor
	if e.tsCursorKey != "" {
		e.store.meta(e.tsCursorKey, &projection)
	}
	e.store.meta("centerCursor", &center)
	total := e.store.count()
	pending := total - center
	var rejected uint64
	if os.Getenv("EDGE_PLATFORM_URL") != "" {
		e.store.db.View(func(tx *bolt.Tx) error {
			pending = uint64(tx.Bucket([]byte("gatewayPending")).Stats().KeyN)
			rejected = uint64(tx.Bucket([]byte("gatewayRejected")).Stats().KeyN)
			return nil
		})
	}
	connected := e.connected
	if e.run != nil && e.run.Source == "SIMULATED" && e.latest != nil && time.Since(e.latest.Received) > 3*time.Second {
		connected = false
	}
	return map[string]any{"version": appVersion, "centerEnabled": os.Getenv("EDGE_CENTER_URL") != "" || os.Getenv("EDGE_PLATFORM_URL") != "", "state": e.state, "connected": connected, "error": e.lastError, "run": e.run, "latest": e.latest, "gauges": map[string]*Sample{"A": e.latestA, "B": e.latestB}, "pairWindowMs": pairWindow(e.cfg), "config": e.cfg, "syncConfig": e.syncFor(e.cfg.DeviceID), "syncConfigs": e.allSyncConfigs(), "bError": e.bError, "bConnected": e.bConnected, "frequency": e.frequency, "stored": total, "tsPending": total - projection.ID, "tsdb": "InfluxDB", "vmPending": total - projection.ID, "vmError": e.tsError, "centerPending": pending, "centerRejected": rejected, "tsError": e.tsError, "centerError": e.centerError, "time": time.Now().UTC()}
}
