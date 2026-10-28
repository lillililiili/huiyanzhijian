package com.huiyan.platform.measurements;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class MeasurementController {
    private final MeasurementService measurementService;

    public MeasurementController(MeasurementService measurementService) {
        this.measurementService = measurementService;
    }

    @GetMapping("/measurements")
    public ApiResponse<Map<String, Object>> measurements(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = measurementService.queryMeasurements("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/measurements/{id}")
    public ApiResponse<Map<String, Object>> measurement(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = measurementService.getMeasurement("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/device-status")
    public ApiResponse<List<Map<String, Object>>> deviceStatus(HttpServletRequest request) {
        List<Map<String, Object>> data = measurementService.getDeviceStatus("factory-local");
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
