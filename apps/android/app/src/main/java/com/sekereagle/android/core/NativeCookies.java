package com.sekereagle.android.core;

import java.net.URI;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A minimal first-party session jar; privacy cookies and arbitrary response cookies are not
 * imported.
 */
public final class NativeCookies {
  private final String host;
  private final Map<String, String> values = new LinkedHashMap<>();

  public NativeCookies(String origin) {
    host = URI.create(origin).getHost();
  }

  public void accept(String header) {
    if (header == null || header.contains("\r") || header.contains("\n")) return;
    String[] parts = header.split(";");
    String[] pair = parts[0].trim().split("=", 2);
    if (pair.length != 2
        || !(pair[0].equals("sekereagle_access") || pair[0].equals("sekereagle_refresh"))) return;
    if (pair[1].length() > 8192 || !pair[1].matches("[a-zA-Z0-9._~+/-]*={0,2}")) return;
    boolean remove = pair[1].isEmpty();
    Long maxAge = null;
    String expires = null;
    for (int i = 1; i < parts.length; i++) {
      String[] attr = parts[i].trim().split("=", 2);
      if (attr[0].equalsIgnoreCase("Domain")
          && (attr.length != 2 || !attr[1].replaceFirst("^\\.", "").equalsIgnoreCase(host))) return;
      if (attr[0].equalsIgnoreCase("Max-Age") && attr.length == 2 && attr[1].matches("-?[0-9]+")) {
        try {
          maxAge = Long.parseLong(attr[1]);
        } catch (NumberFormatException invalid) {
          return;
        }
      }
      if (attr[0].equalsIgnoreCase("Expires") && attr.length == 2) expires = attr[1].trim();
    }
    if (maxAge != null) remove = maxAge <= 0;
    else if (expires != null) {
      try {
        remove =
            !ZonedDateTime.parse(expires, DateTimeFormatter.RFC_1123_DATE_TIME)
                .toInstant()
                .isAfter(Instant.now());
      } catch (DateTimeParseException invalid) {
        // Unknown date formats are ignored, as with most non-browser cookie clients.
      }
    }
    if (remove) values.remove(pair[0]);
    else values.put(pair[0], pair[1]);
  }

  public String header(String path) {
    String access = values.getOrDefault("sekereagle_access", ""),
        refresh = values.getOrDefault("sekereagle_refresh", "");
    String result = access.isEmpty() ? "" : "sekereagle_access=" + access;
    if ((path.equals("/api/auth") || path.startsWith("/api/auth/")) && !refresh.isEmpty())
      result += (result.isEmpty() ? "" : "; ") + "sekereagle_refresh=" + refresh;
    return result;
  }

  public Map<String, String> snapshot() {
    return new LinkedHashMap<>(values);
  }

  public void restore(Map<String, String> saved) {
    clear();
    saved.forEach((key, value) -> accept(key + "=" + value));
  }

  public void clear() {
    values.clear();
  }
}
