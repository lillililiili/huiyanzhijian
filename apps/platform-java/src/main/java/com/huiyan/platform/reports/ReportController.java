package com.huiyan.platform.reports;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {
    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping
    public ApiResponse<Map<String, Object>> list(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = reportService.list("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping(":generate")
    public ApiResponse<Map<String, Object>> generate(
            @RequestBody Map<String, String> body,
            HttpServletRequest request
    ) {
        String spoolId = body.get("spool_id");
        String actor = "U001";
        Map<String, Object> data = reportService.generateReport("factory-local", spoolId, actor);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/{id}")
    public ApiResponse<Map<String, Object>> detail(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = reportService.detail("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/{id}:publish")
    public ApiResponse<Map<String, Object>> publish(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        String actor = "U001";
        Map<String, Object> data = reportService.publish("factory-local", id, actor);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
