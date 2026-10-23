package com.sekereagle.android;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.net.*;
import android.os.*;
import com.sekereagle.android.core.BackupEngine;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;

/** Visible, bounded foreground work. The next app opening resumes durable checkpoints. */
public final class BackupService extends Service {
  private static volatile BackupService current;

  static boolean isRunning(String scope) {
    BackupService service = current;
    return service != null && service.working.get() && service.scope.equals(scope);
  }

  static final String CHANNEL = "mobile-backup";
  static final int NOTICE = 42;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean working = new AtomicBoolean();
  private volatile boolean cancelled;
  private BackupSettings settings;
  private String scope = "";
  private int seen, uploaded, skipped, failed;
  private JSONArray errors = new JSONArray();
  private JSONArray transferRows = new JSONArray();
  private PowerManager.WakeLock wake;

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
    if (intent != null && "pause".equals(intent.getAction())) {
      cancelled = true;
      stopSelf();
      return START_NOT_STICKY;
    }
    String requested = intent == null ? "" : intent.getStringExtra("scope");
    if (requested == null || requested.isEmpty() || !requested.equals(settings.active())) {
      stopSelf();
      return START_NOT_STICKY;
    }
    if (!working.compareAndSet(false, true)) return START_NOT_STICKY;
    scope = requested;
    startForeground(NOTICE, notification("正在准备扫描"), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
    executor.execute(() -> runBackup(startId));
    return START_NOT_STICKY;
  }

  private void runBackup(int startId) {
    settings.setFlag(scope, "running", true);
    try (BackupJournal journal = new BackupJournal(this)) {
      String origin = settings.value(scope, "origin", "");
      if (!origin.equals(settings.origin())) throw new Hold("服务地址已变化，备份已暂停");
      String token = settings.token(scope);
      if (token.isEmpty()) throw new Hold("请登录并启用备份授权");
      ApiClient api = new ApiClient(origin, token);
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
      JSONArray rules = settings.scanRules(scope);
      if (rules.length() == 0) throw new Hold("请先选择备份目录");
      MediaCatalog catalog = new MediaCatalog(this);
      update("正在扫描所选目录");
      catalog.scan(
          rules,
          (item, mode) -> {
            guard();
            seen++;
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
              if (result == BackupEngine.Result.UPLOADED) uploaded++;
              else skipped++;
              recordTransfer(
                  item.name, mode, result == BackupEngine.Result.UPLOADED ? "已上传" : "已存在");
            } catch (Hold e) {
              throw e;
            } catch (ApiClient.Failure e) {
              if (e.status == 401 || e.status == 403) {
                throw e;
              }
              failure(item.name, e);
            } catch (SecurityException e) {
              failure(item.name, new IOException("文件访问权限失效，请重新授权"));
            } catch (Exception e) {
              failure(item.name, e);
            }
            update("正在扫描并备份");
          },
          this::guard);
      update(failed == 0 ? "备份完成" : "备份结束，有失败项可重试");
      settings.setValue(scope, "lastFinished", Long.toString(System.currentTimeMillis()));
    } catch (ApiClient.Failure e) {
      if (e.invalidatesCredential()) settings.setValue(scope, "credential", "");
      update(e.getMessage());
    } catch (SecurityException e) {
      update("目录权限不足，请授权照片视频或重新选择目录");
    } catch (Exception e) {
      update(safeMessage(e));
    } finally {
      if (wake != null && wake.isHeld()) wake.release();
      settings.setFlag(scope, "running", false);
      working.set(false);
      stopForeground(STOP_FOREGROUND_REMOVE);
      stopSelf();
    }
  }

  private void failure(String name, Exception e) throws Exception {
    failed++;
    recordTransfer(name, "", "失败：" + safeMessage(e));
    if (errors.length() < 20) errors.put(name + "：" + safeMessage(e));
    settings.setValue(scope, "errors", errors.toString());
  }

  private void recordTransfer(String name, String mode, String result) throws Exception {
    JSONArray recent = new JSONArray();
    for (int i = Math.max(0, transferRows.length() - 99); i < transferRows.length(); i++)
      recent.put(transferRows.get(i));
    recent.put(
        name + (mode.isEmpty() ? "" : mode.equals("PHOTO") ? " · 照片" : " · 素材") + " · " + result);
    transferRows = recent;
    settings.setValue(scope, "transferRows", transferRows.toString());
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

  private void guard() throws Hold {
    if (cancelled
        || Thread.currentThread().isInterrupted()
        || !scope.equals(settings.active())
        || !settings.flag(scope, "enabled", false)) throw new Hold("备份已暂停");
    ConnectivityManager manager = getSystemService(ConnectivityManager.class);
    NetworkCapabilities network = manager.getNetworkCapabilities(manager.getActiveNetwork());
    if (network == null || !network.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
      throw new Hold("等待网络连接");
    if (settings.flag(scope, "wifi", true)
        && !network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
        && !network.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
      throw new Hold("等待 Wi-Fi");
    Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
    if (battery != null) {
      int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
      boolean charging =
          status == BatteryManager.BATTERY_STATUS_CHARGING
              || status == BatteryManager.BATTERY_STATUS_FULL;
      if (settings.flag(scope, "charging", false) && !charging) throw new Hold("等待充电");
      int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, 100),
          scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
      if (!charging && scale > 0 && level * 100L / scale <= 15) throw new Hold("电量低于 15%，等待充电");
    }
  }

  private void update(String message) {
    settings.setValue(scope, "status", message);
    settings.setValue(
        scope,
        "counts",
        "扫描 " + seen + " · 已上传 " + uploaded + " · 已存在 " + skipped + " · 失败 " + failed);
    settings.setValue(scope, "errors", errors.toString());
    getSystemService(NotificationManager.class).notify(NOTICE, notification(message));
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
            new Intent(this, BackupService.class).setAction("pause"),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    return new Notification.Builder(this, CHANNEL)
        .setSmallIcon(R.drawable.app_icon)
        .setContentTitle("SekerEagle 手机备份")
        .setContentText(text)
        .setContentIntent(open)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .addAction(new Notification.Action.Builder(null, "暂停", pause).build())
        .build();
  }

  @Override
  public void onTimeout(int startId, int foregroundServiceType) {
    cancelled = true;
    update("系统执行时限已到，下次打开继续");
    stopSelf();
  }

  @Override
  public void onDestroy() {
    cancelled = true;
    if (current == this) current = null;
    executor.shutdownNow();
    if (wake != null && wake.isHeld()) wake.release();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
