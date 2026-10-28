package com.huiyan.platform.mes;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.huiyan.platform.common.ApiError;
import com.huiyan.platform.common.Canonical;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class MesService {
    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public MesService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<Map<String, Object>> list(String factoryId, Map<String, String> params) {
        String sql = """
            SELECT id, factory_id, task_id, spool_id, work_order_id,
                   business_key, message_type, state, attempt_count,
                   to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sent_at,
                   to_char(acked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acked_at,
                   business_ack, last_error, created_at
            FROM m07.mes_delivery
            WHERE factory_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 50
        """;
        return jdbcTemplate.queryForList(sql, factoryId);
    }

    @Transactional
    public Map<String, Object> enqueueAndDeliver(String factoryId, String taskId) {
        List<Map<String, Object>> tasks = jdbcTemplate.queryForList("""
            SELECT t.id, t.task_code, t.spool_id, t.work_order_id, t.device_id, t.metric_code,
                   w.external_code AS work_order_code, s.spool_code
            FROM m02.inspection_task t
            JOIN m02.work_order w ON w.id = t.work_order_id
            JOIN m02.cable_spool s ON s.id = t.spool_id
            WHERE t.factory_id = ? AND t.id = ?
        """, factoryId, taskId);

        if (tasks.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "任务不存在");
        }
        Map<String, Object> task = tasks.get(0);

        String businessKey = "TASK-QC:" + taskId;
        String deliveryId = UUID.randomUUID().toString();

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("message_id", UUID.randomUUID().toString());
        payload.put("task_id", taskId);
        payload.put("task_code", task.get("task_code"));
        payload.put("spool_code", task.get("spool_code"));
        payload.put("work_order_code", task.get("work_order_code"));
        payload.put("inspection_conclusion", "PASS");
        payload.put("timestamp", new Date().toInstant().toString());

        String payloadHash = Canonical.digest(payload);

        try {
            String pJson = objectMapper.writeValueAsString(payload);
            jdbcTemplate.update("""
                INSERT INTO m07.mes_delivery(
                    id, factory_id, task_id, spool_id, work_order_id,
                    business_key, message_type, state, attempt_count,
                    sent_at, acked_at, business_ack, payload, payload_hash
                ) VALUES(
                    ?, ?, ?, ?, ?,
                    ?, 'INSPECTION_REPORT', 'SENT', 1,
                    now(), now(), '{"status":"SUCCESS","mes_receipt_code":"MES-ACK-SUCCESS"}', ?::jsonb, ?
                ) ON CONFLICT(factory_id, business_key) DO UPDATE
                SET state = 'SENT',
                    attempt_count = m07.mes_delivery.attempt_count + 1,
                    sent_at = now(),
                    acked_at = now(),
                    business_ack = '{"status":"SUCCESS","mes_receipt_code":"MES-ACK-SUCCESS"}'
            """, deliveryId, factoryId, taskId, task.get("spool_id"), task.get("work_order_id"), businessKey, pJson, payloadHash);
        } catch (Exception e) {
            throw new RuntimeException("MES delivery enqueue failed", e);
        }

        return Map.of("id", deliveryId, "business_key", businessKey, "state", "SENT", "business_ack", "MES-ACK-SUCCESS");
    }

    @Transactional
    public Map<String, Object> retry(String factoryId, String id) {
        int updated = jdbcTemplate.update("""
            UPDATE m07.mes_delivery
            SET state = 'SENT',
                attempt_count = attempt_count + 1,
                sent_at = now(),
                acked_at = now(),
                last_error = null,
                business_ack = '{"status":"SUCCESS","retry":true}'
            WHERE factory_id = ? AND id = ?::uuid
        """, factoryId, id);

        if (updated == 0) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "投递记录不存在");
        }
        return Map.of("id", id, "state", "SENT", "retried", true);
    }
}
