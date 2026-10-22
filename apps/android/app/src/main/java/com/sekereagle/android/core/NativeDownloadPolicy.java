package com.sekereagle.android.core;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.LongConsumer;

/** Bounded streaming and safe display names for explicitly requested original-file exports. */
public final class NativeDownloadPolicy {
  private NativeDownloadPolicy() {}

  public static void validate(long size, String mime) {
    if (size <= 0 || size > 5_000_000_000L || mime == null
        || !(mime.matches("(?:image|video)/[a-zA-Z0-9.+-]+") || mime.equals("application/octet-stream")))
      throw new IllegalArgumentException("原文件大小或格式不可下载");
  }

  public static void copy(InputStream input, OutputStream output, long expected,
      Runnable checkActive, LongConsumer progress) throws IOException {
    if (expected <= 0 || expected > 5_000_000_000L) throw new IllegalArgumentException("文件大小无效");
    byte[] buffer = new byte[64 * 1024];
    long total = 0;
    while (true) {
      checkActive.run();
      int count = input.read(buffer);
      checkActive.run();
      if (count < 0) break;
      if (total + count > expected) throw new IOException("原文件大小已变化，请刷新后重试");
      output.write(buffer, 0, count);
      total += count;
      progress.accept(total);
    }
    if (total != expected) throw new IOException("下载不完整，请重试");
    checkActive.run();
  }

  public static String fileName(String original) {
    String value = original.replace('\\', '/');
    value = value.substring(value.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\\p{Cf}:*?\"<>|]", "").trim();
    value = value.replaceAll("^\\.+|\\.+$", "");
    if (value.isBlank()) return "download";
    int dot = value.lastIndexOf('.');
    String extension = dot > 0 && value.length() - dot <= 16 ? value.substring(dot) : "";
    String stem = extension.isEmpty() ? value : value.substring(0, dot);
    while (stem.length() + extension.length() > 160
        || (stem + extension).getBytes(StandardCharsets.UTF_8).length > 220)
      stem = stem.substring(0, stem.offsetByCodePoints(stem.length(), -1));
    return stem + extension;
  }
}
