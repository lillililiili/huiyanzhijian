package com.huiyan.platform.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {
    private String code;
    private String message;
    private String request_id;
    private T data;
    private String write_outcome;
    private Boolean retryable;
    private Long retry_after_ms;
    private List<String> field_errors;

    public ApiResponse() {}

    public static <T> ApiResponse<T> ok(T data, String requestId) {
        ApiResponse<T> res = new ApiResponse<>();
        res.setCode("OK");
        res.setMessage("成功");
        res.setRequest_id(requestId != null ? requestId : UUID.randomUUID().toString());
        res.setData(data);
        return res;
    }

    public static <T> ApiResponse<T> error(int status, String code, String message, String requestId) {
        ApiResponse<T> res = new ApiResponse<>();
        res.setCode(code != null ? code : "ERROR");
        res.setMessage(message != null ? message : "系统异常");
        res.setRequest_id(requestId != null ? requestId : UUID.randomUUID().toString());
        res.setData(null);
        res.setWrite_outcome("NONE");
        res.setRetryable(status >= 500 || status == 429);
        res.setRetry_after_ms(status == 429 ? 60000L : (status >= 500 ? 1000L : null));
        res.setField_errors(Collections.emptyList());
        return res;
    }

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public String getRequest_id() { return request_id; }
    public void setRequest_id(String request_id) { this.request_id = request_id; }

    public T getData() { return data; }
    public void setData(T data) { this.data = data; }

    public String getWrite_outcome() { return write_outcome; }
    public void setWrite_outcome(String write_outcome) { this.write_outcome = write_outcome; }

    public Boolean getRetryable() { return retryable; }
    public void setRetryable(Boolean retryable) { this.retryable = retryable; }

    public Long getRetry_after_ms() { return retry_after_ms; }
    public void setRetry_after_ms(Long retry_after_ms) { this.retry_after_ms = retry_after_ms; }

    public List<String> getField_errors() { return field_errors; }
    public void setField_errors(List<String> field_errors) { this.field_errors = field_errors; }
}
