package com.sekereagle.android.core;

import java.net.URI;

/** Fixed screen navigation; never accepts commands, arguments, or iframe navigation. */
public final class NativeRoute {
  public static String screen(
      String origin, String current, String target, boolean mainFrame, boolean gesture) {
    if (!mainFrame || !gesture) return "";
    try {
      URI base = new URI(origin), source = new URI(current), next = new URI(target);
      if (!same(base, source)
          || !same(base, next)
          || next.getRawQuery() != null
          || next.getRawFragment() != null) return "";
      switch (next.getRawPath()) {
        case "/_native/backup":
          return "backup";
        case "/_native/cleanup":
          return "cleanup";
        case "/_native/account":
          return "server";
        default:
          return "";
      }
    } catch (Exception e) {
      return "";
    }
  }

  private static boolean same(URI a, URI b) {
    return a.getScheme() != null
        && a.getHost() != null
        && a.getScheme().equals(b.getScheme())
        && a.getHost().equals(b.getHost())
        && a.getPort() == b.getPort()
        && b.getUserInfo() == null;
  }
}
