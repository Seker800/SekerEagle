package com.sekereagle.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import com.sekereagle.android.core.BackupEngine;
import com.sekereagle.android.core.BackupPermissionPolicy;
import com.sekereagle.android.core.BackupRunPolicy;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Visible, bounded foreground work. The next app opening resumes durable checkpoints. */
public final class BackupService extends Service {

  private static volatile BackupService current;

  static boolean isRunning(String scope) {
    BackupService service = current;
    return (service != null
        && service.working.get()
        && !service.cancelled
        && service.scope.equals(scope));
  }

  static final String CHANNEL = "mobile-backup";
  static final int NOTICE = 42;
  private static final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean working = new AtomicBoolean();
  private volatile boolean cancelled;
  private volatile boolean retiring;
  private volatile ApiClient activeApi;
  private Intent pendingRestart;
  private int latestStartId;
  private boolean manual;
  private boolean timedOut;
  private long lastConditions, lastUpdate;
  private String pendingMessage = "";

  static void pause(Context context) {
    BackupSettings state = new BackupSettings(context);
    String scope = state.active();
    if (scope.isEmpty()) return;
    state.setFlag(scope, "userPaused", true);
    state.setValue(scope, "status", "备份已暂停");
    BackupService service = current;
    if (service != null && scope.equals(service.scope)) service.cancelRun(true);
  }

  /** Stop obsolete work without changing the user's durable pause preference. */
  static void cancel(Context context) {
    BackupSettings state = new BackupSettings(context);
    BackupService service = current;
    if (service != null && state.active().equals(service.scope)) service.cancelRun(false);
  }

  private void cancelRun(boolean userPause) {
    cancelled = true;
    pendingRestart = null;
    if (userPause) settings.setFlag(scope, "userPaused", true);
    String message = settings.flag(scope, "userPaused", false) ? "备份已暂停" : "备份已停止";
    pendingMessage = message;
    settings.setValue(scope, "status", message);
    ApiClient api = activeApi;
    if (api != null) api.close();
    getSystemService(NotificationManager.class).notify(NOTICE, notification(message));
  }

  private BackupSettings settings;
  private String scope = "";
  private int seen, uploaded, skipped, failed;
  private JSONArray errors = new JSONArray();
  private JSONArray transferRows = new JSONArray();
  private PowerManager.WakeLock wake;
  private long wakeUntil;

  static final class Hold extends IOException {

    Hold(String reason) {
      super(reason);
    }
  }

  @Override
  public void onCreate() {
    super.onCreate();
    current = this;
    settings = new BackupSettings(this);
    NotificationManager manager = getSystemService(NotificationManager.class);
    manager.createNotificationChannel(
        new NotificationChannel(CHANNEL, "手机备份", NotificationManager.IMPORTANCE_LOW));
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    latestStartId = startId;
    if (intent != null && "pause".equals(intent.getAction())) {
      pause(this);
      return START_NOT_STICKY;
    }
    String requested = intent == null ? "" : intent.getStringExtra("scope");
    if (requested == null || requested.isEmpty() || !requested.equals(settings.active())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    boolean explicit = intent != null && intent.getBooleanExtra("manual", false);
    if (!BackupRunPolicy.mayStart(explicit, settings.flag(requested, "userPaused", false))) {
      if (!working.get()) scope = requested;
      // A stale automatic start can race the durable pause write. Honour Android's
      // foreground-start contract even when declining to perform any work.
      startForeground(NOTICE, notification("备份已暂停"), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
      if (!working.get()) {
        stopForeground(STOP_FOREGROUND_DETACH);
        stopSelfResult(startId);
      }
      return START_NOT_STICKY;
    }
    if (working.get()) {
      if (cancelled || retiring) pendingRestart = new Intent(intent);
      return START_NOT_STICKY;
    }
    working.set(true);
    retiring = false;
    cancelled = false;
    manual = explicit;
    timedOut = false;
    scope = requested;
    if (explicit) settings.setFlag(scope, "userPaused", false);
    lastConditions = lastUpdate = 0;
    startForeground(NOTICE, notification("正在准备扫描"), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    executor.execute(this::runBackup);
    return START_NOT_STICKY;
  }

  private void runBackup() {
    settings.setFlag(scope, "running", true);
    try (BackupJournal journal = new BackupJournal(this)) {
      boolean resume = settings.flag(scope, "scanOpen", false);
      refreshCounts(journal);
      errors = resume ? new JSONArray(settings.value(scope, "errors", "[]")) : new JSONArray();
      transferRows =
          resume ? new JSONArray(settings.value(scope, "transferRows", "[]")) : new JSONArray();
      guard();
      journal.beginScan(scope, resume);
      settings.setFlag(scope, "scanOpen", true);
      refreshCounts(journal);
      String origin = settings.value(scope, "origin", "");
      if (!origin.equals(settings.origin())) throw new Hold("服务地址已变化，备份已暂停");
      String token = settings.token(scope);
      if (token.isEmpty()) throw new Hold("请登录并启用备份授权");
      ApiClient api = new ApiClient(origin, token);
      activeApi = api;
      JSONObject me = api.request("GET", "/api/auth/me", null);
      if (!me.getJSONObject("user").getString("id").equals(settings.value(scope, "owner", ""))
          || !me.getJSONObject("desktopCache")
              .getString("deploymentId")
              .equals(settings.value(scope, "deployment", ""))) throw new Hold("账号或服务身份已变化，请重新连接");
      guard();
      wake =
          getSystemService(PowerManager.class)
              .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SekerEagle:MobileBackup");
      wake.acquire(30 * 60 * 1000L);
      wakeUntil = SystemClock.elapsedRealtime() + 25 * 60 * 1000L;
      JSONArray rules = settings.scanRules(scope);
      if (rules.length() == 0) throw new Hold("请先选择备份目录");
      if (BackupPermissionPolicy.requiresCompleteMediaAccess(mediaRuleCount(rules))
          && !hasMediaPermission()) throw new Hold("请授予完整的照片和视频访问权限，避免备份遗漏");
      MediaCatalog catalog = new MediaCatalog(this);
      update("正在扫描所选目录");
      catalog.scan(
          rules,
          (item, mode) -> {
            guard();
            String fileKey =
                mode
                    + ":"
                    + com.sekereagle.android.core.BackupPolicy.digest(
                        item.uri + "\n" + item.size + "\n" + item.modified);
            if (item.modified > 0 && journal.scanCompleted(scope, fileKey)) return;
            journal.scanResult(scope, fileKey, "CHECKING");
            refreshCounts(journal);
            update("正在检查：" + item.name);
            try {
              catalog.checkSize(item);
              BackupEngine engine =
                  new BackupEngine(
                      journal, new MultipartTransport(api, mode, catalog, item), this::guard);
              BackupEngine.File source =
                  new BackupEngine.File(
                      item.uri.toString(),
                      item.size,
                      item.modified,
                      () -> catalog.hash(item, this::guard),
                      () -> catalog.stable(item));
              BackupEngine.Result result = engine.process(scope, mode, source);
              guard();
              journal.scanResult(scope, fileKey, result.name());
              refreshCounts(journal);
              recordTransfer(
                  item.name, mode, result == BackupEngine.Result.UPLOADED ? "已上传" : "已存在");
            } catch (Hold e) {
              throw e;
            } catch (ApiClient.Failure e) {
              if (e.status == 401 || e.status == 403) {
                throw e;
              }
              guard();
              journal.scanResult(scope, fileKey, "FAILED");
              refreshCounts(journal);
              failure(item.name, e);
            } catch (SecurityException e) {
              guard();
              journal.scanResult(scope, fileKey, "FAILED");
              refreshCounts(journal);
              failure(item.name, new IOException("文件访问权限失效，请重新授权"));
            } catch (Exception e) {
              guard();
              journal.scanResult(scope, fileKey, "FAILED");
              refreshCounts(journal);
              failure(item.name, e);
            }
            update("正在扫描并备份");
          },
          this::guard);
      guard();
      settings.setFlag(scope, "scanOpen", false);
      update(failed == 0 ? "备份完成" : "备份结束，有失败项可重试");
      settings.setValue(scope, "lastFinished", Long.toString(System.currentTimeMillis()));
    } catch (ApiClient.Failure e) {
      if (current == this && !cancelled && e.invalidatesCredential())
        settings.setValue(scope, "credential", "");
      update(e.getMessage());
    } catch (SecurityException e) {
      update("目录权限不足，请授权照片视频或重新选择目录");
    } catch (Exception e) {
      update(safeMessage(e));
    } finally {
      ApiClient api = activeApi;
      if (api != null) api.close();
      activeApi = null;
      if (wake != null && wake.isHeld()) wake.release();
      if (current == this) {
        retiring = true;
        if (cancelled && settings.flag(scope, "userPaused", false)) pendingMessage = "备份已暂停";
        flushUpdate();
        // Keep the retiring run occupied until its main-thread handoff. New starts
        // queue behind it, so an old completion can never stop a newer run.
        new Handler(Looper.getMainLooper())
            .post(
                () -> {
                  if (current != this) return;
                  settings.setFlag(scope, "running", false);
                  working.set(false);
                  Intent restart = pendingRestart;
                  pendingRestart = null;
                  if (restart != null) {
                    onStartCommand(restart, 0, latestStartId);
                    return;
                  }
                  stopForeground(
                      settings.flag(scope, "userPaused", false)
                          ? STOP_FOREGROUND_DETACH
                          : STOP_FOREGROUND_REMOVE);
                  stopSelfResult(latestStartId);
                });
      } else working.set(false);
    }
  }

  private void refreshCounts(BackupJournal journal) {
    int[] counts = journal.scanCounts(scope);
    seen = counts[0];
    uploaded = counts[1];
    skipped = counts[2];
    failed = counts[3];
  }

  private void failure(String name, Exception e) throws Exception {
    recordTransfer(name, "", "失败：" + safeMessage(e));
    if (errors.length() < 20) errors.put(name + "：" + safeMessage(e));
  }

  private void recordTransfer(String name, String mode, String result) throws Exception {
    JSONArray recent = new JSONArray();
    for (int i = Math.max(0, transferRows.length() - 99); i < transferRows.length(); i++)
      recent.put(transferRows.get(i));
    recent.put(
        name + (mode.isEmpty() ? "" : mode.equals("PHOTO") ? " · 照片" : " · 素材") + " · " + result);
    transferRows = recent;
  }

  private static String safeMessage(Exception e) {
    if (e instanceof Hold || e instanceof ApiClient.Failure) return e.getMessage();
    if (e instanceof java.net.SocketTimeoutException
        || e instanceof java.net.ConnectException
        || e instanceof java.net.UnknownHostException) return "网络连接中断，下次打开可继续";
    if (e instanceof IOException && e.getMessage() != null && !e.getMessage().contains("://"))
      return e.getMessage();
    return "备份未完成，可重新扫描重试";
  }

  private synchronized void guard() throws Hold {
    if (current != this
        || cancelled
        || Thread.currentThread().isInterrupted()
        || !scope.equals(settings.active())
        || !settings.flag(scope, "enabled", false)) throw new Hold("备份已暂停");
    keepAwake();
    long now = SystemClock.elapsedRealtime();
    if (lastConditions != 0 && now - lastConditions < 1000) return;
    lastConditions = now;
    ConnectivityManager manager = getSystemService(ConnectivityManager.class);
    NetworkCapabilities network = manager.getNetworkCapabilities(manager.getActiveNetwork());
    if (network == null || !network.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
      throw new Hold("等待网络连接");
    boolean unmetered =
        network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            || network.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
    Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
    boolean charging = false;
    int percent = 100;
    if (battery != null) {
      int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
      charging =
          status == BatteryManager.BATTERY_STATUS_CHARGING
              || status == BatteryManager.BATTERY_STATUS_FULL;
      int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
      if (scale > 0)
        percent = (int) ((battery.getIntExtra(BatteryManager.EXTRA_LEVEL, 100) * 100L) / scale);
    }
    String hold =
        BackupRunPolicy.hold(
            manual,
            unmetered,
            settings.flag(scope, "wifi", true),
            settings.flag(scope, "charging", false),
            charging,
            percent);
    if (!hold.isEmpty()) throw new Hold(hold);
  }

  private static int mediaRuleCount(JSONArray rules) {
    int count = 0;
    for (int i = 0; i < rules.length(); i++) {
      JSONObject rule = rules.optJSONObject(i);
      if (rule != null && "media".equals(rule.optString("type"))) count++;
    }
    return count;
  }

  /** A partial Android 14 photo grant must never be mistaken for a complete directory scan. */
  private boolean hasMediaPermission() {
    boolean images = false, video = false, storage = false;
    if (Build.VERSION.SDK_INT >= 33) {
      images =
          checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)
              == PackageManager.PERMISSION_GRANTED;
      video =
          checkSelfPermission(Manifest.permission.READ_MEDIA_VIDEO)
              == PackageManager.PERMISSION_GRANTED;
    } else {
      storage =
          checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)
              == PackageManager.PERMISSION_GRANTED;
    }
    return BackupPermissionPolicy.hasCompleteMediaAccess(
        Build.VERSION.SDK_INT, images, video, storage);
  }

  /** Foreground plus a partial wake lock; renew the bounded lease for long first imports. */
  private void keepAwake() {
    if (wake == null) return;
    long now = SystemClock.elapsedRealtime();
    if (wake.isHeld() && now < wakeUntil) return;
    if (wake.isHeld()) wake.release();
    wake.acquire(30 * 60 * 1000L);
    wakeUntil = now + 25 * 60 * 1000L;
  }

  private void update(String message) {
    if (current != this || cancelled) return;
    pendingMessage = message;
    long now = SystemClock.elapsedRealtime();
    if (lastUpdate != 0 && now - lastUpdate < 1000) return;
    lastUpdate = now;
    flushUpdate();
  }

  private void flushUpdate() {
    if (current != this) return;
    settings.snapshot(
        scope,
        pendingMessage,
        "扫描 " + seen + " · 已上传 " + uploaded + " · 已存在 " + skipped + " · 失败 " + failed,
        errors.toString(),
        transferRows.toString());
    getSystemService(NotificationManager.class).notify(NOTICE, notification(pendingMessage));
  }

  private Notification notification(String text) {
    PendingIntent open =
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, NativeActivity.class)
                .putExtra("transfers", true)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    PendingIntent pause =
        PendingIntent.getService(
            this,
            1,
            new Intent(this, BackupService.class).setAction("pause").putExtra("scope", scope),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    boolean paused = settings.flag(scope, "userPaused", false);
    PendingIntent resume =
        PendingIntent.getForegroundService(
            this,
            2,
            new Intent(this, BackupService.class).putExtra("scope", scope).putExtra("manual", true),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    return new Notification.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.ic_notification)
        .setContentTitle("SekerEagle 手机备份")
        .setContentText(text)
        .setContentIntent(open)
        .setOngoing(!paused)
        .setOnlyAlertOnce(true)
        .setSubText(settings.value(scope, "counts", ""))
        .addAction(
            new Notification.Action.Builder(null, paused ? "继续" : "暂停", paused ? resume : pause)
                .build())
        .build();
  }

  @Override
  public void onTimeout(int startId, int foregroundServiceType) {
    cancelled = true;
    timedOut = true;
    pendingMessage = "系统执行时限已到，下次打开继续";
    flushUpdate();
    stopSelf();
  }

  @Override
  public void onDestroy() {
    cancelled = true;
    if (current == this) {
      if (!scope.isEmpty()) {
        if (working.get() && !settings.flag(scope, "userPaused", false) && !timedOut) {
          pendingMessage = "备份未完成，下次打开继续";
          flushUpdate();
        }
        settings.setFlag(scope, "running", false);
      }
      current = null;
    }
    ApiClient api = activeApi;
    if (api != null) api.close();
    if (wake != null && wake.isHeld()) wake.release();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
