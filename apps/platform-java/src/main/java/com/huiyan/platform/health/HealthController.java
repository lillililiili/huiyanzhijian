package com.huiyan.platform.health;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/health")
public class HealthController {
    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/live")
    public ApiResponse<Map<String, Object>> live(HttpServletRequest request) {
        return ApiResponse.ok(Map.of("alive", true, "engine", "Java 21 / Spring Boot 3"), request.getHeader("X-Request-Id"));
    }

    @GetMapping("/ready")
    public ApiResponse<Map<String, Object>> ready(HttpServletRequest request) {
        jdbcTemplate.queryForObject("SELECT 1", Integer.class);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("database", "UP");
        data.put("engine", "Java 21 / Spring Boot 3.3.4 (Adoptium/Zulu)");
        data.put("implemented", List.of(
                "m00-identity", "m01-catalog", "m02-production", "m04-measurements",
                "m05-alarms", "m06-quality-reports", "m07-mes"
        ));
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
