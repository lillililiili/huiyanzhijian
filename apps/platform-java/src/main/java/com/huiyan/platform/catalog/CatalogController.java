package com.huiyan.platform.catalog;

import com.huiyan.platform.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class CatalogController {
    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping("/catalog")
    public ApiResponse<Map<String, Object>> catalog(HttpServletRequest request) {
        Map<String, Object> data = catalogService.getCatalog("factory-local");
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }

    @GetMapping("/catalog/specifications")
    public ApiResponse<List<Map<String, Object>>> specifications(HttpServletRequest request) {
        List<Map<String, Object>> data = catalogService.getSpecifications("factory-local");
        return ApiResponse.ok(data, request.getHeader("X-Request-Id"));
    }
}
