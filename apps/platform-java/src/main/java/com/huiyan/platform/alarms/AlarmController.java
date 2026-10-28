package com.huiyan.platform.alarms;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/alarms")
public class AlarmController {
    private final AlarmService alarmService;

    public AlarmController(AlarmService alarmService) {
        this.alarmService = alarmService;
    }

    @GetMapping
    public ApiResponse<Map<String, Object>> list(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = alarmService.list("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = alarmService.detail("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/{id}:ack")
    public ApiResponse<Map<String, Object>> ack(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        String actor = "U001";
        Map<String, Object> data = alarmService.acknowledge("factory-local", id, actor);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/{id}:handle")
    public ApiResponse<Map<String, Object>> handle(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        String actor = "U001";
        Map<String, Object> data = alarmService.handle("factory-local", id, actor, body);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/{id}:review")
    public ApiResponse<Map<String, Object>> review(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        String actor = "U001";
        Map<String, Object> data = alarmService.review("factory-local", id, actor, body);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping(":aggregate")
    public ApiResponse<Map<String, Object>> aggregate(
            @RequestBody(required = false) Map<String, String> body,
            HttpServletRequest request
    ) {
        String taskId = body != null ? body.get("task_id") : null;
        Map<String, Object> data = alarmService.aggregateFailMeasurements("factory-local", taskId);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
