package com.sekereagle.android.core;

import java.io.Closeable;
import java.util.concurrent.locks.ReentrantLock;

/** Serializes identical content so a concurrent duplicate sees the first confirmation. */
public final class BackupContentLock implements BackupEngine.ContentLock {
  private final ReentrantLock[] locks;

  public BackupContentLock(int stripes) {
    if (stripes < 1) throw new IllegalArgumentException("内容锁预算无效");
    locks = new ReentrantLock[stripes];
    for (int i = 0; i < stripes; i++) locks[i] = new ReentrantLock();
  }

  @Override
  public Closeable lock(String content) {
    ReentrantLock lock = locks[Math.floorMod(content.hashCode(), locks.length)];
    lock.lock();
    return lock::unlock;
  }
}
