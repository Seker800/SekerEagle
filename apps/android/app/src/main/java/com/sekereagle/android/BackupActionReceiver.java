package com.sekereagle.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Notification actions never start the limited foreground service directly. */
public final class BackupActionReceiver extends BroadcastReceiver {
  static final String ACTION_PAUSE = "com.sekereagle.android.action.PAUSE_BACKUP";
  static final String ACTION_RESUME = "com.sekereagle.android.action.RESUME_BACKUP";

  @Override
  public void onReceive(Context context, Intent intent) {
    String scope = intent.getStringExtra("scope");
    if (scope == null || !scope.equals(new BackupSettings(context).active())) return;
    if (ACTION_PAUSE.equals(intent.getAction())) BackupService.pause(context);
    else if (ACTION_RESUME.equals(intent.getAction()))
      BackupLauncher.start(context, scope, true);
  }
}
