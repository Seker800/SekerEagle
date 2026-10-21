package com.sekereagle.android;

import static org.junit.Assert.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class ApiClientFailureTest {
  private static final class HttpFixture implements AutoCloseable {
    final ServerSocket listener;
    final AtomicBoolean leaked = new AtomicBoolean();
    final Thread worker;

    HttpFixture(int status) throws Exception {
      listener = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
      worker =
          new Thread(
              () -> {
                while (!listener.isClosed())
                  try (Socket connection = listener.accept()) {
                    BufferedReader input =
                        new BufferedReader(
                            new InputStreamReader(
                                connection.getInputStream(), StandardCharsets.UTF_8));
                    String line = input.readLine();
                    int length = 0;
                    while ((line = input.readLine()) != null && !line.isEmpty()) {
                      String lower = line.toLowerCase(java.util.Locale.ROOT);
                      if (lower.startsWith("authorization:") || lower.startsWith("cookie:"))
                        leaked.set(true);
                      if (lower.startsWith("content-length:"))
                        length = Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                    }
                    while (length-- > 0) input.read();
                    connection
                        .getOutputStream()
                        .write(
                            ("HTTP/1.1 "
                                    + status
                                    + " Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                                .getBytes(StandardCharsets.UTF_8));
                    connection.getOutputStream().flush();
                  } catch (IOException ignored) {
                  }
              });
      worker.setDaemon(true);
      worker.start();
    }

    String origin() {
      return "http://127.0.0.1:" + listener.getLocalPort();
    }

    public void close() throws Exception {
      listener.close();
      worker.join(1000);
    }
  }

  @Test
  public void signedPut403DoesNotInvalidateThePatOrSendItToStorage() throws Exception {
    try (HttpFixture server = new HttpFixture(403)) {
      ApiClient api = new ApiClient(server.origin(), "private-test-pat");
      ApiClient.Failure failure =
          assertThrows(
              ApiClient.Failure.class,
              () ->
                  api.put(
                      server.origin() + "/sekereagle-assets/users/owner/file?X-Amz-Signature=abc",
                      new ByteArrayInputStream(new byte[] {1}),
                      1,
                      () -> {}));
      assertFalse(failure.invalidatesCredential());
      assertTrue(failure.renewSignature());
      assertFalse(server.leaked.get());
    }
  }

  @Test
  public void onlyApi401InvalidatesCredentials() throws Exception {
    try (HttpFixture server = new HttpFixture(401)) {
      ApiClient api = new ApiClient(server.origin(), "test");
      assertTrue(
          assertThrows(ApiClient.Failure.class, () -> api.request("GET", "/api/auth/me", null))
              .invalidatesCredential());
    }
  }
}
