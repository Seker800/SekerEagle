package com.sekereagle.android.core;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Bounded cross-file workers. The first fatal failure stops new submissions. */
public final class BackupExecutor implements AutoCloseable {
  public interface Task {
    void run() throws Exception;
  }

  private final ExecutorService workers;
  private final Semaphore slots;
  private final AtomicReference<Exception> failure = new AtomicReference<>();

  public BackupExecutor(int threads, int inFlight) {
    if (threads < 1 || inFlight < threads) throw new IllegalArgumentException("并发预算无效");
    workers = Executors.newFixedThreadPool(threads);
    slots = new Semaphore(inFlight, true);
  }

  public void submit(Task task) throws Exception {
    if (task == null) throw new IllegalArgumentException("任务不能为空");
    throwIfFailed();
    slots.acquire();
    boolean scheduled = false;
    try {
      if (failure.get() != null) throwIfFailed();
      workers.execute(
          () -> {
            try {
              if (failure.get() == null) task.run();
            } catch (Exception error) {
              failure.compareAndSet(null, error);
            } finally {
              slots.release();
            }
          });
      scheduled = true;
    } finally {
      if (!scheduled) slots.release();
    }
    throwIfFailed();
  }

  public void drain() throws Exception {
    workers.shutdown();
    while (!workers.awaitTermination(1, TimeUnit.DAYS)) {}
    throwIfFailed();
  }

  @Override
  public void close() {
    workers.shutdownNow();
    try {
      workers.awaitTermination(10, TimeUnit.SECONDS);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
    }
  }

  private void throwIfFailed() throws Exception {
    Exception error = failure.get();
    if (error != null) throw error;
  }
}
