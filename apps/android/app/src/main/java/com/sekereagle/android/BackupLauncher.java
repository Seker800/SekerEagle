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
 * Manual transfers use user-initiated data transfer jobs on Android 14+; older devices and
 * automatic runs fall back to the bounded foreground service.
 */
final class BackupLauncher {
  static final int JOB_ID = 7301;

  private BackupLauncher() {}

  static boolean start(Context context, String scope, boolean manual) {
    if (scope == null || scope.isEmpty()) return false;
    if (manual && Build.VERSION.SDK_INT >= 34 && scheduleJob(context)) return true;
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
  private static boolean scheduleJob(Context context) {
    JobScheduler scheduler = context.getSystemService(JobScheduler.class);
    if (scheduler == null) return false;
    NetworkRequest network =
        new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build();
    JobInfo info =
        new JobInfo.Builder(
                JOB_ID, new ComponentName(context, BackupTransferJobService.class))
            .setUserInitiated(true)
            .setRequiredNetwork(network)
            // A generous estimate keeps the system from stopping a large resumable backup early.
            .setEstimatedNetworkBytes(1L << 30, 1L << 30)
            .build();
    return scheduler.schedule(info) == JobScheduler.RESULT_SUCCESS;
  }
}
