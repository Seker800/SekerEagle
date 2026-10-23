package com.sekereagle.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.sekereagle.android.core.BackupPolicy;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only app-private configuration; credentials are encrypted with a non-exportable device key. */
final class BackupSettings {
  private final SharedPreferences preferences;

  BackupSettings(Context context) {
    preferences = context.getSharedPreferences("backup", Context.MODE_PRIVATE);
  }

  String origin() {
    return preferences.getString("origin", "");
  }

  String active() {
    return preferences.getString("active", "");
  }

  void origin(String value) {
    preferences
        .edit()
        .putString("origin", BackupPolicy.origin(value, BuildConfig.DEBUG))
        .putString("active", "")
        .commit();
  }

  void active(String value) {
    preferences.edit().putString("active", value).commit();
  }

  String value(String scope, String key, String fallback) {
    return preferences.getString(scope + ":" + key, fallback);
  }

  void setValue(String scope, String key, String value) {
    preferences.edit().putString(scope + ":" + key, value).commit();
  }

  boolean flag(String scope, String key, boolean fallback) {
    return preferences.getBoolean(scope + ":" + key, fallback);
  }

  void setFlag(String scope, String key, boolean value) {
    preferences.edit().putBoolean(scope + ":" + key, value).commit();
  }

  JSONArray rules(String scope) {
    try {
      return new JSONArray(value(scope, "rules", "[]"));
    } catch (Exception e) {
      throw new IllegalStateException("备份目录配置无法读取", e);
    }
  }

  JSONArray scanRules(String scope) {
    JSONArray configured = rules(scope);
    if (!flag(scope, "allMedia", false)) return configured;
    JSONArray result = new JSONArray();
    try {
      result.put(
          new JSONObject()
              .put("type", "media")
              .put("path", "")
              .put("mode", value(scope, "allMediaMode", "PHOTO"))
              .put("recursive", true));
      for (int i = 0; i < configured.length(); i++)
        if (configured.getJSONObject(i).getString("type").equals("tree"))
          result.put(configured.getJSONObject(i));
      return result;
    } catch (org.json.JSONException e) {
      throw new IllegalStateException(e);
    }
  }

  void rules(String scope, JSONArray rules) {
    setValue(scope, "rules", rules.toString());
  }

  void saveToken(String scope, String token) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    cipher.updateAAD(scope.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    JSONObject record =
        new JSONObject()
            .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put(
                "data",
                Base64.encodeToString(
                    cipher.doFinal(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    Base64.NO_WRAP));
    setValue(scope, "credential", record.toString());
  }

  String token(String scope) throws Exception {
    String raw = value(scope, "credential", "");
    if (raw.isEmpty()) return "";
    JSONObject record = new JSONObject(raw);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        new GCMParameterSpec(128, Base64.decode(record.getString("iv"), Base64.NO_WRAP)));
    cipher.updateAAD(scope.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    return new String(
        cipher.doFinal(Base64.decode(record.getString("data"), Base64.NO_WRAP)),
        java.nio.charset.StandardCharsets.UTF_8);
  }

  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    String alias = "sekereagle-backup-v1";
    if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
    KeyGenerator generator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    generator.init(
        new KeyGenParameterSpec.Builder(
                alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
    return generator.generateKey();
  }
}
