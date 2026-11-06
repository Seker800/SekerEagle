package com.sekereagle.android.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class BackupScanPolicyTest {
  private static final long NOW = 2_000_000_000L;

  @Test
  public void firstRunWithoutWatermarkIsFull() {
    assertTrue(BackupScanPolicy.full(-1, 0, 0, NOW, false));
    assertTrue(BackupScanPolicy.full(10, 0, NOW, NOW, false));
  }

  @Test
  public void recentIncrementalRunStaysIncremental() {
    assertFalse(BackupScanPolicy.full(10, NOW - 60, NOW - 86_400, NOW, false));
  }

  @Test
  public void resumeAndWeeklyReconcileAreFull() {
    assertTrue(BackupScanPolicy.full(10, NOW - 60, NOW - 86_400, NOW, true));
    assertTrue(
        BackupScanPolicy.full(
            10, NOW - 60, NOW - BackupScanPolicy.FULL_INTERVAL_SECONDS, NOW, false));
  }

  @Test
  public void changedWindowKeepsOneHourOverlap() {
    assertEquals(3600, BackupScanPolicy.changedAfter(7200));
    assertEquals(0, BackupScanPolicy.changedAfter(1000));
  }

  @Test
  public void fullTimestampAdvancesOnlyAfterAFullPass() {
    assertEquals(NOW, BackupScanPolicy.nextFull(NOW - 100, NOW, true));
    assertEquals(NOW - 100, BackupScanPolicy.nextFull(NOW - 100, NOW, false));
  }
}
