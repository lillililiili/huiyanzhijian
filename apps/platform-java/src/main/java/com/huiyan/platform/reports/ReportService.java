package com.huiyan.platform.reports;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.huiyan.platform.common.ApiError;
import com.huiyan.platform.common.Canonical;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

@Service
public class ReportService {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ReportService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional
    public Map<String, Object> generateReport(String factoryId, String spoolId, String actorId) {
        if (spoolId == null || spoolId.trim().isEmpty()) {
            throw new ApiError(400, "REQUEST_INVALID", "线缆盘号 spool_id 不能为空");
        }

        List<Map<String, Object>> tasks = jdbcTemplate.queryForList("""
            SELECT t.id, t.work_order_id, t.device_id, t.state
            FROM m02.inspection_task t
            JOIN m02.cable_spool s ON s.id = t.spool_id
            WHERE t.factory_id = ? AND (s.id = ? OR s.canonical_spool_id = ?)
        """, factoryId, spoolId, spoolId);

        if (tasks.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "未找到线缆盘 " + spoolId + " 相关的检测任务，无法生成报告");
        }

        List<String> taskIds = new ArrayList<>();
        String workOrderId = (String) tasks.get(0).get("work_order_id");
        for (Map<String, Object> t : tasks) {
            taskIds.add((String) t.get("id"));
        }

        String inClause = String.join("','", taskIds);
        String recordsSql = String.format("""
            SELECT r.id AS record_id, r.task_id, r.device_id, r.position_m, r.receipt_status,
                   v.metric_code, v.value, v.unit, v.data_status, e.quality_result
            FROM m04.measurement_record r
            JOIN m04.measurement_value v ON v.record_id = r.id
            JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
            WHERE r.factory_id = '%s' AND r.task_id IN ('%s')
            ORDER BY r.position_m ASC, r.sample_time ASC
        """, factoryId, inClause);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(recordsSql);
        if (rows.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "指定的任务范围内暂无有效测量数据");
        }

        BigDecimal minPos = null;
        BigDecimal maxPos = null;
        Set<String> recordIds = new HashSet<>();
        int quarantined = 0;

        Map<String, MetricStat> stats = new LinkedHashMap<>();

        for (Map<String, Object> row : rows) {
            recordIds.add((String) row.get("record_id"));
            if ("QUARANTINED".equals(row.get("receipt_status"))) quarantined++;

            BigDecimal pos = (BigDecimal) row.get("position_m");
            if (pos != null) {
                if (minPos == null || pos.compareTo(minPos) < 0) minPos = pos;
                if (maxPos == null || pos.compareTo(maxPos) > 0) maxPos = pos;
            }

            String mCode = (String) row.get("metric_code");
            String unit = (String) row.get("unit");
            MetricStat m = stats.computeIfAbsent(mCode, k -> new MetricStat(k, unit));
            m.total++;

            if ("VALID".equals(row.get("data_status"))) {
                m.valid++;
                BigDecimal val = (BigDecimal) row.get("value");
                if (val != null) {
                    m.values.add(val);
                }
                String qual = (String) row.get("quality_result");
                if ("PASS".equals(qual)) m.passed++;
                else if ("FAIL".equals(qual)) m.failed++;
            }
        }

        Map<String, Object> metricsSummary = new LinkedHashMap<>();
        int totalFailed = 0;
        int totalPassed = 0;

        for (Map.Entry<String, MetricStat> entry : stats.entrySet()) {
            MetricStat s = entry.getValue();
            BigDecimal minVal = null;
            BigDecimal maxVal = null;
            BigDecimal sum = BigDecimal.ZERO;

            for (BigDecimal v : s.values) {
                if (minVal == null || v.compareTo(minVal) < 0) minVal = v;
                if (maxVal == null || v.compareTo(maxVal) > 0) maxVal = v;
                sum = sum.add(v);
            }

            BigDecimal avgVal = s.values.isEmpty() ? null : sum.divide(BigDecimal.valueOf(s.values.size()), 3, RoundingMode.HALF_UP);
            BigDecimal compRate = s.valid == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(s.passed * 100.0 / s.valid).setScale(2, RoundingMode.HALF_UP);

            totalFailed += s.failed;
            totalPassed += s.passed;

            Map<String, Object> item = new LinkedHashMap<>();
            item.put("metric_code", s.code);
            item.put("unit", s.unit);
            item.put("total_samples", s.total);
            item.put("valid_samples", s.valid);
            item.put("passed_samples", s.passed);
            item.put("failed_samples", s.failed);
            item.put("min_value", minVal != null ? minVal.setScale(3, RoundingMode.HALF_UP).toString() : null);
            item.put("max_value", maxVal != null ? maxVal.setScale(3, RoundingMode.HALF_UP).toString() : null);
            item.put("avg_value", avgVal != null ? avgVal.toString() : null);
            item.put("compliance_rate", compRate.doubleValue());
            item.put("verdict", s.failed == 0 ? "PASS" : "FAIL");

            metricsSummary.put(s.code, item);
        }

        BigDecimal startM = minPos != null ? minPos.setScale(3, RoundingMode.HALF_UP) : BigDecimal.ZERO;
        BigDecimal endM = maxPos != null ? maxPos.setScale(3, RoundingMode.HALF_UP) : BigDecimal.ZERO;
        BigDecimal totalM = endM.subtract(startM).max(BigDecimal.ZERO);

        Map<String, Object> coverage = new LinkedHashMap<>();
        coverage.put("start_position_m", startM.toString());
        coverage.put("end_position_m", endM.toString());
        coverage.put("total_covered_meters", totalM.toString());
        coverage.put("total_records", recordIds.size());
        coverage.put("quarantined_records", quarantined);
        coverage.put("valid_records", recordIds.size() - quarantined);
        coverage.put("coverage_completeness", totalM.compareTo(BigDecimal.ZERO) > 0 ? "COMPLETE" : "PARTIAL");

        String finalResult = totalFailed == 0 && totalPassed > 0 ? "PASS" : "FAIL";

        String reportId = UUID.randomUUID().toString();
        String reportCode = "QR-" + spoolId.substring(0, Math.min(8, spoolId.length())).toUpperCase() + "-" + Long.toHexString(System.currentTimeMillis()).toUpperCase();

        Date now = new Date();
        Map<String, Object> hashPayload = new LinkedHashMap<>();
        hashPayload.put("factory_id", factoryId);
        hashPayload.put("report_code", reportCode);
        hashPayload.put("spool_id", spoolId);
        hashPayload.put("work_order_id", workOrderId);
        hashPayload.put("task_ids", taskIds);
        hashPayload.put("statistics", metricsSummary);
        hashPayload.put("coverage", coverage);
        hashPayload.put("final_result", finalResult);

        String snapshotHash = Canonical.digest(hashPayload);

        try {
            String tasksJson = objectMapper.writeValueAsString(taskIds);
            String coverageJson = objectMapper.writeValueAsString(coverage);
            String statsJson = objectMapper.writeValueAsString(metricsSummary);

            jdbcTemplate.update("""
                INSERT INTO m06.quality_report(
                    id, factory_id, report_code, revision, report_kind, data_environment,
                    spool_id, work_order_id, task_ids,
                    coverage_snapshot, statistics, state, final_result,
                    snapshot_hash, query_cutoff, generated_by
                ) VALUES(?, ?, ?, 1, 'TASK_FINAL', 'SIMULATED', ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, 'GENERATED', ?, ?, ?, ?)
            """, reportId, factoryId, reportCode, spoolId, workOrderId, tasksJson, coverageJson, statsJson, finalResult, snapshotHash, now, actorId);
        } catch (Exception e) {
            throw new RuntimeException("Report save failed", e);
        }

        return detail(factoryId, reportId);
    }

    public Map<String, Object> list(String factoryId, Map<String, String> params) {
        String sql = """
            SELECT id, factory_id, report_code, revision, report_kind, data_environment,
                   spool_id, work_order_id, task_ids, state, final_result, snapshot_hash,
                   coverage_snapshot, statistics,
                   to_char(query_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS query_cutoff,
                   generated_by, published_by,
                   to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM m06.quality_report
            WHERE factory_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        """;
        List<Map<String, Object>> items = jdbcTemplate.queryForList(sql, factoryId);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("has_more", false);
        res.put("next_cursor", null);
        return res;
    }

    public Map<String, Object> detail(String factoryId, String id) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList("""
            SELECT id, factory_id, report_code, revision, report_kind, data_environment,
                   spool_id, work_order_id, task_ids, template_snapshot, format_snapshot,
                   coverage_snapshot, input_snapshot, statistics, state, final_result,
                   snapshot_hash,
                   to_char(query_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS query_cutoff,
                   generated_by, published_by,
                   to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
            FROM m06.quality_report
            WHERE factory_id = ? AND id = ?
        """, factoryId, id);

        if (rows.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "质量报告不存在");
        }
        return rows.get(0);
    }

    @Transactional
    public Map<String, Object> publish(String factoryId, String id, String actorId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM m06.quality_report WHERE factory_id = ? AND id = ? FOR UPDATE",
                factoryId, id
        );
        if (rows.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "质量报告不存在");
        }
        Map<String, Object> report = rows.get(0);
        if ("PUBLISHED".equals(report.get("state"))) {
            throw new ApiError(409, "REPORT_ALREADY_PUBLISHED", "报告已处于发布状态，无需重复发布");
        }

        Date now = new Date();
        jdbcTemplate.update("""
            UPDATE m06.quality_report
            SET state = 'PUBLISHED',
                published_by = ?,
                published_at = ?,
                updated_at = ?
            WHERE id = ?
        """, actorId, now, now, id);

        return Map.of("id", id, "report_code", report.get("report_code"), "state", "PUBLISHED", "published_by", actorId);
    }

    private static class MetricStat {
        String code;
        String unit;
        int total = 0;
        int valid = 0;
        int passed = 0;
        int failed = 0;
        List<BigDecimal> values = new ArrayList<>();

        MetricStat(String code, String unit) {
            this.code = code;
            this.unit = unit != null ? unit : "";
        }
    }
}
