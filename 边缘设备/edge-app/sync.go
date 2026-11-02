package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func post(client *http.Client, url, token string, b []byte) ([]byte, error) {
	req, e := http.NewRequest("POST", url, bytes.NewReader(b))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	out, e := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return out, e
}

type CenterBatch struct {
	Contract string   `json:"contract"`
	DeviceID string   `json:"deviceId"`
	BatchID  string   `json:"batchId"`
	Records  []Sample `json:"records"`
	Runs     []Run    `json:"runs"`
}

func checkACK(b []byte, batch CenterBatch) error {
	var ack struct {
		BatchID  string   `json:"batchId"`
		Accepted []uint64 `json:"acceptedIds"`
	}
	if err := json.Unmarshal(b, &ack); err != nil {
		return err
	}
	if ack.BatchID != batch.BatchID || len(ack.Accepted) != len(batch.Records) {
		return fmt.Errorf("中心未确认整个批次")
	}
	ids := map[uint64]bool{}
	for _, id := range ack.Accepted {
		if ids[id] {
			return fmt.Errorf("重复确认ID")
		}
		ids[id] = true
	}
	for _, s := range batch.Records {
		if !ids[s.ID] {
			return fmt.Errorf("中心未确认记录%d", s.ID)
		}
	}
	return nil
}
func (e *Engine) center(ctx context.Context) {
	url, token := os.Getenv("EDGE_CENTER_URL"), os.Getenv("EDGE_CENTER_TOKEN")
	if url == "" {
		return
	}
	if len(token) < 32 || (!strings.HasPrefix(url, "https://") && os.Getenv("EDGE_ALLOW_INSECURE_CENTER") != "local-test-only") {
		e.mu.Lock()
		e.centerError = "中心上传未启用：需要HTTPS地址和至少32字符的机器凭据"
		e.mu.Unlock()
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		var cursor uint64
		e.store.meta("centerCursor", &cursor)
		samples := e.store.samples("", cursor, 500)
		if len(samples) == 0 {
			continue
		}
		seen := map[string]bool{}
		runs := []Run{}
		for _, s := range samples {
			if !seen[s.RunID] {
				r, err := e.store.run(s.RunID)
				if err == nil {
					runs = append(runs, r)
				}
				seen[s.RunID] = true
			}
		}
		// Stable identity includes the installation UUID: reinstallation on another volume cannot collide.
		var install string
		e.store.meta("installationId", &install)
		batch := CenterBatch{Contract: "edge.v1", DeviceID: samples[0].DeviceID, BatchID: fmt.Sprintf("%s:%d:%d", install, samples[0].ID, samples[len(samples)-1].ID), Records: samples, Runs: runs}
		b, err := post(client, strings.TrimRight(url, "/")+"/edge/v1/batches", token, marshal(batch))
		if err == nil {
			err = checkACK(b, batch)
		}
		if err == nil {
			err = e.store.set("centerCursor", samples[len(samples)-1].ID)
		}
		e.mu.Lock()
		e.centerError = ""
		if err != nil {
			e.centerError = "中心同步等待确认：" + err.Error()
		}
		e.mu.Unlock()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}
