package com.huiyan.platform.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiError.class)
    public ResponseEntity<ApiResponse<Void>> handleApiError(ApiError ex, HttpServletRequest request) {
        String reqId = request.getHeader("X-Request-Id");
        ApiResponse<Void> body = ApiResponse.error(ex.getStatus(), ex.getCode(), ex.getMessage(), reqId);
        return ResponseEntity.status(ex.getStatus()).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGenericError(Exception ex, HttpServletRequest request) {
        String reqId = request.getHeader("X-Request-Id");
        ApiResponse<Void> body = ApiResponse.error(500, "INTERNAL_SERVER_ERROR", ex.getMessage(), reqId);
        return ResponseEntity.status(500).body(body);
    }
}
