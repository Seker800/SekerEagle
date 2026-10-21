package com.sekereagle.android;

import com.sekereagle.android.core.BackupEngine;
import java.io.InputStream;
import org.json.JSONObject;

/** Upload protocol boundary shared by HTTP and device-test adapters. */
interface UploadApi {
  JSONObject request(String method, String path, JSONObject body) throws Exception;

  String put(String url, InputStream input, long bytes, BackupEngine.Guard guard) throws Exception;
}
