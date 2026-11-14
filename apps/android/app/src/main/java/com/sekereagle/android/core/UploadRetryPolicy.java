package com.sekereagle.android.core;

import java.io.EOFException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;

/** Bounded retries for errors that can succeed on the next attempt; never for policy failures. */
public final class UploadRetryPolicy {
  // Initial attempt plus three retries: 1s + 4s + 12s outlasts a rolling deploy.
  public static final int MAX_ATTEMPTS = 4;

  private UploadRetryPolicy() {}

  public static boolean retryable(Throwable error) {
    if (error instanceof BackupEngine.PermanentFailure) return false;
    if (error instanceof UploadFailure) {
      UploadFailure failure = (UploadFailure) error;
      if (failure.endpoint == UploadFailure.Endpoint.API)
        return failure.status == 408
            || failure.status == 425
            || failure.status == 429
            || failure.status >= 500;
      return failure.status >= 500;
    }
    if (error instanceof SocketTimeoutException
        || error instanceof ConnectException
        || error instanceof NoRouteToHostException
        || error instanceof UnknownHostException
        || error instanceof SocketException
        || error instanceof EOFException) return true;
    return false;
  }

  /** Exponential-ish backoff long enough to clear a rolling deploy, short enough to stay visible. */
  public static long delayMillis(int failedAttempts) {
    if (failedAttempts <= 1) return 1_000L;
    if (failedAttempts == 2) return 4_000L;
    return 12_000L;
  }
}
