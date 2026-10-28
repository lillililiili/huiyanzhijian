package com.huiyan.platform.measurements;

import com.huiyan.platform.common.ApiError;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class MeasurementService {
    private final JdbcTemplate jdbcTemplate;

    public MeasurementService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> queryMeasurements(String factoryId, Map<String, String> params) {
        StringBuilder sql = new StringBuilder("""
            SELECT r.id, r.factory_id, r.device_id, r.task_id, r.position_m,
                   to_char(r.sample_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sample_time,
                   to_char(r.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at,
                   r.data_status, r.receipt_status,
                   v.metric_code, v.value::text AS value, v.unit,
                   e.quality_result
            FROM m04.measurement_record r
            JOIN m04.measurement_value v ON v.record_id = r.id
            JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
            WHERE r.factory_id = ?
        """);

        List<Object> args = new ArrayList<>();
        args.add(factoryId);

        if (params.containsKey("task_id")) {
            sql.append(" AND r.task_id = ?");
            args.add(params.get("task_id"));
        }
        if (params.containsKey("quality")) {
            sql.append(" AND e.quality_result = ?");
            args.add(params.get("quality"));
        }
        if (params.containsKey("metric_code")) {
            sql.append(" AND v.metric_code = ?");
            args.add(params.get("metric_code"));
        }

        sql.append(" ORDER BY r.ingest_order DESC LIMIT ?");
        int limit = 50;
        try {
            if (params.containsKey("limit")) limit = Math.min(Math.max(Integer.parseInt(params.get("limit")), 1), 100);
        } catch (Exception ignored) {}
        args.add(limit);

        List<Map<String, Object>> items = jdbcTemplate.queryForList(sql.toString(), args.toArray());

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("limit", limit);
        res.put("as_of", new Date().toInstant().toString());
        return res;
    }

    public Map<String, Object> getMeasurement(String factoryId, String id) {
        List<Map<String, Object>> items = jdbcTemplate.queryForList("""
            SELECT r.id, r.factory_id, r.device_id, r.task_id, r.position_m,
                   to_char(r.sample_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sample_time,
                   r.data_status, r.receipt_status,
                   v.metric_code, v.value::text AS value, v.unit,
                   e.quality_result, e.rule_snapshot
            FROM m04.measurement_record r
            JOIN m04.measurement_value v ON v.record_id = r.id
            JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
            WHERE r.factory_id = ? AND r.id = ?
        """, factoryId, id);

        if (items.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "测点记录不存在");
        }
        return items.get(0);
    }

    public List<Map<String, Object>> getDeviceStatus(String factoryId) {
        return jdbcTemplate.queryForList("""
            SELECT d.id AS device_id, d.name AS device_name, d.metric_code,
                   CASE WHEN c.client_session_id IS NOT NULL AND c.last_heartbeat_at > now() - interval '30 seconds' THEN 'ONLINE' ELSE 'OFFLINE' END AS status,
                   to_char(c.last_heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_heartbeat_at
            FROM m01.device d
            LEFT JOIN m04.device_connection c ON c.device_id = d.id AND c.superseded_at IS NULL
            WHERE d.factory_id = ?
            ORDER BY d.id
        """, factoryId);
    }
}
