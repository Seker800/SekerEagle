package com.sekereagle.android.core;

import java.util.ArrayList;
import java.util.List;
import java.util.function.ToLongFunction;

/** Pure cleanup filter and batching decisions; Android adapters own provider access. */
public final class CleanupPolicy {
  private CleanupPolicy() {}

  public static boolean olderThan(long modifiedMillis, int days, long nowMillis) {
    if (days <= 0) return true;
    if (modifiedMillis <= 0) return false;
    return modifiedMillis < nowMillis - days * 24L * 60 * 60 * 1000;
  }

  /** Takes one batch from the head; an oversized first item still forms a batch of one. */
  public static <T> List<T> nextBatch(
      List<T> remaining, ToLongFunction<T> sizeOf, int maxItems, long maxBytes) {
    List<T> batch = new ArrayList<>();
    long bytes = 0;
    for (T item : remaining) {
      long size = Math.max(0, sizeOf.applyAsLong(item));
      if (!batch.isEmpty() && (batch.size() >= maxItems || bytes + size > maxBytes)) break;
      batch.add(item);
      bytes += size;
    }
    return batch;
  }
}
