package com.sekereagle.android

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import org.json.JSONArray

private data class BackupTransferView(
    val running: Boolean = false,
    val enabled: Boolean = false,
    val status: String = "尚未开启自动备份",
    val counts: String = "",
    val rows: List<String> = emptyList(),
)

/** One normal navigation destination for manual uploads and directory backup; no modal progress. */
@Composable
fun NativeTransferScreen(
    state: GalleryState,
    model: NativeGalleryViewModel,
    openNative: (String) -> Unit,
) {
    val identity = state.identity ?: return
    val queue by model.transfers.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val backup by
        produceState(BackupTransferView(), identity.scope) {
            val settings = BackupSettings(context)
            while (isActive) {
                value =
                    withContext(Dispatchers.IO) {
                        val entries =
                            runCatching {
                                    JSONArray(settings.value(identity.scope, "transferRows", "[]"))
                                }
                                .getOrDefault(JSONArray())
                        BackupTransferView(
                            BackupService.isRunning(identity.scope),
                            settings.flag(identity.scope, "enabled", false),
                            settings.value(identity.scope, "status", "尚未开始备份"),
                            settings.value(identity.scope, "counts", ""),
                            (0 until entries.length()).map { entries.getString(it) },
                        )
                    }
                delay(1000)
            }
        }
    var notificationsAllowed by remember {
        mutableStateOf(
            androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
        )
    }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
        notificationsAllowed =
            androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
    val notificationPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            notificationsAllowed =
                androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()
        }
    var permissionMessage by remember(identity.scope) { mutableStateOf<String?>(null) }
    fun startBackup() {
        permissionMessage = null
        runCatching {
                context.startForegroundService(
                    Intent(context, BackupService::class.java)
                        .putExtra("scope", identity.scope)
                        .putExtra("manual", true)
                )
            }
            .onFailure { permissionMessage = "系统暂不允许启动备份，请回到应用后重试" }
    }
    val mediaPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            if (model.mediaPermissionGranted()) startBackup()
            else permissionMessage = "需要允许访问全部照片和视频，避免自动备份遗漏文件"
        }
    fun scanAndBackup() {
        if (model.backupNeedsMediaPermission(identity.scope) && !model.mediaPermissionGranted())
            mediaPermission.launch(model.mediaPermissionNames())
        else startBackup()
    }
    Column(Modifier.fillMaxSize().background(Color.Black).testTag("native-transfers")) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ model.back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回图库") }
            Text("传输列表", style = MaterialTheme.typography.titleLarge)
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (queue.error != null)
                item { Text(queue.error.orEmpty(), color = MaterialTheme.colorScheme.error) }
            if (!notificationsAllowed)
                item {
                    Column(Modifier.padding(12.dp)) {
                        Text("通知未开启，后台传输进度仍可在此查看")
                        TextButton({
                            if (
                                android.os.Build.VERSION.SDK_INT >= 33 &&
                                    !BackupSettings(context)
                                        .flag("notifications", "requested", false)
                            ) {
                                BackupSettings(context).setFlag("notifications", "requested", true)
                                notificationPermission.launch(
                                    android.Manifest.permission.POST_NOTIFICATIONS
                                )
                            } else {
                                context.startActivity(
                                    Intent(
                                            android.provider.Settings
                                                .ACTION_APP_NOTIFICATION_SETTINGS
                                        )
                                        .putExtra(
                                            android.provider.Settings.EXTRA_APP_PACKAGE,
                                            context.packageName,
                                        )
                                )
                            }
                        }) {
                            Text("开启传输通知")
                        }
                    }
                }
            item {
                GlassSurface(Modifier.fillMaxWidth(), radius = 22) {
                    Column(
                        Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.CloudUpload, null)
                            Text(
                                "自动备份",
                                Modifier.weight(1f).padding(start = 10.dp),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            TextButton({ openNative("backup") }) { Text("备份设置") }
                        }
                        Text(backup.status)
                        if (backup.counts.isNotBlank())
                            Text(
                                backup.counts,
                                color = NativeMuted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        if (backup.running) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            TextButton({ BackupService.pause(context) }) { Text("暂停备份") }
                        } else if (backup.enabled) TextButton({ scanAndBackup() }) { Text("扫描并备份") }
                        permissionMessage?.let {
                            Text(
                                it,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        backup.rows.takeLast(8).reversed().forEach {
                            Text(
                                it,
                                color = NativeMuted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            item { Text("手动上传", style = MaterialTheme.typography.titleMedium, color = NativeMuted) }
            val batches =
                queue.batches
                    .filter { it.scope == identity.scope && it.origin == identity.origin }
                    .asReversed()
                    .sortedBy {
                        when {
                            it.id == queue.activeId -> 0
                            it.waiting -> 1
                            it.unfinished.isNotEmpty() -> 2
                            else -> 3
                        }
                    }
            if (batches.isEmpty())
                item { Text("暂无手动上传任务。可从图库右上角选择上传，提交后继续浏览。", color = NativeMuted) }
            items(batches, key = { it.id }) { batch ->
                val active = queue.activeId == batch.id
                val progress = batch.progress
                GlassSurface(Modifier.fillMaxWidth().testTag("transfer:${batch.id}"), radius = 22) {
                    Column(
                        Modifier.padding(18.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            "${batch.mode.title} · ${batch.entries.size} 个文件",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(batch.message, color = NativeMuted)
                        Text(
                            "已上传 ${progress?.uploaded ?: 0} · 重复跳过 ${progress?.skipped ?: 0}",
                            Modifier.testTag("upload-summary:${batch.id}"),
                        )
                        if (progress?.issues?.isNotEmpty() == true)
                            Text(
                                "${progress.issues.size} 项失败",
                                color = MaterialTheme.colorScheme.error,
                            )
                        if (active) {
                            if (
                                progress != null &&
                                    progress.size > 0 &&
                                    progress.stage in setOf("上传原文件", "校验原文件")
                            )
                                LinearProgressIndicator(
                                    progress = {
                                        (progress.bytes.toDouble() / progress.size)
                                            .toFloat()
                                            .coerceIn(0f, 1f)
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            else LinearProgressIndicator(Modifier.fillMaxWidth())
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (active || batch.waiting)
                                TextButton({ model.transfers.pause(batch.id) }) { Text("暂停") }
                            else if (batch.unfinished.isNotEmpty())
                                TextButton({ model.transfers.resume(batch.id) }) {
                                    Text(
                                        if (progress?.issues?.isNotEmpty() == true) "重试未完成项"
                                        else "继续上传"
                                    )
                                }
                            if (!active)
                                TextButton({ model.transfers.remove(batch.id) }) { Text("移除记录") }
                        }
                        batch.entries.forEach { entry ->
                            val issue = progress?.issues?.firstOrNull { it.entry.uri == entry.uri }
                            val label =
                                when {
                                    entry.uri in progress?.completedEntries.orEmpty() -> "完成"
                                    issue != null -> issue.reason
                                    active && entry.name == progress?.current -> progress.stage
                                    batch.paused -> "待继续"
                                    batch.waiting -> "排队中"
                                    else -> "待处理"
                                }
                            Row(
                                Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Text(
                                    entry.name,
                                    Modifier.weight(1f),
                                    maxLines = 2,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(
                                    label,
                                    color =
                                        if (issue != null) MaterialTheme.colorScheme.error
                                        else NativeMuted,
                                    modifier = Modifier.widthIn(max = 140.dp),
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
            item {
                Text(
                    "重复文件沿用服务器现有分类；私密内容不会出现在原生公开图库。后台任务受系统网络、电量和执行时限约束。",
                    color = NativeMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
