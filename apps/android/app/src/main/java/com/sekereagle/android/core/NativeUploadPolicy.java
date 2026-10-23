package com.sekereagle.android.core;

import java.net.URI;
import java.util.*;

/** Manual selections never inherit durable automatic-backup receipts. */
public final class NativeUploadPolicy {
  private NativeUploadPolicy() {}

  public static List<String> picked(List<String> input) {
    Set<String> unique = new LinkedHashSet<>();
    for (String value : input) {
      try {
        URI uri = new URI(value);
        if (!"content".equals(uri.getScheme())
            || uri.getRawAuthority() == null
            || uri.getRawAuthority().isBlank()) throw new IllegalArgumentException();
      } catch (Exception failure) {
        throw new IllegalArgumentException("请通过系统文件选择器选择文件");
      }
      unique.add(value);
    }
    if (unique.size() > 100) throw new IllegalArgumentException("每次最多上传 100 个文件，请分批选择");
    return new ArrayList<>(unique);
  }

  public interface ManualStore extends BackupEngine.Store {
    void verifyContent(String key, String hash);
    void retryFailures();
  }

  public static final class Journal implements ManualStore {
    private final Map<String, BackupEngine.Checkpoint> files = new HashMap<>();
    private final Set<String> receipts = new HashSet<>();

    public BackupEngine.Checkpoint load(String key) {
      return files.get(key);
    }

    public void save(String key, BackupEngine.Checkpoint value) {
      files.put(key, value);
    }

    public boolean contains(String key) {
      return receipts.contains(key);
    }

    public void confirm(String key, String content, BackupEngine.Checkpoint value) {
      save(key, value);
      receipts.add(content);
    }

    public void verifyContent(String key, String hash) {
      BackupEngine.Checkpoint previous = files.get(key);
      if (previous != null && !previous.hash.equals(hash)) files.remove(key);
    }

    public void retryFailures() {
      files.entrySet().removeIf(entry -> !entry.getValue().terminalError.isEmpty());
    }
  }
}
