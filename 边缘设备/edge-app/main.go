package main

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/csv"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed web
var assets embed.FS

const appVersion = "1.9.0"

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(400)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	return d.Decode(v)
}
func handler(e *Engine) http.Handler {
	mux := http.NewServeMux()
	e.gatewayRoutes(mux)
	e.localDeliveryRoutes(mux)
	e.gaugeRoutes(mux)
	e.syncRoutes(mux)
	csrf := uid()
	e.liveRoutes(mux,csrf)
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		v := e.status()
		v["csrf"] = csrf
		v["centerEnabled"] = os.Getenv("EDGE_CENTER_URL") != "" || os.Getenv("EDGE_PLATFORM_URL") != ""
		reply(w, v)
	})
	mux.HandleFunc("GET /api/trend", func(w http.ResponseWriter, r *http.Request) {
		e.mu.Lock()
		out := make([]map[string]any, 0, len(e.recent))
		cutoff := time.Now().Add(-60 * time.Second)
		for _, s := range e.recent {
			if s.At.Before(cutoff) {
				continue
			}
			out = append(out, trendPoint(s))
		}
		e.mu.Unlock()
		reply(w, out)
	})
	mux.HandleFunc("GET /api/runs", func(w http.ResponseWriter, r *http.Request) { reply(w, e.store.runs()) })
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) { reply(w, e.store.events()) })
	mux.HandleFunc("GET /api/records", func(w http.ResponseWriter, r *http.Request) {
		run := r.URL.Query().Get("run")
		if _, err := e.store.run(run); err != nil {
			fail(w, err)
			return
		}
		after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
		reply(w, e.store.samples(run, after, 5000))
	})
	mux.HandleFunc("GET /api/export", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("run")
		if _, err := e.store.run(id); err != nil {
			fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=inspection-"+id+".csv")
		w.Write([]byte{0xef, 0xbb, 0xbf})
		c := csv.NewWriter(w)
		c.Write([]string{"记录ID", "工单检测ID", "测径仪", "采集时间UTC", "X直径mm", "Y直径mm", "轴计算均值mm", "仪器平均直径mm", "A圆整度", "护套厚度mm", "厚度方法", "配对状态", "A记录ID", "B记录ID", "A采样时间UTC", "B采样时间UTC", "配对时间差ms", "配对窗口ms", "有效性", "当前点判定", "原因", "原始报文", "算法版本", "同步配置版本", "计米器补偿时间ms", "取点容差ms", "上游仪器", "取点残差ms", "仪器间距mm", "计米器记录ID", "计米器来源"})
		var after uint64
		num := func(v *float64) string {
			if v == nil {
				return ""
			}
			return strconv.FormatFloat(*v, 'g', -1, 64)
		}
		for {
			batch := e.store.samples(id, after, 1000)
			if len(batch) == 0 {
				break
			}
			for _, s := range batch {
				pair := []string{"", "", "", "", "", "", "", "", ""}
				if p := s.Sheath; p != nil {
					pair[0], pair[1], pair[2] = num(p.Value), p.Method, p.Status
					if p.Value != nil {
						pair[3] = strconv.FormatUint(p.AID, 10)
						pair[4] = strconv.FormatUint(p.BID, 10)
						pair[5] = p.AAt.Format(time.RFC3339Nano)
						pair[6] = p.BAt.Format(time.RFC3339Nano)
						pair[7] = strconv.FormatFloat(p.DeltaMS, 'g', -1, 64)
					}
					pair[8] = strconv.Itoa(p.WindowMS)
				}
				row := []string{strconv.FormatUint(s.ID, 10), s.RunID, gaugeOf(s), s.At.Format(time.RFC3339Nano), num(s.X), num(s.Y), num(gaugeMean(s)), num(s.Average), num(s.Ratio)}
				row = append(row, pair...)
				row = append(row, strconv.FormatBool(s.Valid), s.Verdict, s.Reason, s.Raw, s.Method)
				syncFields := []string{"", "", "", "", ""}
				if p := s.Sheath; p != nil {
					syncFields = []string{p.SyncRevision, num(p.DelayMS), strconv.FormatFloat(p.ToleranceMS, 'g', -1, 64), p.UpstreamGauge, strconv.FormatFloat(p.ResidualMS, 'g', -1, 64)}
				}
				row = append(row, syncFields...)
				distance := ""
				if s.Sheath != nil && s.Sheath.DistanceMM != nil {
					distance = strconv.FormatInt(*s.Sheath.DistanceMM, 10)
				}
				row = append(row, distance)
				meterID, meterSource := "", ""
				if s.Sheath != nil {
					meterID, meterSource = s.Sheath.MeterRecordID, s.Sheath.MeterSource
				}
				row = append(row, meterID, meterSource)
				c.Write(row)
				after = s.ID
			}
			c.Flush()
			if c.Error() != nil {
				return
			}
		}
		c.Flush()
	})
	mux.HandleFunc("POST /api/config", func(w http.ResponseWriter, r *http.Request) {
		var c Config
		err := decode(w, r, &c)
		if err == nil {
			err = e.setConfig(c)
		}
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, c)
	})
	mux.HandleFunc("POST /api/start", func(w http.ResponseWriter, r *http.Request) {
		err := e.arm()
		if err != nil {
			fail(w, err)
			return
		}
		reply(w, e.status())
	})
	for path, fn := range map[string]func() error{"pause": e.pause, "resume": e.resume, "end": e.powerOff} {
		mux.HandleFunc("POST /api/"+path, func(w http.ResponseWriter, r *http.Request) {
			if err := fn(); err != nil {
				fail(w, err)
				return
			}
			reply(w, e.status())
		})
	}
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]string{"status": "ok", "version": appVersion, "method": method})
	})
	// Reserved inbound center interface: orders are staged, never start hardware remotely.
	mux.HandleFunc("PUT /edge/v1/orders/{id}", func(w http.ResponseWriter, r *http.Request) {
		var o Order
		if err := decode(w, r, &o); err != nil {
			fail(w, err)
			return
		}
		if err := o.validate(); err != nil {
			fail(w, err)
			return
		}
		o.ExternalID = r.PathValue("id")
		if len(o.ExternalID) > 120 {
			fail(w, fmt.Errorf("订单ID过长"))
			return
		}
		err := e.store.db.Update(func(tx *bolt.Tx) error {
			b := tx.Bucket([]byte("orders"))
			old := b.Get([]byte(o.ExternalID))
			if old != nil && string(old) != string(marshal(o)) {
				return fmt.Errorf("相同订单ID内容不同，请使用新版本ID")
			}
			return b.Put([]byte(o.ExternalID), marshal(o))
		})
		if err != nil {
			fail(w, err)
			return
		}
		e.store.event("CENTER_ORDER", o.ExternalID)
		reply(w, map[string]any{"accepted": true, "orderId": o.ExternalID})
	})
	mux.HandleFunc("GET /api/orders", func(w http.ResponseWriter, r *http.Request) {
		orders := []Order{}
		e.store.db.View(func(tx *bolt.Tx) error {
			return tx.Bucket([]byte("orders")).ForEach(func(k, v []byte) error { var o Order; json.Unmarshal(v, &o); orders = append(orders, o); return nil })
		})
		reply(w, orders)
	})
	mux.HandleFunc("GET /edge/v1/status", func(w http.ResponseWriter, r *http.Request) { reply(w, e.status()) })
	f, _ := fs.Sub(assets, "web")
	mux.Handle("GET /", http.FileServer(http.FS(f)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'")
		if strings.HasPrefix(r.URL.Path, "/edge/") {
			token := os.Getenv("EDGE_INBOUND_TOKEN")
			if len(token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
				http.Error(w, "Unauthorized", 401)
				return
			}
		}
		if !strings.HasPrefix(r.URL.Path, "/edge/") {
			host := r.Host
			if i := strings.LastIndex(host, ":"); i >= 0 {
				host = host[:i]
			}
			if host != "127.0.0.1" && host != "localhost" && host != "[::1]" && host != os.Getenv("EDGE_UI_HOST") {
				http.Error(w, "Local operator interface only", 403)
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != "GET" {
			origin := r.Header.Get("Origin")
			u, err := url.Parse(origin)
			if origin != "" && (err != nil || u.Host != r.Host) {
				http.Error(w, "Origin rejected", 403)
				return
			}
			if r.Header.Get("X-Edge-CSRF") != csrf {
				http.Error(w, "CSRF rejected", 403)
				return
			}
		}
		// No cross-origin access. Bind to loopback or a trusted local kiosk network only.
		mux.ServeHTTP(w, r)
	})
}
func main() {
	dir := os.Getenv("EDGE_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	store, err := openStore(dir)
	if err != nil {
		log.Fatal(err)
	}
	defer store.db.Close()
	var install string
	store.meta("installationId", &install)
	if install == "" {
		store.set("installationId", uid())
	}
	e := newEngine(store, dir)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	go e.projection(ctx)
	go e.center(ctx)
	go e.gatewayLoop(ctx)
	go e.lifecycleLoop(ctx)
	addr := os.Getenv("EDGE_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:4198"
	}
	srv := &http.Server{Addr: addr, Handler: handler(e), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	go func() {
		log.Printf("慧眼边缘终端 %s listening %s", appVersion, addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	e.mu.Lock()
	if e.cancel != nil {
		e.cancel()
	}
	done := e.done
	e.mu.Unlock()
	if done != nil {
		<-done
	}
	shutdown, c := context.WithTimeout(context.Background(), 10*time.Second)
	defer c()
	srv.Shutdown(shutdown)
}
