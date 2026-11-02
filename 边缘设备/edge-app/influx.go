package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type influxCredentials struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}
type influxTarget struct {
	Base, Token, Org, Bucket, CursorKey string
}
type influxCursor struct {
	ID     uint64 `json:"id"`
	TimeNS int64  `json:"timeNs"`
}

// Never include response bodies or credentials in logs/operator errors.
func influxRequest(ctx context.Context, client *http.Client, method, endpoint, token, contentType string, body []byte) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("InfluxDB 请求地址无效")
	}
	req.Header.Set("Content-Type", contentType)
	if token != "" {
		req.Header.Set("Authorization", "Token "+token)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("InfluxDB 暂不可达")
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if err != nil {
		return nil, res.StatusCode, fmt.Errorf("InfluxDB 响应读取失败")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, res.StatusCode, fmt.Errorf("InfluxDB HTTP %d", res.StatusCode)
	}
	return b, res.StatusCode, nil
}

func envDefault(name, fallback string) string {
	if s := os.Getenv(name); s != "" {
		return s
	}
	return fallback
}
func randomSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func prepareInflux(ctx context.Context, client *http.Client, dir string) (influxTarget, error) {
	t := influxTarget{Base: strings.TrimRight(envDefault("EDGE_INFLUX_URL", "http://127.0.0.1:8086"), "/"), Org: envDefault("EDGE_INFLUX_ORG", "huiyan-edge"), Bucket: envDefault("EDGE_INFLUX_BUCKET", "measurements"), Token: os.Getenv("EDGE_INFLUX_TOKEN")}
	u, err := url.Parse(t.Base)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return t, fmt.Errorf("InfluxDB 地址无效")
	}
	local := u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"
	if !local && (u.Scheme != "https" || t.Token == "") {
		return t, fmt.Errorf("远程 InfluxDB 必须配置 HTTPS 和 Token")
	}
	if t.Token == "" {
		// Managed local installation only. Persist the secret before onboarding so
		// a crash after the server commits setup cannot lose access to the bucket.
		b, _, err := influxRequest(ctx, client, "GET", t.Base+"/api/v2/setup", "", "application/json", nil)
		if err != nil {
			return t, err
		}
		var setup struct {
			Allowed bool `json:"allowed"`
		}
		if json.Unmarshal(b, &setup) != nil {
			return t, fmt.Errorf("InfluxDB 初始化状态无效")
		}
		path := filepath.Join(dir, "influx-credentials.json")
		var creds influxCredentials
		b, err = os.ReadFile(path)
		if os.IsNotExist(err) && setup.Allowed {
			creds.Token, err = randomSecret()
			if err != nil {
				return t, err
			}
			creds.Password, err = randomSecret()
			if err != nil {
				return t, err
			}
			f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return t, fmt.Errorf("无法保存 InfluxDB 本机凭据")
			}
			_, writeErr := f.Write(marshal(creds))
			syncErr := f.Sync()
			closeErr := f.Close()
			if writeErr != nil || syncErr != nil || closeErr != nil {
				return t, fmt.Errorf("InfluxDB 凭据持久化失败")
			}
		} else if err != nil || json.Unmarshal(b, &creds) != nil || len(creds.Token) < 32 || len(creds.Password) < 32 {
			return t, fmt.Errorf("InfluxDB 本机凭据缺失或无效，请恢复备份；未重置数据库")
		}
		t.Token = creds.Token
		if setup.Allowed {
			retention, err := strconv.ParseInt(envDefault("EDGE_INFLUX_RETENTION_SECONDS", "0"), 10, 64)
			if err != nil || retention < 0 {
				return t, fmt.Errorf("InfluxDB 保留秒数无效")
			}
			payload := map[string]any{"username": "huiyan-edge", "password": creds.Password, "token": creds.Token, "org": t.Org, "bucket": t.Bucket, "retentionPeriodSeconds": retention}
			if _, _, err = influxRequest(ctx, client, "POST", t.Base+"/api/v2/setup", "", "application/json", marshal(payload)); err != nil {
				return t, err
			}
		}
	}
	// Resolve immutable bucket IDs: a new/recreated target must get its own
	// projection cursor, never inherit VictoriaMetrics' acknowledgement.
	q := url.Values{"org": {t.Org}, "name": {t.Bucket}}
	b, _, err := influxRequest(ctx, client, "GET", t.Base+"/api/v2/buckets?"+q.Encode(), t.Token, "application/json", nil)
	if err != nil {
		return t, err
	}
	var buckets struct {
		Buckets []struct {
			ID    string `json:"id"`
			OrgID string `json:"orgID"`
		} `json:"buckets"`
	}
	if json.Unmarshal(b, &buckets) != nil || len(buckets.Buckets) != 1 || buckets.Buckets[0].ID == "" {
		return t, fmt.Errorf("InfluxDB 数据桶不存在或不唯一")
	}
	t.Org, t.Bucket = buckets.Buckets[0].OrgID, buckets.Buckets[0].ID
	h := sha256.Sum256([]byte(t.Base + "/" + t.Org + "/" + t.Bucket))
	t.CursorKey = "influx-v1-" + hex.EncodeToString(h[:])
	return t, nil
}

func influxTag(s string) string {
	return strings.NewReplacer("\\", "\\\\", ",", "\\,", "=", "\\=", " ", "\\ ", "\r", "\\r", "\n", "\\n").Replace(s)
}
func influxString(s string) string {
	return `"` + strings.NewReplacer("\\", "\\\\", `"`, `\"`, "\r", "\\r", "\n", "\\n").Replace(s) + `"`
}

func projectBody(samples []Sample, lastNS int64) ([]byte, int64) {
	var b bytes.Buffer
	for _, s := range samples {
		// Receipt-time index is monotonic, including clock rollback and multiple
		// records in one instant. Exact source/receipt times remain separate fields.
		ns := s.Received.UnixNano()
		if ns <= lastNS {
			ns = lastNS + 1
		}
		lastNS = ns
		fields := []string{"record_id=" + strconv.FormatUint(s.ID, 10) + "u", "sample_time_ns=" + strconv.FormatInt(s.At.UnixNano(), 10) + "i", "received_time_ns=" + strconv.FormatInt(s.Received.UnixNano(), 10) + "i", "valid=" + strconv.FormatBool(s.Valid), "verdict=" + influxString(s.Verdict), "reason=" + influxString(s.Reason), "method=" + influxString(s.Method), "source=" + influxString(s.Source), "offset_x=" + strconv.FormatFloat(s.OffsetX, 'g', -1, 64), "offset_y=" + strconv.FormatFloat(s.OffsetY, 'g', -1, 64)}
		for _, f := range []struct {
			name  string
			value *float64
		}{{"x_mm", s.X}, {"y_mm", s.Y}, {"average_mm", s.Average}, {"axis_mean_mm", gaugeMean(s)}, {"roundness", s.Ratio}} {
			if f.value != nil {
				fields = append(fields, f.name+"="+strconv.FormatFloat(*f.value, 'g', -1, 64))
			}
		}
		if s.Sheath != nil {
			fields = append(fields, "sheath_method="+influxString(s.Sheath.Method), "pair_status="+influxString(s.Sheath.Status))
			if s.Sheath.DistanceMM != nil {
				fields = append(fields, "sync_distance_mm="+strconv.FormatInt(*s.Sheath.DistanceMM, 10)+"i", "distance_revision="+influxString(s.Sheath.SyncRevision))
			}
			if s.Sheath.DelayMS != nil {
				fields = append(fields, "sync_revision="+influxString(s.Sheath.SyncRevision), "meter_record_id="+influxString(s.Sheath.MeterRecordID), "meter_source="+influxString(s.Sheath.MeterSource), "sync_delay_ms="+strconv.FormatFloat(*s.Sheath.DelayMS, 'g', -1, 64), "sync_tolerance_ms="+strconv.FormatFloat(s.Sheath.ToleranceMS, 'g', -1, 64), "sync_upstream="+influxString(s.Sheath.UpstreamGauge), "pair_residual_ms="+strconv.FormatFloat(s.Sheath.ResidualMS, 'g', -1, 64))
			}
			if s.Sheath.Value != nil {
				fields = append(fields, "sheath_value_mm="+strconv.FormatFloat(*s.Sheath.Value, 'g', -1, 64), "pair_delta_ms="+strconv.FormatFloat(s.Sheath.DeltaMS, 'g', -1, 64), "a_record_id="+strconv.FormatUint(s.Sheath.AID, 10)+"u", "b_record_id="+strconv.FormatUint(s.Sheath.BID, 10)+"u")
			}
		}
		fmt.Fprintf(&b, "huiyan_measurement,device=%s,run=%s,gauge=%s %s %d\n", influxTag(s.DeviceID), influxTag(s.RunID), gaugeOf(s), strings.Join(fields, ","), ns)
	}
	return b.Bytes(), lastNS
}

func (e *Engine) projection(ctx context.Context) {
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var target influxTarget
	delay := 250 * time.Millisecond
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		var err error
		if target.CursorKey == "" {
			target, err = prepareInflux(ctx, client, e.dir)
			if err == nil {
				e.mu.Lock()
				e.tsCursorKey = target.CursorKey
				e.mu.Unlock()
			}
		}
		if err == nil {
			var cursor influxCursor
			err = e.store.meta(target.CursorKey, &cursor)
			if err == nil {
				batch := e.store.samples("", cursor.ID, 1000)
				if len(batch) > 0 {
					body, lastNS := projectBody(batch, cursor.TimeNS)
					q := url.Values{"org": {target.Org}, "bucket": {target.Bucket}, "precision": {"ns"}}
					var status int
					_, status, err = influxRequest(ctx, client, "POST", target.Base+"/api/v2/write?"+q.Encode(), target.Token, "text/plain; charset=utf-8", body)
					if err == nil && status != http.StatusNoContent {
						err = fmt.Errorf("InfluxDB 未确认完整写入（%d）", status)
					}
					if err == nil {
						err = e.store.set(target.CursorKey, influxCursor{ID: batch[len(batch)-1].ID, TimeNS: lastNS})
					}
				}
			}
		}
		e.mu.Lock()
		e.tsError = ""
		if err != nil {
			e.tsError = "时序写入等待重试：" + err.Error()
		}
		e.mu.Unlock()
		delay = 250 * time.Millisecond
		if err != nil {
			delay = 2 * time.Second
			target = influxTarget{}
		}
	}
}
