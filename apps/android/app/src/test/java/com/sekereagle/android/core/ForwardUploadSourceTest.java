package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.io.*;
import org.junit.Test;

public class ForwardUploadSourceTest {

  @Test
  public void readsPipeOnceAndSkipsOnlyCommittedParts() throws Exception {
    byte[] data = new byte[21];
    for (int i = 0; i < data.length; i++) data[i] = (byte) i;
    ByteArrayInputStream input = new ByteArrayInputStream(data);
    try (ForwardUploadSource source = new ForwardUploadSource(input)) {
      assertArrayEquals(new byte[] {0, 1, 2}, source.read(0, 3, () -> {}));
      assertArrayEquals(new byte[] {12, 13, 14}, source.read(12, 3, () -> {}));
      assertArrayEquals(new byte[] {15, 16, 17}, source.read(15, 3, () -> {}));
      assertThrows(IOException.class, () -> source.read(0, 3, () -> {}));
      assertThrows(IOException.class, () -> source.read(18, 4, () -> {}));
    }
  }

  @Test
  public void cancellationStopsReadingAndBufferBudgetIsBounded() throws Exception {
    try (ForwardUploadSource source =
        new ForwardUploadSource(new ByteArrayInputStream(new byte[8]))) {
      assertThrows(
          IOException.class,
          () ->
              source.read(
                  0,
                  1,
                  () -> {
                    throw new IOException("paused");
                  }));
      assertThrows(
          IllegalArgumentException.class, () -> source.read(0, 16 * 1024 * 1024, () -> {}));
    }
  }

  @Test
  public void pipeThatRejectsSeekingFallsBackToOneForwardRead() throws Exception {
    InputStream pipe =
        new ByteArrayInputStream(new byte[] {1, 2, 3, 4, 5}) {
          @Override
          public long skip(long count) {
            return 0;
          }
        };
    try (ForwardUploadSource source = new ForwardUploadSource(pipe)) {
      assertArrayEquals(new byte[] {3, 4}, source.read(2, 2, () -> {}));
      assertArrayEquals(new byte[] {5}, source.read(4, 1, () -> {}));
    }
  }
}
