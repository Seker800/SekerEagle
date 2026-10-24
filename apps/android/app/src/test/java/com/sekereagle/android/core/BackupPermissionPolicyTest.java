package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackupPermissionPolicyTest {
  @Test
  public void treeOnlyBackupsDoNotRequireBroadMediaAccess() {
    assertFalse(BackupPermissionPolicy.requiresCompleteMediaAccess(0));
    assertTrue(BackupPermissionPolicy.requiresCompleteMediaAccess(1));
  }

  @Test
  public void legacyStoragePermissionCoversApi30To32() {
    assertTrue(BackupPermissionPolicy.hasCompleteMediaAccess(30, false, false, true));
    assertTrue(BackupPermissionPolicy.hasCompleteMediaAccess(32, false, false, true));
    assertFalse(BackupPermissionPolicy.hasCompleteMediaAccess(32, true, true, false));
  }

  @Test
  public void api33AndLaterRequireBothImagesAndVideo() {
    assertTrue(BackupPermissionPolicy.hasCompleteMediaAccess(33, true, true, false));
    assertTrue(BackupPermissionPolicy.hasCompleteMediaAccess(36, true, true, false));
    assertFalse(BackupPermissionPolicy.hasCompleteMediaAccess(33, true, false, true));
    assertFalse(BackupPermissionPolicy.hasCompleteMediaAccess(34, false, true, true));
    assertFalse(BackupPermissionPolicy.hasCompleteMediaAccess(36, false, false, false));
  }
}
