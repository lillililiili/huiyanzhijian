package main

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"strings"
	"time"
)

const method = "roundness-min-max.v1"

type Config struct {
	B            *BConfig    `json:"b,omitempty"`
	Sync         *SyncConfig `json:"sync,omitempty"`
	DeviceID     string      `json:"deviceId"`
	Transport    string      `json:"transport"`
	Endpoint     string      `json:"endpoint"`
	Baud         int         `json:"baud"`
	Parity       string      `json:"parity"`
	StopBits     int         `json:"stopBits"`
	Slave        int         `json:"slave"`
	Address      int         `json:"address"`
	Scale        float64     `json:"scale"`
	IntervalMS   int         `json:"intervalMs"`
	TimeoutMS    int         `json:"timeoutMs"`
	Lower        *float64    `json:"lower"`
	PairWindowMS int         `json:"pairWindowMs,omitempty"`
}

func defaultConfig() Config {
	return Config{DeviceID: "edge-01", Transport: "rtu", Endpoint: "/dev/ttyUSB0", Baud: 9600, Parity: "N", StopBits: 1, Slave: 1, Address: 512, Scale: 1000, IntervalMS: 100, TimeoutMS: 500}
}
func (c Config) validate() error {
	if c.B != nil && c.B.Enabled {
		b := c.B.config(c.DeviceID)
		if b.Transport != "rtu" && b.Transport != "tcp" {
			return errors.New("B连接方式须为RTU或TCP")
		}
		if err := b.validate(); err != nil {
			return fmt.Errorf("测径仪B：%w", err)
		}
		if c.Transport == "rtu" && b.Transport == "rtu" && c.Endpoint == b.Endpoint {
			return errors.New("A/B请配置独立串口；当前不支持同一串口并发采集")
		}
	}
	if c.DeviceID == "" || len(c.DeviceID) > 80 {
		return errors.New("请填写设备编号（最多80字节）")
	}
	if c.Transport != "rtu" && c.Transport != "tcp" && c.Transport != "input" {
		return errors.New("请选择RTU、TCP或数据接口")
	}
	if c.PairWindowMS < 0 || c.PairWindowMS > 5000 {
		return errors.New("配对时间窗口须为0～5000ms，0使用100ms")
	}
	if c.Transport == "rtu" && !strings.HasPrefix(c.Endpoint, "/dev/") {
		return errors.New("串口路径必须以 /dev/ 开头")
	}
	if c.Transport == "tcp" {
		if _, _, e := net.SplitHostPort(c.Endpoint); e != nil {
			return errors.New("TCP地址格式：主机:端口")
		}
	}
	validBaud := map[int]bool{9600: true, 19200: true, 38400: true, 57600: true, 115200: true, 230400: true}
	if !validBaud[c.Baud] || (c.Parity != "N" && c.Parity != "E" && c.Parity != "O") || (c.StopBits != 1 && c.StopBits != 2) {
		return errors.New("串口参数无效")
	}
	if c.Slave < 1 || c.Slave > 247 || c.Address < 0 || c.Address > 65530 || c.Scale <= 0 || math.IsNaN(c.Scale) || math.IsInf(c.Scale, 0) || c.IntervalMS < 2 || c.IntervalMS > 10000 || c.TimeoutMS < 10 || c.TimeoutMS > 5000 {
		return errors.New("地址、倍率或采样周期无效（周期2～10000ms）")
	}
	if c.Lower != nil && (*c.Lower <= 0 || *c.Lower > 1) {
		return errors.New("圆整度下限应大于0且不大于1")
	}
	if c.Transport == "rtu" {
		bits := 10
		if c.Parity != "N" {
			bits++
		}
		bits += c.StopBits - 1
		minMS := int(math.Ceil(float64(25+7) * float64(bits) * 1000 / float64(c.Baud)))
		if c.IntervalMS < minMS {
			return fmt.Errorf("当前串口参数理论最短周期约%dms，请增大周期或确认设备支持更高波特率", minMS)
		}
	}
	return nil
}

type Order struct {
	TaskCode       string  `json:"taskCode,omitempty"`
	ScanRound      int     `json:"scanRound,omitempty"`
	SourceTaskCode string  `json:"sourceTaskCode,omitempty"`
	Code           string  `json:"code"`
	Spool          string  `json:"spool"`
	Spec           string  `json:"spec"`
	Length         float64 `json:"length"`
	ExternalID     string  `json:"externalId,omitempty"`
}

func (o Order) validate() error {
	if strings.TrimSpace(o.Code) == "" || strings.TrimSpace(o.Spool) == "" || strings.TrimSpace(o.Spec) == "" || o.Length <= 0 || o.Length > 1e8 || len(o.Code) > 120 || len(o.Spool) > 120 || len(o.Spec) > 200 {
		return errors.New("请填写工单、盘号、规格和有效计划长度；编号不超过120字节")
	}
	return nil
}

type Run struct {
	Barcode string     `json:"barcode,omitempty"`
	Binding string     `json:"bindingId,omitempty"`
	Task    string     `json:"taskId,omitempty"`
	ID      string     `json:"id"`
	Order   Order      `json:"order"`
	Config  Config     `json:"config"`
	Method  string     `json:"method"`
	Started time.Time  `json:"started"`
	Ended   *time.Time `json:"ended,omitempty"`
	State   string     `json:"state"`
	Count   uint64     `json:"count"`
	Invalid uint64     `json:"invalid"`
	Below   uint64     `json:"below"`
	Source  string     `json:"source"`
}
type Sample struct {
	Meter       *MeterReading `json:"meter,omitempty"`
	AxisCount   int           `json:"axisCount,omitempty"`
	Gauge       string        `json:"gauge,omitempty"`
	Mean        *float64      `json:"mean,omitempty"`
	InputValues []float64     `json:"inputValues,omitempty"`
	Sheath      *SheathResult `json:"sheath,omitempty"`
	ID          uint64        `json:"id"`
	RunID       string        `json:"runId"`
	DeviceID    string        `json:"deviceId"`
	At          time.Time     `json:"at"`
	Received    time.Time     `json:"received"`
	Registers   [6]uint16     `json:"registers"`
	Raw         string        `json:"raw"`
	X           *float64      `json:"x"`
	Y           *float64      `json:"y"`
	Average     *float64      `json:"average"`
	Ratio       *float64      `json:"ratio"`
	OffsetX     float64       `json:"offsetX"`
	OffsetY     float64       `json:"offsetY"`
	Valid       bool          `json:"valid"`
	Reason      string        `json:"reason"`
	Verdict     string        `json:"verdict"`
	Method      string        `json:"method"`
	Source      string        `json:"source"`
}

func ptr(v float64) *float64 { return &v }
func calculate(reg [6]uint16, c Config, run string, raw []byte) Sample {
	s := Sample{RunID: run, DeviceID: c.DeviceID, At: time.Now().UTC(), Received: time.Now().UTC(), Registers: reg, Raw: hex.EncodeToString(raw), Method: method, Source: "MODBUS", Verdict: "UNDETERMINED"}
	s.OffsetX = float64(int16(reg[3])) / c.Scale
	s.OffsetY = float64(int16(reg[5])) / c.Scale
	if reg[0] != 2 {
		switch reg[0] {
		case 0x4442:
			s.Reason = "无被测物"
		case 0x2222:
			s.Reason = "仪器测量错误"
		default:
			s.Reason = fmt.Sprintf("未知状态字 0x%04X", reg[0])
		}
		return s
	}
	x, y, avg := float64(reg[2])/c.Scale, float64(reg[4])/c.Scale, float64(reg[1])/c.Scale
	if x <= 0 || y <= 0 || avg <= 0 {
		s.Reason = "直径无效"
		return s
	}
	s.X = ptr(x)
	s.Y = ptr(y)
	s.Average = ptr(avg)
	s.Ratio = ptr(math.Min(x, y) / math.Max(x, y))
	s.Gauge = "A"
	s.Mean = ptr((x + y) / 2)
	s.Valid = true
	if c.Lower != nil {
		s.Verdict = "PASS"
		if *s.Ratio < *c.Lower {
			s.Verdict = "FAIL"
		}
	}
	return s
}
func crc16(b []byte) uint16 {
	crc := uint16(0xffff)
	for _, v := range b {
		crc ^= uint16(v)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0xa001
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}
func requestRTU(c Config) []byte {
	b := []byte{byte(c.Slave), 3, byte(c.Address >> 8), byte(c.Address), 0, 6}
	v := crc16(b)
	return append(b, byte(v), byte(v>>8))
}
func decodeRTU(b []byte, c Config) ([6]uint16, error) {
	var r [6]uint16
	if len(b) < 5 {
		return r, errors.New("响应不完整")
	}
	if binary.LittleEndian.Uint16(b[len(b)-2:]) != crc16(b[:len(b)-2]) {
		return r, errors.New("CRC校验失败")
	}
	if int(b[0]) != c.Slave {
		return r, errors.New("从站地址不匹配")
	}
	if b[1] == 0x83 {
		return r, fmt.Errorf("Modbus异常码 %d", b[2])
	}
	if len(b) != 17 || b[1] != 3 || b[2] != 12 {
		return r, errors.New("功能码或寄存器长度不匹配")
	}
	for i := range r {
		r[i] = binary.BigEndian.Uint16(b[3+i*2:])
	}
	return r, nil
}
func marshal(v any) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
