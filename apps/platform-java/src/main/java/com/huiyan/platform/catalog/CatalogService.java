package com.huiyan.platform.catalog;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class CatalogService {
    private final JdbcTemplate jdbcTemplate;

    public CatalogService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> getCatalog(String factoryId) {
        Map<String, Object> result = new LinkedHashMap<>();

        result.put("factory", jdbcTemplate.queryForList(
                "SELECT id, code, name, timezone, status FROM m01.factory WHERE id = ?",
                factoryId
        ));

        result.put("production_line", jdbcTemplate.queryForList(
                "SELECT id, factory_id, code, name FROM m01.production_line WHERE factory_id = ?",
                factoryId
        ));

        result.put("inspection_process", jdbcTemplate.queryForList(
                "SELECT id, factory_id, code, name FROM m01.inspection_process WHERE factory_id = ?",
                factoryId
        ));

        result.put("product_specification", jdbcTemplate.queryForList(
                "SELECT id, factory_id, code, name, voltage_kv, conductor_area_mm2, core_count, shield_structure, source_metadata " +
                "FROM m01.product_specification WHERE factory_id = ? ORDER BY id",
                factoryId
        ));

        result.put("device", jdbcTemplate.queryForList(
                "SELECT id, factory_id, line_id, process_id, code, name, metric_code, model, enabled, data_environment " +
                "FROM m01.device WHERE factory_id = ? ORDER BY id",
                factoryId
        ));

        result.put("recipes", jdbcTemplate.queryForList(
                "SELECT r.id, r.factory_id, r.metric_code, r.revision, r.approval_state, r.rule_snapshot, m.name, m.unit " +
                "FROM m03.recipe_version r " +
                "LEFT JOIN m03.recipe_metadata m ON m.recipe_version_id = r.id " +
                "WHERE r.factory_id = ? ORDER BY r.metric_code, r.revision DESC",
                factoryId
        ));

        return result;
    }

    public List<Map<String, Object>> getSpecifications(String factoryId) {
        return jdbcTemplate.queryForList(
                "SELECT id, factory_id, code, name, voltage_kv, conductor_area_mm2, core_count, shield_structure " +
                "FROM m01.product_specification WHERE factory_id = ? ORDER BY id",
                factoryId
        );
    }
}
