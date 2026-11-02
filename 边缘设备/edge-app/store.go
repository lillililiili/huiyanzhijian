package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"os"
	"path/filepath"
	"time"
)

type Store struct{ db *bolt.DB }

func openStore(dir string) (*Store, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	db, e := bolt.Open(filepath.Join(dir, "edge.db"), 0600, &bolt.Options{Timeout: time.Second})
	if e != nil {
		return nil, e
	}
	s := &Store{db}
	e = db.Update(func(tx *bolt.Tx) error {
		for _, n := range []string{"meta", "runs", "samples", "runIndex", "events", "orders", "barcodes", "gatewayRecords", "gatewayPending", "gatewayRejected", "gaugeInputs", "gaugeTimes"} {
			if _, e := tx.CreateBucketIfNotExists([]byte(n)); e != nil {
				return e
			}
		}
		return nil
	})
	return s, e
}
func key(id uint64) []byte { b := make([]byte, 8); binary.BigEndian.PutUint64(b, id); return b }
func (s *Store) meta(k string, v any) error {
	return s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("meta")).Get([]byte(k))
		if b == nil {
			return nil
		}
		return json.Unmarshal(b, v)
	})
}
func (s *Store) set(k string, v any) error {
	return s.db.Update(func(tx *bolt.Tx) error { return tx.Bucket([]byte("meta")).Put([]byte(k), marshal(v)) })
}
func (s *Store) saveRun(r Run) error {
	return s.db.Update(func(tx *bolt.Tx) error { return tx.Bucket([]byte("runs")).Put([]byte(r.ID), marshal(r)) })
}
func (s *Store) append(sample *Sample, r *Run) error {
	return s.db.Update(func(tx *bolt.Tx) error { return appendSample(tx, sample, r) })
}
func appendSample(tx *bolt.Tx, sample *Sample, r *Run) error {
	b := tx.Bucket([]byte("samples"))
	id, e := b.NextSequence()
	if e != nil {
		return e
	}
	sample.ID = id
	if e = pairSampleTx(tx, sample, r); e != nil {
		return e
	}
	if e = b.Put(key(id), marshal(sample)); e != nil {
		return e
	}
	ix, e := tx.Bucket([]byte("runIndex")).CreateBucketIfNotExists([]byte(r.ID))
	if e != nil {
		return e
	}
	if e = ix.Put(key(id), []byte{1}); e != nil {
		return e
	}
	r.Count++
	if !sample.Valid {
		r.Invalid++
	}
	if sample.Verdict == "FAIL" {
		r.Below++
	}
	return tx.Bucket([]byte("runs")).Put([]byte(r.ID), marshal(r))
}
func (s *Store) runs() []Run {
	out := []Run{}
	s.db.View(func(tx *bolt.Tx) error {
		c := tx.Bucket([]byte("runs")).Cursor()
		for k, v := c.Last(); k != nil; k, v = c.Prev() {
			var r Run
			if json.Unmarshal(v, &r) == nil {
				out = append(out, r)
			}
			if len(out) >= 200 {
				break
			}
		}
		return nil
	})
	return out
}
func (s *Store) run(id string) (Run, error) {
	var r Run
	e := s.db.View(func(tx *bolt.Tx) error {
		v := tx.Bucket([]byte("runs")).Get([]byte(id))
		if v == nil {
			return fmt.Errorf("检测记录不存在")
		}
		return json.Unmarshal(v, &r)
	})
	return r, e
}
func (s *Store) samples(run string, after uint64, limit int) []Sample {
	out := []Sample{}
	s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("samples"))
		index := b
		if run != "" {
			index = tx.Bucket([]byte("runIndex")).Bucket([]byte(run))
			if index == nil {
				return nil
			}
		}
		c := index.Cursor()
		for k, v := c.Seek(key(after + 1)); k != nil; k, v = c.Next() {
			if run != "" {
				v = b.Get(k)
			}
			var p Sample
			if json.Unmarshal(v, &p) == nil {
				out = append(out, p)
			}
			if len(out) >= limit {
				break
			}
		}
		return nil
	})
	return out
}
func (s *Store) count() uint64 {
	var n uint64
	s.db.View(func(tx *bolt.Tx) error { n = tx.Bucket([]byte("samples")).Sequence(); return nil })
	return n
}
func (s *Store) event(kind string, detail any) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("events"))
		n, e := b.NextSequence()
		if e != nil {
			return e
		}
		return b.Put(key(n), marshal(map[string]any{"id": n, "at": time.Now().UTC(), "kind": kind, "detail": detail}))
	})
}
func (s *Store) events() []json.RawMessage {
	out := []json.RawMessage{}
	s.db.View(func(tx *bolt.Tx) error {
		c := tx.Bucket([]byte("events")).Cursor()
		for k, v := c.Last(); k != nil; k, v = c.Prev() {
			out = append(out, append(json.RawMessage{}, v...))
			if len(out) == 100 {
				break
			}
		}
		return nil
	})
	return out
}
