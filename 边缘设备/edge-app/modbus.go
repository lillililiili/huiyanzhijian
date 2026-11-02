package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"go.bug.st/serial"
	"io"
	"net"
	"time"
)

type Device struct {
	serial serial.Port
	tcp    net.Conn
	cfg    Config
	tx     uint16
}

func connect(c Config) (*Device, error) {
	d := &Device{cfg: c}
	var e error
	if c.Transport == "tcp" {
		d.tcp, e = net.DialTimeout("tcp", c.Endpoint, time.Duration(c.TimeoutMS)*time.Millisecond)
	} else {
		p := serial.NoParity
		if c.Parity == "E" {
			p = serial.EvenParity
		}
		if c.Parity == "O" {
			p = serial.OddParity
		}
		sb := serial.OneStopBit
		if c.StopBits == 2 {
			sb = serial.TwoStopBits
		}
		d.serial, e = serial.Open(c.Endpoint, &serial.Mode{BaudRate: c.Baud, DataBits: 8, Parity: p, StopBits: sb})
		if e == nil {
			e = d.serial.SetReadTimeout(time.Duration(c.TimeoutMS) * time.Millisecond)
		}
	}
	if e != nil {
		d.Close()
		return nil, e
	}
	return d, nil
}
func (d *Device) Close() {
	if d.serial != nil {
		d.serial.Close()
	}
	if d.tcp != nil {
		d.tcp.Close()
	}
}
func readSerial(p serial.Port, b []byte, deadline time.Time) error {
	for len(b) > 0 {
		left := time.Until(deadline)
		if left <= 0 {
			return errors.New("串口整帧响应超时")
		}
		if e := p.SetReadTimeout(left); e != nil {
			return e
		}
		n, e := p.Read(b)
		if e != nil {
			return e
		}
		if n == 0 {
			return errors.New("串口响应超时")
		}
		b = b[n:]
	}
	return nil
}
func (d *Device) Read() ([6]uint16, []byte, error) {
	var reg [6]uint16
	req := requestRTU(d.cfg)
	if d.tcp != nil {
		d.tx++
		buf := make([]byte, 12)
		binary.BigEndian.PutUint16(buf, d.tx)
		binary.BigEndian.PutUint16(buf[4:], 6)
		copy(buf[6:], req[:6])
		d.tcp.SetDeadline(time.Now().Add(time.Duration(d.cfg.TimeoutMS) * time.Millisecond))
		if _, e := d.tcp.Write(buf); e != nil {
			return reg, nil, e
		}
		head := make([]byte, 7)
		if _, e := io.ReadFull(d.tcp, head); e != nil {
			return reg, nil, e
		}
		n := int(binary.BigEndian.Uint16(head[4:]))
		if binary.BigEndian.Uint16(head) != d.tx || binary.BigEndian.Uint16(head[2:]) != 0 || head[6] != byte(d.cfg.Slave) || n < 3 || n > 254 {
			return reg, head, errors.New("Modbus TCP事务号/协议/长度不匹配")
		}
		body := make([]byte, n-1)
		if _, e := io.ReadFull(d.tcp, body); e != nil {
			return reg, head, e
		}
		if body[0] == 0x83 {
			return reg, append(head, body...), fmt.Errorf("Modbus异常码 %d", body[1])
		}
		if len(body) != 14 || body[0] != 3 || body[1] != 12 {
			return reg, append(head, body...), errors.New("Modbus寄存器数量错误")
		}
		for i := range reg {
			reg[i] = binary.BigEndian.Uint16(body[2+2*i:])
		}
		return reg, append(head, body...), nil
	}
	if e := d.serial.ResetInputBuffer(); e != nil {
		return reg, nil, e
	}
	if _, e := d.serial.Write(req); e != nil {
		return reg, nil, e
	}
	deadline := time.Now().Add(time.Duration(d.cfg.TimeoutMS) * time.Millisecond)
	head := make([]byte, 3)
	if e := readSerial(d.serial, head, deadline); e != nil {
		return reg, head, e
	}
	n := int(head[2]) + 2
	if head[1]&0x80 != 0 {
		n = 2
	}
	if n > 254 {
		return reg, head, errors.New("Modbus响应长度错误")
	}
	body := make([]byte, n)
	if e := readSerial(d.serial, body, deadline); e != nil {
		return reg, head, e
	}
	raw := append(head, body...)
	reg, e := decodeRTU(raw, d.cfg)
	return reg, raw, e
}
