package com.sekereagle.android;

import com.sekereagle.android.core.BackupEngine;
import com.sekereagle.android.core.ForwardUploadSource;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

final class MultipartTransport implements BackupEngine.Transport {
  // Shared across backup and manual queues: at most 3 buffers of at most 8 MiB.
  private static final Semaphore slots = new Semaphore(3, true);
  private static final ExecutorService uploads = Executors.newFixedThreadPool(3);

  private final UploadApi api;
  private final String path;
  private final MediaCatalog catalog;
  private final MediaCatalog.Item item;

  MultipartTransport(UploadApi api, String mode, MediaCatalog catalog, MediaCatalog.Item item) {
    if (!(mode.equals("PHOTO") || mode.equals("MATERIAL")))
      throw new IllegalArgumentException("无效模式");
    this.api = api;
    this.catalog = catalog;
    this.item = item;
    path = "/api/" + (mode.equals("PHOTO") ? "photos" : "eagle") + "/uploads";
  }

  @Override
  public boolean exists(String hash, long size) throws Exception {
    return api.request(
            "POST",
            path + "/check-content",
            new JSONObject().put("contentSha256", hash).put("size", size))
        .getBoolean("exists");
  }

  @Override
  public void upload(
      BackupEngine.File file,
      BackupEngine.Checkpoint cp,
      BackupEngine.Save save,
      BackupEngine.Guard guard)
      throws Exception {
    try {
      resume(file, cp, save, guard);
    } catch (ApiClient.Failure error) {
      if (error.endpoint != com.sekereagle.android.core.UploadFailure.Endpoint.API) throw error;
      if (error.permanent()) {
        if (validSession(cp.session))
          try {
            guard.check();
            api.request("DELETE", path + "/" + cp.session, null);
          } catch (Exception ignored) {
          }
        cp.session = "";
        cp.partSize = 0;
        cp.terminalError = error.getMessage();
        save.write(cp);
        throw new BackupEngine.PermanentFailure(cp.terminalError);
      }
      if (error.status == 404) {
        cp.session = "";
        cp.partSize = 0;
        save.write(cp);
      }
      if (error.status == 409 && validSession(cp.session)) {
        JSONObject current = api.request("GET", path + "/" + cp.session, null);
        if (current.optString("status").equals("COMPLETED")
            && !current.isNull("eagleAssetId")
            && !current.optString("eagleAssetId").isEmpty()) return;
        if (current.optString("status").equals("ABORTED")) {
          cp.session = "";
          cp.partSize = 0;
          save.write(cp);
        } else if (current.optString("status").equals("FAILED")
            && (current.optInt("finalizationAttempts") >= 10
                || current.optBoolean("objectCleanupPending"))) {
          cp.session = "";
          cp.partSize = 0;
          cp.terminalError = "服务器已拒绝该文件，请检查后重试失败文件";
          save.write(cp);
          throw new BackupEngine.PermanentFailure(cp.terminalError);
        }
      }
      throw error;
    }
  }

  private static boolean validSession(String value) {
    return value.matches(
        "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}");
  }

  private void resume(
      BackupEngine.File file,
      BackupEngine.Checkpoint cp,
      BackupEngine.Save save,
      BackupEngine.Guard guard)
      throws Exception {
    String status = "";
    if (!cp.session.isEmpty() && !validSession(cp.session)) {
      cp.session = "";
      cp.partSize = 0;
      save.write(cp);
    }

    if (!cp.session.isEmpty()) {
      try {
        JSONObject session = api.request("GET", path + "/" + cp.session, null);
        if (session.getLong("size") != item.size) throw new IOException("上传检查点与文件不一致");
        status = session.getString("status");
        if (status.equals("COMPLETED")) {
          if (session.isNull("eagleAssetId")) throw new IOException("入库尚未确认");
          return;
        }
        if (status.equals("ABORTED")) cp.session = "";
        if (status.equals("FINALIZING")) throw new IOException("服务器正在确认入库，下次自动接续");
      } catch (ApiClient.Failure e) {
        if (e.status != 404) throw e;
        cp.session = "";
      }
    }
    if (cp.session.isEmpty()) {
      guard.check();
      JSONObject session =
          api.request(
              "POST",
              path,
              new JSONObject()
                  .put("originalName", item.name)
                  .put("mimeType", item.mime)
                  .put("size", item.size)
                  .put("contentSha256", cp.hash)
                  .put("duplicatePolicy", "SKIP"));
      cp.session = session.getString("id");
      cp.partSize = session.getLong("partSize");
      save.write(cp);
      status = "INITIATED";
    }
    if (!validSession(cp.session) || cp.partSize < 5_242_880 || cp.partSize > 64L * 1024 * 1024)
      throw new IOException("上传检查点无效");
    Map<Integer, JSONObject> committed = new HashMap<>();
    JSONArray inventory =
        api.request("GET", path + "/" + cp.session + "/parts", null).getJSONArray("parts");
    for (int i = 0; i < inventory.length(); i++) {
      JSONObject part = inventory.getJSONObject(i);
      committed.put(part.getInt("partNumber"), part);
    }
    JSONArray parts = new JSONArray();
    int total = (int) ((item.size + cp.partSize - 1) / cp.partSize);
    ArrayDeque<Future<JSONObject>> pending = new ArrayDeque<>();
    try (ForwardUploadSource source = new ForwardUploadSource(catalog.open(item, 0, guard))) {
      try {
        for (int number = 1; number <= total; number++) {
          guard.check();
          long offset = (number - 1L) * cp.partSize,
              length = Math.min(cp.partSize, item.size - offset);
          JSONObject part = committed.get(number);
          boolean reusable = part != null && (!part.has("size") || part.getLong("size") == length);
          if (reusable) {
            parts.put(
                new JSONObject().put("partNumber", number).put("etag", part.getString("etag")));
            continue;
          }
          if (!status.equals("INITIATED")) throw new IOException("上传已进入确认阶段，等待服务器恢复");
          if (pending.size() == 3) parts.put(await(pending.removeFirst()));
          slots.acquire();
          boolean scheduled = false;
          try {
            guard.check();
            final int partNumber = number;
            if (length <= ForwardUploadSource.MAX_BUFFER) {
              byte[] buffer = source.read(offset, (int) length, guard);
              pending.add(
                  uploads.submit(
                      () -> {
                        try {
                          return uploadPart(cp.session, partNumber, buffer, guard);
                        } finally {
                          slots.release();
                        }
                      }));
              scheduled = true;
            } else {
              // Legacy sessions may have larger parts. Stream them without a large allocation.
              while (!pending.isEmpty()) parts.put(await(pending.removeFirst()));
              guard.check();
              JSONObject signed =
                  api.request(
                      "POST", path + "/" + cp.session + "/parts/" + number, new JSONObject());
              String etag =
                  api.put(
                      signed.getString("uploadUrl"),
                      source.part(offset, length, guard),
                      length,
                      guard);
              parts.put(new JSONObject().put("partNumber", number).put("etag", etag));
            }
          } finally {
            if (!scheduled) slots.release();
          }
        }
        while (!pending.isEmpty()) parts.put(await(pending.removeFirst()));
      } finally {
        // Finish every in-flight write before handing a checkpoint to another run.
        while (!pending.isEmpty()) {
          try {
            await(pending.removeFirst());
          } catch (Exception ignored) {
          }
        }
      }
    }
    guard.check();
    JSONObject completed =
        api.request(
            "POST", path + "/" + cp.session + "/complete", new JSONObject().put("parts", parts));
    if (completed.optString("assetId").isEmpty()) throw new IOException("服务器尚未确认原文件入库");
  }

  private JSONObject uploadPart(String session, int number, byte[] bytes, BackupEngine.Guard guard)
      throws Exception {
    for (int attempt = 0; attempt < 2; attempt++) {
      guard.check();
      JSONObject signed =
          api.request("POST", path + "/" + session + "/parts/" + number, new JSONObject());
      try {
        String etag =
            api.put(
                signed.getString("uploadUrl"),
                new ByteArrayInputStream(bytes),
                bytes.length,
                guard);
        return new JSONObject().put("partNumber", number).put("etag", etag);
      } catch (ApiClient.Failure error) {
        if (attempt != 0 || !error.renewSignature()) throw error;
      }
    }
    throw new IOException("分片未能上传");
  }

  private static JSONObject await(Future<JSONObject> future) throws Exception {
    boolean interrupted = false;
    try {
      for (; ; ) {
        try {
          return future.get();
        } catch (InterruptedException error) {
          interrupted = true;
        }
      }
    } catch (ExecutionException error) {
      if (error.getCause() instanceof Exception) throw (Exception) error.getCause();
      throw error;
    } finally {
      if (interrupted) Thread.currentThread().interrupt();
    }
  }
}
