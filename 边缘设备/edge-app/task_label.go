package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Printed task identities are resolved at scan time; the existing binding code
// and its validation remain authoritative for collection and resubmission.
func (e *Engine) resolveTaskLabel(code string) (scanLabel, error) {
	var label scanLabel
	b, status, err := platformRequest(context.Background(), "/task-labels/"+url.PathEscape(code), nil)
	if err != nil {
		return label, err
	}
	var response struct {
		Data    scanLabel `json:"data"`
		Message string    `json:"message"`
	}
	if json.Unmarshal(b, &response) != nil {
		return label, fmt.Errorf("中心返回无效条码响应")
	}
	if status != 200 {
		return label, fmt.Errorf("任务条码不可用：%s", response.Message)
	}
	if response.Data.Device == "" {
		return label, fmt.Errorf("任务条码缺少授权设备")
	}
	return e.saveLabel(response.Data)
}

func isTaskLabel(code string) bool { return strings.HasPrefix(code, "HYT1") }
