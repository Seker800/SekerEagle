package com.sekereagle.android.core;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public final class BackupPolicy {
    private BackupPolicy() {}
    public static String origin(String input, boolean debug) {
        try {
            URI uri = new URI(input.trim());
            boolean tls = "https".equals(uri.getScheme());
            boolean local = debug && "http".equals(uri.getScheme()) &&
                ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()));
            if ((!tls && !local) || uri.getHost() == null || uri.getRawUserInfo() != null ||
                uri.getRawQuery() != null || uri.getRawFragment() != null ||
                (!uri.getRawPath().isEmpty() && !uri.getRawPath().equals("/"))) throw new IllegalArgumentException();
            return uri.getScheme() + "://" + uri.getRawAuthority();
        } catch (Exception e) { throw new IllegalArgumentException("请输入 HTTPS 服务地址；调试版仅额外允许本机 HTTP 地址。", e); }
    }
    public static boolean inFolder(String folder, String path, boolean recursive) {
        String prefix = folder.endsWith("/") ? folder : folder + "/";
        return path.equals(prefix) || (recursive && path.startsWith(prefix));
    }
    public static String digest(String value) {
        try { return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return out.toString();
    }
}
