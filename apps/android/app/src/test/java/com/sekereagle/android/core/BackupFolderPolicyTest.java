package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackupFolderPolicyTest {
  @Test
  public void allCoversNewIndexedFoldersWithoutWeakeningExplicitBoundaries() {
    assertTrue(BackupPolicy.inFolder("", "DCIM/NewCamera/", true));
    assertTrue(BackupPolicy.inFolder("", "Download/", true));
    assertFalse(BackupPolicy.inFolder("", "", true));
    assertTrue(BackupPolicy.inFolder("DCIM", "DCIM/Camera/", true));
    assertFalse(BackupPolicy.inFolder("DCIM", "DCIM/Camera/", false));
    assertFalse(BackupPolicy.inFolder("DCIM", "DCIM-other/", true));
  }
}
