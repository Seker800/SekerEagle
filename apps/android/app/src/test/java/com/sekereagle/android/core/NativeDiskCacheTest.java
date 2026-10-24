package com.sekereagle.android.core;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NativeDiskCacheTest {
  @Rule public TemporaryFolder temporary = new TemporaryFolder();
  private String key(int number) { return String.format("%064x", number); }
  private byte[] bytes(int count) { return new byte[count]; }
  @Test public void survivesReopenAndEvictsLeastRecentlyRead() throws Exception {
    File root = temporary.newFolder();
    NativeDiskCache cache = new NativeDiskCache(root, 12);
    cache.put(key(1), bytes(4), cache.generation());
    cache.put(key(2), bytes(4), cache.generation());
    cache.put(key(3), bytes(4), cache.generation());
    assertNotNull(cache.get(key(1)));
    cache.put(key(4), bytes(4), cache.generation());
    assertNull(cache.get(key(2)));
    NativeDiskCache reopened = new NativeDiskCache(root, 12);
    assertArrayEquals(bytes(4), reopened.get(key(1)));
    assertEquals(12, reopened.size());
    assertEquals(3, reopened.count());
  }
  @Test public void shrinkingBudgetAndDisablingImmediatelyReleaseDisk() throws Exception {
    NativeDiskCache cache = new NativeDiskCache(temporary.newFolder(), 12);
    for (int n=1;n<=3;n++) cache.put(key(n), bytes(4), cache.generation());
    cache.resize(4);
    assertEquals(4, cache.size());
    cache.resize(0);
    assertEquals(0, cache.count());
    assertFalse(cache.put(key(4), bytes(4), cache.generation()));
    assertNull(cache.get(key(4)));
    assertThrows(IllegalArgumentException.class, () -> cache.resize(-1));
  }
  @Test public void clearRejectsInFlightWritesAndAllowsNewReads() throws Exception {
    NativeDiskCache cache = new NativeDiskCache(temporary.newFolder(), 12);
    long old = cache.generation();
    cache.put(key(1), bytes(4), old);
    cache.invalidate();
    assertFalse(cache.put(key(2), bytes(4), old));
    cache.clear();
    assertEquals(0, cache.size());
    assertTrue(cache.put(key(3), bytes(4), cache.generation()));
    cache.remove(key(3));
    assertNull(cache.get(key(3)));
  }
  @Test public void recoversInterruptedWritesAndMissingFiles() throws Exception {
    File root = temporary.newFolder();
    Files.write(new File(root, "unfinished.pending").toPath(), bytes(5));
    Files.write(new File(root, "unknown").toPath(), bytes(5));
    NativeDiskCache cache = new NativeDiskCache(root, 12);
    assertEquals(0, cache.size());
    assertEquals(0, root.list().length);
    cache.put(key(1), bytes(4), cache.generation());
    assertTrue(new File(root,key(1)+".cache").delete());
    assertNull(cache.get(key(1)));
    assertEquals(0, cache.size());
  }
  @Test public void replacingEntriesCountsActualBytesAndRejectsUnboundedInputs() throws Exception {
    NativeDiskCache cache = new NativeDiskCache(temporary.newFolder(), 12);
    cache.put(key(1), bytes(4), cache.generation());
    cache.put(key(1), bytes(8), cache.generation());
    assertEquals(8, cache.size());
    assertFalse(cache.put(key(2), bytes(13), cache.generation()));
    assertFalse(cache.put(key(2), bytes(0), cache.generation()));
    assertThrows(IllegalArgumentException.class, () -> cache.get("../outside"));
    assertThrows(IllegalArgumentException.class, () -> new NativeDiskCache(temporary.newFolder(),-1));
  }
  @Test public void unavailableStorageIsReportedWithoutLeavingTemporaryFiles() throws Exception {
    File file = temporary.newFile();
    NativeDiskCache cache = new NativeDiskCache(file, 12);
    assertThrows(IOException.class, () -> cache.get(key(1)));
  }
}
