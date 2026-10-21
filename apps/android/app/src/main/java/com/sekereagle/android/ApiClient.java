package com.sekereagle.android;

import android.webkit.CookieManager;
import com.sekereagle.android.core.BackupPolicy;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class ApiClient implements UploadApi {
  static final class Failure extends com.sekereagle.android.core.UploadFailure {
    Failure(int status) {
      this(status, Endpoint.API);
    }

    Failure(int status, Endpoint endpoint) {
      super(status, endpoint);
    }
  }

  final String origin;
  private final String token;

  ApiClient(String origin, String token) {
    this.origin = BackupPolicy.origin(origin, BuildConfig.DEBUG);
    this.token = token;
  }

  public JSONObject request(String method, String path, JSONObject body) throws Exception {
    if (!path.startsWith("/api/")) throw new IOException("无效接口路径");
    HttpURLConnection connection = open(origin + path);
    try {
      connection.setRequestMethod(method);
      connection.setRequestProperty("Origin", origin);
      connection.setRequestProperty("Accept", "application/json");
      if (token.isEmpty()) {
        String cookies = CookieManager.getInstance().getCookie(origin + path);
        if (cookies != null) connection.setRequestProperty("Cookie", cookies);
      } else connection.setRequestProperty("Authorization", "Bearer " + token);
      if (body != null) {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
          output.write(bytes);
        }
      }
      int code = connection.getResponseCode();
      if (code < 200 || code >= 300) throw new Failure(code);
      try (InputStream input = connection.getInputStream()) {
        return new JSONObject(new String(readBounded(input), StandardCharsets.UTF_8));
      }
    } finally {
      connection.disconnect();
    }
  }

  public String put(
      String url,
      InputStream input,
      long bytes,
      com.sekereagle.android.core.BackupEngine.Guard guard)
      throws Exception {
    // Signed object URLs are rewritten to the authenticated gateway, as in the shared Web client.
    String target = BackupPolicy.uploadUrl(url, origin);
    HttpURLConnection connection = open(target);
    try {
      connection.setRequestMethod("PUT");
      connection.setDoOutput(true);
      connection.setFixedLengthStreamingMode(bytes);
      connection.setRequestProperty("Content-Type", "application/octet-stream");
      try (OutputStream output = connection.getOutputStream()) {
        byte[] buffer = new byte[256 * 1024];
        long remaining = bytes;
        while (remaining > 0) {
          guard.check();
          int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
          if (count < 0) throw new IOException("文件读取未完成");
          output.write(buffer, 0, count);
          remaining -= count;
        }
      }
      int code = connection.getResponseCode();
      if (code < 200 || code >= 300)
        throw new Failure(code, com.sekereagle.android.core.UploadFailure.Endpoint.SIGNED_PART);
      String etag = connection.getHeaderField("ETag");
      if (etag == null || etag.isEmpty()) throw new IOException("服务器未确认上传分片");
      return etag;
    } finally {
      connection.disconnect();
    }
  }

  private static HttpURLConnection open(String url) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
    connection.setInstanceFollowRedirects(false);
    connection.setConnectTimeout(15_000);
    connection.setReadTimeout(30_000);
    return connection;
  }

  static byte[] readBounded(InputStream input) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) != -1) {
      if (output.size() + count > 2 * 1024 * 1024) throw new IOException("接口响应过大");
      output.write(buffer, 0, count);
    }
    return output.toByteArray();
  }
}
