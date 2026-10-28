package com.huiyan.platform.mes;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/mes")
public class MesController {
    private final MesService mesService;

    public MesController(MesService mesService) {
        this.mesService = mesService;
    }

    @GetMapping("/deliveries")
    public ApiResponse<List<Map<String, Object>>> deliveries(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        List<Map<String, Object>> data = mesService.list("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/enqueue-task")
    public ApiResponse<Map<String, Object>> enqueueTask(
            @RequestBody Map<String, String> body,
            HttpServletRequest request
    ) {
        String taskId = body.get("task_id");
        Map<String, Object> data = mesService.enqueueAndDeliver("factory-local", taskId);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/deliveries/{id}:retry")
    public ApiResponse<Map<String, Object>> retry(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = mesService.retry("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
