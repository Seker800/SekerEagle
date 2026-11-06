package com.sekereagle.android.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public final class BackupExecutorTest {

  @Test
  public void boundsConcurrencyAndDrainsEveryTask() throws Exception {
    BackupExecutor executor = new BackupExecutor(2, 6);
    AtomicInteger active = new AtomicInteger(), peak = new AtomicInteger(), done = new AtomicInteger();
    CountDownLatch started = new CountDownLatch(2), release = new CountDownLatch(1);
    for (int i = 0; i < 6; i++)
      executor.submit(
          () -> {
            int now = active.incrementAndGet();
            peak.accumulateAndGet(now, Math::max);
            started.countDown();
            try {
              release.await();
            } finally {
              active.decrementAndGet();
              done.incrementAndGet();
            }
          });
    assertTrue(started.await(5, TimeUnit.SECONDS));
    assertEquals(2, peak.get());
    release.countDown();
    executor.drain();
    assertEquals(6, done.get());
    executor.close();
  }

  @Test
  public void blocksSubmissionBeyondTheInFlightBudget() throws Exception {
    BackupExecutor executor = new BackupExecutor(2, 2);
    CountDownLatch started = new CountDownLatch(2), release = new CountDownLatch(1);
    for (int i = 0; i < 2; i++)
      executor.submit(
          () -> {
            started.countDown();
            release.await();
          });
    assertTrue(started.await(5, TimeUnit.SECONDS));
    AtomicBoolean submitted = new AtomicBoolean();
    Thread submitter =
        new Thread(
            () -> {
              try {
                executor.submit(() -> {});
                submitted.set(true);
              } catch (Exception ignored) {
              }
            });
    submitter.start();
    Thread.sleep(150);
    assertFalse(submitted.get());
    release.countDown();
    submitter.join(5000);
    assertTrue(submitted.get());
    executor.drain();
    executor.close();
  }

  @Test
  public void firstFatalFailureStopsNewSubmissionsAndDrain() throws Exception {
    BackupExecutor executor = new BackupExecutor(1, 1);
    CountDownLatch thrown = new CountDownLatch(1);
    executor.submit(
        () -> {
          thrown.countDown();
          throw new IOException("boom");
        });
    assertTrue(thrown.await(5, TimeUnit.SECONDS));
    IOException failure = awaitFailure(executor);
    assertEquals("boom", failure.getMessage());
    assertThrows(IOException.class, executor::drain);
    executor.close();
  }

  @Test
  public void rejectsSubmissionsAfterDrain() throws Exception {
    BackupExecutor executor = new BackupExecutor(1, 1);
    executor.drain();
    assertThrows(RejectedExecutionException.class, () -> executor.submit(() -> {}));
    executor.close();
  }

  @Test
  public void rejectsInvalidBudgetsAndEmptyTasks() {
    assertThrows(IllegalArgumentException.class, () -> new BackupExecutor(0, 1));
    assertThrows(IllegalArgumentException.class, () -> new BackupExecutor(2, 1));
    BackupExecutor executor = new BackupExecutor(1, 1);
    assertThrows(IllegalArgumentException.class, () -> executor.submit(null));
    executor.close();
  }

  private static IOException awaitFailure(BackupExecutor executor) throws Exception {
    long deadline = System.currentTimeMillis() + 5000;
    while (System.currentTimeMillis() < deadline) {
      try {
        executor.submit(() -> {});
        Thread.sleep(10);
      } catch (IOException error) {
        return error;
      }
    }
    throw new AssertionError("fatal failure was not propagated");
  }
}
