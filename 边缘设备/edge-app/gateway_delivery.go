package main

import (
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"strconv"
)

func sheathEnvelope(s *SheathResult) any {
	if s == nil {
		return nil
	}
	// JSON raw contract forbids fractional JSON numbers, avoiding implicit
	// client/runtime rounding. IDs remain integral, decimals travel as text.
	var v map[string]any
	_ = json.Unmarshal(marshal(s), &v)
	for k, n := range v {
		if f, ok := n.(float64); ok {
			v[k] = strconv.FormatFloat(f, 'f', -1, 64)
		}
	}
	return v
}

func (e *Engine) projectedPending(limit int) []map[string]any {
	e.mu.Lock()
	cursorKey := e.tsCursorKey
	e.mu.Unlock()
	records := []map[string]any{}
	batchBytes := 1024
	if cursorKey == "" {
		return records
	}
	_ = e.store.db.View(func(tx *bolt.Tx) error {
		var cursor influxCursor
		if json.Unmarshal(tx.Bucket([]byte("meta")).Get([]byte(cursorKey)), &cursor) != nil {
			return nil
		}
		c := tx.Bucket([]byte("gatewayPending")).Cursor()
		for k, _ := c.First(); k != nil && len(records) < limit; k, _ = c.Next() {
			var g gatewayRecord
			if json.Unmarshal(tx.Bucket([]byte("gatewayRecords")).Get(k), &g) == nil && g.SampleID > 0 && g.SampleID <= cursor.ID {
				size := len(marshal(g.Payload)) + 1
				if len(records) > 0 && batchBytes+size > 900000 {
					break
				}
				records = append(records, g.Payload)
				batchBytes += size
			}
		}
		return nil
	})
	return records
}

// The sender retries its original identity until the durable center receipt
// exists. Never acknowledge local-only storage as center STORED.
func (e *Engine) gatewayReceipt(batch string, records []map[string]any) ([]byte, error) {
	items := []map[string]any{}
	counts := map[string]int{"total": len(records), "stored": 0, "duplicate": 0, "quarantined": 0, "rejected": 0}
	err := e.store.db.View(func(tx *bolt.Tx) error {
		for i, r := range records {
			var g gatewayRecord
			if json.Unmarshal(tx.Bucket([]byte("gatewayRecords")).Get([]byte(gatewayKey(r))), &g) != nil || g.Receipt == nil {
				return fmt.Errorf("边缘已持久保存，等待本地时序与中心确认；请保留来源键重试")
			}
			v := g.Receipt
			v["input_index"] = i
			switch str(v["receipt_status"]) {
			case "STORED":
				counts["stored"]++
			case "DUPLICATE":
				counts["duplicate"]++
			case "QUARANTINED":
				counts["quarantined"]++
			case "REJECTED":
				counts["rejected"]++
			default:
				return fmt.Errorf("中心回执无效，队列保留")
			}
			items = append(items, v)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return marshal(map[string]any{"code": "OK", "message": "中心已确认", "request_id": "edge-" + uid(), "data": map[string]any{"schema_version": "1.0", "batch_id": batch, "counts": counts, "items": items}}), nil
}
