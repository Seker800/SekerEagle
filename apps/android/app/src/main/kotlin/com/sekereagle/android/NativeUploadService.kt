package com.sekereagle.android

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine

/** Foreground lifetime only; task state and upload mechanics belong to the shared manager. */
class NativeUploadService : Service() {
    private val lifetime = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: NativeTransferManager
    private var target = ""
    private var observe: Job? = null
    private var wake: PowerManager.WakeLock? = null
    private var wakeUntil = 0L
    private var finished = false

    override fun onCreate() {
        super.onCreate()
        manager = NativeTransferManager.get(this)
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(
                NotificationChannel(CHANNEL, "文件传输", NotificationManager.IMPORTANCE_LOW)
            )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val scope = intent?.getStringExtra("scope").orEmpty()
        if (scope.isEmpty() || scope != BackupSettings(this).active()) {
            finished = true
            stopSelf()
            return START_NOT_STICKY
        }
        target = scope
        if (intent?.action == "pause") {
            manager.halt(target, "已暂停")
            manager.downloads.cancel()
            finished = true
            stopSelf()
            return START_NOT_STICKY
        }
        finished = false
        startForeground(
            NOTICE,
            notification("正在准备上传"),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        if (wake?.isHeld != true) {
            keepAwake(force = true)
        }
        manager.dispatch(scope)
        observe?.cancel()
        observe =
            lifetime.launch {
                combine(manager.state, manager.downloads.state) { queue, download ->
                        queue to download
                    }
                    .collectLatest { (queue, download) ->
                        val own = queue.batches.filter { it.scope == target }
                        val batch = own.firstOrNull { it.id == queue.activeId }
                        if (batch != null) {
                            keepAwake()
                            val progress = batch.progress
                            val text =
                                if (progress == null) batch.message
                                else
                                    "${batch.mode.title} · ${progress.uploaded + progress.skipped}/${batch.entries.size} · ${batch.message}"
                            getSystemService(NotificationManager::class.java)
                                .notify(NOTICE, notification(text))
                        } else if (download?.running == true) {
                            keepAwake()
                            getSystemService(NotificationManager::class.java)
                                .notify(
                                    NOTICE,
                                    notification(
                                        "已保存 ${download.completed}/${download.total} · ${download.current}"
                                    ),
                                )
                        } else if (own.none { it.waiting }) {
                            finished = true
                            stopForeground(STOP_FOREGROUND_REMOVE)
                            stopSelf(startId)
                        }
                    }
            }
        return START_NOT_STICKY
    }

    /** Renew before the platform timeout; a bounded lease must not silently expire mid-upload. */
    private fun keepAwake(force: Boolean = false) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && wake?.isHeld == true && now < wakeUntil) return
        if (wake?.isHeld == true) wake?.release()
        wake =
            getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SekerEagle:ManualTransfer")
                .apply { acquire(30 * 60 * 1000L) }
        wakeUntil = now + 25 * 60 * 1000L
    }

    private fun notification(text: String): Notification {
        val open =
            PendingIntent.getActivity(
                this,
                81,
                Intent(this, NativeActivity::class.java)
                    .putExtra("transfers", true)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val pause =
            PendingIntent.getService(
                this,
                82,
                Intent(this, NativeUploadService::class.java)
                    .setAction("pause")
                    .putExtra("scope", target),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("SekerEagle 传输列表")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "暂停传输", pause).build())
            .build()
    }

    override fun onTimeout(startId: Int, foregroundServiceType: Int) {
        manager.halt(target, "系统传输时限已到，回到传输列表继续")
        manager.downloads.cancel()
        finished = true
        stopSelf()
    }

    override fun onDestroy() {
        if (!finished) {
            manager.halt(target, "后台服务已停止，点击继续")
            manager.downloads.cancel()
        }
        lifetime.cancel()
        if (wake?.isHeld == true) wake?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL = "native-file-transfers"
        private const val NOTICE = 81
    }
}
