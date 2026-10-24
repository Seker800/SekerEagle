package com.sekereagle.android.core;

import java.io.*;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Bounded byte store; caller supplies encrypted bytes and an opaque, scoped SHA-256 key. */
public final class NativeDiskCache {
  private static final int MAX_ENTRIES = 100_000;
  private static final int MAX_ENTRY_BYTES = 16 * 1024 * 1024 + 64;
  private final File root;
  private final LinkedHashMap<String, Long> entries = new LinkedHashMap<>(16, .75f, true);
  private final AtomicLong generation = new AtomicLong();
  private long limit, used, stamp;
  private boolean loaded;

  public NativeDiskCache(File root, long limit) {
    if (limit < 0) throw new IllegalArgumentException("Invalid cache limit");
    this.root = root;
    this.limit = limit;
  }

  public long generation() {
    return generation.get();
  }

  public void invalidate() {
    generation.incrementAndGet();
  }

  private static void validate(String key) {
    if (key == null || !key.matches("[a-f0-9]{64}"))
      throw new IllegalArgumentException("Invalid cache key");
  }

  private File file(String key) {
    return new File(root, key + ".cache");
  }

  private void load() throws IOException {
    if (loaded && root.isDirectory()) return;
    if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cache directory unavailable");
    File[] files = root.listFiles();
    if (files == null) throw new IOException("Cache directory unavailable");
    Arrays.sort(files, Comparator.comparingLong(File::lastModified).thenComparing(File::getName));
    entries.clear();
    used = 0;
    for (File file : files) {
      long size = file.length();
      if (file.isFile()
          && !Files.isSymbolicLink(file.toPath())
          && file.getName().matches("[a-f0-9]{64}\\.cache")
          && size > 0
          && size <= MAX_ENTRY_BYTES) {
        entries.put(file.getName().substring(0, 64), size);
        used += size;
        stamp = Math.max(stamp, file.lastModified());
      } else Files.deleteIfExists(file.toPath());
    }
    loaded = true;
    trim();
  }

  private void touch(File file) throws IOException {
    stamp = Math.max(System.currentTimeMillis(), stamp + 1);
    if (!file.setLastModified(stamp)) throw new IOException("Cannot update cache entry");
  }

  public synchronized void touch(String key) throws IOException {
    validate(key);
    load();
    if (entries.get(key) == null) return;
    if (file(key).isFile()) touch(file(key));
    else remove(key);
  }

  public synchronized byte[] get(String key) throws IOException {
    validate(key);
    load();
    Long size = entries.get(key);
    if (size == null) return null;
    File file = file(key);
    if (!file.isFile() || file.length() != size) {
      remove(key);
      return null;
    }
    byte[] bytes = Files.readAllBytes(file.toPath());
    touch(file);
    return bytes;
  }

  public synchronized boolean put(String key, byte[] bytes, long ticket) throws IOException {
    validate(key);
    load();
    if (ticket != generation.get()
        || bytes.length == 0
        || bytes.length > limit
        || bytes.length > MAX_ENTRY_BYTES) return false;
    File pending = File.createTempFile("entry-", ".pending", root);
    try {
      try (FileOutputStream output = new FileOutputStream(pending)) {
        output.write(bytes);
      }
      if (ticket != generation.get()) return false;
      if (!pending.renameTo(file(key))) throw new IOException("Cannot publish cache entry");
      Long previous = entries.put(key, (long) bytes.length);
      used += bytes.length - (previous == null ? 0 : previous);
      touch(file(key));
      trim();
      return true;
    } finally {
      Files.deleteIfExists(pending.toPath());
    }
  }

  private void trim() throws IOException {
    Iterator<Map.Entry<String, Long>> iterator = entries.entrySet().iterator();
    while ((used > limit || entries.size() > MAX_ENTRIES) && iterator.hasNext()) {
      Map.Entry<String, Long> entry = iterator.next();
      Files.deleteIfExists(file(entry.getKey()).toPath());
      used -= entry.getValue();
      iterator.remove();
    }
  }

  public synchronized void remove(String key) throws IOException {
    validate(key);
    load();
    Files.deleteIfExists(file(key).toPath());
    Long size = entries.remove(key);
    if (size != null) used -= size;
  }

  public synchronized void clear() throws IOException {
    invalidate();
    load();
    for (String key : new ArrayList<>(entries.keySet())) remove(key);
  }

  public synchronized void resize(long bytes) throws IOException {
    if (bytes < 0) throw new IllegalArgumentException("Invalid cache limit");
    invalidate();
    limit = bytes;
    load();
    trim();
  }

  public synchronized long size() throws IOException {
    load();
    Iterator<Map.Entry<String, Long>> iterator = entries.entrySet().iterator();
    while (iterator.hasNext()) {
      Map.Entry<String, Long> entry = iterator.next();
      File file = file(entry.getKey());
      if (!file.isFile() || file.length() != entry.getValue()) {
        Files.deleteIfExists(file.toPath());
        used -= entry.getValue();
        iterator.remove();
      }
    }
    return used;
  }

  public synchronized int count() throws IOException {
    size();
    return entries.size();
  }
}
