package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCenterRetryAndBusinessACK(t *testing.T) {
	s, _ := openStore(t.TempDir())
	defer s.db.Close()
	s.set("installationId", "install-test")
	r := Run{ID: "center-test", Config: defaultConfig()}
	for i := 0; i < 2; i++ {
		p := calculate([6]uint16{2, 39800, 40000, 0, 39600, 0}, r.Config, r.ID, nil)
		if err := s.append(&p, &r); err != nil {
			t.Fatal(err)
		}
	}
	var calls atomic.Int32
	seen := make(chan bool, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 32) {
			t.Error("auth missing")
		}
		var b CenterBatch
		json.NewDecoder(req.Body).Decode(&b)
		n := calls.Add(1)
		if n == 1 {
			reply(w, map[string]any{"success": true})
			seen <- true
			return
		}
		reply(w, map[string]any{"batchId": b.BatchID, "acceptedIds": []uint64{1, 2}})
		seen <- true
	}))
	defer server.Close()
	t.Setenv("EDGE_CENTER_URL", server.URL)
	t.Setenv("EDGE_CENTER_TOKEN", strings.Repeat("a", 32))
	t.Setenv("EDGE_ALLOW_INSECURE_CENTER", "local-test-only")
	e := newEngine(s, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { e.center(ctx); close(done) }()
	<-seen
	var cursor uint64
	s.meta("centerCursor", &cursor)
	if cursor != 0 {
		t.Fatal("HTTP200 advanced cursor without business ACK")
	}
	select {
	case <-seen:
	case <-time.After(10 * time.Second):
		t.Fatal("no retry")
	}
	for i := 0; i < 50; i++ {
		s.meta("centerCursor", &cursor)
		if cursor == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if cursor != 2 {
		t.Fatal("confirmed cursor not persisted")
	}
	cancel()
	<-done
}
func TestInboundOrderIdempotency(t *testing.T) {
	s, _ := openStore(t.TempDir())
	defer s.db.Close()
	e := newEngine(s, t.TempDir())
	token := strings.Repeat("b", 32)
	t.Setenv("EDGE_INBOUND_TOKEN", token)
	h := handler(e)
	o := Order{Code: "C1", Spool: "P1", Spec: "S1", Length: 100}
	put := func(o Order) int {
		req := httptest.NewRequest("PUT", "/edge/v1/orders/external-1", bytes.NewReader(marshal(o)))
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}
	if put(o) != 200 || put(o) != 200 {
		t.Fatal("not idempotent")
	}
	o.Length = 200
	if put(o) != 400 {
		t.Fatal("conflicting payload accepted")
	}
	if e.state != "IDLE" {
		t.Fatal("center order started acquisition automatically")
	}
}
