package main

import (
	"context"
	"encoding/json"
	bolt "go.etcd.io/bbolt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSC01PendingBatchByteLimitPreservesRemainder(t *testing.T) {
	s, _ := openStore(t.TempDir())
	defer s.db.Close()
	e := newEngine(s, t.TempDir())
	e.tsCursorKey = "projection"
	s.set(e.tsCursorKey, influxCursor{ID: 30})
	s.db.Update(func(tx *bolt.Tx) error {
		for i := 0; i < 30; i++ {
			r := map[string]any{"device_id": "d", "record_id": string(rune('a' + i)), "raw": strings.Repeat("x", 50000)}
			k := []byte(gatewayKey(r))
			tx.Bucket([]byte("gatewayRecords")).Put(k, marshal(gatewayRecord{Payload: r, SampleID: uint64(i + 1)}))
			tx.Bucket([]byte("gatewayPending")).Put(k, []byte{1})
		}
		return nil
	})
	batch := e.projectedPending(500)
	if len(batch) == 0 || len(batch) >= 30 || len(marshal(batch)) > 900000 {
		t.Fatal("batch must split by byte size", len(batch))
	}
	s.db.View(func(tx *bolt.Tx) error {
		if tx.Bucket([]byte("gatewayPending")).Stats().KeyN != 30 {
			t.Fatal("selection removed pending records")
		}
		return nil
	})
}

func TestSC01ProjectionGateReceiptsAndRestart(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	e := newEngine(s, t.TempDir())
	records := []map[string]any{{"device_id": "test", "record_id": "one"}, {"device_id": "test", "record_id": "two"}}
	for i, r := range records {
		err = s.db.Update(func(tx *bolt.Tx) error {
			k := []byte(gatewayKey(r))
			if err := tx.Bucket([]byte("gatewayRecords")).Put(k, marshal(gatewayRecord{Digest: "test", Payload: r, SampleID: uint64(i + 1)})); err != nil {
				return err
			}
			return tx.Bucket([]byte("gatewayPending")).Put(k, []byte{1})
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(e.projectedPending(500)) != 0 {
		t.Fatal("sent before local TS target ready")
	}
	e.tsCursorKey = "test-projection"
	s.set(e.tsCursorKey, influxCursor{ID: 1})
	if len(e.projectedPending(500)) != 1 {
		t.Fatal("unprojected sample escaped")
	}
	if _, err = e.gatewayReceipt("b", records); err == nil {
		t.Fatal("local persistence falsely acknowledged")
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Records []map[string]any `json:"records"`
		}
		json.NewDecoder(r.Body).Decode(&b)
		if calls.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		items := []map[string]any{}
		for i, v := range b.Records {
			items = append(items, map[string]any{"input_index": i, "source_id": v["record_id"], "receipt_status": "STORED", "stored_id": "id-" + str(v["record_id"]), "retryable": false})
		}
		reply(w, map[string]any{"code": "OK", "data": map[string]any{"items": items}})
	}))
	defer server.Close()
	t.Setenv("EDGE_PLATFORM_URL", server.URL)
	t.Setenv("EDGE_PLATFORM_DEVICE_TOKEN", "test-token")
	s.set(e.tsCursorKey, influxCursor{ID: 2})
	_, status, err := e.forward(context.Background(), records)
	if err != nil || status != 503 {
		t.Fatal(status, err)
	}
	if len(e.projectedPending(500)) != 2 {
		t.Fatal("network failure removed samples")
	}
	_, status, err = e.forward(context.Background(), records)
	if err != nil || status != 200 {
		t.Fatal(status, err)
	}
	if len(e.projectedPending(500)) != 0 {
		t.Fatal("ack not committed")
	}
	s.db.Close()
	s, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	e = newEngine(s, t.TempDir())
	ack, err := e.gatewayReceipt("retry", []map[string]any{records[1], records[0]})
	if err != nil {
		t.Fatal(err)
	}
	var b map[string]any
	json.Unmarshal(ack, &b)
	items := obj(b["data"])["items"].([]any)
	if obj(items[0])["source_id"] != "two" || obj(items[0])["input_index"] != float64(0) {
		t.Fatal("receipt reordered incorrectly")
	}
}

func TestSC01OneSecondBatchNoPointLoss(t *testing.T) {
	s, _ := openStore(t.TempDir())
	defer s.db.Close()
	e := newEngine(s, t.TempDir())
	e.tsCursorKey = "projection"
	s.set(e.tsCursorKey, influxCursor{ID: 3})
	s.db.Update(func(tx *bolt.Tx) error {
		for _, id := range []string{"a", "b", "c"} {
			r := map[string]any{"device_id": "d", "record_id": id}
			k := []byte(gatewayKey(r))
			tx.Bucket([]byte("gatewayRecords")).Put(k, marshal(gatewayRecord{Payload: r, SampleID: 1}))
			tx.Bucket([]byte("gatewayPending")).Put(k, []byte{1})
		}
		return nil
	})
	received := make(chan int, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Records []map[string]any `json:"records"`
		}
		json.NewDecoder(r.Body).Decode(&b)
		received <- len(b.Records)
		w.WriteHeader(503)
	}))
	defer server.Close()
	t.Setenv("EDGE_PLATFORM_URL", server.URL)
	t.Setenv("EDGE_PLATFORM_DEVICE_TOKEN", "test")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { e.gatewayLoop(ctx); close(done) }()
	select {
	case <-received:
		t.Fatal("uploaded immediately instead of next tick")
	case <-time.After(300 * time.Millisecond):
	}
	select {
	case n := <-received:
		if n != 3 {
			t.Fatal("points averaged or dropped", n)
		}
	case <-time.After(1800 * time.Millisecond):
		t.Fatal("no one-second upload")
	}
	cancel()
	<-done
}
