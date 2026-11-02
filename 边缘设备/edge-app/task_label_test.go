package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPrintedTaskLabelResolvesWithoutStarting(t *testing.T) {
	s, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	e := newEngine(s, t.TempDir())
	e.cfg.DeviceID = "HY-BY-01"
	code := "HYT1AB123456123443218111ABCDEFABCDEFV1"
	label := scanLabel{Code: "HYOV1" + strings.Repeat("A", 20), Device: "HY-BY-01", Task: "task-1", Binding: "binding-1", Hash: "hash-1", Order: Order{Code: "WO", Spool: "P1", Spec: "SP", Length: 100}}
	reject := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("missing device authentication")
		}
		switch r.URL.Path {
		case "/api/v1/task-labels/" + code:
			if reject {
				w.WriteHeader(409)
				reply(w, map[string]any{"message": "任务归属已更正"})
				return
			}
			reply(w, map[string]any{"data": label})
		case "/api/v1/devices/HY-BY-01/assignment":
			reply(w, map[string]any{"data": map[string]any{"assignment": map[string]any{"task_id": label.Task, "binding_id": label.Binding, "snapshot_hash": label.Hash, "metric_code": "OVALITY"}}})
		default:
			t.Error("unexpected route", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	t.Setenv("EDGE_PLATFORM_URL", server.URL)
	t.Setenv("EDGE_PLATFORM_DEVICE_TOKEN", "test-token")
	got, err := e.label(code)
	if err != nil || got.Task != label.Task || got.Code != label.Code {
		t.Fatalf("resolve failed: %v", err)
	}
	if e.state != "IDLE" {
		t.Fatal("label lookup started acquisition")
	}
	reject = true
	if _, err = e.label(code); err == nil {
		t.Fatal("stale printed label accepted from cache")
	}
}
