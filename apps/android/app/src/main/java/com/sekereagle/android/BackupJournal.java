package com.sekereagle.android;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.sekereagle.android.core.BackupEngine;

final class BackupJournal extends SQLiteOpenHelper implements BackupEngine.Store {
  BackupJournal(Context context) {
    super(context, "mobile-backup.db", null, 2);
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE files (key TEXT PRIMARY KEY, hash TEXT NOT NULL, session TEXT NOT NULL,"
            + " part_size INTEGER NOT NULL, confirmed INTEGER NOT NULL, terminal_error TEXT NOT"
            + " NULL DEFAULT '')");
    db.execSQL("CREATE TABLE receipts (key TEXT PRIMARY KEY)");
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    if (oldVersion == 1 && newVersion == 2)
      db.execSQL("ALTER TABLE files ADD COLUMN terminal_error TEXT NOT NULL DEFAULT ''");
    else throw new IllegalStateException("Unsupported journal migration");
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
        .delete("files", "key LIKE ? AND terminal_error <> ''", new String[] {scope + ":%"});
  }

  void forget(String scope) {
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete("files", "key LIKE ?", new String[] {scope + ":%"});
      db.delete("receipts", "key LIKE ?", new String[] {scope + ":%"});
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
}
