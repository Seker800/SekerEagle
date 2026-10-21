package com.sekereagle.android;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import com.sekereagle.android.core.*;

final class MediaCatalog {
    interface Visitor { void visit(Item item, String mode) throws Exception; }
    static final class Item {
        final Uri uri;
        final String name, path, mime;
        final long size, modified;
        final boolean document;
        Item(Uri uri, String name, String path, String mime, long size, long modified, boolean document) {
            this.uri = uri; this.name = name; this.path = path; this.mime = mime; this.size = size; this.modified = modified; this.document = document;
        }
    }
    private final ContentResolver resolver;
    private final Map<String, JSONObject> formats = new HashMap<>();
    private final long maxImage, maxVideo;
    MediaCatalog(Context context) throws Exception {
        resolver = context.getContentResolver();
        JSONObject policy;
        try (InputStream input = context.getAssets().open("media-policy.json")) { policy = new JSONObject(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)); }
        JSONArray entries = policy.getJSONArray("formats");
        for (int i = 0; i < entries.length(); i++) { JSONObject entry = entries.getJSONObject(i); formats.put(entry.getString("extension"), entry); }
        maxImage = policy.getLong("maxImageBytes"); maxVideo = policy.getLong("maxVideoBytes");
    }
    private JSONObject format(String name) {
        String normalized = java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);
        int dot = normalized.lastIndexOf('.'); return dot < 0 ? null : formats.get(normalized.substring(dot));
    }
    List<String> folders() throws Exception {
        Set<String> paths = new TreeSet<>();
        media(item -> paths.add(item.path));
        return new ArrayList<>(paths);
    }
    interface MediaVisitor { void visit(Item item) throws Exception; }
    private void media(MediaVisitor visitor) throws Exception {
        Uri collection = MediaStore.Files.getContentUri("external");
        String[] projection = {"_id", "_display_name", "relative_path", "_size", "date_modified", "is_pending", "is_trashed"};
        try (Cursor cursor = resolver.query(collection, projection, "is_pending=0 AND is_trashed=0", null, "_id ASC")) {
            if (cursor == null) throw new IOException("无法读取手机媒体目录");
            while (cursor.moveToNext()) {
                String name = cursor.getString(1), path = cursor.getString(2); JSONObject entry = name == null ? null : format(name);
                if (entry == null || path == null || path.isEmpty()) continue;
                visitor.visit(new Item(ContentUris.withAppendedId(collection, cursor.getLong(0)), name, path, entry.getString("mimeType"), cursor.getLong(3), cursor.getLong(4) * 1000, false));
            }
        }
    }
    void scan(JSONArray rules, Visitor visitor, BackupEngine.Guard guard) throws Exception {
        boolean indexed = false;
        for (int i = 0; i < rules.length(); i++) if (rules.getJSONObject(i).getString("type").equals("media")) indexed = true;
        if (indexed) media(item -> {
            guard.check();
            for (int i = 0; i < rules.length(); i++) {
                JSONObject rule = rules.getJSONObject(i);
                if (rule.getString("type").equals("media") && BackupPolicy.inFolder(rule.getString("path"), item.path, rule.optBoolean("recursive", true)))
                    visitor.visit(item, rule.getString("mode"));
            }
        });
        for (int i = 0; i < rules.length(); i++) {
            guard.check(); JSONObject rule = rules.getJSONObject(i);
            if (!rule.getString("type").equals("tree")) continue;
            Uri tree = Uri.parse(rule.getString("path"));
            scanTree(tree, DocumentsContract.getTreeDocumentId(tree), "", rule, visitor, guard, new HashSet<>(), 0);
        }
    }
    private void scanTree(Uri tree, String id, String path, JSONObject rule, Visitor visitor, BackupEngine.Guard guard, Set<String> visited, int depth) throws Exception {
        guard.check();
        if (!visited.add(id)) return;
        if (depth > 64 || visited.size() > 100_000) throw new IOException("目录层级或数量超出扫描上限，请选择更具体的目录");
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, id);
        String[] projection = {"document_id", "_display_name", "mime_type", "_size", "last_modified"};
        try (Cursor cursor = resolver.query(children, projection, null, null, null)) {
            if (cursor == null) throw new IOException("目录不可读，请重新授权");
            while (cursor.moveToNext()) {
                guard.check(); String childId = cursor.getString(0), name = cursor.getString(1), mime = cursor.getString(2);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    if (rule.optBoolean("recursive", true)) scanTree(tree, childId, path + name + "/", rule, visitor, guard, visited, depth + 1);
                } else {
                    JSONObject entry = format(name); if (entry == null) continue;
                    visitor.visit(new Item(DocumentsContract.buildDocumentUriUsingTree(tree, childId), name, path, entry.getString("mimeType"), cursor.getLong(3), cursor.getLong(4), true), rule.getString("mode"));
                }
            }
        }
    }
    void checkSize(Item item) throws Exception {
        JSONObject entry = format(item.name);
        long maximum = entry.getString("kind").equals("video") ? maxVideo : maxImage;
        if (item.size <= 0 || item.size > maximum) throw new IOException("文件为空或超过支持的大小");
    }
    boolean stable(Item item) {
        String[] columns = {"_size", item.document ? "last_modified" : "date_modified"};
        try (Cursor cursor = resolver.query(item.uri, columns, null, null, null)) {
            return cursor != null && cursor.moveToFirst() && cursor.getLong(0) == item.size &&
                cursor.getLong(1) * (item.document ? 1 : 1000) == item.modified;
        }
    }
    InputStream open(Item item, long offset, BackupEngine.Guard guard) throws Exception {
        InputStream input = resolver.openInputStream(item.uri);
        if (input == null) throw new IOException("文件无法读取");
        try {
            if (input instanceof FileInputStream) ((FileInputStream) input).getChannel().position(offset);
            else {
                long remaining = offset;
                while (remaining > 0) { guard.check(); long count = input.skip(remaining); if (count == 0) { if (input.read() < 0) throw new IOException("文件读取未完成"); count = 1; } remaining -= count; }
            }
            return input;
        } catch (Exception e) { input.close(); throw e; }
    }
    String hash(Item item, BackupEngine.Guard guard) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); long count = 0;
        try (InputStream input = open(item, 0, guard)) {
            byte[] buffer = new byte[256 * 1024]; int length;
            while ((length = input.read(buffer)) != -1) { guard.check(); count += length; if (count > item.size) throw new IOException("文件正在变化"); digest.update(buffer, 0, length); }
        }
        if (count != item.size) throw new IOException("文件读取未完成");
        return BackupPolicy.hex(digest.digest());
    }
}
