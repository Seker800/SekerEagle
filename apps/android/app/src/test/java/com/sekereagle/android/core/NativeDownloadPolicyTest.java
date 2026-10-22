package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.io.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.Test;

public class NativeDownloadPolicyTest {
  @Test
  public void streamsExactOriginalWithoutBufferingWholeFile() throws Exception {
    byte[] data = new byte[200_000];
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    AtomicLong progress = new AtomicLong();
    NativeDownloadPolicy.copy(
        new ByteArrayInputStream(data), output, data.length, () -> {}, progress::set);
    assertArrayEquals(data, output.toByteArray());
    assertEquals(data.length, progress.get());
  }

  @Test
  public void rejectsIncompleteAndOversizedResponses() {
    for (int size : new int[] {3, 5})
      assertThrows(
          IOException.class,
          () ->
              NativeDownloadPolicy.copy(
                  new ByteArrayInputStream(new byte[size]),
                  new ByteArrayOutputStream(),
                  4,
                  () -> {},
                  n -> {}));
    assertThrows(
        IllegalArgumentException.class, () -> NativeDownloadPolicy.validate(0, "image/jpeg"));
    assertThrows(
        IllegalArgumentException.class,
        () -> NativeDownloadPolicy.validate(5_000_000_001L, "video/mp4"));
    assertThrows(
        IllegalArgumentException.class, () -> NativeDownloadPolicy.validate(1, "text/html"));
    NativeDownloadPolicy.validate(5_000_000_000L, "video/mp4");
    NativeDownloadPolicy.validate(50, "application/octet-stream");
  }

  @Test
  public void cancellationStopsBeforeWriting() {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    assertThrows(
        java.util.concurrent.CancellationException.class,
        () ->
            NativeDownloadPolicy.copy(
                new ByteArrayInputStream(new byte[10]),
                output,
                10,
                () -> {
                  throw new java.util.concurrent.CancellationException();
                },
                n -> {}));
    assertEquals(0, output.size());
  }

  @Test
  public void filenamesCannotEscapeDestinationOrHideExtension() {
    assertEquals("photo.dng", NativeDownloadPolicy.fileName("../../photo.dng"));
    assertEquals("clip.mp4", NativeDownloadPolicy.fileName("C:\\temp\\clip.mp4"));
    assertEquals("download", NativeDownloadPolicy.fileName("..\n"));
    assertEquals("abc.jpg", NativeDownloadPolicy.fileName("a\nb\rc.jpg"));
    assertTrue(NativeDownloadPolicy.fileName("a".repeat(250) + ".dng").endsWith(".dng"));
    assertTrue(NativeDownloadPolicy.fileName("a".repeat(250) + ".dng").length() <= 160);
  }
}
