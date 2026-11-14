package com.sekereagle.android;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.sekereagle.android.core.BackupEngine;
import java.util.ArrayList;
import java.util.List;

final class BackupJournal extends SQLiteOpenHelper implements BackupEngine.Store {

  BackupJournal(Context context) {
    this(context, "mobile-backup.db");
  }

  BackupJournal(Context context, String name) {
    super(context, name, null, 5);
    setWriteAheadLoggingEnabled(true);
  }

  /** A failed file kept with its media metadata so the next run can retry it without a full scan. */
  static final class Retry {
    final String key, uri, name, mode, error;
    final long size, modified;
    final boolean document;
    final int attempts;

    Retry(
        String key,
        String uri,
        String name,
        String mode,
        long size,
        long modified,
        boolean document,
        int attempts,
        String error) {
      this.key = key;
      this.uri = uri;
      this.name = name;
      this.mode = mode;
      this.size = size;
      this.modified = modified;
      this.document = document;
      this.attempts = attempts;
      this.error = error;
    }
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE files (key TEXT PRIMARY KEY, hash TEXT NOT NULL, session TEXT NOT NULL,"
            + " part_size INTEGER NOT NULL, confirmed INTEGER NOT NULL, terminal_error TEXT NOT"
            + " NULL DEFAULT '')");
    db.execSQL("CREATE TABLE receipts (key TEXT PRIMARY KEY)");
    createProgress(db);
    createScanState(db);
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion < 2)
      db.execSQL("ALTER TABLE files ADD COLUMN terminal_error TEXT NOT NULL DEFAULT ''");
    if (oldVersion < 3) createProgress(db);
    if (oldVersion < 4) {
      // v3 created scan_progress without the fingerprint column.
      if (oldVersion >= 3)
        db.execSQL(
            "ALTER TABLE scan_progress ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
      createScanState(db);
      // The old keys included size/modified; rebuild them once from the stable URI key.
      db.execSQL("DELETE FROM scan_progress");
      db.execSQL("DELETE FROM scan_runs");
    }
    if (oldVersion < 5) {
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN uri TEXT NOT NULL DEFAULT ''");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN name TEXT NOT NULL DEFAULT ''");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN size INTEGER NOT NULL DEFAULT 0");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN modified INTEGER NOT NULL DEFAULT 0");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN document INTEGER NOT NULL DEFAULT 0");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN mode TEXT NOT NULL DEFAULT ''");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN last_error TEXT NOT NULL DEFAULT ''");
      db.execSQL("ALTER TABLE scan_progress ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
      // Rows written by older versions only kept hashes; one full pass rebuilds their metadata.
      db.execSQL("DELETE FROM scan_state");
    }
  }

  private static void createScanState(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE IF NOT EXISTS scan_state (scope TEXT PRIMARY KEY, max_id INTEGER NOT NULL"
            + " DEFAULT -1, scanned_at INTEGER NOT NULL DEFAULT 0, full_scanned_at INTEGER NOT"
            + " NULL DEFAULT 0, rules_hash TEXT NOT NULL DEFAULT '')");
  }

  private static void createProgress(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE scan_progress (scope TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT"
            + " NULL DEFAULT '', result TEXT NOT NULL, uri TEXT NOT NULL DEFAULT '', name TEXT NOT"
            + " NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, modified INTEGER NOT NULL DEFAULT 0,"
            + " document INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT '', attempts INTEGER"
            + " NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL"
            + " DEFAULT 0, PRIMARY KEY(scope,key))");
    db.execSQL(
        "CREATE TABLE scan_runs (scope TEXT PRIMARY KEY, seen INTEGER NOT NULL, uploaded INTEGER"
            + " NOT NULL, skipped INTEGER NOT NULL, failed INTEGER NOT NULL)");
    db.execSQL(
        "CREATE TRIGGER scan_insert AFTER INSERT ON scan_progress BEGIN INSERT INTO scan_runs"
            + " VALUES (new.scope,1,new.result='UPLOADED',new.result='SKIPPED',new.result='FAILED')"
            + " ON CONFLICT(scope) DO UPDATE SET"
            + " seen=seen+1,uploaded=uploaded+(new.result='UPLOADED'),skipped=skipped+(new.result='SKIPPED'),failed=failed+(new.result='FAILED');"
            + " END");
    db.execSQL(
        "CREATE TRIGGER scan_update AFTER UPDATE ON scan_progress BEGIN UPDATE scan_runs SET"
            + " uploaded=uploaded+(new.result='UPLOADED')-(old.result='UPLOADED'),skipped=skipped+(new.result='SKIPPED')-(old.result='SKIPPED'),failed=failed+(new.result='FAILED')-(old.result='FAILED')"
            + " WHERE scope=new.scope; END");
    db.execSQL(
        "CREATE TRIGGER scan_delete AFTER DELETE ON scan_progress BEGIN UPDATE scan_runs SET"
            + " seen=seen-1,uploaded=uploaded-(old.result='UPLOADED'),skipped=skipped-(old.result='SKIPPED'),failed=failed-(old.result='FAILED')"
            + " WHERE scope=old.scope; END");
  }

  boolean scanCompleted(String scope, String key, String fingerprint) {
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT 1 FROM scan_progress WHERE scope=? AND key=? AND fingerprint=? AND"
                    + " result IN ('UPLOADED','SKIPPED')",
                new String[] {scope, key, fingerprint})) {
      return cursor.moveToFirst();
    }
  }

  void scanResult(String scope, String key, String fingerprint, String result) {
    getWritableDatabase()
        .execSQL(
            "INSERT INTO scan_progress(scope,key,fingerprint,result) VALUES (?,?,?,?) ON"
                + " CONFLICT(scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,"
                + " result=excluded.result, attempts=CASE WHEN excluded.result IN"
                + " ('UPLOADED','SKIPPED') THEN 0 ELSE attempts END,"
                + " last_error=CASE WHEN excluded.result IN ('UPLOADED','SKIPPED') THEN ''"
                + " ELSE last_error END",
            new Object[] {scope, key, fingerprint, result});
  }

  /** Keeps the media identity of a failed file so it can be retried without a full media scan. */
  void scanFailure(
      String scope,
      String key,
      String fingerprint,
      String uri,
      String name,
      String mode,
      long size,
      long modified,
      boolean document,
      String error) {
    getWritableDatabase()
        .execSQL(
            "INSERT INTO scan_progress(scope,key,fingerprint,result,uri,name,mode,size,modified,"
                + "document,attempts,last_error,updated_at) VALUES"
                + " (?,?,?,'FAILED',?,?,?,?,?,?,1,?,?) ON CONFLICT(scope,key) DO UPDATE SET"
                + " fingerprint=excluded.fingerprint, result='FAILED', uri=excluded.uri,"
                + " name=excluded.name, mode=excluded.mode, size=excluded.size,"
                + " modified=excluded.modified, document=excluded.document,"
                + " attempts=attempts+1, last_error=excluded.last_error,"
                + " updated_at=excluded.updated_at",
            new Object[] {
              scope,
              key,
              fingerprint,
              uri,
              name,
              mode,
              size,
              modified,
              document ? 1 : 0,
              error,
              System.currentTimeMillis()
            });
  }

  List<Retry> failures(String scope) {
    List<Retry> result = new ArrayList<>();
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT key,uri,name,mode,size,modified,document,attempts,last_error FROM"
                    + " scan_progress WHERE scope=? AND result='FAILED' AND uri<>''"
                    + " ORDER BY modified DESC, updated_at ASC, name ASC",
                new String[] {scope})) {
      while (cursor.moveToNext())
        result.add(
            new Retry(
                cursor.getString(0),
                cursor.getString(1),
                cursor.getString(2),
                cursor.getString(3),
                cursor.getLong(4),
                cursor.getLong(5),
                cursor.getInt(6) == 1,
                cursor.getInt(7),
                cursor.getString(8)));
    }
    return result;
  }

  long[] scanState(String scope) {
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT max_id,scanned_at,full_scanned_at FROM scan_state WHERE scope=?",
                new String[] {scope})) {
      if (!cursor.moveToFirst()) return new long[] {-1, 0, 0};
      return new long[] {cursor.getLong(0), cursor.getLong(1), cursor.getLong(2)};
    }
  }

  String scanRulesHash(String scope) {
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT rules_hash FROM scan_state WHERE scope=?", new String[] {scope})) {
      return cursor.moveToFirst() ? cursor.getString(0) : "";
    }
  }

  void saveScanState(
      String scope, long maxId, long scannedAt, long fullScannedAt, String rulesHash) {
    getWritableDatabase()
        .execSQL(
            "INSERT INTO scan_state(scope,max_id,scanned_at,full_scanned_at,rules_hash)"
                + " VALUES (?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET"
                + " max_id=excluded.max_id, scanned_at=excluded.scanned_at,"
                + " full_scanned_at=excluded.full_scanned_at, rules_hash=excluded.rules_hash",
            new Object[] {scope, maxId, scannedAt, fullScannedAt, rulesHash});
  }

  int[] scanCounts(String scope) {
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT seen,uploaded,skipped,failed FROM scan_runs WHERE scope=?",
                new String[] {scope})) {
      if (!cursor.moveToFirst()) return new int[] {0, 0, 0, 0};
      return new int[] {cursor.getInt(0), cursor.getInt(1), cursor.getInt(2), cursor.getInt(3)};
    }
  }

  @Override
  public BackupEngine.Checkpoint load(String key) {
    try (Cursor cursor =
        getReadableDatabase().query("files", null, "key=?", new String[] {key}, null, null, null)) {
      if (!cursor.moveToFirst()) return null;
      BackupEngine.Checkpoint cp = new BackupEngine.Checkpoint();
      cp.terminalError = cursor.getString(cursor.getColumnIndexOrThrow("terminal_error"));
      cp.hash = cursor.getString(cursor.getColumnIndexOrThrow("hash"));
      cp.session = cursor.getString(cursor.getColumnIndexOrThrow("session"));
      cp.partSize = cursor.getLong(cursor.getColumnIndexOrThrow("part_size"));
      cp.confirmed = cursor.getInt(cursor.getColumnIndexOrThrow("confirmed")) == 1;
      return cp;
    }
  }

  @Override
  public void save(String key, BackupEngine.Checkpoint cp) {
    ContentValues values = new ContentValues();
    values.put("key", key);
    values.put("hash", cp.hash);
    values.put("terminal_error", cp.terminalError);
    values.put("session", cp.session);
    values.put("part_size", cp.partSize);
    values.put("confirmed", cp.confirmed ? 1 : 0);
    getWritableDatabase()
        .insertWithOnConflict("files", null, values, SQLiteDatabase.CONFLICT_REPLACE);
  }

  @Override
  public boolean contains(String key) {
    try (Cursor cursor =
        getReadableDatabase().rawQuery("SELECT 1 FROM receipts WHERE key=?", new String[] {key})) {
      return cursor.moveToFirst();
    }
  }

  @Override
  public void confirm(String key, String content, BackupEngine.Checkpoint cp) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      save(key, cp);
      ContentValues values = new ContentValues();
      values.put("key", content);
      db.insertWithOnConflict("receipts", null, values, SQLiteDatabase.CONFLICT_IGNORE);
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }

  void retryFailures(String scope) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete(
          "files",
          "key LIKE ? AND terminal_error <> ''",
          new String[] {
            scope + ":%",
          });
      // Retry items re-read their media row before upload, so a changed file gets fresh metadata
      // without forcing another full scan.
      db.execSQL(
          "UPDATE scan_progress SET attempts=0, last_error='' WHERE scope=? AND result='FAILED'",
          new Object[] {scope});
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }

  void forget(String scope) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete("scan_progress", "scope=?", new String[] {scope});
      db.delete("scan_runs", "scope=?", new String[] {scope});
      db.delete("scan_state", "scope=?", new String[] {scope});
      db.delete("files", "key LIKE ?", new String[] {scope + ":%"});
      db.delete("receipts", "key LIKE ?", new String[] {scope + ":%"});
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
}
