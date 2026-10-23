package com.sekereagle.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import com.sekereagle.android.core.BackupPolicy;
import java.util.concurrent.*;
import org.json.*;

/** Same authenticated Web workspace, with a native backup surface and no JavaScript bridge. */
public final class MainActivity extends Activity {
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private BackupSettings settings;
  private boolean nativeHost;
  private LinearLayout root, body, appBar;
  private WebView web;
  private BackupScreen backup;
  private CleanupScreen cleanup;
  private String currentTab = "library", activeScope = "", pendingTreeScope = "";
  private boolean resumed, checking, autoPending, backPending;
  private final java.util.ArrayDeque<String> nativeBackStack = new java.util.ArrayDeque<>();
  private long nextCheck;
  private ValueCallback<Uri[]> chooser;
  private final Runnable tick =
      new Runnable() {
        @Override
        public void run() {
          if (!resumed) return;
          if (backup != null && currentTab.equals("backup")) backup.refreshStatus();
          if (System.currentTimeMillis() >= nextCheck) {
            nextCheck = System.currentTimeMillis() + 5000;
            checkIdentity();
          }
          handler.postDelayed(this, 1000);
        }
      };

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    settings = new BackupSettings(this);
    nativeHost = getIntent().getBooleanExtra("nativeHost", false);
    activeScope = settings.active();
    autoPending = true;
    if (!settings.active().isEmpty() && !BackupService.isRunning(settings.active())) {
      settings.setFlag(settings.active(), "running", false);
    }
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Ui.BG);
    root.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          android.graphics.Insets padding =
              insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
          view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
          return insets;
        });
    setContentView(root);
    appBar = new LinearLayout(this);
    appBar.setGravity(Gravity.CENTER_VERTICAL);
    appBar.setPadding(Ui.dp(this, 8), 0, Ui.dp(this, 8), 0);
    root.addView(appBar, new LinearLayout.LayoutParams(-1, Ui.dp(this, 52)));
    body = new LinearLayout(this);
    body.setOrientation(LinearLayout.VERTICAL);
    root.addView(body, new LinearLayout.LayoutParams(-1, 0, 1));
    if (Build.VERSION.SDK_INT >= 33)
      getOnBackInvokedDispatcher()
          .registerOnBackInvokedCallback(
              android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    if (nativeHost) {
      show("cleanup".equals(getIntent().getStringExtra("screen")) ? "cleanup" : "backup");
      return;
    }
    setupWeb();
    if (settings.origin().isEmpty()) show("server");
    else {
      web.loadUrl(settings.origin());
      show("library");
    }
  }

  @SuppressWarnings("SetJavaScriptEnabled")
  private void setupWeb() {
    web = new WebView(this);
    WebSettings config = web.getSettings();
    config.setJavaScriptEnabled(true);
    config.setDomStorageEnabled(true);
    config.setUserAgentString(
        config.getUserAgentString() + " SekerEagleAndroid/" + BuildConfig.VERSION_NAME + "");
    config.setAllowFileAccess(false);
    config.setAllowContentAccess(false);
    config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    config.setSupportMultipleWindows(false);
    config.setMediaPlaybackRequiresUserGesture(true);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    web.setBackgroundColor(Ui.BG);
    web.setWebViewClient(
        new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String screen =
                com.sekereagle.android.core.NativeRoute.screen(
                    settings.origin(),
                    view.getUrl(),
                    request.getUrl().toString(),
                    request.isForMainFrame(),
                    request.hasGesture());
            if (!screen.isEmpty()) {
              show(screen);
              return true;
            }
            String scheme = request.getUrl().getScheme();
            if (request.isForMainFrame() && !sameOrigin(request.getUrl())) {
              if ("https".equals(scheme))
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
              return true;
            }
            return false;
          }

          @Override
          public void onPageFinished(WebView view, String url) {
            nextCheck = 0;
          }
        });
    web.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
            if (chooser != null) chooser.onReceiveValue(null);
            chooser = callback;
            try {
              startActivityForResult(parameters.createIntent(), 71);
            } catch (ActivityNotFoundException e) {
              chooser.onReceiveValue(null);
              chooser = null;
            }
            return true;
          }
        });
    web.setDownloadListener(
        (url, userAgent, disposition, mime, length) -> {
          try {
            Uri uri = Uri.parse(url);
            if (!sameOrigin(uri)) throw new IllegalArgumentException("下载地址不属于当前服务");
            android.app.DownloadManager.Request request =
                new android.app.DownloadManager.Request(uri);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) request.addRequestHeader("Cookie", cookies);
            request.addRequestHeader("User-Agent", userAgent);
            request.setMimeType(mime);
            request.setNotificationVisibility(
                android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime));
            getSystemService(android.app.DownloadManager.class).enqueue(request);
          } catch (Exception e) {
            toast("下载暂不可用，请稍后重试");
          }
        });
  }

  private boolean sameOrigin(Uri uri) {
    try {
      Uri expected = Uri.parse(settings.origin());
      return expected.getScheme().equals(uri.getScheme())
          && expected.getHost().equals(uri.getHost())
          && expected.getPort() == uri.getPort()
          && uri.getUserInfo() == null;
    } catch (Exception e) {
      return false;
    }
  }

  SessionApi sessionApi() {
    return nativeHost
        ? NativeSession.open(this, settings.origin())
        : new ApiClient(settings.origin(), "");
  }

  private JSONObject sessionRequest(String method, String path, JSONObject body) throws Exception {
    return sessionApi().request(method, path, body);
  }

  void show(String tab) {
    if (nativeHost && (tab.equals("library") || tab.equals("server"))) {
      finish();
      return;
    }
    if (tab.equals("library")) nativeBackStack.clear();
    else if (!tab.equals(currentTab)
        && !settings.origin().isEmpty()
        && (!nativeHost || !currentTab.equals("library"))) nativeBackStack.push(currentTab);
    renderTab(tab);
  }

  private void renderTab(String tab) {
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    currentTab = tab;
    renderAppBar();
    body.removeAllViews();
    backup = null;
    cleanup = null;
    if (tab.equals("library")) {
      if (settings.origin().isEmpty()) {
        show("server");
        return;
      }
      body.addView(web, new LinearLayout.LayoutParams(-1, -1));
    } else if (tab.equals("backup")) {
      backup = new BackupScreen(this, settings, activeScope);
      body.addView(backup, new LinearLayout.LayoutParams(-1, -1));
      checkIdentity();
    } else if (tab.equals("cleanup")) {
      cleanup = new CleanupScreen(this, settings, activeScope, io);
      body.addView(cleanup, new LinearLayout.LayoutParams(-1, -1));
    } else serverScreen();
  }

  private void renderAppBar() {
    appBar.removeAllViews();
    boolean home = currentTab.equals("library");
    appBar.setVisibility(home ? View.GONE : View.VISIBLE);
    if (home) return;
    ImageButton back = Ui.iconButton(this, R.drawable.ic_back, "返回", this::back);
    back.setTag("back-action");
    appBar.addView(back);
    TextView title =
        Ui.text(
            this,
            currentTab.equals("backup") ? "手机备份" : currentTab.equals("cleanup") ? "释放空间" : "账户",
            18);
    appBar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
  }

  private void serverScreen() {
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(true);
    body.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
    LinearLayout panel = Ui.panel(this);
    scroll.addView(panel);
    boolean connected = !settings.origin().isEmpty();
    Ui.space(panel, 8);
    TextView heading = Ui.text(this, connected ? "你的图库，随时在手边" : "连接你的图库", 26);
    panel.addView(heading);
    Ui.space(panel, 8);
    panel.addView(Ui.muted(this, "登录后即可浏览图库，并为手机原片开启自动备份。", 14));
    Ui.space(panel, 26);
    if (!activeScope.isEmpty()) {
      LinearLayout identity = Ui.card(this, panel);
      identity.addView(
          Ui.row(
              this,
              R.drawable.ic_account,
              settings.value(activeScope, "email", "当前账号"),
              "SekerEagle 账号",
              null));
      Ui.divider(identity);
      identity.addView(
          Ui.row(
              this,
              R.drawable.ic_cloud,
              "手机备份",
              settings.flag(activeScope, "enabled", false) ? "已启用" : "尚未启用",
              () -> show("backup")));
    }
    Ui.section(panel, "服务地址");
    LinearLayout service = Ui.card(this, panel);
    com.google.android.material.textfield.TextInputLayout field =
        new com.google.android.material.textfield.TextInputLayout(
            this, null, com.google.android.material.R.attr.textInputOutlinedStyle);
    field.setHint("SekerEagle 服务地址");
    field.setBoxBackgroundMode(
        com.google.android.material.textfield.TextInputLayout.BOX_BACKGROUND_OUTLINE);
    field.setBoxCornerRadii(Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12), Ui.dp(this, 12));
    com.google.android.material.textfield.TextInputEditText address =
        new com.google.android.material.textfield.TextInputEditText(field.getContext());
    address.setTag("server-address");
    address.setSingleLine(true);
    address.setTextSize(14);
    address.setInputType(
        android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
    address.setText(settings.origin());
    field.addView(address, new LinearLayout.LayoutParams(-1, -2));
    service.addView(field);
    Ui.space(service, 10);
    service.addView(Ui.muted(this, "使用与你的网页版相同的地址和账号。", 12));
    Ui.space(service, 20);
    service.addView(
        Ui.button(
            this,
            connected ? "保存并连接" : "连接图库",
            () -> {
              try {
                String next = BackupPolicy.origin(address.getText().toString(), BuildConfig.DEBUG);
                pause();
                settings.origin(next);
                activeScope = "";
                nextCheck = 0;
                autoPending = true;
                web.loadUrl(next);
                show("library");
              } catch (Exception e) {
                field.setError(e.getMessage());
              }
            }),
        new LinearLayout.LayoutParams(-1, Ui.dp(this, 48)));
    Ui.space(panel, 8);
    panel.addView(Ui.row(this, R.drawable.ic_shield, "原片保存在你的服务中", "手机目录仅用于备份，不会自动删除原片。", null));
  }

  private void checkIdentity() {
    if (checking || settings.origin().isEmpty()) return;
    checking = true;
    String origin = settings.origin();
    io.execute(
        () -> {
          try {
            JSONObject me = sessionRequest("GET", "/api/auth/me", null);
            String owner = me.getJSONObject("user").getString("id");
            String deployment = me.getJSONObject("desktopCache").getString("deploymentId");
            String scope = BackupPolicy.digest(origin + "\n" + deployment + "\n" + owner);
            runOnUiThread(
                () -> {
                  checking = false;
                  if (!origin.equals(settings.origin()) || !resumed) return;
                  if (!scope.equals(activeScope)) {
                    pause();
                    activeScope = scope;
                    settings.active(scope);
                    autoPending = true;
                    settings.setValue(scope, "origin", origin);
                    settings.setValue(scope, "owner", owner);
                    settings.setValue(scope, "deployment", deployment);
                    settings.setValue(scope, "email", me.optJSONObject("user").optString("email"));
                    if (currentTab.equals("backup")) show("backup");
                  }
                  if (autoPending
                      && settings.flag(scope, "enabled", false)
                      && settings.flag(scope, "auto", false)) {
                    autoPending = false;
                    startBackup();
                  }
                });
          } catch (Exception e) {
            runOnUiThread(
                () -> {
                  checking = false;
                  if (!origin.equals(settings.origin())) return;
                  if ((e instanceof ApiClient.Failure
                          && (((ApiClient.Failure) e).status == 401
                              || ((ApiClient.Failure) e).status == 403))
                      || (e instanceof NativeSession.Failure
                          && ((NativeSession.Failure) e).getStatus() == 401)) {
                    pause();
                    activeScope = "";
                    settings.active("");
                    if (backup != null && !backup.scope.isEmpty()) show("backup");
                  }
                });
          }
        });
  }

  void enable(boolean value) {
    if (activeScope.isEmpty()) {
      toast("请先在图库登录");
      show("backup");
      return;
    }
    String scope = activeScope;
    settings.setFlag(scope, "enabled", value);
    if (!value) {
      pause();
      show("backup");
      return;
    }
    toast("正在启用手机备份授权");
    io.execute(
        () -> {
          try {
            if (settings.token(scope).isEmpty()) {
              JSONObject response =
                  sessionRequest(
                      "POST",
                      "/api/tokens",
                      new JSONObject()
                          .put("name", "Android 手机备份")
                          .put("scopes", new JSONArray().put("asset:write")));
              settings.saveToken(scope, response.getString("token"));
            }
            runOnUiThread(
                () -> {
                  if (scope.equals(activeScope)) {
                    show("backup");
                    if (settings.flag(scope, "auto", false)) startBackup();
                  }
                });
          } catch (Exception e) {
            settings.setFlag(scope, "enabled", false);
            runOnUiThread(
                () -> {
                  toast("授权未完成，请确认已登录并重试");
                  if (scope.equals(activeScope)) show("backup");
                });
          }
        });
  }

  void startBackup() {
    String scope = activeScope;
    if (!resumed || scope.isEmpty() || !settings.flag(scope, "enabled", false)) {
      toast("请先登录并启用手机备份");
      return;
    }
    if (!mediaPermission() && hasMediaRules(scope)) {
      toast("请先授予完整的照片和视频访问权限");
      return;
    }
    try {
      startForegroundService(new Intent(this, BackupService.class).putExtra("scope", scope));
    } catch (RuntimeException e) {
      toast("系统暂不允许启动备份，请重新打开后重试");
    }
  }

  boolean hasMediaRules(String scope) {
    JSONArray rules = settings.scanRules(scope);
    for (int i = 0; i < rules.length(); i++)
      if (rules.optJSONObject(i).optString("type").equals("media")) return true;
    return false;
  }

  void pause() {
    stopService(new Intent(this, BackupService.class));
  }

  boolean mediaPermission() {
    if (Build.VERSION.SDK_INT >= 33)
      return checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)
              == PackageManager.PERMISSION_GRANTED
          && checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO)
              == PackageManager.PERMISSION_GRANTED;
    return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
        == PackageManager.PERMISSION_GRANTED;
  }

  void requestMediaPermission() {
    if (Build.VERSION.SDK_INT >= 33)
      requestPermissions(
          new String[] {
            Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO
          },
          72);
    else requestPermissions(new String[] {Manifest.permission.READ_EXTERNAL_STORAGE}, 72);
  }

  void pickTree() {
    pendingTreeScope = activeScope;
    Intent intent =
        new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(intent, 73);
  }

  private Runnable pendingMediaAction;
  private String pendingMediaScope = "";

  void withMediaPermission(Runnable action) {
    if (mediaPermission()) {
      action.run();
      return;
    }
    pendingMediaAction = action;
    pendingMediaScope = activeScope;
    requestMediaPermission();
  }

  void loadFolders(java.util.function.Consumer<java.util.List<String>> done) {
    if (!mediaPermission()) {
      withMediaPermission(() -> loadFolders(done));
      return;
    }
    io.execute(
        () -> {
          try {
            java.util.List<String> folders = new MediaCatalog(this).folders();
            runOnUiThread(() -> done.accept(folders));
          } catch (Exception e) {
            runOnUiThread(() -> toast("无法读取目录，请检查媒体权限"));
          }
        });
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
    super.onRequestPermissionsResult(requestCode, permissions, results);
    if (requestCode == 72) {
      Runnable action = pendingMediaAction;
      pendingMediaAction = null;
      if (mediaPermission() && pendingMediaScope.equals(activeScope) && action != null) {
        action.run();
        return;
      }
      show(currentTab.equals("cleanup") ? "cleanup" : "backup");
      if (!mediaPermission()) toast("请允许访问全部照片和视频，以免自动备份遗漏文件");
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == CleanupScreen.DELETE_REQUEST) {
      if (cleanup != null) cleanup.onDeleteResult(resultCode);
      return;
    }
    if (requestCode == 71 && chooser != null) {
      chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
      chooser = null;
    }
    if (requestCode == 73
        && resultCode == RESULT_OK
        && data != null
        && data.getData() != null
        && pendingTreeScope.equals(activeScope)) {
      try {
        Uri tree = data.getData();
        int flags =
            (data.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
                ? Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                : Intent.FLAG_GRANT_READ_URI_PERMISSION;
        getContentResolver().takePersistableUriPermission(tree, flags);
        BackupScreen.addRule(settings, activeScope, "tree", tree.toString());
        show("backup");
      } catch (Exception e) {
        toast("目录授权未保存，请重新选择");
      }
    }
  }

  void toast(String text) {
    Toast.makeText(this, text, Toast.LENGTH_LONG).show();
  }

  @Override
  protected void onResume() {
    super.onResume();
    resumed = true;
    autoPending = true;
    nextCheck = 0;
    handler.post(tick);
    if (web != null) web.onResume();
  }

  @Override
  protected void onPause() {
    resumed = false;
    handler.removeCallbacks(tick);
    if (web != null) web.onPause();
    if (!nativeHost) CookieManager.getInstance().flush();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    handler.removeCallbacks(tick);
    io.shutdownNow();
    if (chooser != null) chooser.onReceiveValue(null);
    if (web != null) {
      body.removeView(web);
      web.destroy();
    }
    super.onDestroy();
  }

  private void back() {
    if (backPending) return;
    if (!currentTab.equals("library")) {
      if (!nativeBackStack.isEmpty()) renderTab(nativeBackStack.pop());
      else if (nativeHost) finish();
      else if (!settings.origin().isEmpty()) renderTab("library");
      else finish();
      return;
    }
    if (web.getUrl() == null || !sameOrigin(Uri.parse(web.getUrl()))) {
      browserBack();
      return;
    }
    backPending = true;
    web.evaluateJavascript(
        "!window.dispatchEvent(new Event('sekereagle:back',{cancelable:true}))",
        handled -> {
          backPending = false;
          if (!isFinishing()
              && !isDestroyed()
              && currentTab.equals("library")
              && !"true".equals(handled)) browserBack();
        });
  }

  private void browserBack() {
    if (web.canGoBack()) web.goBack();
    else finish();
  }

  @Override
  public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
    if (Build.VERSION.SDK_INT < 33 && keyCode == android.view.KeyEvent.KEYCODE_BACK) {
      back();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }
}
