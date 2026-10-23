package com.sekereagle.android

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

/** Foreground lifetime only; task state and upload mechanics belong to the shared manager. */
class NativeUploadService : Service() {
    private val lifetime = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var manager: NativeTransferManager
    private var target = ""
    private var observe: Job? = null
    private var wake: PowerManager.WakeLock? = null
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
            wake =
                getSystemService(PowerManager::class.java)
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SekerEagle:ManualTransfer")
                    .apply { acquire(30 * 60 * 1000L) }
        }
        manager.dispatch(scope)
        observe?.cancel()
        observe = lifetime.launch {
            manager.state.collectLatest { queue ->
                val own = queue.batches.filter { it.scope == target }
                val batch = own.firstOrNull { it.id == queue.activeId }
                if (batch != null) {
                    val progress = batch.progress
                    val text =
                        if (progress == null) batch.message
                        else
                            "${batch.mode.title} · ${progress.uploaded + progress.skipped}/${batch.entries.size} · ${batch.message}"
                    getSystemService(NotificationManager::class.java)
                        .notify(NOTICE, notification(text))
                } else if (own.none { it.waiting }) {
                    finished = true
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf(startId)
                }
            }
        }
        return START_NOT_STICKY
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
            .setSmallIcon(R.drawable.app_icon)
            .setContentTitle("SekerEagle 传输列表")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "暂停上传", pause).build())
            .build()
    }

    override fun onTimeout(startId: Int, foregroundServiceType: Int) {
        manager.halt(target, "系统传输时限已到，回到传输列表继续")
        finished = true
        stopSelf()
    }

    override fun onDestroy() {
        if (!finished) manager.halt(target, "后台服务已停止，点击继续")
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
