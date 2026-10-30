package com.sekereagle.android.core;

/** User intent and network cost are separate from automatic idle constraints. */
public final class BackupRunPolicy {

  private BackupRunPolicy() {}

  public static boolean mayStart(boolean manual, boolean userPaused) {
    return manual || !userPaused;
  }

  public static String hold(
      boolean manual,
      boolean unmeteredTransport,
      boolean wifiOnly,
      boolean chargingOnly,
      boolean charging,
      int batteryPercent) {
    if (wifiOnly && !unmeteredTransport) return "等待 Wi-Fi";
    if (!manual && chargingOnly && !charging) return "等待充电";
    if (!manual && !charging && batteryPercent <= 15) return "电量低于 15%，等待充电";
    return "";
  }
}
