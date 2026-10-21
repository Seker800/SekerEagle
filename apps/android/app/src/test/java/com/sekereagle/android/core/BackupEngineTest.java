package com.sekereagle.android.core;

import static org.junit.Assert.*;

import java.io.IOException;
import java.util.*;
import org.junit.Test;

public class BackupEngineTest {
  private final Map<String, BackupEngine.Checkpoint> files = new HashMap<>();
  private final Set<String> receipts = new HashSet<>();
  private int hashes, uploads, checks;
  private boolean fail, change, paused;
  private final BackupEngine.Store store =
      new BackupEngine.Store() {
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
          files.put(key, value);
          receipts.add(content);
        }
      };

  private BackupEngine engine(boolean exists) {
    return new BackupEngine(
        store,
        new BackupEngine.Transport() {
          public boolean exists(String hash, long size) {
            checks++;
            return exists;
          }

          public void upload(
              BackupEngine.File file,
              BackupEngine.Checkpoint cp,
              BackupEngine.Save save,
              BackupEngine.Guard guard)
              throws Exception {
            uploads++;
            guard.check();
            if (cp.session.isEmpty()) {
              cp.session = "session";
              cp.partSize = 5242880;
              save.write(cp);
            }
            if (fail) throw new IOException("offline");
          }
        },
        () -> {
          if (paused) throw new IOException("paused");
        });
  }

  private BackupEngine.File file(String uri, long size, long modified) {
    return new BackupEngine.File(
        uri,
        size,
        modified,
        () -> {
          hashes++;
          return "a".repeat(64);
        },
        () -> !change);
  }

  @Test
  public void confirmsOnlyAfterServerAcknowledgesAndSkipsUnchangedFiles() throws Exception {
    BackupEngine e = engine(false);
    assertEquals(BackupEngine.Result.UPLOADED, e.process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(BackupEngine.Result.SKIPPED, e.process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(1, hashes);
    assertEquals(1, uploads);
  }

  @Test
  public void movedRenamedAndOverlappingSourcesUseContentReceipt() throws Exception {
    BackupEngine e = engine(false);
    e.process("scope", "PHOTO", file("one", 12, 1));
    assertEquals(BackupEngine.Result.SKIPPED, e.process("scope", "PHOTO", file("renamed", 12, 2)));
    assertEquals(1, uploads);
  }

  @Test
  public void ownerDeploymentServerAndModeNeverShareReceipts() throws Exception {
    BackupEngine e = engine(false);
    e.process("scope1", "PHOTO", file("one", 12, 1));
    e.process("scope2", "PHOTO", file("one", 12, 1));
    e.process("scope1", "MATERIAL", file("one", 12, 1));
    assertEquals(3, uploads);
  }

  @Test
  public void existingContentSkipsNetworkTransfer() throws Exception {
    assertEquals(
        BackupEngine.Result.SKIPPED, engine(true).process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(0, uploads);
    assertEquals(1, checks);
  }

  @Test
  public void failureKeepsSessionAndDoesNotWriteSuccessReceipt() throws Exception {
    BackupEngine e = engine(false);
    fail = true;
    assertThrows(IOException.class, () -> e.process("scope", "PHOTO", file("one", 12, 1)));
    assertTrue(receipts.isEmpty());
    assertEquals("session", files.values().iterator().next().session);
    fail = false;
    assertEquals(BackupEngine.Result.UPLOADED, e.process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(1, hashes);
    assertEquals(2, uploads);
  }

  @Test
  public void filesChangingDuringReadNeverBecomeSuccessful() throws Exception {
    change = true;
    assertThrows(
        IOException.class, () -> engine(false).process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(0, uploads);
    assertTrue(receipts.isEmpty());
  }

  @Test
  public void missingTimestampsAreRehashedInsteadOfSilentlySkipped() throws Exception {
    BackupEngine e = engine(false);
    e.process("scope", "PHOTO", file("one", 12, 0));
    e.process("scope", "PHOTO", file("one", 12, 0));
    assertEquals(2, hashes);
    assertEquals(1, uploads);
  }

  @Test
  public void pausedWorkNeverUploads() {
    paused = true;
    assertThrows(
        IOException.class, () -> engine(false).process("scope", "PHOTO", file("one", 12, 1)));
    assertEquals(0, hashes);
    assertEquals(0, uploads);
  }

  @Test
  public void originPolicyRejectsCredentialsPathsAndRemoteCleartext() {
    for (String value :
        List.of(
            "https://user:secret@example.com",
            "https://example.com/path",
            "javascript:alert(1)",
            "http://example.com",
            "https://example.com?x=1",
            "https://example.com#x"))
      assertThrows(IllegalArgumentException.class, () -> BackupPolicy.origin(value, false));
    assertEquals("https://example.com", BackupPolicy.origin("https://example.com/", false));
    assertEquals("http://localhost:40123", BackupPolicy.origin("http://localhost:40123", true));
    assertThrows(
        IllegalArgumentException.class, () -> BackupPolicy.origin("http://192.168.1.2", true));
  }

  @Test
  public void folderMatchingUsesDirectoryBoundaries() {
    assertTrue(BackupPolicy.inFolder("DCIM/Camera/", "DCIM/Camera/sub/", true));
    assertFalse(BackupPolicy.inFolder("DCIM/Camera/", "DCIM/Camera2/", true));
    assertFalse(BackupPolicy.inFolder("DCIM/Camera/", "DCIM/Camera/sub/", false));
    assertTrue(BackupPolicy.inFolder("Download/", "Download/", false));
  }

  @Test
  public void invalidModesAndHashesFailClosed() {
    assertThrows(
        IllegalArgumentException.class,
        () -> engine(false).process("scope", "WRONG", file("one", 12, 1)));
    assertThrows(
        IllegalArgumentException.class,
        () -> engine(false).process("", "PHOTO", file("one", 12, 1)));
  }

  @Test
  public void signedUploadsStayOnTheSelectedGatewayAndRequireASignature() {
    String query = "?X-Amz-Signature=abc";
    assertEquals(
        "https://eagle.example/sekereagle-assets/file" + query,
        BackupPolicy.uploadUrl(
            "http://localhost:9000/sekereagle-assets/file" + query, "https://eagle.example"));
    assertEquals(
        "https://eagle.example/sekereagle-assets/file" + query,
        BackupPolicy.uploadUrl(
            "https://eagle.example/sekereagle-assets/file" + query, "https://eagle.example"));
    for (String value :
        List.of(
            "https://evil.example/sekereagle-assets/file" + query,
            "https://eagle.example/sekereagle-assets/file",
            "file:///sekereagle-assets/file" + query,
            "https://user:pass@eagle.example/sekereagle-assets/file" + query,
            "https://eagle.example/another-bucket/file" + query,
            "https://eagle.example/sekereagle-assets/../secret" + query))
      assertThrows(
          IllegalArgumentException.class,
          () -> BackupPolicy.uploadUrl(value, "https://eagle.example"));
  }
}
