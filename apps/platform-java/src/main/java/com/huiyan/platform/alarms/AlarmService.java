package com.huiyan.platform.alarms;

import com.huiyan.platform.common.ApiError;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.*;

@Service
public class AlarmService {
    private final JdbcTemplate jdbcTemplate;

    public AlarmService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> list(String factoryId, Map<String, String> params) {
        StringBuilder sql = new StringBuilder("""
            SELECT id, factory_id, device_id, task_id, spool_id, work_order_id,
                   source_alarm_key, alarm_type, metric_code, severity, lifecycle, handling_state,
                   sample_count, start_position_m::text AS start_position_m, end_position_m::text AS end_position_m,
                   peak_value::text AS peak_value, unit,
                   to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at,
                   acknowledged_by,
                   to_char(triggered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS triggered_at,
                   to_char(recovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recovered_at,
                   version, created_at
            FROM m05.alarm_event
            WHERE factory_id = ?
        """);

        List<Object> args = new ArrayList<>();
        args.add(factoryId);

        if (params.containsKey("handling_state")) {
            sql.append(" AND handling_state = ?");
            args.add(params.get("handling_state"));
        }
        if (params.containsKey("lifecycle")) {
            sql.append(" AND lifecycle = ?");
            args.add(params.get("lifecycle"));
        }
        if (params.containsKey("metric_code")) {
            sql.append(" AND metric_code = ?");
            args.add(params.get("metric_code"));
        }
        if (params.containsKey("device_id")) {
            sql.append(" AND device_id = ?");
            args.add(params.get("device_id"));
        }

        sql.append(" ORDER BY triggered_at DESC, id DESC LIMIT ?");
        int limit = 50;
        try {
            if (params.containsKey("limit")) limit = Math.min(Math.max(Integer.parseInt(params.get("limit")), 1), 100);
        } catch (Exception ignored) {}
        args.add(limit + 1);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql.toString(), args.toArray());
        boolean more = rows.size() > limit;
        List<Map<String, Object>> items = more ? rows.subList(0, limit) : rows;

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("has_more", more);
        res.put("next_cursor", more ? items.get(items.size() - 1).get("id") : null);
        return res;
    }

    public Map<String, Object> detail(String factoryId, String id) {
        List<Map<String, Object>> events = jdbcTemplate.queryForList("""
            SELECT id, factory_id, device_id, task_id, spool_id, work_order_id,
                   source_alarm_key, alarm_type, metric_code, severity, lifecycle, handling_state,
                   sample_count, start_position_m::text AS start_position_m, end_position_m::text AS end_position_m,
                   peak_value::text AS peak_value, unit,
                   to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at,
                   acknowledged_by,
                   to_char(triggered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS triggered_at,
                   to_char(recovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recovered_at,
                   version, created_at
            FROM m05.alarm_event
            WHERE factory_id = ? AND id = ?
        """, factoryId, id);

        if (events.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "报警事件不存在");
        }

        Map<String, Object> alarm = new LinkedHashMap<>(events.get(0));
        List<Map<String, Object>> actions = jdbcTemplate.queryForList("""
            SELECT id, action, actor_id, actor_name, from_state, to_state, opinion, evidence_refs,
                   to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
            FROM m05.alarm_action
            WHERE alarm_id = ?
            ORDER BY occurred_at ASC
        """, id);

        alarm.put("actions", actions);
        return alarm;
    }

    @Transactional
    public Map<String, Object> acknowledge(String factoryId, String id, String actorId) {
        List<Map<String, Object>> events = jdbcTemplate.queryForList(
                "SELECT * FROM m05.alarm_event WHERE factory_id = ? AND id = ? FOR UPDATE",
                factoryId, id
        );
        if (events.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "报警事件不存在");
        }
        Map<String, Object> alarm = events.get(0);
        String state = (String) alarm.get("handling_state");
        if (!"PENDING".equals(state)) {
            throw new ApiError(409, "ALARM_STATE_INVALID", "当前报警状态为 " + state + "，无需重复确认");
        }

        Date now = new Date();
        jdbcTemplate.update("""
            UPDATE m05.alarm_event
            SET handling_state = 'PROCESSING',
                acknowledged_at = ?,
                acknowledged_by = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ?
        """, now, actorId, now, id);

        jdbcTemplate.update("""
            INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at)
            VALUES(?, ?, 'ACKNOWLEDGE', ?, ?, 'PENDING', 'PROCESSING', '操作员已确认看到报警', ?)
        """, UUID.randomUUID().toString(), id, actorId, actorId, now);

        return Map.of("id", id, "handling_state", "PROCESSING", "acknowledged_by", actorId);
    }

    @Transactional
    public Map<String, Object> handle(String factoryId, String id, String actorId, Map<String, Object> dto) {
        String opinion = (String) dto.get("opinion");
        if (opinion == null || opinion.trim().isEmpty()) {
            throw new ApiError(400, "REQUEST_INVALID", "处置意见不能为空");
        }

        List<Map<String, Object>> events = jdbcTemplate.queryForList(
                "SELECT * FROM m05.alarm_event WHERE factory_id = ? AND id = ? FOR UPDATE",
                factoryId, id
        );
        if (events.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "报警事件不存在");
        }
        Map<String, Object> alarm = events.get(0);
        String state = (String) alarm.get("handling_state");
        if ("HANDLED".equals(state) || "REVIEWED".equals(state)) {
            throw new ApiError(409, "ALARM_STATE_INVALID", "报警当前处于 " + state + "，已完成处置");
        }

        Date now = new Date();
        jdbcTemplate.update("""
            UPDATE m05.alarm_event
            SET handling_state = 'HANDLED',
                acknowledged_at = COALESCE(acknowledged_at, ?),
                acknowledged_by = COALESCE(acknowledged_by, ?),
                version = version + 1,
                updated_at = ?
            WHERE id = ?
        """, now, actorId, now, id);

        jdbcTemplate.update("""
            INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at)
            VALUES(?, ?, 'HANDLE', ?, ?, ?, 'HANDLED', ?, ?)
        """, UUID.randomUUID().toString(), id, actorId, actorId, state, opinion.trim(), now);

        return Map.of("id", id, "handling_state", "HANDLED", "handled_by", actorId);
    }

    @Transactional
    public Map<String, Object> review(String factoryId, String id, String actorId, Map<String, Object> dto) {
        String opinion = (String) dto.get("opinion");
        Boolean approved = (Boolean) dto.get("approved");
        if (opinion == null || opinion.trim().isEmpty() || approved == null) {
            throw new ApiError(400, "REQUEST_INVALID", "复核意见与结论不能为空");
        }

        List<Map<String, Object>> events = jdbcTemplate.queryForList(
                "SELECT * FROM m05.alarm_event WHERE factory_id = ? AND id = ? FOR UPDATE",
                factoryId, id
        );
        if (events.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "报警事件不存在");
        }
        Map<String, Object> alarm = events.get(0);
        String state = (String) alarm.get("handling_state");
        if (!"HANDLED".equals(state)) {
            throw new ApiError(409, "ALARM_STATE_INVALID", "只有已处置的报警才可复核，当前状态为 " + state);
        }

        String target = approved ? "REVIEWED" : "PROCESSING";
        Date now = new Date();
        jdbcTemplate.update("""
            UPDATE m05.alarm_event
            SET handling_state = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ?
        """, target, now, id);

        jdbcTemplate.update("""
            INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at)
            VALUES(?, ?, 'REVIEW', ?, ?, 'HANDLED', ?, ?, ?)
        """, UUID.randomUUID().toString(), id, actorId, actorId, target, "【复核" + (approved ? "通过" : "驳回") + "】" + opinion.trim(), now);

        return Map.of("id", id, "handling_state", target, "reviewed_by", actorId, "approved", approved);
    }

    @Transactional
    public Map<String, Object> aggregateFailMeasurements(String factoryId, String taskId) {
        String sql = """
            SELECT r.id, r.factory_id, r.device_id, r.task_id, r.position_m, r.sample_time,
                   v.metric_code, v.value, v.unit, t.spool_id, t.work_order_id
            FROM m04.measurement_record r
            JOIN m04.measurement_value v ON v.record_id = r.id
            JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
            LEFT JOIN m02.inspection_task t ON t.id = r.task_id
            WHERE r.factory_id = ? AND e.quality_result = 'FAIL'
        """;
        List<Object> args = new ArrayList<>();
        args.add(factoryId);
        if (taskId != null && !taskId.isEmpty()) {
            sql += " AND r.task_id = ?";
            args.add(taskId);
        }
        sql += " ORDER BY r.device_id, r.task_id, r.ingest_order ASC";

        List<Map<String, Object>> failRows = jdbcTemplate.queryForList(sql, args.toArray());
        if (failRows.isEmpty()) {
            return Map.of("fail_points_scanned", 0, "alarms_created", 0, "alarms_updated", 0, "total_active_alarms", 0);
        }

        int created = 0;
        int updated = 0;

        for (Map<String, Object> row : failRows) {
            String deviceId = (String) row.get("device_id");
            String rowTaskId = (String) row.get("task_id");
            String metric = (String) row.get("metric_code");
            BigDecimal pos = (BigDecimal) row.get("position_m");
            BigDecimal val = (BigDecimal) row.get("value");
            String unit = (String) row.get("unit");
            String spoolId = (String) row.get("spool_id");
            String woId = (String) row.get("work_order_id");

            String sourceAlarmKey = "ALARM:" + deviceId + ":" + (rowTaskId != null ? rowTaskId : "GLOBAL") + ":" + metric;

            List<Map<String, Object>> existing = jdbcTemplate.queryForList("""
                SELECT id, start_position_m, end_position_m, peak_value, sample_count
                FROM m05.alarm_event
                WHERE factory_id = ? AND source_alarm_key = ? AND lifecycle = 'ACTIVE'
                FOR UPDATE
            """, factoryId, sourceAlarmKey);

            if (existing.isEmpty()) {
                String alarmId = "ALR-" + UUID.randomUUID().toString().substring(0, 8);
                Date now = new Date();
                jdbcTemplate.update("""
                    INSERT INTO m05.alarm_event(
                        id, factory_id, device_id, task_id, spool_id, work_order_id,
                        source_alarm_key, alarm_type, metric_code, severity, lifecycle, handling_state,
                        sample_count, start_position_m, end_position_m, peak_value, unit, triggered_at
                    ) VALUES(?, ?, ?, ?, ?, ?, ?, 'QUALITY', ?, 'CRITICAL', 'ACTIVE', 'PENDING', 1, ?, ?, ?, ?, ?)
                """, alarmId, factoryId, deviceId, rowTaskId, spoolId, woId, sourceAlarmKey, metric, pos, pos, val, unit, now);

                jdbcTemplate.update("""
                    INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at)
                    VALUES(?, ?, 'TRIGGER', 'SYSTEM', '自动聚合引擎', 'PENDING', 'PENDING', '检测到指标超限，自动生成工业报警', ?)
                """, UUID.randomUUID().toString(), alarmId, now);

                created++;
            } else {
                Map<String, Object> alr = existing.get(0);
                String alarmId = (String) alr.get("id");
                BigDecimal currentPeak = (BigDecimal) alr.get("peak_value");
                BigDecimal newPeak = (currentPeak == null || (val != null && val.compareTo(currentPeak) > 0)) ? val : currentPeak;

                jdbcTemplate.update("""
                    UPDATE m05.alarm_event
                    SET sample_count = sample_count + 1,
                        end_position_m = ?,
                        peak_value = ?,
                        updated_at = now()
                    WHERE id = ?
                """, pos, newPeak, alarmId);
                updated++;
            }
        }

        return Map.of("fail_points_scanned", failRows.size(), "alarms_created", created, "alarms_updated", updated);
    }
}
