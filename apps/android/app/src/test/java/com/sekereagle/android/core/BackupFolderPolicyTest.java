package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackupFolderPolicyTest {
  @Test
  public void hiddenNamesStayOutOfDirectoryScansLikeTheMediaIndex() {
    assertTrue(BackupPolicy.hidden(".IMG_20260212_170000.jpg"));
    assertTrue(BackupPolicy.hidden(".trashed"));
    assertFalse(BackupPolicy.hidden("IMG_20260212_170000.jpg"));
    assertFalse(BackupPolicy.hidden(""));
    assertFalse(BackupPolicy.hidden(null));
  }

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
