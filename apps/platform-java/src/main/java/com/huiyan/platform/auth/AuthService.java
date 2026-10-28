package com.huiyan.platform.auth;

import com.huiyan.platform.common.ApiError;
import org.bouncycastle.crypto.generators.SCrypt;
import org.bouncycastle.util.encoders.Hex;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

@Service
public class AuthService {
    private final JdbcTemplate jdbcTemplate;

    public AuthService(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public Map<String, Object> login(String username, String password) {
        List<Map<String, Object>> users = jdbcTemplate.queryForList(
                "SELECT id, login_name, display_name, password_hash, status FROM m00.app_user WHERE login_name = ?",
                username
        );
        if (users.isEmpty()) {
            throw new ApiError(401, "AUTHENTICATION_FAILED", "用户名或密码错误");
        }

        Map<String, Object> user = users.get(0);
        String status = (String) user.get("status");
        if (!"ACTIVE".equals(status)) {
            throw new ApiError(403, "ACCOUNT_DISABLED", "账号已被停用");
        }

        String storedHash = (String) user.get("password_hash");
        if (!verifyPassword(password, storedHash)) {
            throw new ApiError(401, "AUTHENTICATION_FAILED", "用户名或密码错误");
        }

        String userId = (String) user.get("id");
        List<String> permissions = getPermissions(userId);

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("id", userId);
        profile.put("login_name", user.get("login_name"));
        profile.put("display_name", user.get("display_name"));
        profile.put("factory_id", "factory-local");
        profile.put("permissions", permissions);

        String csrf = UUID.randomUUID().toString().replace("-", "");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", profile);
        result.put("csrf_token", csrf);
        return result;
    }

    public Map<String, Object> getProfile(String userId) {
        List<Map<String, Object>> users = jdbcTemplate.queryForList(
                "SELECT id, login_name, display_name, status FROM m00.app_user WHERE id = ?",
                userId
        );
        if (users.isEmpty()) {
            throw new ApiError(404, "USER_NOT_FOUND", "用户不存在");
        }
        Map<String, Object> user = users.get(0);
        List<String> permissions = getPermissions(userId);

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("id", user.get("id"));
        profile.put("login_name", user.get("login_name"));
        profile.put("display_name", user.get("display_name"));
        profile.put("factory_id", "factory-local");
        profile.put("permissions", permissions);
        return profile;
    }

    public List<String> getPermissions(String userId) {
        List<Map<String, Object>> roles = jdbcTemplate.queryForList(
                "SELECT r.permission_codes " +
                "FROM m00.user_role ur " +
                "JOIN m00.app_role r ON r.code = ur.role_code " +
                "WHERE ur.user_id = ? AND ur.factory_id = 'factory-local'",
                userId
        );
        Set<String> set = new LinkedHashSet<>();
        for (Map<String, Object> r : roles) {
            String[] perms = (String[]) r.get("permission_codes");
            if (perms != null) {
                Collections.addAll(set, perms);
            }
        }
        return new ArrayList<>(set);
    }

    private boolean verifyPassword(String password, String stored) {
        if (stored == null || !stored.contains(":")) {
            return false;
        }
        try {
            String[] parts = stored.split(":");
            String salt = parts[0];
            String expectedHex = parts[1];

            // Node.js crypto.scrypt default N=16384, r=8, p=1, maxmem=32MB, keylen=64
            byte[] derived = SCrypt.generate(
                    password.getBytes(StandardCharsets.UTF_8),
                    salt.getBytes(StandardCharsets.UTF_8),
                    16384, 8, 1, 64
            );
            String actualHex = Hex.toHexString(derived);
            return MessageDigest.isEqual(actualHex.getBytes(StandardCharsets.UTF_8), expectedHex.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }
}
