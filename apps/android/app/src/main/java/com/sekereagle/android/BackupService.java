package com.sekereagle.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import com.sekereagle.android.core.BackupContentLock;
import com.sekereagle.android.core.BackupEngine;
import com.sekereagle.android.core.BackupExecutor;
import com.sekereagle.android.core.BackupPermissionPolicy;
import com.sekereagle.android.core.BackupRunPolicy;
import com.sekereagle.android.core.BackupScanPolicy;
import com.sekereagle.android.core.UploadRetryPolicy;
import java.io.IOException;
import java.util.*;
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
  // Two files overlap hashing/finalization with the other's upload while the shared part budget stays at three.
  private static final int FILE_THREADS = 2;
  private static final int FILES_IN_FLIGHT = 2;
  private final BackupEngine.ContentLock contentLock = new BackupContentLock(64);
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

  /** Restores the failed files to the front of the next run without clearing successful receipts. */
  static void retryFailed(Context context, String scope) {
    try (BackupJournal journal = new BackupJournal(context)) {
      journal.retryFailures(scope);
    }
    context.startForegroundService(
        new Intent(context, BackupService.class)
            .putExtra("scope", scope)
            .putExtra("manual", true));
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
  private int runSeen, runUploaded, runSkipped, runFailed;
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
    BackupLive.begin(scope);
    resetRunCounts();
    BackupJournal journal = null;
    BackupExecutor workers = null;
    try {
      journal = new BackupJournal(this);
      final BackupJournal store = journal;
      boolean resume = settings.flag(scope, "scanOpen", false);
      refreshCounts(journal);
      errors = resume ? new JSONArray(settings.value(scope, "errors", "[]")) : new JSONArray();
      transferRows =
          resume ? new JSONArray(settings.value(scope, "transferRows", "[]")) : new JSONArray();
      guard();
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
      workers = new BackupExecutor(FILE_THREADS, FILES_IN_FLIGHT);
      final BackupExecutor fileWorkers = workers;
      // Files that failed before this run stay queued for after the scan; new photos must never
      // wait behind a multi-gigabyte retry backlog. Incremental scans never revisit them.
      final Set<String> retriedKeys = new HashSet<>();
      final List<PendingRetry> pendingRetries = new ArrayList<>();
      for (BackupJournal.Retry retry : store.failures(scope)) {
        guard();
        // A known failure is never re-submitted by the scan, even after automatic retries stop;
        // only the explicit retry action resets its attempt count.
        retriedKeys.add(
            retry.mode + ":" + com.sekereagle.android.core.BackupPolicy.digest(retry.uri));
        if (retry.attempts >= UploadRetryPolicy.MAX_ATTEMPTS) continue;
        MediaCatalog.Item pending;
        try {
          // The file may have been edited since it failed; use the provider's current metadata.
          pending = catalog.selected(android.net.Uri.parse(retry.uri));
        } catch (Exception refreshFailed) {
          try {
            pending =
                catalog.stored(retry.uri, retry.name, retry.size, retry.modified, retry.document);
          } catch (Exception unsupported) {
            continue;
          }
        }
        String fileKey =
            retry.mode + ":" + com.sekereagle.android.core.BackupPolicy.digest(retry.uri);
        pendingRetries.add(
            new PendingRetry(
                pending, retry.mode, fileKey, pending.size + ":" + pending.modified));
      }
      long scanStarted = System.currentTimeMillis() / 1000;
      long[] state = store.scanState(scope);
      String rulesHash = com.sekereagle.android.core.BackupPolicy.digest(rules.toString());
      boolean rulesChanged = !rulesHash.equals(store.scanRulesHash(scope));
      boolean full =
          rulesChanged
              || BackupScanPolicy.full(state[0], state[1], state[2], scanStarted, resume);
      final Set<String> submittedKeys = new HashSet<>();
      MediaCatalog.Visitor visit =
          (item, mode) -> {
            guard();
            String fileKey =
                mode
                    + ":"
                    + com.sekereagle.android.core.BackupPolicy.digest(item.uri.toString());
            String fingerprint = item.size + ":" + item.modified;
            if (retriedKeys.contains(fileKey)) return;
            if (item.modified > 0) {
              if (store.scanCompleted(scope, fileKey, fingerprint)) {
                countRun("SKIPPED");
                return;
              }
              String engineKey =
                  BackupEngine.fileKey(
                      scope, mode, item.uri.toString(), item.size, item.modified);
              BackupEngine.Checkpoint checkpoint = store.load(engineKey);
              if (checkpoint != null
                  && checkpoint.confirmed
                  && checkpoint.terminalError.isEmpty()) {
                store.scanResult(scope, fileKey, fingerprint, "SKIPPED");
                countRun("SKIPPED");
                return;
              }
            }
            if (!submittedKeys.add(fileKey)) return;
            BackupLive.queued(item.uri.toString(), item.name, mode, item.size);
            fileWorkers.submit(
                () -> processItem(store, catalog, api, item, mode, fileKey, fingerprint));
          };
      if (full) {
        // Newest files first: a multi-gigabyte backlog of older failures must not hide today's
        // photos behind a full ascending scan.
        update("正在优先检查最近修改的文件");
        catalog.scanRecent(
            rules,
            visit,
            this::guard,
            scanStarted - 24 * 3600,
            state[0] >= 0 ? state[0] : Long.MAX_VALUE);
      }
      for (PendingRetry retry : pendingRetries) {
        guard();
        BackupLive.queued(
            retry.item.uri.toString(), retry.item.name, retry.mode, retry.item.size);
        fileWorkers.submit(
            () ->
                processItem(
                    store,
                    catalog,
                    api,
                    retry.item,
                    retry.mode,
                    retry.fileKey,
                    retry.fingerprint));
      }
      update("正在扫描所选目录");
      catalog.scan(
          rules,
          visit,
          this::guard,
          full ? -1 : state[0],
          full ? 0 : BackupScanPolicy.changedAfter(state[1]),
          full ? -1 : state[0]);
      guard();
      fileWorkers.drain();
      guard();
      long maxId = catalog.maxSeenId();
      store.saveScanState(
          scope,
          maxId >= 0 ? maxId : state[0],
          scanStarted,
          BackupScanPolicy.nextFull(state[2], scanStarted, full),
          rulesHash);
      refreshCounts(journal);
      settings.setFlag(scope, "scanOpen", false);
      update(runFailed == 0 ? "备份完成" : "备份结束，有失败项可重试");
      BackupLive.end(pendingMessage);
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
      if (workers != null) workers.close();
      if (journal != null) journal.close();
      if (wake != null && wake.isHeld()) wake.release();
      if (current == this) {
        retiring = true;
        if (cancelled && settings.flag(scope, "userPaused", false)) pendingMessage = "备份已暂停";
        BackupLive.end(pendingMessage);
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

  private static final class PendingRetry {
    final MediaCatalog.Item item;
    final String mode, fileKey, fingerprint;

    PendingRetry(MediaCatalog.Item item, String mode, String fileKey, String fingerprint) {
      this.item = item;
      this.mode = mode;
      this.fileKey = fileKey;
      this.fingerprint = fingerprint;
    }
  }

  private void processItem(
      BackupJournal journal,
      MediaCatalog catalog,
      ApiClient api,
      MediaCatalog.Item item,
      String mode,
      String fileKey,
      String fingerprint)
      throws Exception {
    guard();
    journal.scanResult(scope, fileKey, fingerprint, "CHECKING");
    refreshCounts(journal);
    update("正在检查：" + item.name);
    BackupLive.start(item.uri.toString());
    try {
      catalog.checkSize(item);
      BackupEngine engine =
          new BackupEngine(
              journal,
              new MultipartTransport(
                  api,
                  mode,
                  catalog,
                  item,
                  bytes -> BackupLive.progress(item.uri.toString(), bytes)),
              this::guard,
              contentLock);
      BackupEngine.File source =
          new BackupEngine.File(
              item.uri.toString(),
              item.size,
              item.modified,
              () -> catalog.hash(item, this::guard),
              () -> catalog.stable(item));
      BackupEngine.Result result = processWithRetry(engine, scope, mode, source, item);
      guard();
      journal.scanResult(scope, fileKey, fingerprint, result.name());
      refreshCounts(journal);
      BackupLive.finish(item.uri.toString(), result.name(), "");
      recordTransfer(item.name, mode, result == BackupEngine.Result.UPLOADED ? "已上传" : "已存在");
      countRun(result.name());
      update("正在扫描并备份");
    } catch (Hold e) {
      throw e;
    } catch (ApiClient.Failure e) {
      if (e.status == 401 || e.status == 403) throw e;
      guard();
      markFailure(journal, fileKey, fingerprint, item, mode, e);
      failure(item.name, e);
      countRun("FAILED");
      update("正在扫描并备份");
    } catch (SecurityException e) {
      guard();
      IOException reason = new IOException("文件访问权限失效，请重新授权");
      markFailure(journal, fileKey, fingerprint, item, mode, reason);
      failure(item.name, reason);
      countRun("FAILED");
      update("正在扫描并备份");
    } catch (Exception e) {
      guard();
      markFailure(journal, fileKey, fingerprint, item, mode, e);
      failure(item.name, e);
      countRun("FAILED");
      update("正在扫描并备份");
    }
  }

  private void markFailure(
      BackupJournal journal,
      String fileKey,
      String fingerprint,
      MediaCatalog.Item item,
      String mode,
      Exception error)
      throws Exception {
    String message = safeMessage(error);
    journal.scanFailure(
        scope,
        fileKey,
        fingerprint,
        item.uri.toString(),
        item.name,
        mode,
        item.size,
        item.modified,
        item.document,
        message);
    refreshCounts(journal);
    BackupLive.finish(item.uri.toString(), BackupLive.FAILED, message);
  }

  /** A rolling deploy can refuse connections for a few seconds; each file resumes from its checkpoint. */
  private BackupEngine.Result processWithRetry(
      BackupEngine engine,
      String scope,
      String mode,
      BackupEngine.File source,
      MediaCatalog.Item item)
      throws Exception {
    for (int attempt = 1; ; attempt++) {
      try {
        return engine.process(scope, mode, source);
      } catch (Exception error) {
        if (error instanceof Hold
            || attempt >= UploadRetryPolicy.MAX_ATTEMPTS
            || !UploadRetryPolicy.retryable(error)) throw error;
        update("网络波动，正在重试：" + item.name);
        long until = SystemClock.elapsedRealtime() + UploadRetryPolicy.delayMillis(attempt);
        while (SystemClock.elapsedRealtime() < until) {
          guard();
          try {
            Thread.sleep(Math.max(50L, Math.min(250L, until - SystemClock.elapsedRealtime())));
          } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw error;
          }
        }
      }
    }
  }

  private synchronized void resetRunCounts() {
    runSeen = runUploaded = runSkipped = runFailed = 0;
  }

  private synchronized void countRun(String result) {
    runSeen++;
    if ("UPLOADED".equals(result)) runUploaded++;
    else if ("SKIPPED".equals(result)) runSkipped++;
    else if ("FAILED".equals(result)) runFailed++;
  }

  private synchronized void refreshCounts(BackupJournal journal) {
    int[] counts = journal.scanCounts(scope);
    seen = counts[0];
    uploaded = counts[1];
    skipped = counts[2];
    failed = counts[3];
  }

  private synchronized void failure(String name, Exception e) throws Exception {
    recordTransfer(name, "", "失败：" + safeMessage(e));
    if (errors.length() < 20) errors.put(name + "：" + safeMessage(e));
  }

  private synchronized void recordTransfer(String name, String mode, String result) throws Exception {
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

  private synchronized void update(String message) {
    if (current != this || cancelled) return;
    pendingMessage = message;
    BackupLive.message(message);
    long now = SystemClock.elapsedRealtime();
    if (lastUpdate != 0 && now - lastUpdate < 1000) return;
    lastUpdate = now;
    flushUpdate();
  }

  private synchronized void flushUpdate() {
    if (current != this) return;
    settings.snapshot(
        scope,
        pendingMessage,
        "已记录 "
            + seen
            + " · 已上传 "
            + uploaded
            + " · 待补传 "
            + failed
            + " · 本轮处理 "
            + runSeen,
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
