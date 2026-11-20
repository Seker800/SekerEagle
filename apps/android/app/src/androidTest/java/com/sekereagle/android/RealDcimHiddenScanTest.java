package com.sekereagle.android;

import static org.junit.Assert.*;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.platform.app.InstrumentationRegistry;
import com.sekereagle.android.core.BackupPolicy;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;

/**
 * Read-only check of the granted DCIM tree. Skipped on devices without the persisted grant.
 * The display name of a trashed file is clean; its document id still carries the dot prefix.
 */
public final class RealDcimHiddenScanTest {

  @Test
  public void grantedDcimTreeNeverYieldsHiddenDocuments() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    Uri tree =
        Uri.parse("content://com.android.externalstorage.documents/tree/primary%3ADCIM");
    try (Cursor probe =
        context
            .getContentResolver()
            .query(
                DocumentsContract.buildChildDocumentsUriUsingTree(
                    tree, DocumentsContract.getTreeDocumentId(tree)),
                new String[] {DocumentsContract.Document.COLUMN_DOCUMENT_ID},
                null,
                null,
                null)) {
      Assume.assumeTrue("DCIM tree permission is not granted on this device", probe != null);
    } catch (SecurityException denied) {
      Assume.assumeNoException(denied);
    }
    JSONArray rules =
        new JSONArray()
            .put(
                new JSONObject()
                    .put("type", "tree")
                    .put("path", tree.toString())
                    .put("mode", "PHOTO")
                    .put("recursive", true));
    List<String> hidden = new ArrayList<>();
    int[] seen = {0};
    new MediaCatalog(context)
        .scan(
            rules,
            (item, mode) -> {
              seen[0]++;
              String real = BackupPolicy.documentName(DocumentsContract.getDocumentId(item.uri));
              if (BackupPolicy.hidden(real)) hidden.add(real);
            },
            () -> {});
    assertTrue("no documents were scanned", seen[0] > 0);
    assertTrue("hidden documents were scanned: " + hidden, hidden.isEmpty());
  }
}
