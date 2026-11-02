package main

import (
	"encoding/hex"
	"fmt"
	"time"
)

// B has the same six-register layout as A; the status low nibble declares axes.
type BConfig struct {
	Enabled    bool    `json:"enabled"`
	Transport  string  `json:"transport"`
	Endpoint   string  `json:"endpoint"`
	Baud       int     `json:"baud"`
	Parity     string  `json:"parity"`
	StopBits   int     `json:"stopBits"`
	Slave      int     `json:"slave"`
	Address    int     `json:"address"`
	Scale      float64 `json:"scale"`
	IntervalMS int     `json:"intervalMs"`
	TimeoutMS  int     `json:"timeoutMs"`
}

func (b BConfig) config(id string) Config {
	return Config{DeviceID: id, Transport: b.Transport, Endpoint: b.Endpoint, Baud: b.Baud, Parity: b.Parity, StopBits: b.StopBits, Slave: b.Slave, Address: b.Address, Scale: b.Scale, IntervalMS: b.IntervalMS, TimeoutMS: b.TimeoutMS}
}
func calculateB(reg [6]uint16, c Config, run string, raw []byte) Sample {
	s := Sample{RunID: run, DeviceID: c.DeviceID, Gauge: "B", AxisCount: int(reg[0] & 15), At: time.Now().UTC(), Received: time.Now().UTC(), Registers: reg, Raw: hex.EncodeToString(raw), Method: "diameter-axis-mean.v1", Source: "MODBUS", Verdict: "UNDETERMINED"}
	if (s.AxisCount != 1 && s.AxisCount != 2) || reg[0]&0xfff0 != 0 {
		s.Reason = fmt.Sprintf("B状态无效 0x%04X", reg[0])
		return s
	}
	x, y := float64(reg[2])/c.Scale, float64(reg[4])/c.Scale
	if x <= 0 || s.AxisCount == 2 && y <= 0 {
		s.Reason = "B轴直径无效"
		return s
	}
	s.X = ptr(x)
	s.OffsetX = float64(int16(reg[3])) / c.Scale
	if s.AxisCount == 2 {
		s.Y = ptr(y)
		s.OffsetY = float64(int16(reg[5])) / c.Scale
	}
	s.Average = ptr(float64(reg[1]) / c.Scale)
	s.Valid = true
	s.Mean = gaugeMean(s)
	return s
}
