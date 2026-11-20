package com.sekereagle.android.testdocuments;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;
import java.io.FileNotFoundException;
import java.util.Map;

/** Test-only SAF tree so device tests can exercise directory scans without the system picker. */
public final class TestDocumentsProvider extends DocumentsProvider {

  public static final String AUTHORITY = "com.sekereagle.android.testdocuments";
  public static final String ROOT = "root";
  private static final String DIR = DocumentsContract.Document.MIME_TYPE_DIR;
  private static final String[] DEFAULT_PROJECTION = {
    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
    DocumentsContract.Document.COLUMN_MIME_TYPE,
    DocumentsContract.Document.COLUMN_SIZE,
    DocumentsContract.Document.COLUMN_LAST_MODIFIED
  };
  private static final Map<String, String[]> CHILDREN =
      Map.of(
          ROOT, new String[] {"photo.jpg", ".deleted.jpg", "album", ".trashed"},
          "album", new String[] {"inner.jpg"},
          ".trashed", new String[] {"gone.jpg"});

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public Cursor queryRoots(String[] projection) {
    MatrixCursor cursor = cursor(projection);
    cursor.addRow(
        row(
            cursor,
            ROOT,
            "test",
            DIR,
            0,
            0));
    return cursor;
  }

  @Override
  public Cursor queryDocument(String documentId, String[] projection) {
    MatrixCursor cursor = cursor(projection);
    cursor.addRow(row(cursor, documentId, name(documentId), mime(documentId), 4, 1_700_000_000_000L));
    return cursor;
  }

  @Override
  public Cursor queryChildDocuments(
      String parentDocumentId, String[] projection, String sortOrder) {
    MatrixCursor cursor = cursor(projection);
    for (String child : CHILDREN.getOrDefault(parentDocumentId, new String[0]))
      cursor.addRow(row(cursor, child, child, mime(child), 4, 1_700_000_000_000L));
    return cursor;
  }

  @Override
  public boolean isChildDocument(String parentDocumentId, String documentId) {
    String current = documentId;
    for (int depth = 0; depth < 8; depth++) {
      String parent = parentOf(current);
      if (parent == null) return false;
      if (parent.equals(parentDocumentId)) return true;
      current = parent;
    }
    return false;
  }

  @Override
  public ParcelFileDescriptor openDocument(
      String documentId, String mode, CancellationSignal signal) throws FileNotFoundException {
    throw new FileNotFoundException("Test documents have no bytes");
  }

  private static MatrixCursor cursor(String[] projection) {
    return new MatrixCursor(projection == null ? DEFAULT_PROJECTION : projection);
  }

  private static Object[] row(
      MatrixCursor cursor, String id, String name, String mime, long size, long modified) {
    Object[] values = new Object[cursor.getColumnCount()];
    for (int i = 0; i < values.length; i++) {
      switch (cursor.getColumnName(i)) {
        case DocumentsContract.Document.COLUMN_DOCUMENT_ID -> values[i] = id;
        case DocumentsContract.Document.COLUMN_DISPLAY_NAME -> values[i] = name;
        case DocumentsContract.Document.COLUMN_MIME_TYPE -> values[i] = mime;
        case DocumentsContract.Document.COLUMN_SIZE -> values[i] = size;
        case DocumentsContract.Document.COLUMN_LAST_MODIFIED -> values[i] = modified;
        default -> values[i] = null;
      }
    }
    return values;
  }

  private static String name(String documentId) {
    return documentId.equals(ROOT) ? "test" : documentId;
  }

  private static String mime(String documentId) {
    return CHILDREN.containsKey(documentId) ? DIR : "image/jpeg";
  }

  private static String parentOf(String documentId) {
    for (Map.Entry<String, String[]> entry : CHILDREN.entrySet())
      for (String child : entry.getValue()) if (child.equals(documentId)) return entry.getKey();
    return null;
  }
}
