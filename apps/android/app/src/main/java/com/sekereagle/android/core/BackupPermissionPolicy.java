package com.sekereagle.android.core;

/**
 * Platform-independent media permission decision for automatic/manual directory backups.
 *
 * <p>Android 14 can grant access to only the user-selected photos. That partial grant must never
 * be treated as a complete album scan, otherwise the service would silently skip unselected files.
 */
public final class BackupPermissionPolicy {
  private BackupPermissionPolicy() {}

  public static boolean requiresCompleteMediaAccess(int mediaRuleCount) {
    return mediaRuleCount > 0;
  }

  public static boolean hasCompleteMediaAccess(
      int sdkInt, boolean imagesGranted, boolean videoGranted, boolean storageGranted) {
    return sdkInt >= 33 ? imagesGranted && videoGranted : storageGranted;
  }
}
