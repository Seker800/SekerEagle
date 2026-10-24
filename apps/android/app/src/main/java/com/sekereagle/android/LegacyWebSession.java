package com.sekereagle.android;

import android.webkit.CookieManager;
import android.webkit.WebStorage;

/**
 * Removes authentication state left by the 0.1 WebView preview. The native app never reads these
 * cookies, but an activity restored from Recents after an upgrade could otherwise resurrect the
 * old unencrypted session. Web storage is cleared with the cookie jar for the same reason.
 */
final class LegacyWebSession {
  private LegacyWebSession() {}

  static void migrate(android.content.Context context, Runnable complete) {
    BackupSettings settings = new BackupSettings(context);
    if (settings.flag("legacy", "web-session-cleared-v1", false)) {
      complete.run();
      return;
    }
    CookieManager cookies = CookieManager.getInstance();
    cookies.removeAllCookies(removed -> {
      cookies.flush();
      WebStorage.getInstance().deleteAllData();
      settings.setFlag("legacy", "web-session-cleared-v1", true);
      complete.run();
    });
  }

  static void clear() {
    CookieManager cookies = CookieManager.getInstance();
    cookies.removeAllCookies(null);
    cookies.flush();
    WebStorage.getInstance().deleteAllData();
  }
}
