package com.sekereagle.android.core;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.EOFException;
import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import org.junit.Test;

public class UploadRetryPolicyTest {

  @Test
  public void retriesServiceOutagesAndThrottling() {
    assertTrue(UploadRetryPolicy.retryable(new UploadFailure(502, UploadFailure.Endpoint.API)));
    assertTrue(UploadRetryPolicy.retryable(new UploadFailure(503, UploadFailure.Endpoint.API)));
    assertTrue(UploadRetryPolicy.retryable(new UploadFailure(504, UploadFailure.Endpoint.API)));
    assertTrue(UploadRetryPolicy.retryable(new UploadFailure(429, UploadFailure.Endpoint.API)));
    assertTrue(UploadRetryPolicy.retryable(new UploadFailure(408, UploadFailure.Endpoint.API)));
    assertTrue(
        UploadRetryPolicy.retryable(new UploadFailure(500, UploadFailure.Endpoint.SIGNED_PART)));
  }

  @Test
  public void neverRetriesPolicyFailures() {
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(400, UploadFailure.Endpoint.API)));
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(401, UploadFailure.Endpoint.API)));
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(403, UploadFailure.Endpoint.API)));
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(413, UploadFailure.Endpoint.API)));
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(415, UploadFailure.Endpoint.API)));
    assertFalse(UploadRetryPolicy.retryable(new UploadFailure(422, UploadFailure.Endpoint.API)));
    assertFalse(
        UploadRetryPolicy.retryable(
            new BackupEngine.PermanentFailure("文件格式不支持")));
  }

  @Test
  public void retriesConnectionLevelFailures() {
    assertTrue(UploadRetryPolicy.retryable(new SocketTimeoutException()));
    assertTrue(UploadRetryPolicy.retryable(new ConnectException()));
    assertTrue(UploadRetryPolicy.retryable(new UnknownHostException()));
    assertTrue(UploadRetryPolicy.retryable(new EOFException()));
    assertFalse(UploadRetryPolicy.retryable(new IOException("文件仍在变化，留待下次备份")));
    assertFalse(UploadRetryPolicy.retryable(new SecurityException("拒绝")));
  }

  @Test
  public void backoffGrowsButStaysBounded() {
    assertEquals(1_000L, UploadRetryPolicy.delayMillis(1));
    assertEquals(4_000L, UploadRetryPolicy.delayMillis(2));
    assertEquals(12_000L, UploadRetryPolicy.delayMillis(3));
    assertEquals(12_000L, UploadRetryPolicy.delayMillis(4));
    assertEquals(4, UploadRetryPolicy.MAX_ATTEMPTS);
  }
}
