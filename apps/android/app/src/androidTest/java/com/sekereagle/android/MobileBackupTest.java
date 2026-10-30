package com.sekereagle.android;

import static org.junit.Assert.*;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import androidx.test.platform.app.InstrumentationRegistry;
import com.sekereagle.android.core.BackupPolicy;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import org.junit.*;

/** Real Android media + SQLite + Keystore + HTTP API + private test object storage. */
public final class MobileBackupTest {

  private Instrumentation getInstrumentation() {
    return InstrumentationRegistry.getInstrumentation();
  }

  private Context context;
  private BackupSettings settings;
  private MainActivity activity;
  private String origin, scope, path;
  private final List<Uri> created = new ArrayList<>();

  @Before
  public void setUp() throws Exception {
    context = getInstrumentation().getTargetContext();
    settings = new BackupSettings(context);
    // This suite intentionally exercises the retained host after native migration.
    settings.setFlag("legacy", "web-session-cleared-v1", true);
    String[] permissions =
        android.os.Build.VERSION.SDK_INT >= 33
            ? new String[] {
              android.Manifest.permission.READ_MEDIA_IMAGES,
              android.Manifest.permission.READ_MEDIA_VIDEO,
            }
            : new String[] {android.Manifest.permission.READ_EXTERNAL_STORAGE};
    for (String permission : permissions) {
      try (android.os.ParcelFileDescriptor result =
              getInstrumentation()
                  .getUiAutomation()
                  .executeShellCommand("pm grant " + context.getPackageName() + " " + permission);
          InputStream output = new android.os.ParcelFileDescriptor.AutoCloseInputStream(result)) {
        output.readAllBytes();
      }
      assertEquals(
          android.content.pm.PackageManager.PERMISSION_GRANTED,
          context.checkSelfPermission(permission));
    }
    origin = InstrumentationRegistry.getArguments().getString("origin", "");
    if (!origin.matches("http://localhost:[0-9]+"))
      throw new IllegalArgumentException(
          "Only an explicitly supplied loopback test workbench is allowed");
    TestLoginThrottle.await();
    HttpURLConnection connection =
        (HttpURLConnection) new URL(origin + "/__test/login").openConnection();
    connection.setInstanceFollowRedirects(false);
    assertEquals(302, connection.getResponseCode());
    List<String> cookies = new ArrayList<>();
    for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet())
      if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie"))
        cookies.addAll(header.getValue());
    connection.disconnect();
    CountDownLatch latch = new CountDownLatch(cookies.size());
    getInstrumentation()
        .runOnMainSync(
            () -> {
              for (String cookie : cookies)
                CookieManager.getInstance().setCookie(origin, cookie, value -> latch.countDown());
            });
    assertTrue(latch.await(10, TimeUnit.SECONDS));
    CookieManager.getInstance().flush();
    settings.origin(origin);
    settings.active("");
    launch();
    waitUntil(() -> !settings.active().isEmpty(), 15000, "authenticated identity");
    scope = settings.active();
    JSONObject token =
        new ApiClient(origin, "")
            .request(
                "POST",
                "/api/tokens",
                new JSONObject()
                    .put("name", "Android isolated test")
                    .put("scopes", new JSONArray().put("asset:write")));
    settings.saveToken(scope, token.getString("token"));
    settings.setFlag(scope, "enabled", true);
    settings.setFlag(scope, "auto", false);
    settings.setFlag(scope, "userPaused", false);
    settings.setFlag(scope, "wifi", false);
    path = "Pictures/SekerEagleTest-" + UUID.randomUUID() + "/";
    settings.rules(scope, new JSONArray());
    settings.setFlag(scope, "allMedia", false);
    try (BackupJournal journal = new BackupJournal(context)) {
      journal.forget(scope);
    }
  }

  @Test
  public void revokingPhoneBackupAuthorizationInvalidatesOnlyItsSavedToken() throws Exception {
    String token = settings.token(scope);
    JSONObject other =
        new ApiClient(origin, "")
            .request(
                "POST",
                "/api/tokens",
                new JSONObject()
                    .put("name", "Independent acceptance token")
                    .put("scopes", new JSONArray().put("asset:write")));
    getInstrumentation().runOnMainSync(() -> activity.revokeBackupAuthorization());
    waitUntil(() -> settings.token(scope).isEmpty(), 15000, "server revocation confirmation");
    assertFalse(settings.flag(scope, "enabled", true));
    assertFalse(settings.flag(scope, "auto", true));
    ApiClient.Failure failure =
        assertThrows(
            ApiClient.Failure.class,
            () -> new ApiClient(origin, token).request("GET", "/api/auth/me", null));
    assertEquals(401, failure.status);
    assertNotNull(
        new ApiClient(origin, other.getString("token")).request("GET", "/api/auth/me", null));
    new ApiClient(origin, other.getString("token")).request("DELETE", "/api/tokens/current", null);
  }

  private void launch() {
    activity =
        (MainActivity)
            getInstrumentation()
                .startActivitySync(
                    new Intent(context, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    getInstrumentation().waitForIdleSync();
  }

  private interface Check {
    boolean value() throws Exception;
  }

  private void waitUntil(Check check, long timeout, String label) throws Exception {
    long end = System.currentTimeMillis() + timeout;
    while (System.currentTimeMillis() < end) {
      if (check.value()) return;
      Thread.sleep(100);
    }
    fail("Timed out: " + label + "; " + settings.value(scope == null ? "" : scope, "status", ""));
  }

  private Uri image(String name, int color, boolean publish) throws Exception {
    Bitmap bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(color);
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
    bitmap.recycle();
    return media(name, "image/png", bytes.toByteArray(), publish);
  }

  private Uri media(String name, String mime, byte[] bytes, boolean publish) throws Exception {
    ContentValues values = new ContentValues();
    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
    values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
    values.put(MediaStore.MediaColumns.RELATIVE_PATH, path);
    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
    Uri collection =
        path.startsWith("Download/")
            ? MediaStore.Downloads.EXTERNAL_CONTENT_URI
            : mime.startsWith("video/")
                ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    Uri uri = context.getContentResolver().insert(collection, values);
    assertNotNull(uri);
    created.add(uri);
    try (OutputStream output = context.getContentResolver().openOutputStream(uri)) {
      output.write(bytes);
    }
    if (publish) {
      ContentValues ready = new ContentValues();
      ready.put(MediaStore.MediaColumns.IS_PENDING, 0);
      context.getContentResolver().update(uri, ready, null, null);
    }
    return uri;
  }

  private String hash(Uri uri) throws Exception {
    MessageDigest hash = MessageDigest.getInstance("SHA-256");
    try (InputStream input = context.getContentResolver().openInputStream(uri)) {
      byte[] buffer = new byte[8192];
      int n;
      while ((n = input.read(buffer)) != -1) hash.update(buffer, 0, n);
    }
    return BackupPolicy.hex(hash.digest());
  }

  private long size(Uri uri) throws Exception {
    long size = 0;
    try (InputStream input = context.getContentResolver().openInputStream(uri)) {
      byte[] bytes = new byte[8192];
      int n;
      while ((n = input.read(bytes)) != -1) size += n;
    }
    return size;
  }

  private boolean exists(Uri uri, String library) throws Exception {
    return new ApiClient(origin, settings.token(scope))
        .request(
            "POST",
            "/api/" + library + "/uploads/check-content",
            new JSONObject().put("contentSha256", hash(uri)).put("size", size(uri)))
        .getBoolean("exists");
  }

  private static Object serviceField(Object service, String name) throws Exception {
    java.lang.reflect.Field field = BackupService.class.getDeclaredField(name);
    field.setAccessible(true);
    return field.get(service);
  }

  private static BackupService currentBackup() throws Exception {
    return (BackupService) serviceField(null, "current");
  }

  // Hold the actual serial worker, without adding test hooks to the application.
  private CountDownLatch holdBackupExecutor() throws Exception {
    ExecutorService executor = (ExecutorService) serviceField(null, "executor");
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    executor.execute(
        () -> {
          entered.countDown();
          try {
            release.await();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
        });
    assertTrue(entered.await(5, TimeUnit.SECONDS));
    return release;
  }

  private void runScan() throws Exception {
    String previous = settings.value(scope, "lastFinished", "");
    getInstrumentation()
        .runOnMainSync(
            () -> {
              activity.startBackup();
              activity.startBackup();
            });
    waitUntil(
        () ->
            !settings.value(scope, "lastFinished", "").equals(previous)
                && !BackupService.isRunning(scope)
                && currentBackup() == null,
        90000,
        "backup completion");
    assertEquals("备份完成", settings.value(scope, "status", ""));
  }

  @Test
  public void testLibraryHasNoNativeTitleAndReturnsToTheSameWorkspace() throws Exception {
    getInstrumentation()
        .runOnMainSync(
            () -> {
              activity.show("library");
              android.view.View root = activity.findViewById(android.R.id.content);
              assertNull(root.findViewWithTag("backup-action"));
              assertNull(root.findViewWithTag("account-action"));
              android.webkit.WebView workspace = findWorkspace(root);
              assertNotNull(workspace);
              activity.show("backup");
              assertNotNull(root.findViewWithTag("backup-auto"));
              root.findViewWithTag("back-action").performClick();
              assertSame(workspace, findWorkspace(root));
              activity.show("cleanup");
              assertNotNull(root.findViewWithTag("cleanup-action"));
              root.findViewWithTag("back-action").performClick();
              assertSame(workspace, findWorkspace(root));
              activity.show("server");
              assertNotNull(root.findViewWithTag("server-address"));
            });
  }

  @Test
  public void testCleanupOnlyAcceptsConfirmedUnchangedFilesWithLiveServerCopies() throws Exception {
    Uri original = image("cleanup-backed-up.png", 0xff123456, true);
    image("cleanup-not-backed-up.png", 0xff654321, true);
    MediaCatalog catalog = new MediaCatalog(context);
    MediaCatalog.Item item =
        new MediaCatalog.Item(
            android.content.ContentUris.withAppendedId(
                MediaStore.Files.getContentUri("external"),
                android.content.ContentUris.parseId(original)),
            "cleanup-backed-up.png",
            path,
            "image/png",
            size(original),
            modified(original),
            false);
    checkCleanupEligibility(catalog, item, false);
    BackupScreen.addRule(settings, scope, "media", path);
    runScan();
    checkCleanupEligibility(catalog, item, true);
    android.app.PendingIntent prompt =
        MediaStore.createDeleteRequest(context.getContentResolver(), java.util.List.of(original));
    assertNotNull(prompt);
    // Merely building the system request never deletes a file or a server resource.
    assertTrue(exists(original, "photos"));
    try (InputStream input = context.getContentResolver().openInputStream(original)) {
      assertTrue(input.read() >= 0);
    }
    Uri changed = image("cleanup-unconfirmed.png", 0xffaa1122, true);
    MediaCatalog.Item other =
        new MediaCatalog.Item(
            changed,
            "cleanup-unconfirmed.png",
            path,
            "image/png",
            size(changed),
            modified(changed),
            false);
    checkCleanupEligibility(catalog, other, false);
  }

  private long modified(Uri uri) {
    try (android.database.Cursor cursor =
        context.getContentResolver().query(uri, new String[] {"date_modified"}, null, null, null)) {
      assertTrue(cursor.moveToFirst());
      return cursor.getLong(0) * 1000;
    }
  }

  private void checkCleanupEligibility(
      MediaCatalog catalog, MediaCatalog.Item item, boolean expected) throws Exception {
    try (BackupJournal journal = new BackupJournal(context)) {
      com.sekereagle.android.core.CleanupEngine engine =
          new com.sekereagle.android.core.CleanupEngine(
              journal,
              (mode, hash, size) ->
                  new MultipartTransport(
                          new ApiClient(origin, settings.token(scope)), mode, catalog, item)
                      .exists(hash, size),
              () -> {});
      com.sekereagle.android.core.CleanupEngine.Candidate result =
          engine.check(
              scope,
              "PHOTO",
              new com.sekereagle.android.core.BackupEngine.File(
                  item.uri.toString(),
                  item.size,
                  item.modified,
                  () -> catalog.hash(item, () -> {}),
                  () -> catalog.stable(item)));
      assertEquals(expected, result != null);
    }
  }

  @Test
  public void testMoreLinksUseRealUserNavigationToOpenNativeScreens() throws Exception {
    openMoreSection();
    waitUntil(
        () ->
            webValue("Boolean(document.querySelector('a[href=\"/_native/backup\"]'))")
                .equals("true"),
        10000,
        "native backup link");
    tapWebLink("/_native/backup");
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.view.View root = activity.findViewById(android.R.id.content);
              assertNotNull(root.findViewWithTag("backup-auto"));
              root.findViewWithTag("back-action").performClick();
            });
    Thread.sleep(300);
    tapWebLink("/_native/cleanup");
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.view.View root = activity.findViewById(android.R.id.content);
              assertNotNull(root.findViewWithTag("cleanup-action"));
              root.findViewWithTag("back-action").performClick();
            });
  }

  private String webValue(String script) throws Exception {
    CountDownLatch ready = new CountDownLatch(1);
    String[] value = {""};
    getInstrumentation()
        .runOnMainSync(
            () ->
                findWorkspace(activity.findViewById(android.R.id.content))
                    .evaluateJavascript(
                        script,
                        result -> {
                          value[0] = result;
                          ready.countDown();
                        }));
    assertTrue(ready.await(10, TimeUnit.SECONDS));
    return value[0];
  }

  private void tapWebLink(String href) throws Exception {
    CountDownLatch ready = new CountDownLatch(1);
    String[] bounds = {""};
    int[] location = new int[2];
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.webkit.WebView web =
                  findWorkspace(activity.findViewById(android.R.id.content));
              web.getLocationOnScreen(location);
              web.evaluateJavascript(
                  "(()=>{const r=document.querySelector('a[href=\""
                      + href
                      + "\"]').getBoundingClientRect();return"
                      + " [r.x+r.width/2,r.y+r.height/2,devicePixelRatio];})()",
                  value -> {
                    bounds[0] = value;
                    ready.countDown();
                  });
            });
    assertTrue(ready.await(10, TimeUnit.SECONDS));
    JSONArray point = new JSONArray(bounds[0]);
    float x = (float) (location[0] + point.getDouble(0) * point.getDouble(2)),
        y = (float) (location[1] + point.getDouble(1) * point.getDouble(2));
    long now = android.os.SystemClock.uptimeMillis();
    android.view.MotionEvent
        down =
            android.view.MotionEvent.obtain(
                now, now, android.view.MotionEvent.ACTION_DOWN, x, y, 0),
        up =
            android.view.MotionEvent.obtain(
                now, now + 60, android.view.MotionEvent.ACTION_UP, x, y, 0);
    getInstrumentation().sendPointerSync(down);
    getInstrumentation().sendPointerSync(up);
    down.recycle();
    up.recycle();
    Thread.sleep(400);
    getInstrumentation().waitForIdleSync();
  }

  @Test
  public void testReopeningAnActivityDoesNotStopAnActiveManualBackup() throws Exception {
    for (int i = 0; i < 24; i++)
      image("reopen-" + i + ".png", 0xff000000 | new Random().nextInt(0xffffff), true);
    BackupScreen.addRule(settings, scope, "media", path);
    settings.setFlag(scope, "auto", false);
    String previous = settings.value(scope, "lastFinished", "");
    getInstrumentation().runOnMainSync(activity::startBackup);
    waitUntil(() -> settings.flag(scope, "running", false), 10000, "active manual backup");
    getInstrumentation().runOnMainSync(() -> activity.finish());
    getInstrumentation().waitForIdleSync();
    launch();
    Thread.sleep(400);
    assertTrue(
        "Reopening must not cancel a manual foreground backup",
        BackupService.isRunning(scope)
            || !settings.value(scope, "lastFinished", "").equals(previous));
    waitUntil(
        () -> !settings.value(scope, "lastFinished", "").equals(previous),
        90000,
        "resumed manual backup completion");
    assertEquals("备份完成", settings.value(scope, "status", ""));
  }

  @Test
  public void testMultipartResigns403AndPersistsPermanentFailuresWithoutClearingSuccess()
      throws Exception {
    Uri uri = image("retry-part.png", 0xff123987, true);
    MediaCatalog catalog = new MediaCatalog(context);
    MediaCatalog.Item item =
        new MediaCatalog.Item(
            uri, "retry-part.png", path, "image/png", size(uri), modified(uri), false);
    String session = UUID.randomUUID().toString();
    int[] signs = {0}, puts = {0};
    boolean[] permanent = {false};
    UploadApi api =
        new UploadApi() {
          public JSONObject request(String method, String request, JSONObject body)
              throws Exception {
            assertFalse(request.contains(".."));
            if (method.equals("DELETE")) return new JSONObject();
            if (request.endsWith("/complete")) {
              if (permanent[0]) throw new ApiClient.Failure(400);
              return new JSONObject().put("assetId", UUID.randomUUID().toString());
            }
            if (request.endsWith("/parts/1")) {
              signs[0]++;
              return new JSONObject().put("uploadUrl", "signed");
            }
            if (request.endsWith("/parts")) return new JSONObject().put("parts", new JSONArray());
            return new JSONObject()
                .put("id", session)
                .put("size", item.size)
                .put("partSize", 5242880)
                .put("status", "INITIATED");
          }

          public String put(
              String url,
              InputStream input,
              long length,
              com.sekereagle.android.core.BackupEngine.Guard guard)
              throws Exception {
            if (puts[0]++ == 0)
              throw new ApiClient.Failure(
                  403, com.sekereagle.android.core.UploadFailure.Endpoint.SIGNED_PART);
            return "etag";
          }
        };
    com.sekereagle.android.core.BackupEngine.File source =
        new com.sekereagle.android.core.BackupEngine.File(
            uri.toString(), item.size, item.modified, () -> hash(uri), () -> true);
    com.sekereagle.android.core.BackupEngine.Checkpoint cp =
        new com.sekereagle.android.core.BackupEngine.Checkpoint();
    cp.hash = hash(uri);
    cp.session = "../not-a-session";
    MultipartTransport transport = new MultipartTransport(api, "PHOTO", catalog, item);
    transport.upload(source, cp, value -> {}, () -> {});
    assertEquals(2, signs[0]);
    assertFalse(settings.token(scope).isEmpty());
    permanent[0] = true;
    try (BackupJournal journal = new BackupJournal(context)) {
      String key = com.sekereagle.android.core.BackupEngine.fileKey(scope, "PHOTO", source);
      try {
        transport.upload(source, cp, value -> journal.save(key, value), () -> {});
        fail("expected terminal failure");
      } catch (com.sekereagle.android.core.BackupEngine.PermanentFailure expected) {
      }
      assertEquals("", journal.load(key).session);
      assertFalse(journal.load(key).terminalError.isEmpty());
      com.sekereagle.android.core.BackupEngine.Checkpoint success =
          new com.sekereagle.android.core.BackupEngine.Checkpoint();
      success.confirmed = true;
      journal.confirm(scope + ":PHOTO:success", scope + ":PHOTO:receipt", success);
      journal.retryFailures(scope);
      assertNull(journal.load(key));
      assertNotNull(journal.load(scope + ":PHOTO:success"));
      assertTrue(journal.contains(scope + ":PHOTO:receipt"));
    }
  }

  @Test
  public void testVersionOneJournalMigratesWithoutLosingSuccessfulReceipts() throws Exception {
    android.content.Context isolated = context.createDeviceProtectedStorageContext();
    isolated.deleteDatabase("mobile-backup.db");
    android.database.sqlite.SQLiteDatabase legacy =
        isolated.openOrCreateDatabase("mobile-backup.db", 0, null);
    legacy.execSQL(
        "CREATE TABLE files(key TEXT PRIMARY KEY, hash TEXT NOT NULL, session TEXT NOT NULL,"
            + " part_size INTEGER NOT NULL, confirmed INTEGER NOT NULL)");
    legacy.execSQL("CREATE TABLE receipts(key TEXT PRIMARY KEY)");
    legacy.execSQL("INSERT INTO files VALUES('owner:PHOTO:file','hash','',0,1)");
    legacy.execSQL("INSERT INTO receipts VALUES('owner:PHOTO:receipt')");
    legacy.setVersion(1);
    legacy.close();
    try (BackupJournal upgraded = new BackupJournal(isolated)) {
      assertTrue(upgraded.load("owner:PHOTO:file").confirmed);
      assertEquals("", upgraded.load("owner:PHOTO:file").terminalError);
      assertTrue(upgraded.contains("owner:PHOTO:receipt"));
      upgraded.retryFailures("owner");
      assertNotNull(upgraded.load("owner:PHOTO:file"));
    } finally {
      isolated.deleteDatabase("mobile-backup.db");
    }
  }

  @Test
  public void testCaptureModernScreens() throws Exception {
    org.junit.Assume.assumeTrue(
        InstrumentationRegistry.getArguments().getString("screenshots", "false").equals("true"));
    getInstrumentation().runOnMainSync(() -> activity.show("library"));
    Thread.sleep(1000);
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.webkit.WebView web =
                  findWorkspace(activity.findViewById(android.R.id.content));
              web.evaluateJavascript("window.sekerEagleI18n?.setLocale('zh-CN')", null);
            });
    Thread.sleep(4000);
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.webkit.WebView web =
                  findWorkspace(activity.findViewById(android.R.id.content));
              web.evaluateJavascript(
                  "Array.from(document.querySelectorAll('nav"
                      + " button')).find(b=>b.textContent.trim()==='照片')?.click()",
                  null);
            });
    Thread.sleep(1500);
    capture("modern-home.png");
    getInstrumentation()
        .runOnMainSync(
            () -> {
              android.webkit.WebView web =
                  findWorkspace(activity.findViewById(android.R.id.content));
              web.evaluateJavascript(
                  "document.querySelector('button[aria-label=\"视图与筛选\"]')?.click()", null);
            });
    capture("modern-tools.png");
    webScript(
        "Array.from(document.querySelectorAll('dialog"
            + " button')).find(b=>b.textContent.trim()==='完成')?.click()");
    openMoreSection();
    capture("modern-more.png");
    getInstrumentation().runOnMainSync(() -> activity.show("backup"));
    getInstrumentation().waitForIdleSync();
    capture("modern-backup.png");
    getInstrumentation().runOnMainSync(() -> activity.show("server"));
    getInstrumentation().waitForIdleSync();
    capture("modern-account.png");
    getInstrumentation().runOnMainSync(() -> activity.show("library"));
  }

  @Test
  public void testCaptureMobilePageAudit() throws Exception {
    org.junit.Assume.assumeTrue(
        InstrumentationRegistry.getArguments().getString("screenshots", "false").equals("true"));
    getInstrumentation().runOnMainSync(() -> activity.show("library"));
    webScript("window.sekerEagleI18n?.setLocale('zh-CN')");
    Thread.sleep(600);
    auditMode("照片");
    capture("audit-photo-home.png");
    webScript("document.querySelector('button[aria-label=\"搜索\"]').click()");
    capture("audit-search.png");
    webScript("document.querySelector('dialog[open] button[aria-label=\"关闭搜索\"]').click()");
    waitUntil(
        () -> webValue("Boolean(document.querySelector('[data-asset-id]'))").equals("true"),
        10000,
        "photo card");
    webScript("document.querySelector('[data-asset-id]').click()");
    Thread.sleep(1500);
    waitUntil(
        () ->
            webValue("Boolean(document.querySelector('[role=dialog] button[aria-label=\"返回\"]'))")
                .equals("true"),
        5000,
        "mobile viewer");
    capture("audit-viewer.png");
    webScript("document.querySelector('[role=dialog] details summary')?.click()");
    capture("audit-viewer-more.png");
    webScript(
        "Array.from(document.querySelectorAll('[role=dialog]"
            + " button')).find(b=>b.textContent.trim()==='编辑')?.click()");
    waitUntil(
        () -> webValue("Boolean(document.querySelector('[aria-label=\"关闭编辑器\"]'))").equals("true"),
        15000,
        "editor opened");
    capture("audit-editor.png");
    webScript("document.querySelector('button[aria-label=\"关闭编辑器\"]').click()");
    webScript("document.querySelector('[role=dialog] button[aria-label=\"返回\"]')?.click()");
    auditDestination("地图");
    capture("audit-map.png");
    auditDestination("人物");
    capture("audit-people.png");
    auditDestination("更多");
    capture("audit-more.png");
    webScript(
        "Array.from(document.querySelectorAll('section[aria-label=\"更多\"]"
            + " button')).find(b=>b.textContent.trim()==='设置')?.click()");
    Thread.sleep(700);
    capture("audit-account.png");
    int tabs =
        Integer.parseInt(
            webValue("document.querySelectorAll('[aria-label=\"账号设置分类\"] [role=tab]').length"));
    for (int index = 0; index < tabs; index++) {
      webScript(
          "document.querySelectorAll('[aria-label=\"账号设置分类\"] [role=tab]')[" + index + "].click()");
      Thread.sleep(350);
      assertEquals(
          "true",
          webValue(
              "document.querySelectorAll('[aria-label=\"账号设置分类\"] [role=tab]')["
                  + index
                  + "].getAttribute('aria-selected') === 'true'"));
      capture("audit-account-" + index + ".png");
    }
    for (String label : new String[] {"人工标签推荐", "AI 内容识别"}) {
      webScript(
          "Array.from(document.querySelectorAll('nav[aria-label=\"设置功能\"]"
              + " button')).find(b=>b.textContent.trim()==='"
              + label
              + "').click()");
      capture(label.equals("人工标签推荐") ? "audit-tag-settings.png" : "audit-ai-settings.png");
    }
    auditMode("素材");
    capture("audit-material.png");
    auditDestination("标签");
    capture("audit-tags.png");
    webScript(
        "Array.from(document.querySelectorAll('nav[aria-label=\"标签功能\"]"
            + " button')).find(b=>b.textContent.trim()==='AI 标签').click()");
    capture("audit-ai-tags.png");
    auditDestination("素材");
    webScript("document.querySelector('button[aria-label=\"视图与筛选\"]').click()");
    capture("audit-filters.png");
    webScript(
        "Array.from(document.querySelectorAll('dialog[open]"
            + " button')).find(b=>b.textContent.trim()==='完成').click()");
    for (String label : new String[] {"待处理", "回收站"}) {
      webScript("document.querySelector('button[aria-label=\"更多操作\"]').click()");
      Thread.sleep(200);
      webScript(
          "Array.from(document.querySelectorAll('dialog[open]"
              + " summary')).find(b=>b.textContent.trim()==='图库管理').click()");
      webScript(
          "Array.from(document.querySelectorAll('dialog[open]"
              + " button')).find(b=>(b.getAttribute('aria-label')||'').startsWith('"
              + label
              + "')).click()");
      capture(label.equals("待处理") ? "audit-pending.png" : "audit-trash.png");
      if (label.equals("待处理"))
        for (String tab : new String[] {"待分类", "处理任务"}) {
          webScript(
              "Array.from(document.querySelectorAll('nav[aria-label=\"待处理功能\"]"
                  + " button')).find(b=>b.textContent.trim().startsWith('"
                  + tab
                  + "')).click()");
          capture(tab.equals("待分类") ? "audit-unclassified.png" : "audit-processing.png");
        }
    }
    getInstrumentation().runOnMainSync(() -> activity.show("backup"));
    capture("audit-backup.png");
    getInstrumentation().runOnMainSync(() -> activity.show("cleanup"));
    capture("audit-cleanup.png");
    getInstrumentation().runOnMainSync(() -> activity.show("server"));
    capture("audit-connection.png");
    getInstrumentation()
        .runOnMainSync(
            () -> {
              activity.show("library");
              findWorkspace(activity.findViewById(android.R.id.content))
                  .loadUrl(origin.replace("localhost", "127.0.0.1"));
            });
    waitUntil(
        () -> webValue("Boolean(document.querySelector('input[type=password]'))").equals("true"),
        10000,
        "login layout");
    capture("audit-login.png");
    getInstrumentation()
        .runOnMainSync(
            () -> findWorkspace(activity.findViewById(android.R.id.content)).loadUrl(origin));
    getInstrumentation().runOnMainSync(() -> activity.show("library"));
  }

  @Test
  public void testSystemBackReturnsThroughSearchViewerAndSubpages() throws Exception {
    webScript("window.sekerEagleI18n?.setLocale('zh-CN')");
    Thread.sleep(600);
    auditMode("照片");
    webScript("document.querySelector('button[aria-label=\"搜索\"]').click()");
    waitUntil(
        () -> webValue("Boolean(document.querySelector('dialog[open]'))").equals("true"),
        5000,
        "search opened");
    getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitUntil(
        () -> webValue("Boolean(document.querySelector('dialog[open]'))").equals("false"),
        5000,
        "back closes search");
    assertFalse(activity.isFinishing());
    auditDestination("更多");
    getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitUntil(
        () ->
            webValue("Boolean(document.querySelector('section[aria-label=\"更多\"]'))")
                .equals("false"),
        5000,
        "back returns from more");
    webScript("document.querySelector('[data-asset-id]').click()");
    waitUntil(
        () -> webValue("Boolean(document.querySelector('[role=dialog]'))").equals("true"),
        5000,
        "viewer opened");
    getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    waitUntil(
        () -> webValue("Boolean(document.querySelector('[role=dialog]'))").equals("false"),
        5000,
        "back closes viewer");
    assertFalse(activity.isFinishing());
    getInstrumentation()
        .runOnMainSync(
            () -> {
              activity.show("backup");
              activity.show("server");
            });
    getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    getInstrumentation().waitForIdleSync();
    getInstrumentation()
        .runOnMainSync(
            () ->
                assertNotNull(
                    activity.findViewById(android.R.id.content).findViewWithTag("backup-auto")));
    getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK);
    getInstrumentation().waitForIdleSync();
    assertFalse(activity.isFinishing());
  }

  private void auditMode(String label) throws Exception {
    webScript(
        "Array.from(document.querySelectorAll('nav[aria-label=\"图库模式\"]"
            + " button')).find(b=>b.textContent.trim()==='"
            + label
            + "').click()");
    Thread.sleep(700);
  }

  private void auditDestination(String label) throws Exception {
    webScript("document.querySelector('button[aria-label=\"更多操作\"]').click()");
    waitUntil(
        () -> webValue("Boolean(document.querySelector('dialog[open] nav'))").equals("true"),
        5000,
        "navigation menu");
    webScript(
        "Array.from(document.querySelectorAll('dialog[open] nav"
            + " button')).find(b=>b.textContent.trim()==='"
            + label
            + "').click()");
    Thread.sleep(500);
  }

  private void openMoreSection() throws Exception {
    String selector = "button[aria-label=\"更多操作\"],button[aria-label=\"More actions\"]";
    waitUntil(
        () -> webValue("Boolean(document.querySelector('" + selector + "'))").equals("true"),
        15000,
        "actions trigger");
    webScript("document.querySelector('" + selector + "').click()");
    waitUntil(
        () ->
            webValue("Boolean(document.querySelector('dialog[open] nav button:last-child'))")
                .equals("true"),
        10000,
        "actions destinations");
    if (InstrumentationRegistry.getArguments().getString("screenshots", "false").equals("true"))
      capture("modern-navigation.png");
    webScript("document.querySelector('dialog[open] nav button:last-child').click()");
  }

  private void webScript(String script) {
    getInstrumentation()
        .runOnMainSync(
            () ->
                findWorkspace(activity.findViewById(android.R.id.content))
                    .evaluateJavascript(script, null));
  }

  private void capture(String name) throws Exception {
    Thread.sleep(400);
    Bitmap bitmap = getInstrumentation().getUiAutomation().takeScreenshot();
    assertNotNull(bitmap);
    try (OutputStream output =
        new FileOutputStream(new File(context.getExternalFilesDir(null), name))) {
      assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
    }
    bitmap.recycle();
  }

  private static android.webkit.WebView findWorkspace(android.view.View view) {
    if (view instanceof android.webkit.WebView) return (android.webkit.WebView) view;
    if (view instanceof android.view.ViewGroup) {
      android.view.ViewGroup group = (android.view.ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) {
        android.webkit.WebView result = findWorkspace(group.getChildAt(i));
        if (result != null) return result;
      }
    }
    return null;
  }

  @Test
  public void testIncrementalDuplicateRenameModesPendingAndAutomaticReopen() throws Exception {
    int color = 0xff000000 | new Random().nextInt(0xffffff);
    Uri first = image("original.png", color, true);
    image("same-content-new-name.png", color, true);
    Uri pending = image("still-writing.png", color ^ 0x555555, false);
    assertTrue(new MediaCatalog(context).folders().contains(path));
    assertFalse(exists(first, "photos"));
    assertFalse(exists(first, "eagle"));
    BackupScreen.addRule(settings, scope, "media", path);
    runScan();
    assertTrue(exists(first, "photos"));
    assertFalse(exists(first, "eagle"));
    assertTrue(settings.value(scope, "counts", "").contains("已上传 1"));
    assertTrue(settings.value(scope, "counts", "").contains("已存在 1"));
    runScan();
    assertTrue(settings.value(scope, "counts", "").contains("已上传 0"));
    assertTrue(settings.value(scope, "counts", "").contains("已存在 2"));
    ContentValues renamed = new ContentValues();
    renamed.put(MediaStore.MediaColumns.DISPLAY_NAME, "renamed.png");
    context.getContentResolver().update(first, renamed, null, null);
    runScan();
    assertTrue(settings.value(scope, "counts", "").contains("已上传 0"));
    Uri later = image("new-after-first-scan.png", color ^ 0x111111, true);
    String previous = settings.value(scope, "lastFinished", "");
    settings.setFlag(scope, "auto", true);
    getInstrumentation().runOnMainSync(() -> activity.finish());
    getInstrumentation().waitForIdleSync();
    launch();
    waitUntil(
        () ->
            !settings.value(scope, "lastFinished", "").equals(previous)
                && !settings.flag(scope, "running", false),
        90000,
        "open automatically backs up new image");
    assertTrue(exists(later, "photos"));
    assertTrue(settings.value(scope, "counts", "").contains("已上传 1"));
    assertFalse(exists(pending, "photos"));
    settings.setFlag(scope, "auto", false);
    JSONArray rules = settings.rules(scope);
    rules.getJSONObject(0).put("mode", "MATERIAL");
    settings.rules(scope, rules);
    runScan();
    assertTrue(exists(first, "eagle"));
    assertTrue(exists(first, "photos"));
    getInstrumentation().runOnMainSync(() -> activity.show("backup"));
    getInstrumentation().waitForIdleSync();
  }

  @Test
  public void testFolderSelectionAddsWithoutRemovingAndAllIncludesNewAlbums() throws Exception {
    image("chosen-folder.png", 0xff123456, true);
    final String first = path;
    BackupScreen.addRule(settings, scope, "media", first);
    JSONArray initial = settings.rules(scope);
    initial.getJSONObject(0).put("mode", "MATERIAL");
    settings.rules(scope, initial);
    path = "Download/SekerEagleFuture-" + UUID.randomUUID() + "/";
    final String second = path;
    final String future = "future-" + UUID.randomUUID() + ".png";
    image(future, 0xff663322, true);
    getInstrumentation().runOnMainSync(() -> activity.show("backup"));
    androidx.test.espresso.Espresso.onView(
            androidx.test.espresso.matcher.ViewMatchers.withText("添加手机相册"))
        .perform(
            androidx.test.espresso.action.ViewActions.scrollTo(),
            androidx.test.espresso.action.ViewActions.click());
    androidx.test.espresso.Espresso.onData(org.hamcrest.Matchers.equalTo(second))
        .perform(androidx.test.espresso.action.ViewActions.click());
    androidx.test.espresso.Espresso.onView(
            androidx.test.espresso.matcher.ViewMatchers.withText("添加（1）"))
        .perform(androidx.test.espresso.action.ViewActions.click());
    assertEquals(2, settings.rules(scope).length());
    assertEquals("MATERIAL", settings.rules(scope).getJSONObject(0).getString("mode"));
    assertEquals(first, settings.rules(scope).getJSONObject(0).getString("path"));
    // All is a reversible override, not a destructive replacement of the chosen list.
    getInstrumentation().runOnMainSync(() -> activity.show("backup"));
    androidx.test.espresso.Espresso.onView(
            androidx.test.espresso.matcher.ViewMatchers.withContentDescription("备份全部照片和视频"))
        .perform(
            androidx.test.espresso.action.ViewActions.scrollTo(),
            androidx.test.espresso.action.ViewActions.click());
    assertTrue(settings.flag(scope, "allMedia", false));
    if (InstrumentationRegistry.getArguments().getString("screenshots", "false").equals("true")) {
      androidx.test.espresso.Espresso.onView(
              androidx.test.espresso.matcher.ViewMatchers.withText("添加手机相册"))
          .perform(androidx.test.espresso.action.ViewActions.scrollTo());
      capture("native-backup-folders.png");
    }
    String third = "Pictures/SekerEagleNew-" + UUID.randomUUID() + "/";
    path = third;
    String addedLater = "new-album-" + UUID.randomUUID() + ".png";
    image(addedLater, 0xff998833, true);
    try {
      Map<String, String> scanned = new HashMap<>();
      new MediaCatalog(context)
          .scan(settings.scanRules(scope), (item, mode) -> scanned.put(item.name, mode), () -> {});
      assertEquals("PHOTO", scanned.get(addedLater));
      assertEquals(2, settings.rules(scope).length());
      assertEquals("MATERIAL", settings.rules(scope).getJSONObject(0).getString("mode"));
      settings.setFlag(scope, "allMedia", false);
      scanned.clear();
      new MediaCatalog(context)
          .scan(settings.scanRules(scope), (item, mode) -> scanned.put(item.name, mode), () -> {});
      assertFalse(scanned.containsKey(addedLater));
      assertTrue(scanned.containsKey(future));
      assertFalse(new BackupSettings(context).flag("another-identity", "allMedia", false));
    } finally {
      settings.setFlag(scope, "allMedia", false);
    }
  }

  @Test
  public void testRawAndVideoPreserveOriginalBytes() throws Exception {
    List<Uri> files = new ArrayList<>();
    for (String[] format :
        new String[][] {
          {"synthetic.dng", "image/x-adobe-dng"},
          {"synthetic.mp4", "video/mp4"},
        }) {
      byte[] bytes;
      try (InputStream input = getInstrumentation().getContext().getAssets().open(format[0])) {
        bytes = input.readAllBytes();
      }
      files.add(media(format[0], format[1], bytes, true));
    }
    BackupScreen.addRule(settings, scope, "media", path);
    runScan();
    for (Uri uri : files) assertTrue(exists(uri, "photos"));
    runScan();
    assertTrue(settings.value(scope, "counts", "").contains("已上传 0"));
    assertTrue(settings.value(scope, "counts", "").contains("已存在 2"));
  }

  @Test
  public void testDownloadedImagesRespectSelectedFolders() throws Exception {
    String chosen = "Download/SekerEagleTest-" + UUID.randomUUID() + "/";
    path = chosen;
    int color = 0xff000000 | new Random().nextInt(0xffffff);
    Uri downloaded = image("downloaded.png", color, true);
    path = "Pictures/SekerEagleExcluded-" + UUID.randomUUID() + "/";
    Uri excluded = image("excluded.png", color ^ 0x333333, true);
    BackupScreen.addRule(settings, scope, "media", chosen);
    runScan();
    assertTrue(exists(downloaded, "photos"));
    assertFalse(exists(excluded, "photos"));
    assertTrue(settings.value(scope, "counts", "").contains("扫描 1"));
  }

  @Test
  public void testMultipartInterruptionResumesPersistedSession() throws Exception {
    int width = 1600, height = 1200;
    int[] pixels = new int[width * height];
    Random random = new Random();
    for (int i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | random.nextInt(0xffffff);
    Bitmap bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes);
    bitmap.recycle();
    Uri uri = media("multipart.png", "image/png", bytes.toByteArray(), true);
    assertTrue(size(uri) > 5242880);
    BackupScreen.addRule(settings, scope, "media", path);
    MediaCatalog catalog = new MediaCatalog(context);
    List<MediaCatalog.Item> selected = new ArrayList<>();
    catalog.scan(settings.rules(scope), (item, mode) -> selected.add(item), () -> {});
    assertEquals(1, selected.size());
    MediaCatalog.Item item = selected.get(0);
    ApiClient api = new ApiClient(origin, settings.token(scope));
    MultipartTransport transport = new MultipartTransport(api, "PHOTO", catalog, item);
    com.sekereagle.android.core.BackupEngine.File file =
        new com.sekereagle.android.core.BackupEngine.File(
            item.uri.toString(),
            item.size,
            item.modified,
            () -> catalog.hash(item, () -> {}),
            () -> catalog.stable(item));
    String key =
        scope + ":PHOTO:" + BackupPolicy.digest(file.uri + "\n" + file.size + "\n" + file.modified);
    String session;
    try (BackupJournal journal = new BackupJournal(context)) {
      com.sekereagle.android.core.BackupEngine.Transport interrupted =
          new com.sekereagle.android.core.BackupEngine.Transport() {
            public boolean exists(String hash, long size) throws Exception {
              return transport.exists(hash, size);
            }

            public void upload(
                com.sekereagle.android.core.BackupEngine.File source,
                com.sekereagle.android.core.BackupEngine.Checkpoint cp,
                com.sekereagle.android.core.BackupEngine.Save save,
                com.sekereagle.android.core.BackupEngine.Guard guard)
                throws Exception {
              java.util.concurrent.atomic.AtomicInteger completedParts =
                  new java.util.concurrent.atomic.AtomicInteger();
              UploadApi observed =
                  new UploadApi() {
                    public JSONObject request(String method, String path, JSONObject body)
                        throws Exception {
                      return api.request(method, path, body);
                    }

                    public String put(
                        String url,
                        InputStream input,
                        long size,
                        com.sekereagle.android.core.BackupEngine.Guard check)
                        throws Exception {
                      String etag = api.put(url, input, size, check);
                      completedParts.incrementAndGet();
                      return etag;
                    }
                  };
              new MultipartTransport(observed, "PHOTO", catalog, item)
                  .upload(
                      source,
                      cp,
                      save,
                      () -> {
                        if (completedParts.get() > 0) throw new IOException("test interruption");
                      });
            }
          };
      try {
        new com.sekereagle.android.core.BackupEngine(journal, interrupted, () -> {})
            .process(scope, "PHOTO", file);
        fail("Expected interrupted upload");
      } catch (IOException expected) {
      }
      com.sekereagle.android.core.BackupEngine.Checkpoint cp = journal.load(key);
      assertNotNull(cp);
      assertFalse(cp.confirmed);
      session = cp.session;
      assertFalse(session.isEmpty());
      assertTrue(
          api.request("GET", "/api/photos/uploads/" + session + "/parts", null)
                  .getJSONArray("parts")
                  .length()
              >= 1);
    }
    try (BackupJournal restored = new BackupJournal(context)) {
      assertEquals(
          com.sekereagle.android.core.BackupEngine.Result.UPLOADED,
          new com.sekereagle.android.core.BackupEngine(restored, transport, () -> {})
              .process(scope, "PHOTO", file));
      assertEquals(session, restored.load(key).session);
      assertTrue(restored.load(key).confirmed);
    }
    assertEquals(
        "COMPLETED",
        api.request("GET", "/api/photos/uploads/" + session, null).getString("status"));
    assertTrue(exists(uri, "photos"));
    assertEquals(file.hash.read(), hash(uri));
  }

  @Test
  public void testInterruptedStatusDoesNotLockTheNextLaunch() throws Exception {
    settings.setFlag(scope, "running", true);
    getInstrumentation().runOnMainSync(() -> activity.finish());
    getInstrumentation().waitForIdleSync();
    launch();
    assertFalse(settings.flag(scope, "running", false));
  }

  @Test
  public void immediatePauseAndResumeRetiresTheLatestServiceStart() throws Exception {
    Uri file = image("handoff.png", 0xff174938, true);
    BackupScreen.addRule(settings, scope, "media", path);
    settings.setValue(scope, "lastFinished", "historical-completion");
    String previous = settings.value(scope, "lastFinished", "");
    CountDownLatch release = holdBackupExecutor();
    try {
      getInstrumentation().runOnMainSync(() -> activity.startBackup());
      waitUntil(() -> BackupService.isRunning(scope), 15000, "backup run started");
      getInstrumentation()
          .runOnMainSync(
              () -> {
                activity.pause();
                activity.startBackup();
                activity.startBackup();
              });
      waitUntil(
          () -> serviceField(currentBackup(), "pendingRestart") != null, 15000, "resume queued");
      // The held initial run cannot have uploaded this file or completed the scan.
      assertFalse(exists(file, "photos"));
      assertEquals(previous, settings.value(scope, "lastFinished", ""));
    } finally {
      release.countDown();
    }
    waitUntil(
        () ->
            !settings.value(scope, "lastFinished", "").equals(previous) && currentBackup() == null,
        30000,
        "resumed run completed and retired");
    assertEquals("备份完成", settings.value(scope, "status", ""));
    assertFalse(settings.flag(scope, "userPaused", true));
    assertTrue(exists(file, "photos"));
  }

  @Test
  public void runningInternalCancelStopsWithoutCreatingAUserPause() throws Exception {
    cancelRunningBackup(false);
  }

  @Test
  public void runningInternalCancelPreservesPauseAndClearsAPendingResume() throws Exception {
    cancelRunningBackup(true);
  }

  private void cancelRunningBackup(boolean userPaused) throws Exception {
    BackupScreen.addRule(settings, scope, "media", path);
    String previous = settings.value(scope, "lastFinished", "");
    CountDownLatch release = holdBackupExecutor();
    try {
      getInstrumentation().runOnMainSync(() -> activity.startBackup());
      waitUntil(() -> BackupService.isRunning(scope), 15000, "running internal cancel");
      BackupService service = currentBackup();
      getInstrumentation()
          .runOnMainSync(
              () -> {
                if (userPaused) {
                  activity.pause();
                  try {
                    service.onStartCommand(
                        new Intent(context, BackupService.class)
                            .putExtra("scope", scope)
                            .putExtra("manual", true),
                        0,
                        (int) serviceField(service, "latestStartId"));
                    assertNotNull(serviceField(service, "pendingRestart"));
                  } catch (Exception e) {
                    throw new AssertionError(e);
                  }
                }
                activity.cancelBackup();
                assertEquals(userPaused, settings.flag(scope, "userPaused", false));
                assertEquals(userPaused ? "备份已暂停" : "备份已停止", settings.value(scope, "status", ""));
              });
    } finally {
      release.countDown();
    }
    waitUntil(() -> currentBackup() == null, 15000, "internally cancelled run retired");
    assertEquals(userPaused, settings.flag(scope, "userPaused", false));
    assertEquals(userPaused ? "备份已暂停" : "备份已停止", settings.value(scope, "status", ""));
    assertEquals(previous, settings.value(scope, "lastFinished", ""));
  }

  @Test
  public void automaticStartDuringNormalRetirementIsNotLost() throws Exception {
    BackupScreen.addRule(settings, scope, "media", path);
    String previous = settings.value(scope, "lastFinished", "");
    CountDownLatch release = holdBackupExecutor();
    Uri[] nextFile = {null};
    try {
      getInstrumentation().runOnMainSync(() -> activity.startBackup());
      waitUntil(() -> BackupService.isRunning(scope), 15000, "initial empty scan started");
      BackupService service = currentBackup();
      ExecutorService executor = (ExecutorService) serviceField(null, "executor");
      CompletableFuture<Void> retiredWorker = new CompletableFuture<>();
      executor.execute(() -> retiredWorker.complete(null));
      getInstrumentation()
          .runOnMainSync(
              () -> {
                release.countDown();
                try {
                  // The main looper is deliberately held here: the real worker has finished,
                  // but its completion callback cannot hand off the service until we return.
                  retiredWorker.get(4, TimeUnit.SECONDS);
                  assertFalse(previous.equals(settings.value(scope, "lastFinished", "")));
                  assertSame(service, currentBackup());
                  nextFile[0] = image("after-retirement.png", 0xff834123, true);
                  settings.setValue(scope, "lastFinished", "first-run-completed");
                  service.onStartCommand(
                      new Intent(context, BackupService.class)
                          .putExtra("scope", scope)
                          .putExtra("manual", false),
                      0,
                      (int) serviceField(service, "latestStartId"));
                } catch (Exception e) {
                  throw new AssertionError(e);
                }
              });
    } finally {
      release.countDown();
    }
    waitUntil(
        () ->
            !settings.value(scope, "lastFinished", "").equals("first-run-completed")
                && currentBackup() == null,
        15000,
        "queued automatic scan completed");
    assertEquals("备份完成", settings.value(scope, "status", ""));
    assertTrue(exists(nextFile[0], "photos"));
  }

  @Test
  public void internalStopDoesNotBecomeADurableUserPause() throws Exception {
    getInstrumentation().runOnMainSync(() -> activity.enable(false));
    assertFalse(settings.flag(scope, "userPaused", false));
    settings.setFlag(scope, "userPaused", true);
    getInstrumentation().runOnMainSync(() -> activity.enable(false));
    assertTrue(settings.flag(scope, "userPaused", false));
  }

  @Test
  public void userPauseSurvivesAutomaticReopenAndExplicitRunCanResume() throws Exception {
    image("pause-reopen.png", 0xff174938, true);
    BackupScreen.addRule(settings, scope, "media", path);
    runScan();
    String finished = settings.value(scope, "lastFinished", "");
    String counts = settings.value(scope, "counts", "");
    getInstrumentation().runOnMainSync(() -> activity.pause());
    assertTrue(new BackupSettings(context).flag(scope, "userPaused", false));
    settings.setFlag(scope, "auto", true);
    getInstrumentation().runOnMainSync(() -> activity.finish());
    getInstrumentation().waitForIdleSync();
    launch();
    Thread.sleep(1500);
    assertEquals(finished, settings.value(scope, "lastFinished", ""));
    assertEquals(counts, settings.value(scope, "counts", ""));
    assertFalse(BackupService.isRunning(scope));
    settings.setFlag(scope, "auto", false);
    runScan();
    assertFalse(settings.flag(scope, "userPaused", true));
  }

  @Test
  public void testKeystoreAndJournalNeverCrossScopes() throws Exception {
    assertFalse(settings.token(scope).isEmpty());
    assertEquals("", settings.token("other-owner"));
    try (BackupJournal journal = new BackupJournal(context)) {
      com.sekereagle.android.core.BackupEngine.Checkpoint cp =
          new com.sekereagle.android.core.BackupEngine.Checkpoint();
      cp.hash = "a".repeat(64);
      cp.confirmed = true;
      journal.confirm(scope + ":PHOTO:file", scope + ":PHOTO:hash", cp);
      assertNull(journal.load("other:PHOTO:file"));
      assertFalse(journal.contains(scope + ":MATERIAL:hash"));
      assertTrue(journal.contains(scope + ":PHOTO:hash"));
    }
  }

  @After
  public void tearDown() throws Exception {
    context.stopService(new Intent(context, BackupService.class));
    settings.setFlag(scope, "auto", false);
    for (Uri uri : created) context.getContentResolver().delete(uri, null, null);
    if (activity != null) getInstrumentation().runOnMainSync(() -> activity.finish());
  }
}
