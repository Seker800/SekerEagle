package com.sekereagle.android.core;

import java.io.*;

/** One forward pass works for seekable files and pipe-backed/cloud document providers alike. */
public final class ForwardUploadSource implements AutoCloseable {

  public static final int MAX_BUFFER = 8 * 1024 * 1024;
  private final InputStream input;
  private long position;

  public ForwardUploadSource(InputStream input) {
    this.input = input;
  }

  public InputStream part(long offset, long length, BackupEngine.Guard guard) throws Exception {
    if (offset < position || length < 1) throw new IOException("无效分片读取顺序");
    byte[] skip = new byte[256 * 1024];
    while (position < offset) {
      guard.check();
      long skipped;
      try {
        skipped = input.skip(offset - position);
      } catch (IOException unavailable) {
        skipped = 0;
      }
      if (skipped > 0 && skipped <= offset - position) {
        position += skipped;
        continue;
      }
      int count = input.read(skip, 0, (int) Math.min(skip.length, offset - position));
      if (count < 0) throw new IOException("文件读取未完成");
      position += count;
    }
    return new InputStream() {
      long remaining = length;

      public int read() throws IOException {
        byte[] one = new byte[1];
        int count = read(one, 0, 1);
        return count < 0 ? -1 : one[0] & 255;
      }

      public int read(byte[] bytes, int start, int count) throws IOException {
        if (remaining == 0) return -1;
        int read = input.read(bytes, start, (int) Math.min(count, remaining));
        if (read < 0) throw new IOException("文件读取未完成");
        remaining -= read;
        position += read;
        return read;
      }
    };
  }

  public byte[] read(long offset, int length, BackupEngine.Guard guard) throws Exception {
    if (length < 1 || length > MAX_BUFFER) throw new IllegalArgumentException("分片缓冲超出预算");
    InputStream stream = part(offset, length, guard);
    byte[] result = new byte[length];
    int count = 0;
    while (count < length) {
      guard.check();
      int read = stream.read(result, count, length - count);
      if (read > 0) count += read;
    }
    return result;
  }

  @Override
  public void close() throws IOException {
    input.close();
  }
}
