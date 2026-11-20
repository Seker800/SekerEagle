package com.sekereagle.android.core;

/** Read-only cleanup eligibility. This engine never deletes local or remote files. */
public final class CleanupEngine {
  public interface Remote {
    boolean exists(String mode, String hash, long size) throws Exception;
  }

  public static final class Candidate {
    public final BackupEngine.File file;
    public final String mode, hash;

    Candidate(BackupEngine.File file, String mode, String hash) {
      this.file = file;
      this.mode = mode;
      this.hash = hash;
    }
  }

  private final BackupEngine.Store store;
  private final Remote remote;
  private final BackupEngine.Guard guard;

  public CleanupEngine(BackupEngine.Store store, Remote remote, BackupEngine.Guard guard) {
    this.store = store;
    this.remote = remote;
    this.guard = guard;
  }

  /**
   * Fast eligibility from the confirmed backup receipt and the file's current size/modified time.
   * It never reads the original bytes; the caller confirms server visibility in one batch.
   */
  public Candidate local(String scope, String mode, BackupEngine.File file) throws Exception {
    if (scope.isEmpty() || !(mode.equals("PHOTO") || mode.equals("MATERIAL")))
      throw new IllegalArgumentException("清理作用域无效");
    guard.check();
    if (file.size <= 0 || file.modified <= 0) return null;
    BackupEngine.Checkpoint cp = store.load(BackupEngine.fileKey(scope, mode, file));
    if (cp == null || !cp.confirmed || !cp.hash.matches("[a-f0-9]{64}")) return null;
    try {
      if (!file.stable.check()) return null;
    } catch (Exception unstable) {
      guard.check();
      return null;
    }
    guard.check();
    return new Candidate(file, mode, cp.hash);
  }

  /** Whether this exact local identity already has a confirmed backup checkpoint. */
  public boolean hasConfirmed(String scope, String mode, BackupEngine.File file) throws Exception {
    if (scope.isEmpty() || !(mode.equals("PHOTO") || mode.equals("MATERIAL"))) return false;
    BackupEngine.Checkpoint cp = store.load(BackupEngine.fileKey(scope, mode, file));
    return cp != null && cp.confirmed && cp.hash.matches("[a-f0-9]{64}");
  }

  public Candidate check(String scope, String mode, BackupEngine.File file) throws Exception {
    if (scope.isEmpty() || !(mode.equals("PHOTO") || mode.equals("MATERIAL")))
      throw new IllegalArgumentException("清理作用域无效");
    guard.check();
    Candidate candidate = local(scope, mode, file);
    if (candidate == null) return null;
    String hash;
    try {
      hash = file.hash.read();
      if (!hash.equals(candidate.hash) || !file.stable.check()) return null;
    } catch (Exception unreadable) {
      // A changed, revoked or unreadable local file is retained; only the rest of the plan
      // should continue. Cancellation from the surrounding task still wins.
      guard.check();
      return null;
    }
    guard.check();
    if (!remote.exists(mode, hash, file.size)) return null;
    guard.check();
    try {
      return file.stable.check() ? new Candidate(file, mode, hash) : null;
    } catch (Exception unstable) {
      guard.check();
      return null;
    }
  }
}
