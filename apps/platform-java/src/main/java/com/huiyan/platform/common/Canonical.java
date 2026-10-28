package com.huiyan.platform.common;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.apache.commons.codec.digest.DigestUtils;

import java.util.Map;
import java.util.TreeMap;

public class Canonical {
    private static final ObjectMapper mapper = new ObjectMapper()
            .configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    public static String sha256(String value) {
        return DigestUtils.sha256Hex(value);
    }

    public static String digest(Object value) {
        try {
            return sha256(mapper.writeValueAsString(value));
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Canonical serialization error", e);
        }
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> sortMap(Map<String, Object> input) {
        if (input == null) return null;
        Map<String, Object> sorted = new TreeMap<>();
        for (Map.Entry<String, Object> entry : input.entrySet()) {
            Object val = entry.getValue();
            if (val instanceof Map) {
                sorted.put(entry.getKey(), sortMap((Map<String, Object>) val));
            } else {
                sorted.put(entry.getKey(), val);
            }
        }
        return sorted;
    }
}
