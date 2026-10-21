package com.sekereagle.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.concurrent.*;
import org.json.*;
import com.sekereagle.android.core.BackupPolicy;

/** Same authenticated Web workspace, with a native backup surface and no JavaScript bridge. */
public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private BackupSettings settings;
    private LinearLayout root, body, tabs;
    private WebView web;
    private BackupScreen backup;
    private String currentTab = "library", activeScope = "", pendingTreeScope = "";
    private boolean resumed, checking, autoPending;
    private long nextCheck;
    private ValueCallback<Uri[]> chooser;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            if (backup != null && currentTab.equals("backup")) backup.refreshStatus();
            if (System.currentTimeMillis() >= nextCheck) { nextCheck = System.currentTimeMillis() + 5000; checkIdentity(); }
            handler.postDelayed(this, 1000);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); settings = new BackupSettings(this);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(17,21,31));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets padding = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom); return insets;
        });
        setContentView(root);
        TextView brand = Ui.text(this, "SekerEagle", 19); brand.setPadding(Ui.dp(this,20),Ui.dp(this,12),0,Ui.dp(this,12)); root.addView(brand);
        body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); root.addView(body, new LinearLayout.LayoutParams(-1,0,1));
        tabs = new LinearLayout(this); root.addView(tabs);
        for (String[] tab : new String[][]{{"library","图库"},{"backup","手机备份"},{"server","连接"}}) {
            Button button = Ui.button(this, tab[1], () -> show(tab[0])); tabs.addView(button, new LinearLayout.LayoutParams(0,Ui.dp(this,54),1));
        }
        setupWeb();
        if (settings.origin().isEmpty()) show("server"); else { web.loadUrl(settings.origin()); show("library"); }
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private void setupWeb() {
        web = new WebView(this);
        WebSettings config = web.getSettings(); config.setJavaScriptEnabled(true); config.setDomStorageEnabled(true);
        config.setAllowFileAccess(false); config.setAllowContentAccess(false); config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        config.setSupportMultipleWindows(false); config.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setBackgroundColor(Color.rgb(17,21,31));
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if (request.isForMainFrame() && !sameOrigin(request.getUrl())) {
                    if ("https".equals(scheme)) startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view, String url) { nextCheck = 0; }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (chooser != null) chooser.onReceiveValue(null); chooser = callback;
                try { startActivityForResult(parameters.createIntent(), 71); }
                catch (ActivityNotFoundException e) { chooser.onReceiveValue(null); chooser = null; }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            try {
                Uri uri = Uri.parse(url);
                if (!sameOrigin(uri)) throw new IllegalArgumentException("下载地址不属于当前服务");
                android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(uri);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.addRequestHeader("User-Agent", userAgent);
                request.setMimeType(mime); request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime));
                getSystemService(android.app.DownloadManager.class).enqueue(request);
            } catch (Exception e) { toast("下载暂不可用，请稍后重试"); }
        });
    }
    private boolean sameOrigin(Uri uri) {
        try {
            Uri expected = Uri.parse(settings.origin());
            return expected.getScheme().equals(uri.getScheme()) && expected.getHost().equals(uri.getHost()) && expected.getPort() == uri.getPort() && uri.getUserInfo() == null;
        } catch (Exception e) { return false; }
    }
    void show(String tab) {
        currentTab = tab; body.removeAllViews(); backup = null;
        if (tab.equals("library")) {
            if (settings.origin().isEmpty()) { show("server"); return; }
            body.addView(web, new LinearLayout.LayoutParams(-1,-1));
        } else if (tab.equals("backup")) {
            backup = new BackupScreen(this, settings, activeScope); body.addView(backup, new LinearLayout.LayoutParams(-1,-1)); checkIdentity();
        } else serverScreen();
    }
    private void serverScreen() {
        LinearLayout panel = Ui.panel(this); body.addView(panel);
        panel.addView(Ui.text(this,"连接你的 SekerEagle",24));
        panel.addView(Ui.text(this,"使用与网页版相同的服务和账号。测试版仅额外允许 localhost 的 HTTP 连接。",14));
        EditText address = new EditText(this); address.setTextColor(Color.WHITE); address.setSingleLine(true); address.setHint("https://你的服务地址"); address.setHintTextColor(Color.GRAY);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setText(settings.origin()); panel.addView(address);
        panel.addView(Ui.button(this,"连接",() -> {
            try {
                String next = BackupPolicy.origin(address.getText().toString(), BuildConfig.DEBUG);
                pause(); settings.origin(next); activeScope = ""; nextCheck = 0; autoPending = true;
                web.loadUrl(next); show("library");
            } catch (Exception e) { toast(e.getMessage()); }
        }));
    }
    private void checkIdentity() {
        if (checking || settings.origin().isEmpty()) return;
        checking = true;
        String origin = settings.origin();
        io.execute(() -> {
            try {
                JSONObject me = new ApiClient(origin, "").request("GET", "/api/auth/me", null);
                String owner = me.getJSONObject("user").getString("id");
                String deployment = me.getJSONObject("desktopCache").getString("deploymentId");
                String scope = BackupPolicy.digest(origin + "\n" + deployment + "\n" + owner);
                runOnUiThread(() -> {
                    checking = false; if (!origin.equals(settings.origin()) || !resumed) return;
                    if (!scope.equals(activeScope)) {
                        pause(); activeScope = scope; settings.active(scope); autoPending = true;
                        settings.setValue(scope,"origin",origin); settings.setValue(scope,"owner",owner); settings.setValue(scope,"deployment",deployment);
                        settings.setValue(scope,"email",me.optJSONObject("user").optString("email"));
                        if (currentTab.equals("backup")) show("backup");
                    }
                    if (autoPending && settings.flag(scope,"enabled",false) && settings.flag(scope,"auto",false)) { autoPending = false; startBackup(); }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    checking = false;
                    if (!origin.equals(settings.origin())) return;
                    if (e instanceof ApiClient.Failure && (((ApiClient.Failure)e).status == 401 || ((ApiClient.Failure)e).status == 403)) {
                        pause(); activeScope = ""; settings.active("");
                        if (backup != null && !backup.scope.isEmpty()) show("backup");
                    }
                });
            }
        });
    }
    void enable(boolean value) {
        if (activeScope.isEmpty()) { toast("请先在图库登录"); show("backup"); return; }
        String scope = activeScope;
        settings.setFlag(scope,"enabled",value);
        if (!value) { pause(); show("backup"); return; }
        toast("正在启用手机备份授权");
        io.execute(() -> {
            try {
                if (settings.token(scope).isEmpty()) {
                    JSONObject response = new ApiClient(settings.value(scope,"origin",""), "").request("POST", "/api/tokens",
                        new JSONObject().put("name","Android 手机备份").put("scopes",new JSONArray().put("asset:write")));
                    settings.saveToken(scope,response.getString("token"));
                }
                runOnUiThread(() -> { if (scope.equals(activeScope)) { show("backup"); if (settings.flag(scope,"auto",false)) startBackup(); } });
            } catch (Exception e) {
                settings.setFlag(scope,"enabled",false);
                runOnUiThread(() -> { toast("授权未完成，请确认已登录并重试"); if (scope.equals(activeScope)) show("backup"); });
            }
        });
    }
    void startBackup() {
        String scope = activeScope;
        if (!resumed || scope.isEmpty() || !settings.flag(scope,"enabled",false)) { toast("请先登录并启用手机备份"); return; }
        if (!mediaPermission() && hasMediaRules(scope)) { toast("请先授予完整的照片和视频访问权限"); return; }
        try { startForegroundService(new Intent(this, BackupService.class).putExtra("scope",scope)); }
        catch (RuntimeException e) { toast("系统暂不允许启动备份，请重新打开后重试"); }
    }
    private boolean hasMediaRules(String scope) {
        JSONArray rules = settings.rules(scope);
        for (int i=0;i<rules.length();i++) if (rules.optJSONObject(i).optString("type").equals("media")) return true;
        return false;
    }
    void pause() { stopService(new Intent(this, BackupService.class)); }
    boolean mediaPermission() {
        if (Build.VERSION.SDK_INT >= 33) return checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)==PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO)==PackageManager.PERMISSION_GRANTED;
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)==PackageManager.PERMISSION_GRANTED;
    }
    void requestMediaPermission() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VIDEO},72);
        else requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE},72);
    }
    void pickTree() {
        pendingTreeScope = activeScope;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent,73);
    }
    void loadFolders(java.util.function.Consumer<java.util.List<String>> done) {
        if (!mediaPermission()) { requestMediaPermission(); return; }
        io.execute(() -> { try {
            java.util.List<String> folders = new MediaCatalog(this).folders(); runOnUiThread(() -> done.accept(folders));
        } catch (Exception e) { runOnUiThread(() -> toast("无法读取目录，请检查媒体权限")); } });
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode,permissions,results);
        if (requestCode==72) { show("backup"); if (!mediaPermission()) toast("请允许访问全部照片和视频，以免自动备份遗漏文件"); }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if (requestCode==71 && chooser!=null) { chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data)); chooser=null; }
        if (requestCode==73 && resultCode==RESULT_OK && data!=null && data.getData()!=null && pendingTreeScope.equals(activeScope)) {
            try {
                Uri tree=data.getData(); getContentResolver().takePersistableUriPermission(tree,Intent.FLAG_GRANT_READ_URI_PERMISSION);
                BackupScreen.addRule(settings,activeScope,"tree",tree.toString()); show("backup");
            } catch (Exception e) { toast("目录授权未保存，请重新选择"); }
        }
    }
    void toast(String text) { Toast.makeText(this,text,Toast.LENGTH_LONG).show(); }
    @Override protected void onResume() { super.onResume(); resumed=true; autoPending=true; nextCheck=0; handler.post(tick); if(web!=null) web.onResume(); }
    @Override protected void onPause() { resumed=false; handler.removeCallbacks(tick); if(web!=null) web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacks(tick); io.shutdownNow(); if(chooser!=null) chooser.onReceiveValue(null); if(web!=null) { body.removeView(web); web.destroy(); } super.onDestroy(); }
    @Override public void onBackPressed() { if(!currentTab.equals("library")) show("library"); else if(web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
