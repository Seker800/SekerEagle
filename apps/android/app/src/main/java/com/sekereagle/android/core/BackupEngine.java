package com.sekereagle.android.core;

import java.io.IOException;

/** Platform-independent decisions. Android adapters own persistence, streams and HTTP. */
public final class BackupEngine {
    public enum Result { UPLOADED, SKIPPED }
    public interface Hash { String read() throws Exception; }
    public interface Stable { boolean check() throws Exception; }
    public interface Guard { void check() throws Exception; }
    public interface Save { void write(Checkpoint value) throws Exception; }
    public interface Store {
        Checkpoint load(String key) throws Exception;
        void save(String key, Checkpoint value) throws Exception;
        boolean contains(String content) throws Exception;
        void confirm(String key, String content, Checkpoint value) throws Exception;
    }
    public interface Transport {
        boolean exists(String hash, long size) throws Exception;
        void upload(File file, Checkpoint cp, Save save, Guard guard) throws Exception;
    }
    public static final class File {
        public final String uri;
        public final long size, modified;
        public final Hash hash;
        public final Stable stable;
        public File(String uri, long size, long modified, Hash hash, Stable stable) {
            this.uri = uri; this.size = size; this.modified = modified; this.hash = hash; this.stable = stable;
        }
    }
    public static final class Checkpoint {
        public String hash = "", session = "";
        public long partSize;
        public boolean confirmed;
    }
    private final Store store;
    private final Transport transport;
    private final Guard guard;
    public BackupEngine(Store store, Transport transport, Guard guard) {
        this.store = store; this.transport = transport; this.guard = guard;
    }
    public Result process(String scope, String mode, File file) throws Exception {
        if (scope.isEmpty() || !(mode.equals("PHOTO") || mode.equals("MATERIAL")) || file.size <= 0)
            throw new IllegalArgumentException("备份作用域或文件无效");
        guard.check();
        String prefix = scope + ":" + mode + ":";
        String key = prefix + BackupPolicy.digest(file.uri + "\n" + file.size + "\n" + file.modified);
        Checkpoint cp = store.load(key);
        if (cp != null && cp.confirmed && file.modified > 0) return Result.SKIPPED;
        if (cp == null || file.modified == 0) cp = new Checkpoint();
        if (cp.hash.isEmpty()) cp.hash = file.hash.read();
        if (!cp.hash.matches("[a-f0-9]{64}")) throw new IOException("文件校验失败");
        if (!file.stable.check()) throw new IOException("文件仍在变化，留待下次备份");
        guard.check();
        store.save(key, cp);
        String content = prefix + cp.hash + ":" + file.size;
        boolean skipped = store.contains(content) || transport.exists(cp.hash, file.size);
        if (!skipped) {
            transport.upload(file, cp, value -> store.save(key, value), guard);
            if (!file.stable.check()) throw new IOException("上传期间文件已变化，留待下次校验");
        }
        cp.confirmed = true;
        store.confirm(key, content, cp);
        return skipped ? Result.SKIPPED : Result.UPLOADED;
    }
}
