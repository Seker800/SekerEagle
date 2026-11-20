package com.sekereagle.android.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class BackupFolderPolicyTest {
  @Test
  public void firstLevelMediaFoldersAggregateTheirChildAlbums() {
    assertEquals("/DCIM/", BackupPolicy.parentFolder("/DCIM/Camera/"));
    assertEquals("/Pictures/", BackupPolicy.parentFolder("Pictures/WeiXin/"));
    assertNull(BackupPolicy.parentFolder("/DCIM/"));
    assertNull(BackupPolicy.parentFolder(""));
    assertNull(BackupPolicy.parentFolder(null));
  }

  @Test
  public void documentIdsKeepTheRealPrefixEvenWhenDisplayNamesDoNot() {
    assertEquals(
        ".trashed-1797000000-plain.jpg",
        BackupPolicy.documentName("primary:DCIM/Screenshots/.trashed-1797000000-plain.jpg"));
    assertEquals("DCIM", BackupPolicy.documentName("primary:DCIM"));
    assertEquals("photo.jpg", BackupPolicy.documentName("photo.jpg"));
    assertTrue(BackupPolicy.hidden(BackupPolicy.documentName("primary:DCIM/.trashed-x.jpg")));
    assertFalse(BackupPolicy.hidden(BackupPolicy.documentName("primary:DCIM/plain.jpg")));
  }

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
