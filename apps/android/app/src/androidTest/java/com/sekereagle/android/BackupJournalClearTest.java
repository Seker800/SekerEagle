package com.sekereagle.android;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import com.sekereagle.android.core.BackupEngine;
import org.junit.Test;

/** Clearing a run must drop its progress but keep confirmed receipts for fast skips. */
public final class BackupJournalClearTest {

  private static final String DB = "clear-run-test.db";

  @Test
  public void clearRunKeepsReceiptsAndConfirmedFilesButDropsRunState() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    context.deleteDatabase(DB);
    String scope = "scope";
    try (BackupJournal journal = new BackupJournal(context, DB)) {
      BackupEngine.Checkpoint confirmed = new BackupEngine.Checkpoint();
      confirmed.hash = "a".repeat(64);
      confirmed.confirmed = true;
      journal.save(scope + ":PHOTO:confirmed", confirmed);
      journal.confirm(scope + ":PHOTO:confirmed", scope + ":PHOTO:" + confirmed.hash + ":10", confirmed);
      BackupEngine.Checkpoint terminal = new BackupEngine.Checkpoint();
      terminal.terminalError = "rejected";
      journal.save(scope + ":PHOTO:terminal", terminal);
      journal.scanResult(scope, "PHOTO:key", "10:20", "UPLOADED");
      journal.scanFailure(
          scope, "PHOTO:fail", "10:20", "content://x", "x.jpg", "PHOTO", 10, 20, false, "oops");
      journal.saveScanState(scope, 42, 100, 100, "hash");
      assertTrue(journal.contains(scope + ":PHOTO:" + confirmed.hash + ":10"));
      assertTrue(journal.scanCompleted(scope, "PHOTO:key", "10:20"));
      assertEquals(1, journal.failures(scope).size());

      journal.clearRun(scope);

      assertNull(journal.load(scope + ":PHOTO:terminal"));
      assertNotNull(journal.load(scope + ":PHOTO:confirmed"));
      assertTrue(journal.contains(scope + ":PHOTO:" + confirmed.hash + ":10"));
      assertFalse(journal.scanCompleted(scope, "PHOTO:key", "10:20"));
      assertEquals(0, journal.failures(scope).size());
      assertEquals(0, journal.scanCounts(scope)[0]);
      assertArrayEquals(new long[] {-1, 0, 0}, journal.scanState(scope));
      assertEquals("", journal.scanRulesHash(scope));
    } finally {
      context.deleteDatabase(DB);
    }
  }
}
