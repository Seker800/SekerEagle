package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.util.*;
import org.junit.Test;

public class CleanupEngineTest {
  private final Map<String, BackupEngine.Checkpoint> records = new HashMap<>();
  private boolean remote = true, stable = true, paused = false;
  private String hash = "a".repeat(64);
  private int checks;
  private final BackupEngine.Store store =
      new BackupEngine.Store() {
        public BackupEngine.Checkpoint load(String k) {
          return records.get(k);
        }

        public void save(String k, BackupEngine.Checkpoint cp) {
          records.put(k, cp);
        }

        public boolean contains(String k) {
          return false;
        }

        public void confirm(String k, String c, BackupEngine.Checkpoint cp) {
          records.put(k, cp);
        }
      };

  private BackupEngine.File file() {
    return new BackupEngine.File(
        "content://media/external/file/1", 100, 1, () -> hash, () -> stable);
  }

  private void receipt() {
    BackupEngine.Checkpoint cp = new BackupEngine.Checkpoint();
    cp.confirmed = true;
    cp.hash = "a".repeat(64);
    records.put(BackupEngine.fileKey("owner", "PHOTO", file()), cp);
  }

  private CleanupEngine engine() {
    return new CleanupEngine(
        store,
        (mode, h, size) -> {
          checks++;
          return remote;
        },
        () -> {
          if (paused) throw new IllegalStateException("scope changed");
        });
  }

  @Test
  public void requiresAConfirmedReceiptForThisExactScopeModeAndFingerprint() throws Exception {
    assertNull(engine().check("owner", "PHOTO", file()));
    receipt();
    assertNotNull(engine().check("owner", "PHOTO", file()));
    assertNull(engine().check("other", "PHOTO", file()));
    assertNull(engine().check("owner", "MATERIAL", file()));
  }

  @Test
  public void deletedServerCopyChangedSourceAndRevokedScopeNeverPermitCleanup() throws Exception {
    receipt();
    remote = false;
    assertNull(engine().check("owner", "PHOTO", file()));
    remote = true;
    hash = "b".repeat(64);
    assertNull(engine().check("owner", "PHOTO", file()));
    hash = "a".repeat(64);
    stable = false;
    assertNull(engine().check("owner", "PHOTO", file()));
    paused = true;
    assertThrows(IllegalStateException.class, () -> engine().check("owner", "PHOTO", file()));
  }

  @Test
  public void revalidationAlwaysChecksServerAgainRatherThanTrustingThePlan() throws Exception {
    receipt();
    assertNotNull(engine().check("owner", "PHOTO", file()));
    remote = false;
    assertNull(engine().check("owner", "PHOTO", file()));
    assertEquals(2, checks);
  }

  @Test
  public void rejectsUnknownModesAndUnknownTimestamps() throws Exception {
    receipt();
    assertThrows(IllegalArgumentException.class, () -> engine().check("owner", "bad", file()));
    assertNull(
        engine()
            .check(
                "owner",
                "PHOTO",
                new BackupEngine.File(file().uri, 100, 0, () -> hash, () -> true)));
  }
}
