package com.huiyan.platform.production;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class ProductionController {
    private final ProductionService productionService;

    public ProductionController(ProductionService productionService) {
        this.productionService = productionService;
    }

    @GetMapping("/production/work-orders")
    public ApiResponse<Map<String, Object>> workOrders(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.workOrders("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/work-order-summaries/{id}")
    public ApiResponse<Map<String, Object>> workOrderSummary(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.workOrderSummary("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/work-orders")
    public ApiResponse<Map<String, Object>> createWorkOrder(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.createWorkOrder("factory-local", body);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/work-orders/{id}:delete")
    public ApiResponse<Map<String, Object>> deleteWorkOrder(
            @PathVariable String id,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.deleteWorkOrder("factory-local", id);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/production/spools")
    public ApiResponse<Map<String, Object>> spools(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.spools("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @PostMapping("/spools")
    public ApiResponse<Map<String, Object>> createSpool(
            @RequestBody Map<String, Object> body,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.createSpool("factory-local", body);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/production/tasks")
    public ApiResponse<Map<String, Object>> tasks(
            @RequestParam Map<String, String> params,
            HttpServletRequest request
    ) {
        Map<String, Object> data = productionService.tasks("factory-local", params);
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/operations/overview")
    public ApiResponse<Map<String, Object>> overview(HttpServletRequest request) {
        Map<String, Object> data = productionService.operationsOverview("factory-local");
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
