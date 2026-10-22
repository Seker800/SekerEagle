package com.sekereagle.android.core;

import java.net.URLEncoder;

/** Shared by both native library modes. No API decision is duplicated in the UI. */
public final class NativeGalleryPolicy {
  private NativeGalleryPolicy() {}

  public static String base(String mode) {
    if ("PHOTO".equals(mode)) return "/api/photos";
    if ("MATERIAL".equals(mode)) return "/api/eagle";
    throw new IllegalArgumentException("未知图库模式");
  }

  public static String listPath(String mode, String search, String cursor) {
    return base(mode)
        + "/assets?limit=60"
        + (search.isBlank() ? "" : "&search=" + encode(search.trim()))
        + (cursor.isEmpty() ? "" : "&cursor=" + encode(cursor));
  }

  public static String mediaPath(String mode, String asset, String rendition) {
    return base(mode)
        + "/assets/"
        + identifier(asset)
        + "/renditions/"
        + identifier(rendition)
        + "/content";
  }

  public static String identifier(String value) {
    if (value == null || !value.matches("[a-zA-Z0-9_-]{1,100}"))
      throw new IllegalArgumentException("无效资源标识");
    return value;
  }

  public static String safePath(String path) {
    if (!path.startsWith("/api/")
        || path.split("\\?", 2)[0].contains("..")
        || path.contains("\\")
        || path.contains("#")
        || path.contains("\r")
        || path.contains("\n")
        || path.contains(" ")) throw new IllegalArgumentException("接口地址必须属于当前服务");
    return path;
  }

  private static String encode(String value) {
    try {
      return URLEncoder.encode(value, "UTF-8");
    } catch (java.io.UnsupportedEncodingException impossible) {
      throw new AssertionError(impossible);
    }
  }
}
