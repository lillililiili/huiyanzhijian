package com.huiyan.platform.common;

public class ApiError extends RuntimeException {
    private final int status;
    private final String code;

    public ApiError(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public int getStatus() { return status; }
    public String getCode() { return code; }
}
