package com.sekereagle.android;

import java.io.*;
import java.util.*;
import org.json.*;
import com.sekereagle.android.core.BackupEngine;

final class MultipartTransport implements BackupEngine.Transport {
    private final ApiClient api;
    private final String path;
    private final MediaCatalog catalog;
    private final MediaCatalog.Item item;
    MultipartTransport(ApiClient api, String mode, MediaCatalog catalog, MediaCatalog.Item item) {
        if (!(mode.equals("PHOTO") || mode.equals("MATERIAL"))) throw new IllegalArgumentException("无效模式");
        this.api = api; this.catalog = catalog; this.item = item;
        path = "/api/" + (mode.equals("PHOTO") ? "photos" : "eagle") + "/uploads";
    }
    @Override public boolean exists(String hash, long size) throws Exception {
        return api.request("POST", path + "/check-content", new JSONObject().put("contentSha256", hash).put("size", size)).getBoolean("exists");
    }
    @Override public void upload(BackupEngine.File file, BackupEngine.Checkpoint cp, BackupEngine.Save save, BackupEngine.Guard guard) throws Exception {
        String status = "";
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
            JSONObject session = api.request("POST", path, new JSONObject().put("originalName", item.name).put("mimeType", item.mime)
                .put("size", item.size).put("contentSha256", cp.hash).put("duplicatePolicy", "SKIP"));
            cp.session = session.getString("id"); cp.partSize = session.getLong("partSize"); save.write(cp); status = "INITIATED";
        }
        if (!cp.session.matches("[a-fA-F0-9-]{36}") || cp.partSize < 5_242_880) throw new IOException("上传检查点无效");
        Map<Integer, JSONObject> committed = new HashMap<>();
        JSONArray inventory = api.request("GET", path + "/" + cp.session + "/parts", null).getJSONArray("parts");
        for (int i = 0; i < inventory.length(); i++) { JSONObject part = inventory.getJSONObject(i); committed.put(part.getInt("partNumber"), part); }
        JSONArray parts = new JSONArray();
        int total = (int) ((item.size + cp.partSize - 1) / cp.partSize);
        for (int number = 1; number <= total; number++) {
            guard.check(); long offset = (number - 1L) * cp.partSize, length = Math.min(cp.partSize, item.size - offset);
            JSONObject part = committed.get(number);
            boolean reusable = part != null && (!part.has("size") || part.getLong("size") == length);
            String etag;
            if (reusable) etag = part.getString("etag");
            else {
                if (!status.equals("INITIATED")) throw new IOException("上传已进入确认阶段，等待服务器恢复");
                JSONObject signed = api.request("POST", path + "/" + cp.session + "/parts/" + number, new JSONObject());
                try (InputStream input = catalog.open(item, offset, guard)) { etag = api.put(signed.getString("uploadUrl"), input, length, guard); }
            }
            parts.put(new JSONObject().put("partNumber", number).put("etag", etag));
        }
        guard.check();
        JSONObject completed = api.request("POST", path + "/" + cp.session + "/complete", new JSONObject().put("parts", parts));
        if (completed.optString("assetId").isEmpty()) throw new IOException("服务器尚未确认原文件入库");
    }
}
