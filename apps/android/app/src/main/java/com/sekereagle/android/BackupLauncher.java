package com.sekereagle.android;

import android.annotation.TargetApi;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;

/**
 * Android 14+ runs transfers as JobScheduler jobs: manual starts use user-initiated jobs,
 * automatic starts use ordinary constrained jobs. Older devices keep the foreground service.
 */
final class BackupLauncher {
  static final int JOB_ID = 7301;
  static final int AUTO_JOB_ID = 7302;
  private static long lastAutoRequest;

  private BackupLauncher() {}

  static boolean start(Context context, String scope, boolean manual) {
    if (scope == null || scope.isEmpty()) return false;
    if (!manual) {
      if (BackupService.isRunning(scope)) return true;
      synchronized (BackupLauncher.class) {
        long now = android.os.SystemClock.elapsedRealtime();
        if (lastAutoRequest != 0 && now - lastAutoRequest < 30_000) return true;
        lastAutoRequest = now;
      }
    }
    if (Build.VERSION.SDK_INT >= 34
        && scheduleJob(context, new BackupSettings(context), scope, manual)) return true;
    try {
      context.startForegroundService(
          new Intent(context, BackupService.class)
              .putExtra("scope", scope)
              .putExtra("manual", manual));
      return true;
    } catch (RuntimeException blocked) {
      new BackupSettings(context).setValue(scope, "status", "系统暂缓后台传输，请稍后重试");
      return false;
    }
  }

  @TargetApi(34)
  private static boolean scheduleJob(
      Context context, BackupSettings settings, String scope, boolean manual) {
    JobScheduler scheduler = context.getSystemService(JobScheduler.class);
    if (scheduler == null) return false;
    NetworkRequest.Builder network =
        new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    if (!manual && settings.flag(scope, "wifi", true))
      network.addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    JobInfo.Builder builder =
        new JobInfo.Builder(
                manual ? JOB_ID : AUTO_JOB_ID,
                new ComponentName(context, BackupTransferJobService.class))
            .setRequiredNetwork(network.build());
    if (manual) {
      builder
          .setUserInitiated(true)
          // A generous estimate keeps the system from stopping a large resumable backup early.
          .setEstimatedNetworkBytes(1L << 30, 1L << 30);
    } else if (settings.flag(scope, "charging", false)) {
      builder.setRequiresCharging(true);
    }
    return scheduler.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS;
  }
}
