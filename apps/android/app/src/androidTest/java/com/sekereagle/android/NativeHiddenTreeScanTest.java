package com.sekereagle.android;

import static org.junit.Assert.*;

import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.test.platform.app.InstrumentationRegistry;
import com.sekereagle.android.testdocuments.TestDocumentsProvider;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The system media index never lists dot-prefixed names; SAF directory scans must match it. */
public final class NativeHiddenTreeScanTest {

  @Test
  public void directoryScanSkipsHiddenFilesAndFolders() throws Exception {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    Uri tree =
        DocumentsContract.buildTreeDocumentUri(
            TestDocumentsProvider.AUTHORITY, TestDocumentsProvider.ROOT);
    JSONArray rules =
        new JSONArray()
            .put(
                new JSONObject()
                    .put("type", "tree")
                    .put("path", tree.toString())
                    .put("mode", "PHOTO")
                    .put("recursive", true));
    MediaCatalog catalog = new MediaCatalog(context);
    List<String> names = new ArrayList<>();
    catalog.scan(rules, (item, mode) -> names.add(item.name), () -> {});
    assertEquals(Arrays.asList("photo.jpg", "inner.jpg"), names);
  }
}
