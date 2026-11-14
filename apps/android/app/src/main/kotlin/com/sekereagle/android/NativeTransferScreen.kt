package com.sekereagle.android

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import java.util.Locale
import kotlinx.coroutines.*

private data class BackupTransferView(
    val running: Boolean = false,
    val enabled: Boolean = false,
    val paused: Boolean = false,
    val status: String = "尚未开启自动备份",
    val counts: String = "",
)

private const val STATE_UPLOADING = "上传中"
private const val STATE_FAILED = "失败"
private const val STATE_QUEUED = "排队中"
private const val STATE_PAUSED = "待继续"
private const val STATE_DONE = "已上传"

private data class TransferRowView(
    val key: String,
    val uri: Uri,
    val name: String,
    val size: Long,
    val state: String,
    val detail: String = "",
    val bytes: Long = 0,
    val batchId: String? = null,
) {
    val rank: Int
        get() =
            when (state) {
                STATE_UPLOADING -> 0
                STATE_FAILED -> 1
                STATE_QUEUED, STATE_PAUSED -> 2
                else -> 3
            }
}

/** One destination for manual uploads and automatic backup; both shown per file, never per batch. */
@Composable
fun NativeTransferScreen(
    state: GalleryState,
    model: NativeGalleryViewModel,
    openNative: (String) -> Unit,
) {
    val identity = state.identity ?: return
    val context = LocalContext.current
    val queue by model.transfers.state.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var completedOpen by rememberSaveable { mutableStateOf(false) }
    var operationsOpen by rememberSaveable { mutableStateOf(false) }
    val backup by
        produceState(BackupTransferView(), identity.scope) {
            val settings = BackupSettings(context)
            while (isActive) {
                value =
                    withContext(Dispatchers.IO) {
                        BackupTransferView(
                            BackupService.isRunning(identity.scope),
                            settings.flag(identity.scope, "enabled", false),
                            settings.flag(identity.scope, "userPaused", false),
                            settings.value(identity.scope, "status", "尚未开始备份"),
                            settings.value(identity.scope, "counts", ""),
                        )
                    }
                delay(1000)
            }
        }
    val live by
        produceState(BackupLive.snapshot(), identity.scope) {
            while (isActive) {
                value = BackupLive.snapshot()
                delay(400)
            }
        }
    var failures by
        remember(identity.scope) { mutableStateOf<List<BackupJournal.Retry>>(emptyList()) }
    // Load once on entry so known failures stay visible while a run is starting, then refresh
    // whenever a run completes.
    LaunchedEffect(identity.scope) {
        failures =
            withContext(Dispatchers.IO) {
                runCatching { BackupJournal(context).use { it.failures(identity.scope) } }
                    .getOrDefault(emptyList())
            }
    }
    LaunchedEffect(identity.scope, live.running, backup.running) {
        if (!live.running && !backup.running) {
            failures =
                withContext(Dispatchers.IO) {
                    runCatching {
                            BackupJournal(context).use { it.failures(identity.scope) }
                        }
                        .getOrDefault(emptyList())
                }
        }
    }
    var operationError by remember(identity.scope) { mutableStateOf<String?>(null) }
    val operationLifecycle = LocalLifecycleOwner.current.lifecycle
    val operations by
        produceState(emptyList<NativeAssetOperation>(), identity.scope, operationLifecycle) {
            operationLifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try {
                        value = model.readAssetOperations()
                        operationError = null
                    } catch (reason: kotlinx.coroutines.CancellationException) {
                        throw reason
                    } catch (reason: Exception) {
                        operationError = "后台操作进度暂时无法读取：${reason.message.orEmpty()}"
                    }
                    delay(if (value.any { it.pending }) 1500 else 30000)
                }
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

    val autoRows =
        remember(live, failures, identity.scope) {
            val rows = mutableListOf<TransferRowView>()
            val seen = HashSet<String>()
            val current = live.scope == identity.scope
            val liveRows = if (current) live.rows else emptyList()
            liveRows.forEach { row ->
                seen.add(row.uri)
                val stopped = !current || !live.running
                val state =
                    when (row.state) {
                        BackupLive.UPLOADING -> if (stopped) STATE_PAUSED else STATE_UPLOADING
                        BackupLive.FAILED -> STATE_FAILED
                        BackupLive.UPLOADED, BackupLive.SKIPPED -> STATE_DONE
                        else -> if (stopped) STATE_PAUSED else STATE_QUEUED
                    }
                rows.add(
                    TransferRowView(
                        row.uri,
                        Uri.parse(row.uri),
                        row.name,
                        row.size,
                        state,
                        when {
                            state == STATE_FAILED -> row.error
                            state == STATE_UPLOADING && row.bytes == 0L -> "校验中"
                            else -> ""
                        },
                        row.bytes,
                    )
                )
            }
            failures.forEach { failure ->
                if (failure.uri !in seen)
                    rows.add(
                        TransferRowView(
                            "${failure.key}:pending",
                            Uri.parse(failure.uri),
                            failure.name,
                            failure.size,
                            STATE_FAILED,
                            failure.error,
                        )
                    )
            }
            rows.sortedBy { it.rank }
        }
    val batches =
        remember(queue.batches, queue.activeId, identity.scope) {
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
        }
    val uploadRows =
        remember(batches, queue.activeId) {
            batches.flatMap { batch ->
                val progress = batch.progress
                val active = queue.activeId == batch.id
                batch.entries.map { entry ->
                    val issue = progress?.issues?.firstOrNull { it.entry.uri == entry.uri }
                    val done = entry.uri in progress?.completedEntries.orEmpty()
                    val uploading = active && progress != null && progress.current == entry.name
                    val state =
                        when {
                            done -> STATE_DONE
                            issue != null -> STATE_FAILED
                            uploading -> STATE_UPLOADING
                            batch.paused -> STATE_PAUSED
                            else -> STATE_QUEUED
                        }
                    TransferRowView(
                        "${batch.id}:${entry.uri}",
                        entry.uri,
                        entry.name,
                        if (uploading) progress!!.size else entry.size,
                        state,
                        when {
                            issue != null -> issue.reason
                            uploading -> progress!!.stage
                            batch.paused -> batch.message
                            else -> batch.message
                        },
                        if (uploading) progress!!.bytes else 0,
                        batch.id,
                    )
                }
            }
                .sortedBy { it.rank }
        }
    val autoFailures = autoRows.count { it.state == STATE_FAILED }
    val uploadFailed = uploadRows.count { it.state == STATE_FAILED }
    val uploadWorking = batches.any { it.id == queue.activeId || it.waiting }
    val uploadResumable = batches.any { it.id != queue.activeId && it.unfinished.isNotEmpty() }
    val uploadDoneBatches = batches.filter { it.unfinished.isEmpty() }
    val uploadFailedBatches = batches.filter { it.progress?.issues?.isNotEmpty() == true }

    Column(Modifier.fillMaxSize().background(Color.Black).testTag("native-transfers")) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ model.back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回图库") }
            Text("传输列表", style = MaterialTheme.typography.titleLarge)
        }
        TabRow(selectedTabIndex = tab, containerColor = Color.Black) {
            Tab(
                selected = tab == 0,
                onClick = { tab = 0 },
                text = { Text("自动备份") },
                modifier = Modifier.testTag("transfer-tab-backup"),
            )
            Tab(
                selected = tab == 1,
                onClick = { tab = 1 },
                text = { Text("上传队列") },
                modifier = Modifier.testTag("transfer-tab-manual"),
            )
        }
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (tab == 0)
                autoBackupContent(
                    backup = backup,
                    liveRunning = live.running && live.scope == identity.scope,
                    liveMessage = live.message,
                    rows = autoRows,
                    failed = autoFailures,
                    completedOpen = completedOpen,
                    onCompletedOpen = { completedOpen = it },
                    onStart = ::scanAndBackup,
                    onPause = { BackupService.pause(context) },
                    onRetry = { BackupService.retryFailed(context, identity.scope) },
                    onSettings = { openNative("backup") },
                    permissionMessage = permissionMessage,
                )
            else
                uploadQueueContent(
                    scope = identity.scope,
                    rows = uploadRows,
                    failed = uploadFailed,
                    working = uploadWorking,
                    resumable = uploadResumable,
                    doneBatches = uploadDoneBatches.size,
                    failedBatches = uploadFailedBatches,
                    completedOpen = completedOpen,
                    onCompletedOpen = { completedOpen = it },
                    onPauseAll = { model.transfers.pauseAll(identity.scope) },
                    onResumeAll = { model.transfers.resumeAll(identity.scope) },
                    onClearCompleted = { model.transfers.removeCompleted(identity.scope) },
                    onRetryEntry = { batchId, uri -> model.transfers.retryEntry(batchId, uri) },
                )
            if (queue.error != null)
                item { Text(queue.error.orEmpty(), color = MaterialTheme.colorScheme.error) }
            if (operationError != null)
                item { Text(operationError.orEmpty(), color = MaterialTheme.colorScheme.error) }
            operationsContent(operations, operationsOpen) { operationsOpen = it }
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
                Text(
                    "重复文件沿用服务器现有分类；私密内容不会出现在原生公开图库。后台任务受系统网络、电量和执行时限约束。",
                    color = NativeMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

private fun LazyListScope.autoBackupContent(
    backup: BackupTransferView,
    liveRunning: Boolean,
    liveMessage: String,
    rows: List<TransferRowView>,
    failed: Int,
    completedOpen: Boolean,
    onCompletedOpen: (Boolean) -> Unit,
    onStart: () -> Unit,
    onPause: () -> Unit,
    onRetry: () -> Unit,
    onSettings: () -> Unit,
    permissionMessage: String?,
) {
    val done = rows.count { it.state == STATE_DONE }
    item {
        GlassSurface(Modifier.fillMaxWidth(), radius = 22) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudUpload, null)
                    Text(
                        if (liveRunning) liveMessage.ifEmpty { "正在备份" } else backup.status,
                        Modifier.weight(1f).padding(start = 10.dp),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    TextButton(onSettings) { Text("备份设置") }
                }
                Text(
                    if (backup.counts.isBlank()) "尚未开始备份"
                    else backup.counts,
                    color = NativeMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
                if (liveRunning && rows.isNotEmpty()) {
                    Text(
                        "已完成 $done / ${rows.size}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    LinearProgressIndicator(
                        progress = {
                            if (rows.isEmpty()) 0f
                            else (done.toFloat() / rows.size).coerceIn(0f, 1f)
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else if (liveRunning) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (liveRunning) TextButton(onPause) { Text("暂停") }
                    else if (backup.enabled) TextButton(onStart) { Text("立即备份") }
                    if (failed > 0) TextButton(onRetry) { Text("重试失败 $failed") }
                }
                if (backup.paused) Text("备份已暂停，点「立即备份」继续", color = NativeMuted)
                permissionMessage?.let {
                    Text(it, color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    if (rows.isEmpty())
        item {
            Text(
                "暂无自动备份记录。打开「立即备份」后，这里会逐个显示正在检查和上传的文件。",
                color = NativeMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    val visible = rows.filter { it.state != STATE_DONE }
    items(visible, key = { it.key }) {
        TransferRow(it, onRetry = if (it.state == STATE_FAILED) onRetry else null)
    }
    if (done > 0) {
        item {
            CollapsedRow("已完成 $done 个", completedOpen) { onCompletedOpen(!completedOpen) }
        }
        if (completedOpen)
            items(rows.filter { it.state == STATE_DONE }, key = { it.key }) { TransferRow(it) }
    }
}

private fun LazyListScope.uploadQueueContent(
    scope: String,
    rows: List<TransferRowView>,
    failed: Int,
    working: Boolean,
    resumable: Boolean,
    doneBatches: Int,
    failedBatches: List<NativeTransferBatch>,
    completedOpen: Boolean,
    onCompletedOpen: (Boolean) -> Unit,
    onPauseAll: () -> Unit,
    onResumeAll: () -> Unit,
    onClearCompleted: () -> Unit,
    onRetryEntry: (String, Uri) -> Unit,
) {
    val done = rows.count { it.state == STATE_DONE }
    val uploading = rows.count { it.state == STATE_UPLOADING }
    val queued = rows.count { it.state == STATE_QUEUED || it.state == STATE_PAUSED }
    item {
        GlassSurface(Modifier.fillMaxWidth(), radius = 22) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    when {
                        uploading > 0 -> "正在上传 $uploading 个文件"
                        queued > 0 -> "还有 $queued 个文件排队"
                        failed > 0 -> "$failed 个文件上传失败"
                        done > 0 -> "上传完成"
                        else -> "暂无手动上传"
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (rows.isNotEmpty())
                    Text(
                        "已完成 $done · 排队 $queued · 失败 $failed",
                        color = NativeMuted,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.testTag("upload-status"),
                    )
                val current = rows.firstOrNull { it.state == STATE_UPLOADING }
                if (current != null) {
                    Text(
                        current.name + if (current.detail.isBlank()) "" else " · ${current.detail}",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (current.size > 0)
                        LinearProgressIndicator(
                            progress = {
                                (current.bytes.toDouble() / current.size)
                                    .toFloat()
                                    .coerceIn(0f, 1f)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    else LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (working) TextButton(onPauseAll) { Text("暂停全部") }
                    if (resumable) TextButton(onResumeAll) { Text("继续") }
                    if (failedBatches.isNotEmpty() && !working)
                        TextButton(onResumeAll) { Text("重试失败 $failed") }
                    if (doneBatches > 0)
                        TextButton(onClearCompleted) { Text("清理已完成") }
                }
            }
        }
    }
    if (rows.isEmpty())
        item {
            Text(
                "暂无手动上传任务。可从图库右上角选择上传，提交后继续浏览。",
                color = NativeMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    val visible = rows.filter { it.state != STATE_DONE }
    items(visible, key = { it.key }) { row ->
        TransferRow(
            row,
            onRetry =
                if (row.state == STATE_FAILED && row.batchId != null)
                    ({ onRetryEntry(row.batchId, row.uri) })
                else null,
        )
    }
    if (done > 0) {
        item { CollapsedRow("已完成 $done 个", completedOpen) { onCompletedOpen(!completedOpen) } }
        if (completedOpen)
            items(rows.filter { it.state == STATE_DONE }, key = { it.key }) { TransferRow(it) }
    }
    if (scope.isNotEmpty() && rows.isEmpty() && doneBatches > 0) {
        item { Text("$doneBatches 个历史任务已全部完成", color = NativeMuted) }
    }
}

private fun LazyListScope.operationsContent(
    operations: List<NativeAssetOperation>,
    expanded: Boolean,
    onExpanded: (Boolean) -> Unit,
) {
    val pending = operations.filter { it.pending }
    val finished = operations.filterNot { it.pending }
    items(pending, key = { "operation:${it.mode}:${it.id}" }) { operation ->
        GlassSurface(Modifier.fillMaxWidth(), radius = 22) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(operation.title, style = MaterialTheme.typography.titleMedium)
                Text(operation.progress)
                if (operation.pending) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (operation.failed > 0)
                    Text(
                        "失败项的源文件仍保留，请返回图库核对后重新选择发送。",
                        color = NativeMuted,
                        style = MaterialTheme.typography.bodySmall,
                    )
            }
        }
    }
    if (finished.isNotEmpty()) {
        item {
            CollapsedRow("后台操作记录 ${finished.size}", expanded) { onExpanded(!expanded) }
        }
        if (expanded)
            items(finished, key = { "operation:${it.mode}:${it.id}" }) { operation ->
                Column(Modifier.padding(horizontal = 4.dp, vertical = 6.dp)) {
                    Text(operation.title, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        operation.progress,
                        color = NativeMuted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
    }
}

@Composable
private fun TransferRow(row: TransferRowView, onRetry: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth()
            .background(Color(0xFF17171A), RoundedCornerShape(16.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MediaThumbnail(row.uri)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(
                row.name,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.bodyMedium,
            )
            val size = formatBytes(row.size)
            val percent =
                if (row.size > 0 && row.state == STATE_UPLOADING)
                    " · ${(row.bytes * 100 / row.size).coerceIn(0, 100)}%"
                else ""
            Text(
                size + percent + if (row.detail.isBlank()) "" else " · ${row.detail}",
                color = if (row.state == STATE_FAILED) MaterialTheme.colorScheme.error else NativeMuted,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (row.state == STATE_UPLOADING && row.size > 0)
                LinearProgressIndicator(
                    progress = {
                        (row.bytes.toDouble() / row.size).toFloat().coerceIn(0f, 1f)
                    },
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                row.state,
                color =
                    when (row.state) {
                        STATE_FAILED -> MaterialTheme.colorScheme.error
                        STATE_UPLOADING -> MaterialTheme.colorScheme.primary
                        else -> NativeMuted
                    },
                style = MaterialTheme.typography.labelSmall,
            )
            if (onRetry != null)
                TextButton(onClick = onRetry, contentPadding = PaddingValues(horizontal = 8.dp)) {
                    Text("重试")
                }
        }
    }
}

@Composable
private fun CollapsedRow(text: String, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .background(Color(0xFF1A1A1E), RoundedCornerShape(14.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Icon(
            if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
            contentDescription = if (expanded) "收起" else "展开",
            tint = NativeMuted,
        )
    }
}

private fun formatBytes(bytes: Long): String =
    when {
        bytes >= 1L shl 30 -> String.format(Locale.US, "%.1f GB", bytes / 1073741824.0)
        bytes >= 1L shl 20 -> String.format(Locale.US, "%.1f MB", bytes / 1048576.0)
        bytes >= 1024 -> String.format(Locale.US, "%.0f KB", bytes / 1024.0)
        else -> "$bytes B"
    }
