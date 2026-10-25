package com.sekereagle.android.core;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.ArrayList;
import java.util.concurrent.*;

public class NativeCacheStatisticsTest {
  @Test public void distinguishesMemoryDiskAndDownloadsWithoutInventingEmptyRates() {
    NativeCacheStatistics stats = new NativeCacheStatistics();
    assertEquals(0, stats.snapshot().requests);
    assertEquals(0, stats.snapshot().hitRate, 0);
    long token = stats.token();
    assertTrue(stats.record(NativeCacheStatistics.Outcome.DOWNLOAD, token));
    assertTrue(stats.record(NativeCacheStatistics.Outcome.DISK, token));
    assertTrue(stats.record(NativeCacheStatistics.Outcome.MEMORY, token));
    NativeCacheStatistics.Snapshot snapshot = stats.snapshot();
    assertEquals(3, snapshot.requests);
    assertEquals(1, snapshot.memoryHits);
    assertEquals(1, snapshot.diskHits);
    assertEquals(1, snapshot.downloads);
    assertEquals(2.0 / 3, snapshot.hitRate, 0.000001);
    stats.record(NativeCacheStatistics.Outcome.DOWNLOAD, token);
    assertEquals(3, snapshot.requests);
    assertEquals(0.5, stats.snapshot().hitRate, 0);
  }

  @Test public void clearingResetsCountersAndRejectsLateOldRequests() {
    NativeCacheStatistics stats = new NativeCacheStatistics();
    long old = stats.token();
    stats.record(NativeCacheStatistics.Outcome.DOWNLOAD, old);
    stats.reset();
    assertFalse(stats.record(NativeCacheStatistics.Outcome.DISK, old));
    assertEquals(0, stats.snapshot().requests);
    assertTrue(stats.record(NativeCacheStatistics.Outcome.MEMORY, stats.token()));
    assertEquals(1, stats.snapshot().requests);
    assertEquals(1, stats.snapshot().hitRate, 0);
  }

  @Test public void concurrentImageLoadsDoNotLoseCounts() throws Exception {
    NativeCacheStatistics stats = new NativeCacheStatistics();
    long token = stats.token();
    ExecutorService pool = Executors.newFixedThreadPool(8);
    try {
      var jobs = new ArrayList<Future<?>>();
      for (int i = 0; i < 8; i++) jobs.add(pool.submit(() -> {
        for (int n = 0; n < 1000; n++) stats.record(NativeCacheStatistics.Outcome.MEMORY, token);
      }));
      for (Future<?> job : jobs) job.get(10, TimeUnit.SECONDS);
      assertEquals(8000, stats.snapshot().requests);
      assertEquals(8000, stats.snapshot().memoryHits);
    } finally { pool.shutdownNow(); }
  }
}
