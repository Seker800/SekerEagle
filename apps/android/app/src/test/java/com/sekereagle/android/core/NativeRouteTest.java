package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class NativeRouteTest {
  private final String origin = "http://localhost:42319";

  private String route(String target, boolean main, boolean gesture) {
    return NativeRoute.screen(origin, origin, target, main, gesture);
  }

  @Test
  public void opensOnlyKnownScreensFromTrustedUserNavigation() {
    assertEquals("cleanup", route(origin + "/_native/cleanup", true, true));
    assertEquals("backup", route(origin + "/_native/backup", true, true));
    assertEquals("server", route(origin + "/_native/account", true, true));
  }

  @Test
  public void rejectsParametersFramesScriptsOriginsAndUnknownActions() {
    assertEquals("", route(origin + "/_native/cleanup?delete=true", true, true));
    assertEquals("", route(origin + "/_native/cleanup#delete", true, true));
    assertEquals("", route(origin + "/_native/cleanup", false, true));
    assertEquals("", route(origin + "/_native/cleanup", true, false));
    assertEquals("", route("https://evil.invalid/_native/cleanup", true, true));
    assertEquals("", route(origin + "/_native/delete", true, true));
    assertEquals(
        "",
        NativeRoute.screen(
            origin, "https://evil.invalid", origin + "/_native/cleanup", true, true));
    assertEquals("", route("bad uri", true, true));
  }
}
