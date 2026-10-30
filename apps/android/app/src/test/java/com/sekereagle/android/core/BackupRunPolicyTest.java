package com.sekereagle.android.core;

import static org.junit.Assert.*;
import org.junit.Test;

public class BackupRunPolicyTest {
  @Test public void explicitRunsBypassIdleBatteryConditionsButNeverNetworkCost() {
    assertEquals("", BackupRunPolicy.hold(true, true, false, true, false, 5));
    assertEquals("等待 Wi-Fi", BackupRunPolicy.hold(true, false, true, true, false, 5));
    assertEquals("等待充电", BackupRunPolicy.hold(false, true, false, true, false, 90));
    assertEquals("电量低于 15%，等待充电", BackupRunPolicy.hold(false, true, false, false, false, 15));
    assertEquals("", BackupRunPolicy.hold(false, true, false, true, true, 5));
  }
  @Test public void automaticOpeningCannotOverrideUserPause() {
    assertFalse(BackupRunPolicy.mayStart(false, true));
    assertTrue(BackupRunPolicy.mayStart(true, true));
    assertTrue(BackupRunPolicy.mayStart(false, false));
  }
}
