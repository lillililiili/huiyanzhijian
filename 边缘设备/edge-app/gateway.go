package main

// The gateway accepts simulated instrument frames, not pre-approved conclusions.
// Original identity, source environment and task binding survive the whole path.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type scanLabel struct {
	Code    string `json:"barcode"`
	Device  string `json:"device_id"`
	Task    string `json:"task_id"`
	Binding string `json:"binding_id"`
	Hash    string `json:"snapshot_hash"`
	Order   Order  `json:"order"`
}
type gatewayRecord struct {
	Digest   string         `json:"digest"`
	Payload  map[string]any `json:"payload"`
	SampleID uint64         `json:"sampleId"`
	Receipt  map[string]any `json:"receipt,omitempty"`
}

var barcodePattern = regexp.MustCompile(`^HYOV1[0-9A-F]{20}$`)

func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func str(v any) string         { s, _ := v.(string); return s }
func number(v any) (float64, error) {
	n, err := strconv.ParseFloat(fmt.Sprint(v), 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, fmt.Errorf("物理量无效")
	}
	return n, nil
}
func platformRequest(ctx context.Context, path string, body any) ([]byte, int, error) {
	base := strings.TrimRight(os.Getenv("EDGE_PLATFORM_URL"), "/")
	token := os.Getenv("EDGE_PLATFORM_DEVICE_TOKEN")
	if base == "" || token == "" {
		return nil, 503, fmt.Errorf("中心平台接入未配置")
	}
	method := "GET"
	var data io.Reader
	if body != nil {
		method = "POST"
		data = bytes.NewReader(marshal(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, base+"/api/v1"+path, data)
	if err != nil {
		return nil, 503, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Huiyan-Edge-Token", os.Getenv("OVALITY_EDGE_TOKEN"))
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, 503, fmt.Errorf("中心暂不可达，待传数据已保留")
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	return b, res.StatusCode, err
}
func assignmentFor(device string) (map[string]any, error) {
	b, status, err := platformRequest(context.Background(), "/devices/"+url.PathEscape(device)+"/assignment", nil)
	if err != nil {
		return nil, err
	}
	if status != 200 {
		return nil, fmt.Errorf("中心任务查询失败（%d）", status)
	}
	var res map[string]any
	if json.Unmarshal(b, &res) != nil {
		return nil, fmt.Errorf("中心返回无效任务")
	}
	a := obj(obj(res["data"])["assignment"])
	if a == nil || str(a["metric_code"]) != "OVALITY" {
		return nil, fmt.Errorf("此设备没有运行中的不圆度任务")
	}
	return a, nil
}
func (e *Engine) saveLabel(l scanLabel) (scanLabel, error) {
	if !barcodePattern.MatchString(l.Code) || l.Device == "" || l.Task == "" {
		return l, fmt.Errorf("条码格式无效")
	}
	if err := l.Order.validate(); err != nil {
		return l, err
	}
	a, err := assignmentFor(l.Device)
	if err != nil {
		return l, err
	}
	if a["task_id"] != l.Task || a["binding_id"] != l.Binding || a["snapshot_hash"] != l.Hash {
		return l, fmt.Errorf("条码任务绑定已变化，请重新生成")
	}
	err = e.store.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("barcodes"))
		old := b.Get([]byte(l.Code))
		if old != nil && !bytes.Equal(old, marshal(l)) {
			return fmt.Errorf("条码已登记且内容不同，请刷新任务")
		}
		return b.Put([]byte(l.Code), marshal(l))
	})
	return l, err
}
func (e *Engine) label(code string) (scanLabel, error) {
	if isTaskLabel(code) {
		return e.resolveTaskLabel(code)
	}
	var l scanLabel
	err := e.store.db.View(func(tx *bolt.Tx) error {
		v := tx.Bucket([]byte("barcodes")).Get([]byte(code))
		if v == nil {
			return fmt.Errorf("条码未登记，请在模拟器重新生成本任务条码")
		}
		return json.Unmarshal(v, &l)
	})
	return l, err
}
func (e *Engine) arm() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == "WAITING_SCAN" || e.state == "RUNNING" {
		return nil
	}
	if e.state == "RUNNING" || e.state == "PAUSED" || e.state == "STOPPING" || e.state == "FAULT" {
		return fmt.Errorf("请先结束当前盘")
	}
	if e.state == "SYNC_PENDING" {
		return fmt.Errorf("正在同步上次任务操作，请等待中心确认")
	}
	e.state = "WAITING_SCAN"
	e.run = nil
	e.latest = nil
	e.resetGauges()
	e.recent = []Sample{}
	e.connected = false
	e.lastError = ""
	return e.store.event("WAITING_SCAN", nil)
}
func (e *Engine) scan(code, device, task string) error {
	// Existing center-staged physical orders remain scannable by external ID.
	// They use the configured RTU/TCP collector, never the simulator gateway.
	code = strings.TrimSpace(code)
	if isTaskLabel(code) {
		return e.scanTask(code, device, task)
	}
	if !barcodePattern.MatchString(code) && device == "" && task == "" {
		var order Order
		err := e.store.db.View(func(tx *bolt.Tx) error {
			v := tx.Bucket([]byte("orders")).Get([]byte(code))
			if v == nil {
				return fmt.Errorf("条码未登记，请核对送检条码")
			}
			return json.Unmarshal(v, &order)
		})
		if err != nil {
			return err
		}
		e.mu.Lock()
		ready := e.state == "WAITING_SCAN"
		e.mu.Unlock()
		if !ready {
			return fmt.Errorf("请先点击开始采集，等待扫码")
		}
		return e.start(order)
	}
	l, err := e.label(strings.TrimSpace(code))
	if err != nil {
		return err
	}
	if (device != "" && device != l.Device) || (task != "" && task != l.Task) {
		return fmt.Errorf("上传条码与所选设备、任务不一致")
	}
	a, err := assignmentFor(l.Device)
	if err != nil {
		return err
	}
	if a["task_id"] != l.Task || a["binding_id"] != l.Binding || a["snapshot_hash"] != l.Hash {
		return fmt.Errorf("此条码绑定已过期，请重新生成")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == "RUNNING" && e.run != nil && e.run.Barcode == l.Code {
		return nil
	}
	if e.state != "WAITING_SCAN" {
		return fmt.Errorf("请先在边缘终端点击开始采集，进入等待扫码")
	}
	c := e.cfg
	c.DeviceID = l.Device
	c.Sync = e.syncFor(l.Device)
	c.Scale = 100 // SIM02 register contract: 0.01 mm, separate from physical instrument settings.
	c.Lower = nil
	rule := obj(a["rule_snapshot"])
	if str(rule["method_id"]) == method {
		if n, err := number(obj(rule["comparison"])["lower"]); err == nil && n > 0 && n <= 1 {
			c.Lower = ptr(n)
		}
	}
	r := Run{ID: uid(), Order: l.Order, Config: c, Method: method, Started: time.Now().UTC(), State: "RUNNING", Source: "SIMULATED", Barcode: l.Code, Binding: l.Binding, Task: l.Task}
	if err = e.store.saveRun(r); err != nil {
		return err
	}
	e.run = &r
	e.state = "RUNNING"
	e.latest = nil
	e.resetGauges()
	e.recent = []Sample{}
	e.lastError = ""
	e.connected = false
	// Simulator submits RTU frames through the authenticated gateway. Physical
	// Modbus acquisition keeps its independent serial/TCP adapter.
	e.cancel = nil
	e.done = nil
	return e.store.event("SCAN_BOUND", l)
}
func gatewayKey(r map[string]any) string { return str(r["device_id"]) + "/" + str(r["record_id"]) }
func (e *Engine) receive(records []map[string]any) error {
	// Late delivery keeps the original run. Only samples captured before the
	// locally persisted cutover are accepted, never appended to the new run.
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(records) > 0 && e.state != "SYNC_PENDING" && (e.run == nil || str(records[0]["binding_id"]) != e.run.Binding || e.state != "RUNNING") {
		for _, old := range e.store.runs() {
			if old.Source != "SIMULATED" || old.Ended == nil || old.Binding != str(records[0]["binding_id"]) {
				continue
			}
			for _, r := range records {
				at, err := time.Parse(time.RFC3339Nano, str(r["sample_time"]))
				if err != nil || at.Before(old.Started) || at.After(*old.Ended) || str(r["task_id"]) != old.Task || str(r["binding_id"]) != old.Binding {
					return fmt.Errorf("旧任务仅接收切换前已采样的迟到记录")
				}
			}
			history := &Engine{store: e.store, run: &old, state: "RUNNING", dir: e.dir}
			return history.receiveCurrent(records)
		}
	}
	return e.receiveCurrent(records)
}
func (e *Engine) receiveCurrent(records []map[string]any) error {
	if len(records) == 0 || len(records) > 500 {
		return fmt.Errorf("每批须为1～500条记录")
	}
	var disk syscall.Statfs_t
	if err := syscall.Statfs(e.dir, &disk); err == nil && disk.Bavail*uint64(disk.Bsize) < 512*1024*1024 {
		return fmt.Errorf("磁盘不足512MB，停止接收，已有队列保留")
	}
	// All input must be valid before committing any part of a batch.
	type prepared struct {
		k string
		g gatewayRecord
		s Sample
		b *Sample
	}
	rows := []prepared{}
	seen := map[string]string{}
	for _, original := range records {
		digest := fmt.Sprintf("%x", sha256.Sum256(marshal(original)))
		k := gatewayKey(original)
		if prior, ok := seen[k]; ok {
			if prior != digest {
				return fmt.Errorf("同批记录ID冲突")
			}
			continue
		}
		seen[k] = digest
		var old gatewayRecord
		e.store.db.View(func(tx *bolt.Tx) error {
			v := tx.Bucket([]byte("gatewayRecords")).Get([]byte(k))
			if v != nil {
				return json.Unmarshal(v, &old)
			}
			return nil
		})
		if old.Digest != "" {
			if old.Digest != digest {
				return fmt.Errorf("相同记录ID内容发生变化，原记录保留")
			}
			// Upgrade legacy records without an ack ledger through center dedup.
			if old.Receipt == nil {
				if err := e.store.db.Update(func(tx *bolt.Tx) error { return tx.Bucket([]byte("gatewayPending")).Put([]byte(k), []byte{1}) }); err != nil {
					return err
				}
			}
			continue
		}
		if e.run == nil || e.state != "RUNNING" || e.run.Source != "SIMULATED" {
			return fmt.Errorf("边缘端未扫码开始或已暂停，请恢复采集后补传")
		}
		if original["task_id"] != e.run.Task || original["binding_id"] != e.run.Binding || original["device_id"] != e.run.Config.DeviceID || original["data_environment"] != "SIMULATED" {
			return fmt.Errorf("测量来源与扫码绑定不匹配")
		}
		values, ok := original["values"].([]any)
		if !ok || len(values) != 1 || obj(values[0])["metric_code"] != "OVALITY" {
			return fmt.Errorf("此接口仅接受不圆度记录")
		}
		if str(original["record_id"]) == "" {
			return fmt.Errorf("缺少原始记录ID")
		}
		var r map[string]any
		json.Unmarshal(marshal(original), &r)
		raw := obj(obj(r["raw"])["data"])
		obs := obj(raw["observation"])
		regs := obj(obs["registers"])
		frame, err := hex.DecodeString(strings.Join(strings.Fields(str(regs["rx_frame_hex"])), ""))
		if err != nil {
			return fmt.Errorf("Modbus帧不是有效十六进制")
		}
		c := e.run.Config
		c.Slave = 1
		reg, err := decodeRTU(frame, c)
		if err != nil {
			return err
		}
		s := calculate(reg, c, e.run.ID, frame)
		s.Source = "SIMULATED"
		at, err := time.Parse(time.RFC3339Nano, str(r["sample_time"]))
		if err != nil {
			return fmt.Errorf("采集时间无效")
		}
		s.At = at
		value := obj(r["values"].([]any)[0])
		if str(r["data_status"]) == "VALID" {
			if !s.Valid {
				return fmt.Errorf("正常数据与Modbus状态不一致")
			}
			// The simulated physical geometry has higher precision than its 0.01mm
			// transport preview. Preserve it, but verify the register projection.
			x, ex := number(obs["diameter_x_mm"])
			y, ey := number(obs["diameter_y_mm"])
			if ex != nil || ey != nil || x <= 0 || y <= 0 || math.Round(x*100) != float64(reg[2]) || math.Round(y*100) != float64(reg[4]) {
				return fmt.Errorf("双轴原始值与寄存器不一致")
			}
			ratio := math.Min(x, y) / math.Max(x, y)
			s.X = ptr(x)
			s.Y = ptr(y)
			s.Ratio = ptr(ratio)
			scalar := ratio
			if str(value["method_id"]) != method {
				scalar = 200 * math.Abs(x-y) / (x + y)
			}
			value["value"] = strconv.FormatFloat(scalar, 'f', 10, 64)
			raw["provided_scalar"] = value["value"]
			s.Verdict = "UNDETERMINED"
			if c.Lower != nil {
				s.Verdict = "PASS"
				if ratio < *c.Lower {
					s.Verdict = "FAIL"
				}
			}
			if str(value["method_id"]) == method {
				value["source_quality_result"] = s.Verdict
				if s.Verdict == "UNDETERMINED" {
					value["source_quality_result"] = "NOT_EVALUATED"
				}
			}
		} else {
			if s.Valid {
				return fmt.Errorf("无效数据与Modbus状态不一致")
			}
			value["value"] = nil
			value["source_quality_result"] = "NOT_EVALUATED"
		}
		raw["edge_gateway"] = map[string]any{"id": os.Getenv("EDGE_GATEWAY_ID"), "run_id": e.run.ID, "method": method, "barcode": e.run.Barcode, "transport": "MODBUS_RTU_FRAME", "source_environment": "SIMULATED"}
		b, err := simulatedMeter(raw, &s, e.run)
		if err != nil {
			return err
		}
		rows = append(rows, prepared{k, gatewayRecord{Digest: digest, Payload: r}, s, b})
	}
	if len(rows) == 0 {
		return nil
	}
	run := *e.run
	err := e.store.db.Update(func(tx *bolt.Tx) error {
		for i := range rows {
			p := &rows[i]
			if p.b != nil {
				if err := appendSample(tx, p.b, &run); err != nil {
					return err
				}
			}
			if err := appendSample(tx, &p.s, &run); err != nil {
				return err
			}
			p.g.SampleID = p.s.ID
			// Decimal values are strings in the center's raw envelope. Preserve
			// the exact pairing provenance separately from the OVALITY metric.
			obj(obj(p.g.Payload["raw"])["data"])["edge_sheath"] = sheathEnvelope(p.s.Sheath)
			if err := tx.Bucket([]byte("gatewayRecords")).Put([]byte(p.k), marshal(p.g)); err != nil {
				return err
			}
			if err := tx.Bucket([]byte("gatewayPending")).Put([]byte(p.k), []byte{1}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	e.run = &run
	e.connected = true
	e.lastError = ""
	for _, p := range rows {
		if p.b != nil {
			e.publishSample(*p.b)
		}
		e.publishSample(p.s)
	}
	cutoff := time.Now().Add(-60 * time.Second)
	n := 0
	for n < len(e.recent) && e.recent[n].At.Before(cutoff) {
		n++
	}
	e.recent = e.recent[n:]
	if len(e.recent) > 30000 {
		e.recent = e.recent[len(e.recent)-30000:]
	}
	if len(e.recent) > 1 {
		seconds := e.recent[len(e.recent)-1].At.Sub(e.recent[0].At).Seconds()
		if seconds > 0 {
			e.frequency = float64(len(e.recent)-1) / seconds
		}
	}
	return nil
}
func (e *Engine) forward(ctx context.Context, records []map[string]any) ([]byte, int, error) {
	payloads := []map[string]any{}
	err := e.store.db.View(func(tx *bolt.Tx) error {
		for _, r := range records {
			var g gatewayRecord
			if json.Unmarshal(tx.Bucket([]byte("gatewayRecords")).Get([]byte(gatewayKey(r))), &g) != nil {
				return fmt.Errorf("待传记录不存在")
			}
			payloads = append(payloads, g.Payload)
		}
		return nil
	})
	if err != nil {
		return nil, 400, err
	}
	b, status, err := platformRequest(ctx, "/measurements:ingest", map[string]any{"schema_version": "1.0", "batch_id": "edge-" + uid(), "sent_at": time.Now().UTC().Format(time.RFC3339Nano), "records": payloads})
	if err != nil {
		return b, status, err
	}
	if status != 200 {
		return b, status, nil
	}
	var reply map[string]any
	if json.Unmarshal(b, &reply) != nil {
		return nil, 503, fmt.Errorf("中心回执格式无效，队列保留")
	}
	data := obj(reply["data"])
	items, ok := data["items"].([]any)
	if str(reply["code"]) != "OK" || !ok || len(items) != len(records) {
		return nil, 503, fmt.Errorf("中心回执数量不一致，队列保留")
	}
	confirmed := []string{}
	receipts := map[string]map[string]any{}
	rejected := map[string]any{}
	for i, item := range items {
		v := obj(item)
		index, _ := number(v["input_index"])
		if index != float64(i) || v["source_id"] != records[i]["record_id"] {
			return nil, 503, fmt.Errorf("中心回执身份不一致，队列保留")
		}
		status := str(v["receipt_status"])
		if status == "REJECTED" && v["retryable"] == false {
			rejected[gatewayKey(records[i])] = v
			confirmed = append(confirmed, gatewayKey(records[i]))
		}
		if status == "STORED" || status == "DUPLICATE" || status == "QUARANTINED" {
			confirmed = append(confirmed, gatewayKey(records[i]))
		}
		if status == "STORED" || status == "DUPLICATE" || status == "QUARANTINED" || (status == "REJECTED" && v["retryable"] == false) {
			receipts[gatewayKey(records[i])] = v
		}
	}
	err = e.store.db.Update(func(tx *bolt.Tx) error {
		for k, v := range rejected {
			if err := tx.Bucket([]byte("gatewayRejected")).Put([]byte(k), marshal(v)); err != nil {
				return err
			}
		}
		for _, k := range confirmed {
			var g gatewayRecord
			if err := json.Unmarshal(tx.Bucket([]byte("gatewayRecords")).Get([]byte(k)), &g); err != nil {
				return err
			}
			g.Receipt = receipts[k]
			if err := tx.Bucket([]byte("gatewayRecords")).Put([]byte(k), marshal(g)); err != nil {
				return err
			}
			if err := tx.Bucket([]byte("gatewayPending")).Delete([]byte(k)); err != nil {
				return err
			}
		}
		return nil
	})
	return b, status, err
}
func (e *Engine) gatewayLoop(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		records := e.projectedPending(500)
		if len(records) == 0 {
			continue
		}
		_, status, err := e.forward(ctx, records)
		e.mu.Lock()
		if err != nil {
			e.centerError = err.Error()
		} else if status != 200 {
			e.centerError = fmt.Sprintf("中心暂未确认（%d），记录保留", status)
		} else {
			e.centerError = ""
		}
		e.mu.Unlock()
	}
}
func (e *Engine) gatewayRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /edge/v1/scanner-state", func(w http.ResponseWriter, r *http.Request) {
		s := e.status()
		out := map[string]any{}
		for _, k := range []string{"state", "run", "stored", "tsPending", "centerPending", "centerRejected", "tsError", "centerError", "time"} {
			out[k] = s[k]
		}
		reply(w, out)
	})
	mux.HandleFunc("POST /edge/v1/barcodes", func(w http.ResponseWriter, r *http.Request) {
		var l scanLabel
		if err := decode(w, r, &l); err != nil {
			fail(w, err)
			return
		}
		l, err := e.saveLabel(l)
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, l)
	})
	mux.HandleFunc("GET /edge/v1/barcodes/{code}", func(w http.ResponseWriter, r *http.Request) {
		l, err := e.label(r.PathValue("code"))
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, l)
	})
	scan := func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Barcode   string `json:"barcode"`
			Device    string `json:"device_id"`
			Task      string `json:"task_id"`
			RequestID string `json:"request_id"`
		}
		if err := decode(w, r, &b); err != nil {
			fail(w, err)
			return
		}
		var scanErr error
		if b.RequestID != "" && (len(b.RequestID) != 36 || strings.ContainsAny(b.RequestID, " /\\")) {
			scanErr = fmt.Errorf("扫码请求标识无效")
		} else if isTaskLabel(strings.TrimSpace(b.Barcode)) {
			scanErr = e.scanTask(strings.TrimSpace(b.Barcode), b.Device, b.Task, b.RequestID)
		} else {
			scanErr = e.scan(b.Barcode, b.Device, b.Task)
		}
		if err := scanErr; err != nil {
			fail(w, err)
			return
		}
		reply(w, e.status())
	}
	mux.HandleFunc("POST /edge/v1/scan", scan)
	mux.HandleFunc("POST /api/scan", scan)
	mux.HandleFunc("POST /edge/v1/measurements", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var b struct {
			Schema  string           `json:"schema_version"`
			Batch   string           `json:"batch_id"`
			Sent    string           `json:"sent_at"`
			Records []map[string]any `json:"records"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			fail(w, err)
			return
		}
		if err := e.receive(b.Records); err != nil {
			fail(w, err)
			return
		}
		data, err := e.gatewayReceipt(b.Batch, b.Records)
		// Wait briefly for the next scheduled flush, without uploading from
		// this handler. The producer keeps capturing independently.
		deadline := time.NewTimer(2 * time.Second)
		poll := time.NewTicker(100 * time.Millisecond)
	waitAck:
		for err != nil {
			select {
			case <-r.Context().Done():
				break waitAck
			case <-deadline.C:
				break waitAck
			case <-poll.C:
				data, err = e.gatewayReceipt(b.Batch, b.Records)
			}
		}
		deadline.Stop()
		poll.Stop()
		if err != nil {
			w.Header().Set("Retry-After", "1")
			http.Error(w, err.Error(), 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write(data)
	})
}
