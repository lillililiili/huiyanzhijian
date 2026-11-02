package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDemoCalculation(t *testing.T) {
	c := defaultConfig()
	c.Lower = ptr(.99)
	s := calculate([6]uint16{2, 39800, 40000, 65535, 39600, 2}, c, "run", nil)
	if !s.Valid || *s.Ratio != .99 || *s.Average != 39.8 || s.OffsetX != -.001 || s.Verdict != "PASS" {
		t.Fatalf("bad %#v", s)
	}
	c.Lower = ptr(.990001)
	if calculate(s.Registers, c, "r", nil).Verdict != "FAIL" {
		t.Fatal("boundary rounded before judgment")
	}
	reg := s.Registers
	reg[2] = 39600
	reg[4] = 40000
	if *calculate(reg, c, "r", nil).Ratio != .99 {
		t.Fatal("axes not symmetric")
	}
}
func TestInvalidNeverZero(t *testing.T) {
	for _, reg := range [][6]uint16{{0x4442, 1, 2, 0, 3, 0}, {0x2222, 1, 2, 0, 3, 0}, {4, 1, 2, 0, 3, 0}, {2, 0, 0, 0, 0, 0}} {
		s := calculate(reg, defaultConfig(), "r", nil)
		if s.Valid || s.Ratio != nil || s.X != nil || s.Verdict != "UNDETERMINED" {
			t.Fatalf("invalid substituted %#v", s)
		}
	}
}
func TestRTUFrame(t *testing.T) {
	c := defaultConfig()
	want := []byte{1, 3, 2, 0, 0, 6, 0xc4, 0x70}
	if !bytes.Equal(requestRTU(c), want) {
		t.Fatalf("request %x", requestRTU(c))
	}
	b := []byte{1, 3, 12, 0, 2, 0x9b, 0x78, 0x9c, 0x40, 0, 0, 0x9a, 0xb0, 0, 0}
	crc := crc16(b)
	b = append(b, byte(crc), byte(crc>>8))
	r, err := decodeRTU(b, c)
	if err != nil || r[2] != 40000 {
		t.Fatal(err, r)
	}
	b[4] ^= 1
	if _, err = decodeRTU(b, c); err == nil {
		t.Fatal("bad CRC accepted")
	}
	b = []byte{1, 0x83, 2}
	crc = crc16(b)
	b = append(b, byte(crc), byte(crc>>8))
	if _, err = decodeRTU(b, c); err == nil {
		t.Fatal("exception accepted")
	}
}
func TestConfigBandwidth(t *testing.T) {
	c := defaultConfig()
	c.IntervalMS = 20
	if c.validate() == nil {
		t.Fatal("impossible 9600 baud allowed")
	}
	c.Baud = 115200
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.Lower = ptr(1.1)
	if c.validate() == nil {
		t.Fatal("invalid lower")
	}
}
func TestStoreRecovery(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	r := Run{ID: "r", State: "RUNNING", Config: defaultConfig(), Started: time.Now()}
	s.saveRun(r)
	for i := 0; i < 101; i++ {
		p := calculate([6]uint16{2, 39800, 40000, 0, 39600, 0}, r.Config, r.ID, nil)
		if err = s.append(&p, &r); err != nil {
			t.Fatal(err)
		}
	}
	s.db.Close()
	s, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.db.Close()
	newEngine(s, dir)
	rr, _ := s.run("r")
	if rr.Count != 101 || rr.State != "INTERRUPTED" || len(s.samples("r", 100, 10)) != 1 {
		t.Fatal(rr)
	}
	if len(s.samples("unknown", 0, 100)) != 0 {
		t.Fatal("wrong scope")
	}
}
func TestACK(t *testing.T) {
	b := CenterBatch{BatchID: "a", Records: []Sample{{ID: 1}, {ID: 2}}}
	for _, raw := range []string{`{}`, `{"batchId":"b","acceptedIds":[1,2]}`, `{"batchId":"a","acceptedIds":[1,1]}`, `{"batchId":"a","acceptedIds":[1]}`} {
		if checkACK([]byte(raw), b) == nil {
			t.Fatal("bad ack accepted")
		}
	}
	if err := checkACK([]byte(`{"batchId":"a","acceptedIds":[2,1]}`), b); err != nil {
		t.Fatal(err)
	}
}
func TestHTTPAndLifecycle(t *testing.T) {
	s, _ := openStore(t.TempDir())
	defer s.db.Close()
	e := newEngine(s, t.TempDir())
	h := handler(e)
	get := httptest.NewRecorder()
	h.ServeHTTP(get, httptest.NewRequest("GET", "http://localhost/api/state", nil))
	var data map[string]any
	json.Unmarshal(get.Body.Bytes(), &data)
	token := data["csrf"].(string)
	req := httptest.NewRequest("POST", "/api/config", bytes.NewReader(marshal(defaultConfig())))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("CSRF missing")
	}
	req = httptest.NewRequest("POST", "http://localhost/api/config", bytes.NewReader(marshal(defaultConfig())))
	req.Header.Set("X-Edge-CSRF", token)
	req.Header.Set("Origin", "http://evil.invalid")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 403 {
		t.Fatal("origin bypass")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/edge/v1/status", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatal("center unauthenticated")
	}
	o := Order{Code: "test", Spool: "p", Spec: "s", Length: 10}
	if err := e.start(o); err != nil {
		t.Fatal(err)
	}
	if e.start(o) == nil {
		t.Fatal("duplicate start")
	}
	if e.setConfig(defaultConfig()) == nil {
		t.Fatal("changed snapshot")
	}
	if err := e.pause(); err != nil {
		t.Fatal(err)
	}
	if err := e.resume(); err != nil {
		t.Fatal(err)
	}
	if err := e.stop(); err != nil {
		t.Fatal(err)
	}
	if e.state != "ENDED" {
		t.Fatal(e.state)
	}
}
func BenchmarkCalculate(b *testing.B) {
	c := defaultConfig()
	reg := [6]uint16{2, 39800, 40000, 0, 39600, 0}
	raw := make([]byte, 17)
	binary.BigEndian.PutUint16(raw[3:], 2)
	for i := 0; i < b.N; i++ {
		calculate(reg, c, "r", raw)
	}
}
