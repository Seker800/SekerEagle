package com.sekereagle.android.core;

/** Decides when the local ledger needs a full media reconcile instead of an incremental pass. */
public final class BackupScanPolicy {
  public static final long FULL_INTERVAL_SECONDS = 7L * 24 * 3600;
  public static final long OVERLAP_SECONDS = 3600;

  private BackupScanPolicy() {}

  public static boolean full(
      long maxId, long scannedAt, long fullScannedAt, long now, boolean resume) {
    return resume
        || maxId < 0
        || scannedAt <= 0
        || fullScannedAt <= 0
        || now - fullScannedAt >= FULL_INTERVAL_SECONDS;
  }

  public static long changedAfter(long scannedAt) {
    return scannedAt <= OVERLAP_SECONDS ? 0 : scannedAt - OVERLAP_SECONDS;
  }

  public static long nextFull(long fullScannedAt, long scanStarted, boolean full) {
    return full ? scanStarted : fullScannedAt;
  }
}
