package com.sekereagle.android;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.sekereagle.android.core.BackupEngine;

final class BackupJournal extends SQLiteOpenHelper implements BackupEngine.Store {

  BackupJournal(Context context) {
    this(context, "mobile-backup.db");
  }

  BackupJournal(Context context, String name) {
    super(context, name, null, 3);
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE files (key TEXT PRIMARY KEY, hash TEXT NOT NULL, session TEXT NOT NULL,"
            + " part_size INTEGER NOT NULL, confirmed INTEGER NOT NULL, terminal_error TEXT NOT"
            + " NULL DEFAULT '')");
    db.execSQL("CREATE TABLE receipts (key TEXT PRIMARY KEY)");
    createProgress(db);
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion < 2)
      db.execSQL("ALTER TABLE files ADD COLUMN terminal_error TEXT NOT NULL DEFAULT ''");
    if (oldVersion < 3) createProgress(db);
  }

  private static void createProgress(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE scan_progress (scope TEXT NOT NULL, key TEXT NOT NULL, result TEXT NOT NULL,"
            + " PRIMARY KEY(scope,key))");
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

  void beginScan(String scope, boolean resume) {
    if (!resume) getWritableDatabase().delete("scan_progress", "scope=?", new String[] {scope});
  }

  boolean scanCompleted(String scope, String key) {
    try (Cursor cursor =
        getReadableDatabase()
            .rawQuery(
                "SELECT 1 FROM scan_progress WHERE scope=? AND key=? AND result IN"
                    + " ('UPLOADED','SKIPPED')",
                new String[] {scope, key})) {
      return cursor.moveToFirst();
    }
  }

  void scanResult(String scope, String key, String result) {
    getWritableDatabase()
        .execSQL(
            "INSERT INTO scan_progress(scope,key,result) VALUES (?,?,?) ON CONFLICT(scope,key) DO"
                + " UPDATE SET result=excluded.result",
            new Object[] {scope, key, result});
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
    getWritableDatabase()
        .delete(
            "files",
            "key LIKE ? AND terminal_error <> ''",
            new String[] {
              scope + ":%",
            });
  }

  void forget(String scope) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete("scan_progress", "scope=?", new String[] {scope});
      db.delete("scan_runs", "scope=?", new String[] {scope});
      db.delete("files", "key LIKE ?", new String[] {scope + ":%"});
      db.delete("receipts", "key LIKE ?", new String[] {scope + ":%"});
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
}
