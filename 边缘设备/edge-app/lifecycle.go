package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"net/url"
	"os"
	"time"
)

// Persist the exact command before calling the center. An unknown response is
// retried with the same identity, including after an application restart.
type lifecycleIntent struct {
	ID                 string    `json:"id"`
	Code               string    `json:"code"`
	Device             string    `json:"device"`
	Task               any       `json:"expected_task_id"`
	Binding            any       `json:"expected_binding_id"`
	Old                *Run      `json:"old,omitempty"`
	Cutoff             time.Time `json:"cutoff"`
	RunID              string    `json:"run_id"`
	RequestID          string    `json:"request_id,omitempty"`
	RequestFingerprint string    `json:"request_fingerprint,omitempty"`
}

func commandUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func centerData(path string, body any) (map[string]any, int, error) {
	b, status, err := platformRequest(context.Background(), path, body)
	if err != nil {
		return nil, status, err
	}
	var v map[string]any
	if json.Unmarshal(b, &v) != nil {
		return nil, 503, fmt.Errorf("中心返回格式无效，同步意图保留")
	}
	if status != 200 {
		return nil, status, fmt.Errorf("中心未接受操作：%s", str(v["message"]))
	}
	return obj(v["data"]), status, nil
}
func (e *Engine) scanTask(code, device, task string, requestIDs ...string) error {
	e.lifecycleMu.Lock()
	defer e.lifecycleMu.Unlock()
	requestID := ""
	if len(requestIDs) > 0 {
		requestID = requestIDs[0]
	}
	fingerprint := code + "|" + device + "|" + task
	if requestID != "" {
		var saved string
		if err := e.store.meta("scan-request:"+requestID, &saved); err != nil {
			return err
		}
		if saved != "" {
			if saved != fingerprint {
				return fmt.Errorf("扫码请求标识内容冲突")
			}
			return nil
		}
	}
	var pending *lifecycleIntent
	e.store.meta("lifecycleIntent", &pending)
	if pending != nil {
		if pending.Code != code || (requestID != "" && pending.RequestID != requestID) {
			return fmt.Errorf("上次切换尚待中心确认，请等待同步或重扫原任务码")
		}
		return e.completeLifecycle(pending)
	}
	e.mu.Lock()
	state := e.state
	configured := e.cfg.DeviceID
	if fixed := os.Getenv("EDGE_SCAN_DEVICE_ID"); fixed != "" {
		configured = fixed
	}
	current := e.run
	e.mu.Unlock()
	if state != "WAITING_SCAN" && state != "RUNNING" && state != "PAUSED" {
		return fmt.Errorf("请先开机，再扫描任务码")
	}
	if device != "" && device != configured {
		return fmt.Errorf("任务码与本机配置设备不一致")
	}
	preview, _, err := centerData("/devices/"+url.PathEscape(configured)+"/scan-preview/"+url.PathEscape(code), nil)
	if err != nil {
		return err
	}
	if task != "" && task != str(preview["task_id"]) {
		return fmt.Errorf("任务码与指定任务不一致")
	}
	a := obj(preview["assignment"])
	if current != nil && (state == "RUNNING" || state == "PAUSED") && current.Task == "" {
		return fmt.Errorf("当前为未关联中心的采集，请关机后再开机扫码")
	}
	p := &lifecycleIntent{ID: commandUUID(), Code: code, Device: configured, Cutoff: time.Now().UTC(), RunID: uid(), RequestID: requestID, RequestFingerprint: fingerprint}
	if a != nil {
		p.Task = a["task_id"]
		p.Binding = a["binding_id"]
	}
	if current != nil && (state == "RUNNING" || state == "PAUSED") {
		if current.Task != str(a["task_id"]) || current.Binding != str(a["binding_id"]) {
			return fmt.Errorf("中心任务与本机不一致，请关机同步后重新扫码")
		}
		old := *current
		p.Old = &old
	}
	return e.beginLifecycle(p)
}
func (e *Engine) beginLifecycle(p *lifecycleIntent) error {
	e.mu.Lock()
	// Capture boundary and freeze reception atomically with the durable intent.
	p.Cutoff = time.Now().UTC()
	if p.Old != nil && e.run != nil {
		old := *e.run
		p.Old = &old
	}
	if err := e.store.set("lifecycleIntent", p); err != nil {
		e.mu.Unlock()
		return err
	}
	e.state = "SYNC_PENDING"
	e.connected = false
	e.mu.Unlock()
	return e.completeLifecycle(p)
}
func (e *Engine) completeLifecycle(p *lifecycleIntent) error {
	body := map[string]any{"command_id": p.ID, "expected_task_id": p.Task, "expected_binding_id": p.Binding}
	action := "stop"
	if p.Code != "" {
		action = "scan"
		body["barcode"] = p.Code
	}
	data, status, err := centerData("/devices/"+url.PathEscape(p.Device)+"/task-"+action, body)
	if err != nil {
		e.mu.Lock()
		defer e.mu.Unlock()
		e.lastError = err.Error()
		// Definitive validation rejection means no transition committed. Unknown
		// responses remain journaled; the background loop retries them.
		if status >= 400 && status < 500 && status != 408 && status != 429 {
			if clearErr := e.store.set("lifecycleIntent", nil); clearErr != nil {
				return clearErr
			}
			e.state = "WAITING_SCAN"
			if p.Old != nil {
				e.run = p.Old
				e.state = p.Old.State
			}
		}
		return err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var next *Run
	var label scanLabel
	if p.Code != "" {
		raw := obj(data["label"])
		if json.Unmarshal(marshal(raw), &label) != nil || label.Task == "" || label.Device != p.Device {
			return fmt.Errorf("中心切换回执不完整，等待重试")
		}
		c := e.cfg
		c.DeviceID = label.Device
		c.Sync = e.syncFor(label.Device)
		c.Scale = 100
		c.Lower = nil
		rule := obj(obj(raw["assignment"])["rule_snapshot"])
		if str(rule["method_id"]) == method {
			if n, err := number(obj(rule["comparison"])["lower"]); err == nil && n > 0 && n <= 1 {
				c.Lower = ptr(n)
			}
		}
		next = &Run{ID: p.RunID, Order: label.Order, Config: c, Method: method, Started: time.Now().UTC(), State: "RUNNING", Source: "SIMULATED", Barcode: label.Code, Binding: label.Binding, Task: label.Task}
	}
	err = e.store.db.Update(func(tx *bolt.Tx) error {
		if p.Old != nil {
			old := *p.Old
			old.State = "ENDED"
			old.Ended = &p.Cutoff
			if err := tx.Bucket([]byte("runs")).Put([]byte(old.ID), marshal(old)); err != nil {
				return err
			}
		}
		if next != nil {
			if err := tx.Bucket([]byte("runs")).Put([]byte(next.ID), marshal(next)); err != nil {
				return err
			}
			if err := tx.Bucket([]byte("barcodes")).Put([]byte(label.Code), marshal(label)); err != nil {
				return err
			}
		}
		if p.RequestID != "" {
			if err := tx.Bucket([]byte("meta")).Put([]byte("scan-request:"+p.RequestID), marshal(p.RequestFingerprint)); err != nil {
				return err
			}
		}
		return tx.Bucket([]byte("meta")).Put([]byte("lifecycleIntent"), []byte("null"))
	})
	if err != nil {
		e.lastError = err.Error()
		return err
	}
	e.state = "IDLE"
	e.run = p.Old
	if e.run != nil {
		e.run.State = "ENDED"
		e.run.Ended = &p.Cutoff
	}
	if next != nil {
		e.run = next
		e.state = "RUNNING"
	}
	e.latest = nil
	e.resetGauges()
	e.recent = []Sample{}
	e.frequency = 0
	e.lastError = ""
	e.connected = false
	e.store.event("CENTER_"+action, map[string]any{"command_id": p.ID, "task": p.Task, "next_task": label.Task})
	return nil
}
func (e *Engine) powerOff() error {
	e.lifecycleMu.Lock()
	defer e.lifecycleMu.Unlock()
	var pending *lifecycleIntent
	e.store.meta("lifecycleIntent", &pending)
	if pending != nil {
		if pending.Code != "" {
			return fmt.Errorf("任务切换正在同步，请完成后关机")
		}
		return e.completeLifecycle(pending)
	}
	e.mu.Lock()
	r := e.run
	state := e.state
	e.mu.Unlock()
	if state == "IDLE" || state == "ENDED" {
		return nil
	}
	if r == nil || r.Task == "" {
		return e.stop()
	}
	p := &lifecycleIntent{ID: commandUUID(), Device: r.Config.DeviceID, Task: r.Task, Binding: r.Binding, Old: r}
	// A manual center end is already complete; power off locally without ending
	// another task that may have since been assigned to this device.
	a, err := assignmentFor(r.Config.DeviceID)
	if err == nil && str(a["task_id"]) != r.Task {
		return fmt.Errorf("中心已切换其他任务，请核对后关机")
	}
	return e.beginLifecycle(p)
}
func (e *Engine) lifecycleLoop(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		e.lifecycleMu.Lock()
		var p *lifecycleIntent
		e.store.meta("lifecycleIntent", &p)
		if p != nil {
			_ = e.completeLifecycle(p)
		}
		e.lifecycleMu.Unlock()
	}
}
