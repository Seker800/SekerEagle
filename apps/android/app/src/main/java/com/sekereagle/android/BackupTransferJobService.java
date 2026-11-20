package com.sekereagle.android;

import android.annotation.TargetApi;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

/**
 * On Android 14+ a user-initiated data transfer job keeps the process alive for the whole
 * resumable backup, so it no longer competes with the dataSync foreground-service time limit.
 */
public final class BackupTransferJobService extends JobService {
  private static final int NOTICE = 43;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final BackupService.JobCallbacks callbacks =
      new BackupService.JobCallbacks() {
        @Override
        public void progress(Notification notification) {
          main.post(
              () -> {
                if (params == null || stopped || finished || Build.VERSION.SDK_INT < 34) return;
                try {
                  setNotification(
                      params,
                      NOTICE,
                      notification,
                      JobService.JOB_END_NOTIFICATION_POLICY_REMOVE);
                } catch (RuntimeException ignored) {
                }
              });
        }

        @Override
        public void finished() {
          main.post(() -> finish(false));
        }
      };
  private final ServiceConnection connection =
      new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
          if (stopped || finished) return;
          ((BackupService.LocalBinder) binder).start(scope, callbacks);
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
          main.post(() -> finish(false));
        }
      };
  private JobParameters params;
  private String scope = "";
  private boolean bound;
  private boolean stopped;
  private boolean finished;

  @TargetApi(34)
  @Override
  public boolean onStartJob(JobParameters job) {
    params = job;
    scope = new BackupSettings(this).active();
    if (Build.VERSION.SDK_INT < 34 || scope.isEmpty()) {
      finish(false);
      return false;
    }
    NotificationManager manager = getSystemService(NotificationManager.class);
    manager.createNotificationChannel(
        new NotificationChannel(
            BackupService.CHANNEL, "手机备份", NotificationManager.IMPORTANCE_LOW));
    Notification notification =
        new Notification.Builder(this, BackupService.CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("SekerEagle 手机备份")
            .setContentText("正在准备扫描")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    try {
      setNotification(job, NOTICE, notification, JobService.JOB_END_NOTIFICATION_POLICY_REMOVE);
    } catch (RuntimeException ignored) {
    }
    bound =
        bindService(
            new Intent(this, BackupService.class).putExtra("scope", scope),
            connection,
            Context.BIND_AUTO_CREATE);
    if (!bound) {
      finish(false);
      return false;
    }
    return true;
  }

  @Override
  public boolean onStopJob(JobParameters job) {
    stopped = true;
    BackupService.cancel(this);
    if (bound) {
      try {
        unbindService(connection);
      } catch (IllegalArgumentException ignored) {
      }
      bound = false;
    }
    return true;
  }

  private void finish(boolean retry) {
    if (finished) return;
    finished = true;
    if (bound) {
      try {
        unbindService(connection);
      } catch (IllegalArgumentException ignored) {
      }
      bound = false;
    }
    if (!stopped && params != null) {
      try {
        jobFinished(params, retry);
      } catch (RuntimeException ignored) {
      }
    }
    params = null;
    if (!stopped) stopSelf();
  }

  @Override
  public void onDestroy() {
    if (bound) {
      try {
        unbindService(connection);
      } catch (IllegalArgumentException ignored) {
      }
      bound = false;
    }
    super.onDestroy();
  }
}
