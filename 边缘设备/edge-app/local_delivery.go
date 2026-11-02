package main

import (
	"encoding/json"
	bolt "go.etcd.io/bbolt"
	"net/http"
)

type localBatch struct {
	Schema  string           `json:"schema_version"`
	Batch   string           `json:"batch_id"`
	Sent    string           `json:"sent_at"`
	Records []map[string]any `json:"records"`
}

func readLocalBatch(w http.ResponseWriter, r *http.Request) (localBatch, bool) {
	var b localBatch
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		fail(w, err)
		return b, false
	}
	if len(b.Records) == 0 || len(b.Records) > 500 {
		http.Error(w, "Expected 1..500 records", 400)
		return b, false
	}
	return b, true
}
func (e *Engine) localDeliveryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /edge/v1/measurements:accept", func(w http.ResponseWriter, r *http.Request) {
		b, ok := readLocalBatch(w, r)
		if !ok {
			return
		}
		if err := e.receive(b.Records); err != nil {
			fail(w, err)
			return
		}
		// receive commits samples, original payloads and the independent outbox in
		// one synced bbolt transaction before publishing or acknowledging anything.
		items := make([]map[string]any, 0, len(b.Records))
		err := e.store.db.View(func(tx *bolt.Tx) error {
			for _, record := range b.Records {
				var g gatewayRecord
				if err := json.Unmarshal(tx.Bucket([]byte("gatewayRecords")).Get([]byte(gatewayKey(record))), &g); err != nil {
					return err
				}
				items = append(items, map[string]any{"source_id": record["record_id"], "device_id": record["device_id"], "sample_id": g.SampleID, "status": "LOCAL_DURABLE"})
			}
			return nil
		})
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, map[string]any{"schema_version": "edge-local.1", "batch_id": b.Batch, "items": items})
	})
	mux.HandleFunc("POST /edge/v1/measurement-receipts", func(w http.ResponseWriter, r *http.Request) {
		b, ok := readLocalBatch(w, r)
		if !ok {
			return
		}
		items := make([]map[string]any, 0, len(b.Records))
		err := e.store.db.View(func(tx *bolt.Tx) error {
			for _, record := range b.Records {
				var g gatewayRecord
				value := tx.Bucket([]byte("gatewayRecords")).Get([]byte(gatewayKey(record)))
				if value != nil {
					if err := json.Unmarshal(value, &g); err != nil {
						return err
					}
				}
				items = append(items, map[string]any{"source_id": record["record_id"], "device_id": record["device_id"], "local_durable": value != nil, "receipt": g.Receipt})
			}
			return nil
		})
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, map[string]any{"schema_version": "edge-receipts.1", "items": items})
	})
}
