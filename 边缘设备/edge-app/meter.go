package main

import (
	"fmt"
	"math"
	"time"
)

// A meter supplies elapsed travel time, not speed. The simulator attaches one
// reading to each A sample so retries never reuse a newer meter value.
type MeterReading struct {
	DelayMS      int64     `json:"delayMs"`
	DistanceMM   int64     `json:"distanceMm"`
	SyncRevision string    `json:"syncRevision"`
	Source       string    `json:"source"`
	RecordID     string    `json:"recordId"`
	At           time.Time `json:"at"`
}

func simulatedMeter(raw map[string]any, a *Sample, run *Run) (*Sample, error) {
	sim := obj(raw["edge_simulation"])
	if sim == nil {
		return nil, nil
	}
	if a.Source != "SIMULATED" || run.Source != "SIMULATED" {
		return nil, fmt.Errorf("模拟计米器不能用于真实采集")
	}
	m := obj(sim["meter"])
	delay, ed := number(m["delay_ms"])
	distance, es := number(m["distance_mm"])
	at, et := time.Parse(time.RFC3339Nano, str(m["sample_time"]))
	if ed != nil || es != nil || et != nil || delay < 0 || delay > 3600000 || math.Trunc(delay) != delay || distance < 1 || distance > 2147483647 || math.Trunc(distance) != distance || !at.Equal(a.At) || str(m["source"]) != "SIMULATED" || str(m["record_id"]) == "" || len(str(m["record_id"])) > 160 || str(m["sync_revision"]) == "" {
		return nil, fmt.Errorf("模拟计米器需要有效整数毫秒、毫米间距、版本及对应采样时间")
	}
	a.Meter = &MeterReading{DelayMS: int64(delay), DistanceMM: int64(distance), SyncRevision: str(m["sync_revision"]), Source: "SIMULATED", RecordID: str(m["record_id"]), At: at}
	bdata := obj(sim["gauge_b"])
	if bdata == nil {
		return nil, nil
	}
	values, ok := bdata["values"].([]any)
	bt, err := time.Parse(time.RFC3339Nano, str(bdata["sample_time"]))
	if !ok || len(values) < 1 || len(values) > 2 || err != nil || !bt.Equal(a.At.Add(-time.Duration(delay)*time.Millisecond)) || str(bdata["status"]) != "VALID" {
		return nil, fmt.Errorf("B模拟读数、轴数或补偿采样时间无效")
	}
	nums := make([]float64, len(values))
	for i, v := range values {
		n, err := number(v)
		if err != nil || n <= 0 || n > 655.35 {
			return nil, fmt.Errorf("B模拟直径须大于0且不超过655.35mm")
		}
		nums[i] = n
	}
	// Virtual B points before this run are never invented to fill the warm-up.
	if bt.Before(run.Started) {
		return nil, nil
	}
	b := &Sample{RunID: a.RunID, DeviceID: a.DeviceID, At: bt, Received: a.Received, Source: "SIMULATED", Gauge: "B", AxisCount: len(nums), InputValues: nums, X: ptr(nums[0]), Valid: true, Verdict: "UNDETERMINED", Method: "simulated-b-axis.v1", Raw: string(marshal(bdata))}
	if len(nums) == 2 {
		b.Y = ptr(nums[1])
	}
	b.Mean = gaugeMean(*b)
	return b, nil
}
