package com.huiyan.platform.production;

import com.huiyan.platform.common.ApiError;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class ProductionService {
    private final JdbcTemplate jdbcTemplate;

    public ProductionService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> workOrders(String factoryId, Map<String, String> query) {
        String sql = """
            SELECT w.id, w.factory_id, w.source_system, w.external_code, w.specification_id,
                   to_char(w.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                   COALESCE(s.spool_count, 0) AS registered_spools,
                   COALESCE(t.task_count, 0) AS task_count,
                   COALESCE(t.running_count, 0) AS running_count,
                   COALESCE(t.ended_count, 0) AS ended_count
            FROM m02.work_order w
            LEFT JOIN (
                SELECT work_order_id, count(*) AS spool_count
                FROM m02.cable_spool WHERE factory_id = ? GROUP BY work_order_id
            ) s ON s.work_order_id = w.id
            LEFT JOIN (
                SELECT work_order_id,
                       count(*) AS task_count,
                       count(*) FILTER(WHERE state = 'RUNNING') AS running_count,
                       count(*) FILTER(WHERE state = 'ENDED') AS ended_count
                FROM m02.inspection_task WHERE factory_id = ? GROUP BY work_order_id
            ) t ON t.work_order_id = w.id
            WHERE w.factory_id = ?
            ORDER BY w.created_at DESC, w.id DESC
        """;

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, factoryId, factoryId, factoryId);
        List<Map<String, Object>> items = new ArrayList<>();

        for (Map<String, Object> r : rows) {
            Map<String, Object> item = new LinkedHashMap<>(r);
            int taskCount = ((Number) r.get("task_count")).intValue();
            int running = ((Number) r.get("running_count")).intValue();
            int ended = ((Number) r.get("ended_count")).intValue();

            String state = "WAITING";
            if (taskCount == 0) state = "NO_TASK";
            else if (running > 0) state = "RUNNING";
            else if (ended == taskCount) state = "COMPLETED";

            item.put("state", state);
            item.put("physical_spools", r.get("registered_spools"));
            items.add(item);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("page", 1);
        res.put("limit", Math.max(items.size(), 20));
        res.put("as_of", new Date().toInstant().toString());
        return res;
    }

    public Map<String, Object> workOrderSummary(String factoryId, String id) {
        List<Map<String, Object>> orders = jdbcTemplate.queryForList(
                "SELECT * FROM m02.work_order WHERE factory_id = ? AND id = ?",
                factoryId, id
        );
        if (orders.isEmpty()) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "工单不存在");
        }
        Map<String, Object> order = new LinkedHashMap<>(orders.get(0));

        List<Map<String, Object>> spools = jdbcTemplate.queryForList(
                "SELECT id, spool_code, created_at FROM m02.cable_spool WHERE factory_id = ? AND work_order_id = ?",
                factoryId, id
        );
        List<Map<String, Object>> tasks = jdbcTemplate.queryForList(
                "SELECT id, task_code, device_id, metric_code, state, created_at FROM m02.inspection_task WHERE factory_id = ? AND work_order_id = ?",
                factoryId, id
        );

        order.put("spools", spools);
        order.put("tasks", tasks);
        order.put("as_of", new Date().toInstant().toString());
        return order;
    }

    @Transactional
    public Map<String, Object> createWorkOrder(String factoryId, Map<String, Object> dto) {
        String extCode = (String) dto.get("external_code");
        String specId = (String) dto.get("specification_id");
        if (extCode == null || extCode.trim().isEmpty()) {
            throw new ApiError(400, "REQUEST_INVALID", "工单编号不能为空");
        }
        if (specId == null || specId.trim().isEmpty()) {
            throw new ApiError(400, "REQUEST_INVALID", "产品规格不能为空");
        }

        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO m02.work_order(id, factory_id, source_system, external_code, specification_id) VALUES(?, ?, 'MANUAL', ?, ?)",
                id, factoryId, extCode.trim(), specId.trim()
        );

        return Map.of("id", id, "external_code", extCode.trim(), "specification_id", specId.trim());
    }

    @Transactional
    public Map<String, Object> deleteWorkOrder(String factoryId, String id) {
        List<Map<String, Object>> spools = jdbcTemplate.queryForList("SELECT id FROM m02.cable_spool WHERE work_order_id = ?", id);
        if (!spools.isEmpty()) {
            throw new ApiError(409, "RESOURCE_IN_USE", "工单已关联线缆盘，不可删除");
        }
        List<Map<String, Object>> tasks = jdbcTemplate.queryForList("SELECT id FROM m02.inspection_task WHERE work_order_id = ?", id);
        if (!tasks.isEmpty()) {
            throw new ApiError(409, "RESOURCE_IN_USE", "工单已关联检测任务，不可删除");
        }

        int count = jdbcTemplate.update("DELETE FROM m02.work_order WHERE factory_id = ? AND id = ?", factoryId, id);
        if (count == 0) {
            throw new ApiError(404, "RESOURCE_NOT_FOUND", "工单不存在");
        }
        return Map.of("deleted", true, "id", id);
    }

    public Map<String, Object> spools(String factoryId, Map<String, String> query) {
        String sql = """
            SELECT s.id, s.factory_id, s.work_order_id, s.spool_code, s.canonical_spool_id,
                   w.external_code AS work_order_code,
                   to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                   COALESCE(t.task_count, 0) AS task_count
            FROM m02.cable_spool s
            JOIN m02.work_order w ON w.id = s.work_order_id
            LEFT JOIN (
                SELECT spool_id, count(*) AS task_count
                FROM m02.inspection_task WHERE factory_id = ? GROUP BY spool_id
            ) t ON t.spool_id = s.id
            WHERE s.factory_id = ?
            ORDER BY s.created_at DESC, s.id DESC
        """;

        List<Map<String, Object>> items = jdbcTemplate.queryForList(sql, factoryId, factoryId);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("page", 1);
        res.put("limit", Math.max(items.size(), 20));
        res.put("as_of", new Date().toInstant().toString());
        return res;
    }

    @Transactional
    public Map<String, Object> createSpool(String factoryId, Map<String, Object> dto) {
        String woId = (String) dto.get("work_order_id");
        String spoolCode = (String) dto.get("spool_code");
        if (woId == null || spoolCode == null || spoolCode.trim().isEmpty()) {
            throw new ApiError(400, "REQUEST_INVALID", "工单ID与线缆盘号不能为空");
        }

        String id = UUID.randomUUID().toString();
        jdbcTemplate.update(
                "INSERT INTO m02.cable_spool(id, factory_id, work_order_id, spool_code) VALUES(?, ?, ?, ?)",
                id, factoryId, woId, spoolCode.trim()
        );

        return Map.of("id", id, "work_order_id", woId, "spool_code", spoolCode.trim());
    }

    public Map<String, Object> tasks(String factoryId, Map<String, String> query) {
        String sql = """
            SELECT t.id, t.factory_id, t.task_code, t.work_order_id, t.spool_id,
                   t.device_id, t.process_id, t.specification_id, t.metric_code, t.state,
                   w.external_code AS work_order_code, s.spool_code,
                   to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
                   to_char(t.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
                   to_char(t.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ended_at,
                   COALESCE(m.total, 0) AS total_samples,
                   COALESCE(m.passed, 0) AS passed_samples,
                   COALESCE(m.failed, 0) AS failed_samples,
                   m.avg_value, m.min_value, m.max_value, m.unit
            FROM m02.inspection_task t
            JOIN m02.work_order w ON w.id = t.work_order_id
            JOIN m02.cable_spool s ON s.id = t.spool_id
            LEFT JOIN (
                SELECT r.task_id,
                       count(*)::int AS total,
                       count(*) FILTER(WHERE e.quality_result = 'PASS')::int AS passed,
                       count(*) FILTER(WHERE e.quality_result = 'FAIL')::int AS failed,
                       avg(v.value)::numeric(18,3)::text AS avg_value,
                       min(v.value)::text AS min_value,
                       max(v.value)::text AS max_value,
                       min(v.unit) AS unit
                FROM m04.measurement_record r
                JOIN m04.measurement_value v ON v.record_id = r.id
                JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
                WHERE r.factory_id = ?
                GROUP BY r.task_id
            ) m ON m.task_id = t.id
            WHERE t.factory_id = ?
            ORDER BY t.created_at DESC, t.id DESC
        """;

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(sql, factoryId, factoryId);
        List<Map<String, Object>> items = new ArrayList<>();

        for (Map<String, Object> r : rows) {
            Map<String, Object> item = new LinkedHashMap<>(r);
            Map<String, Object> meas = new LinkedHashMap<>();
            meas.put("total", r.get("total_samples"));
            meas.put("passed", r.get("passed_samples"));
            meas.put("failed", r.get("failed_samples"));
            meas.put("average", r.get("avg_value"));
            meas.put("minimum", r.get("min_value"));
            meas.put("maximum", r.get("max_value"));
            meas.put("unit", r.get("unit"));

            item.put("measurements", meas);
            items.add(item);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("total", items.size());
        res.put("page", 1);
        res.put("limit", Math.max(items.size(), 20));
        res.put("as_of", new Date().toInstant().toString());
        return res;
    }

    public Map<String, Object> operationsOverview(String factoryId) {
        List<Map<String, Object>> running = jdbcTemplate.queryForList(
                "SELECT t.id, t.task_code, t.device_id, t.metric_code, t.state, s.spool_code, w.external_code " +
                "FROM m02.inspection_task t " +
                "JOIN m02.cable_spool s ON s.id = t.spool_id " +
                "JOIN m02.work_order w ON w.id = t.work_order_id " +
                "WHERE t.factory_id = ? AND t.state = 'RUNNING'",
                factoryId
        );

        List<Map<String, Object>> conns = jdbcTemplate.queryForList(
                "SELECT device_id, client_session_id, last_heartbeat_at " +
                "FROM m04.device_connection WHERE factory_id = ? AND superseded_at IS NULL",
                factoryId
        );

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("as_of", new Date().toInstant().toString());
        res.put("connections", conns);
        res.put("tasks", running);
        return res;
    }
}
