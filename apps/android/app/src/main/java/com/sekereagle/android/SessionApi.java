package com.sekereagle.android;

import org.json.JSONObject;

/** Authenticated JSON boundary; native sessions and the legacy preview share backup consumers. */
interface SessionApi {
  JSONObject request(String method, String path, JSONObject body) throws Exception;
}
