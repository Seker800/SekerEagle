package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.util.*;
import org.junit.Test;

public class NativeUploadPolicyTest {
  @Test
  public void acceptsOnlyExplicitContentUrisAndDeduplicatesWithoutTruncation() {
    assertEquals(
        List.of("content://media/one", "content://docs/two"),
        NativeUploadPolicy.picked(
            List.of("content://media/one", "content://media/one", "content://docs/two")));
    assertTrue(NativeUploadPolicy.picked(List.of()).isEmpty());
    for (String uri :
        List.of("file:///private/file.jpg", "https://foreign/file.jpg", "content:///missing"))
      assertThrows(IllegalArgumentException.class, () -> NativeUploadPolicy.picked(List.of(uri)));
    List<String> tooMany = new ArrayList<>();
    for (int i = 0; i < 101; i++) tooMany.add("content://media/" + i);
    assertThrows(IllegalArgumentException.class, () -> NativeUploadPolicy.picked(tooMany));
  }

  @Test
  public void manualTasksUseFreshReceiptsAndKeepOnlyTheirOwnRetryCheckpoints() throws Exception {
    NativeUploadPolicy.Journal first = new NativeUploadPolicy.Journal();
    BackupEngine.Checkpoint good = new BackupEngine.Checkpoint();
    good.confirmed = true;
    BackupEngine.Checkpoint bad = new BackupEngine.Checkpoint();
    bad.terminalError = "unsupported";
    BackupEngine.Checkpoint resumable = new BackupEngine.Checkpoint();
    resumable.session = "session";
    first.confirm("file", "scope:PHOTO:hash", good);
    first.save("bad", bad);
    first.save("retry", resumable);
    first.retryFailures();
    assertNull(first.load("bad"));
    assertSame(resumable, first.load("retry"));
    assertSame(good, first.load("file"));
    assertTrue(first.contains("scope:PHOTO:hash"));
    assertFalse(first.contains("scope:MATERIAL:hash"));
    assertFalse(new NativeUploadPolicy.Journal().contains("scope:PHOTO:hash"));
  }

  @Test
  public void changedBytesCannotReuseOldMultipartParts() {
    NativeUploadPolicy.Journal journal = new NativeUploadPolicy.Journal();
    BackupEngine.Checkpoint cp = new BackupEngine.Checkpoint();
    cp.hash = "a".repeat(64);
    cp.session = "old";
    journal.save("key", cp);
    journal.verifyContent("key", cp.hash);
    assertSame(cp, journal.load("key"));
    journal.verifyContent("key", "b".repeat(64));
    assertNull(journal.load("key"));
    journal.verifyContent("missing", "b".repeat(64));
  }
}
