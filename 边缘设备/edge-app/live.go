package main

import (
	"fmt"
	"net/http"
	"sort"
	"time"
)

func trendPoint(s Sample) map[string]any {
	return map[string]any{"id": s.ID, "runId": s.RunID, "at": s.At, "received": s.Received, "gauge": gaugeOf(s), "x": s.X, "y": s.Y, "mean": gaugeMean(s), "ratio": s.Ratio, "valid": s.Valid, "sheath": s.Sheath}
}

// Each viewer owns its network writes. Capture only wakes viewers under e.mu;
// it never waits for a browser, network socket, InfluxDB, or center receipt.
func (e *Engine) liveRoutes(mux *http.ServeMux, csrf string) {
	mux.HandleFunc("GET /api/live", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unavailable", 503)
			return
		}
		e.mu.Lock()
		if e.liveClients >= 8 {
			e.mu.Unlock()
			http.Error(w, "Too many viewers", 429)
			return
		}
		e.liveClients++
		if e.liveWake == nil {
			e.liveWake = make(chan struct{})
		}
		e.mu.Unlock()
		defer func() { e.mu.Lock(); e.liveClients--; e.mu.Unlock() }()
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache, no-transform")
		w.Header().Set("X-Accel-Buffering", "no")
		tick := time.NewTicker(50 * time.Millisecond)
		defer tick.Stop()
		var cursor uint64
		runID := ""
		first := true
		lastState := time.Time{}
		for {
			e.mu.Lock()
			wake := e.liveWake
			e.mu.Unlock()
			if !first {
				select {
				case <-r.Context().Done():
					return
				case <-wake:
					continue
				case <-tick.C:
				}
			}
			now := time.Now().UTC()
			withState := first || now.Sub(lastState) >= time.Second
			var status map[string]any
			if withState {
				status = e.status()
				status["csrf"] = csrf
				lastState = now
			}
			e.mu.Lock()
			current := ""
			if e.run != nil {
				current = e.run.ID
			}
			reset := first || current != runID
			if reset {
				cursor = 0
				runID = current
			}
			rows := make([]map[string]any, 0)
			start := sort.Search(len(e.recent), func(i int) bool { return e.recent[i].ID > cursor })
			cutoff := now.Add(-60 * time.Second)
			for _, s := range e.recent[start:] {
				if s.ID > cursor {
					cursor = s.ID
				}
				if !s.At.Before(cutoff) {
					rows = append(rows, trendPoint(s))
				}
			}
			// An update racing this snapshot closes the saved wake channel and is sent
			// next tick. State from a different run is never attached to this frame.
			if status != nil {
				statusRun := ""
				if sr, ok := status["run"].(*Run); ok && sr != nil {
					statusRun = sr.ID
				}
				if statusRun != current {
					status = nil
				}
			}
			e.mu.Unlock()
			first = false
			if len(rows) == 0 && !withState && !reset {
				continue
			}
			payload := map[string]any{"runId": current, "reset": reset, "cursor": cursor, "rows": rows, "time": now}
			if status != nil {
				payload["state"] = status
			}
			controller := http.NewResponseController(w)
			_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if _, err := fmt.Fprintf(w, "data: %s\n\n", marshal(payload)); err != nil {
				return
			}
			flusher.Flush()
		}
	})
}
