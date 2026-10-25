package com.sekereagle.android.core;

/** Successful cacheable image reads during this process; clearing fences late completions. */
public final class NativeCacheStatistics {
  public enum Outcome { MEMORY, DISK, DOWNLOAD }
  private long generation, memoryHits, diskHits, downloads;

  public synchronized long token() { return generation; }

  public synchronized boolean record(Outcome outcome, long ticket) {
    if (ticket != generation) return false;
    switch (outcome) {
      case MEMORY: memoryHits++; break;
      case DISK: diskHits++; break;
      case DOWNLOAD: downloads++; break;
    }
    return true;
  }

  public synchronized void reset() {
    generation++;
    memoryHits = diskHits = downloads = 0;
  }

  public synchronized Snapshot snapshot() { return new Snapshot(memoryHits, diskHits, downloads); }

  public static final class Snapshot {
    public final long memoryHits, diskHits, downloads, requests;
    public final double hitRate;
    private Snapshot(long memory, long disk, long network) {
      memoryHits = memory;
      diskHits = disk;
      downloads = network;
      requests = memory + disk + network;
      hitRate = requests == 0 ? 0 : (double) (memory + disk) / requests;
    }
  }
}
