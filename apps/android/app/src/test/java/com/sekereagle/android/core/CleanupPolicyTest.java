package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.util.List;
import org.junit.Test;

public class CleanupPolicyTest {
  private static final long DAY = 24L * 60 * 60 * 1000;
  private static final long NOW = 1_800_000_000_000L;

  @Test
  public void timeFilterIncludesOnlyFilesOlderThanTheSelectedDays() {
    assertTrue(CleanupPolicy.olderThan(NOW - 21 * DAY, 20, NOW));
    assertFalse(CleanupPolicy.olderThan(NOW - 19 * DAY, 20, NOW));
    assertFalse(CleanupPolicy.olderThan(NOW, 20, NOW));
    assertTrue(CleanupPolicy.olderThan(NOW - 100 * DAY, 0, NOW));
  }

  @Test
  public void timeFilterExcludesFilesWithUnknownDatesOnlyWhenAFilterIsActive() {
    assertTrue(CleanupPolicy.olderThan(0, 0, NOW));
    assertFalse(CleanupPolicy.olderThan(0, 20, NOW));
    assertFalse(CleanupPolicy.olderThan(-1, 7, NOW));
  }

  @Test
  public void batchesRespectTheItemAndByteCapsAndKeepTheRemainderForTheNextCall() {
    List<Long> sizes = List.of(4L, 4L, 4L, 4L, 4L);
    List<Long> first = CleanupPolicy.nextBatch(sizes, s -> s, 2, 100);
    assertEquals(List.of(4L, 4L), first);
    List<Long> rest = sizes.subList(first.size(), sizes.size());
    List<Long> second = CleanupPolicy.nextBatch(rest, s -> s, 10, 9);
    assertEquals(List.of(4L, 4L), second);
    assertEquals(List.of(4L), rest.subList(second.size(), rest.size()));
  }

  @Test
  public void oversizedFirstItemStillFormsASingleItemBatch() {
    assertEquals(List.of(50L), CleanupPolicy.nextBatch(List.of(50L, 1L), s -> s, 500, 10));
    List<Long> empty = List.of();
    assertEquals(List.of(), CleanupPolicy.nextBatch(empty, s -> s, 500, 10));
  }
}
