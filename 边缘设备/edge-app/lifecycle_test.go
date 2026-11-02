package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestScanLifecycleSwitchRetryAndPower(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	e := newEngine(s, dir)
	e.cfg.DeviceID = "HY-BY-01"
	code1 := "HYT1" + strings.Repeat("A", 32) + "V1"
	code2 := "HYT1" + strings.Repeat("B", 32) + "V1"
	active := ""
	bind := ""
	mutations := 0
	loseReply := false
	receipts := map[string]map[string]any{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/scan-preview/") {
			task := "t1"
			if strings.HasSuffix(r.URL.Path, code2) {
				task = "t2"
			}
			var a any
			if active != "" {
				a = map[string]any{"task_id": active, "binding_id": bind}
			}
			reply(w, map[string]any{"data": map[string]any{"task_id": task, "assignment": a}})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/assignment") {
			reply(w, map[string]any{"data": map[string]any{"assignment": map[string]any{"task_id": active, "binding_id": bind, "metric_code": "OVALITY"}}})
			return
		}
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		key := str(b["command_id"])
		result, ok := receipts[key]
		if !ok {
			mutations++
			if strings.HasSuffix(r.URL.Path, "task-stop") {
				active = ""
				bind = ""
				result = map[string]any{"label": nil}
			} else {
				active = "t1"
				if b["barcode"] == code2 {
					active = "t2"
				}
				bind = "binding-" + active
				result = map[string]any{"label": map[string]any{"barcode": "HYOV1" + strings.Repeat(strings.ToUpper(active[1:]), 20), "device_id": "HY-BY-01", "task_id": active, "binding_id": bind, "snapshot_hash": "hash", "order": Order{Code: "WO", Spool: active, Spec: "SP", Length: 100}, "assignment": map[string]any{"rule_snapshot": map[string]any{}}}}
			}
			receipts[key] = result
		}
		if loseReply {
			w.WriteHeader(503)
			reply(w, map[string]any{"message": "response lost"})
			return
		}
		reply(w, map[string]any{"data": result})
	}))
	defer server.Close()
	t.Setenv("EDGE_PLATFORM_URL", server.URL)
	t.Setenv("EDGE_PLATFORM_DEVICE_TOKEN", "test")
	if e.scan(code1, "", "") == nil {
		t.Fatal("off scanner accepted")
	}
	if mutations != 0 {
		t.Fatal("off scanner mutated center")
	}
	if err = e.arm(); err != nil {
		t.Fatal(err)
	}
	if err = e.scan(code1, "", ""); err != nil {
		t.Fatal(err)
	}
	first := e.run.ID
	requestID := commandUUID()
	if err = e.scanTask(code1, "", "", requestID); err != nil {
		t.Fatal(err)
	}
	retryRun := e.run.ID
	if err = e.scanTask(code1, "", "", requestID); err != nil || e.run.ID != retryRun || mutations != 2 {
		t.Fatal("request retry created another run", err)
	}
	if e.scanTask(code2, "", "", requestID) == nil {
		t.Fatal("request collision accepted")
	}
	first = retryRun
	if e.state != "RUNNING" || e.run.Task != "t1" {
		t.Fatal("scan did not start")
	}
	if err = e.scan(code1, "", ""); err != nil || e.run.ID == first || mutations != 3 {
		t.Fatal("repeat did not create separate run", err)
	}
	if e.scan(code2, "OTHER", "") == nil || mutations != 3 {
		t.Fatal("wrong device changed task")
	}
	loseReply = true
	if e.scan(code2, "", "") == nil || e.state != "SYNC_PENDING" {
		t.Fatal("lost reply not pending")
	}
	if e.scan(code1, "", "") == nil {
		t.Fatal("pending intent overwritten")
	}
	// Restart preserves the exact command. Center already committed task 2.
	e = newEngine(s, dir)
	e.cfg.DeviceID = "HY-BY-01"
	loseReply = false
	if err = e.scan(code2, "", ""); err != nil {
		t.Fatal(err)
	}
	if e.run.Task != "t2" || mutations != 4 {
		t.Fatal("recovery duplicated transition")
	}
	old, _ := s.run(first)
	if old.State != "ENDED" || old.Ended == nil {
		t.Fatal("old run not closed")
	}
	if err = e.powerOff(); err != nil {
		t.Fatal(err)
	}
	if e.state != "IDLE" || active != "" || mutations != 5 {
		t.Fatal("power off not synced")
	}
	if err = e.powerOff(); err != nil || mutations != 5 {
		t.Fatal("power off not idempotent")
	}
}

func TestClosedRunRejectsSamplesAfterBoundary(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	now := time.Now().UTC()
	r := Run{ID: "old", Task: "t1", Binding: "b1", Source: "SIMULATED", State: "ENDED", Started: now.Add(-time.Minute), Ended: &now}
	s.saveRun(r)
	e := newEngine(s, t.TempDir())
	err = e.receive([]map[string]any{{"task_id": "t1", "binding_id": "b1", "sample_time": now.Add(time.Second).Format(time.RFC3339Nano)}})
	if err == nil || !strings.Contains(err.Error(), "切换前") {
		t.Fatal("late new sample accepted", err)
	}
}
