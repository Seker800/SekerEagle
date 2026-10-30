package com.sekereagle.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

internal data class NativeTransferBatch(
    val id: String,
    val scope: String,
    val origin: String,
    val mode: GalleryMode,
    val entries: List<NativeUploadEntry>,
    val waiting: Boolean = true,
    val paused: Boolean = false,
    val progress: NativeUploadState? = null,
    val message: String = "等待上传",
) {
    val unfinished: List<NativeUploadEntry>
        get() = entries.filter { it.uri !in progress?.completedEntries.orEmpty() }
}

internal data class NativeTransferQueue(
    val batches: List<NativeTransferBatch> = emptyList(),
    val activeId: String? = null,
    val error: String? = null,
) {
    val busy: Boolean
        get() = activeId != null || batches.any { it.waiting }
}

internal data class NativeTransferEvent(
    val scope: String,
    val mode: GalleryMode,
    val unauthorized: Boolean = false,
    val message: String? = null,
)

/**
 * The application owns submitted tasks. Activities observe them and never own/cancel the worker.
 */
class NativeTransferManager private constructor(context: Context) {
    private val app = context.applicationContext
    private val settings = BackupSettings(app)
    private val store = NativeTransferStore(app)
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val commands =
        kotlinx.coroutines.channels.Channel<suspend () -> Unit>(
            kotlinx.coroutines.channels.Channel.UNLIMITED
        )
    private val mutable = MutableStateFlow(NativeTransferQueue())
    internal val state = mutable.asStateFlow()
    private val changes = MutableSharedFlow<NativeTransferEvent>(extraBufferCapacity = 20)
    internal val events = changes.asSharedFlow()
    private var downloadScope = ""
    private var downloadMode = GalleryMode.PHOTO
    internal val downloads =
        NativeDownloads(app, applicationScope) {
            changes.tryEmit(NativeTransferEvent(downloadScope, downloadMode, unauthorized = true))
        }

    internal fun startDownload(
        session: NativeSession,
        identity: NativeIdentity,
        mode: GalleryMode,
        assets: List<NativeAsset>,
    ) {
        require(
            settings.active() == identity.scope &&
                settings.origin() == identity.origin &&
                session.origin == identity.origin
        )
        if (downloads.state.value?.running == true) return
        downloadScope = identity.scope
        downloadMode = mode
        downloads.start(session, mode, assets)
    }

    private var worker: NativeUploads? = null
    private var observation: Job? = null
    private var queuedAdds = 0

    init {
        downloads.startForeground = {
            check(downloadScope == settings.active())
            startService(downloadScope)
        }
        applicationScope.launch {
            mutable.value =
                NativeTransferQueue(
                    withContext(Dispatchers.IO) { store.load() }
                        .filter { it.scope == settings.active() && it.origin == settings.origin() }
                )
            for (command in commands) try {
                command()
            } catch (_: CancellationException) {
                throw CancellationException()
            } catch (_: Exception) {
                val previous = worker
                worker?.clear()
                observation?.cancel()
                worker = null
                mutable.value =
                    mutable.value.copy(
                        activeId = null,
                        error = "传输暂未完成，请检查存储空间或登录状态后继续",
                        batches =
                            mutable.value.batches.map {
                                it.copy(waiting = false, paused = it.unfinished.isNotEmpty())
                            },
                    )
                previous?.awaitStopped()
                runCatching { persist() }
            }
        }
    }

    private fun command(block: suspend () -> Unit) {
        check(commands.trySend(block).isSuccess)
    }

    private suspend fun persist() =
        withContext(Dispatchers.IO) { store.save(mutable.value.batches) }

    private fun update(id: String, block: (NativeTransferBatch) -> NativeTransferBatch) {
        mutable.value =
            mutable.value.copy(
                batches = mutable.value.batches.map { if (it.id == id) block(it) else it }
            )
    }

    internal fun enqueue(
        session: NativeSession,
        identity: NativeIdentity,
        mode: GalleryMode,
        selected: List<Uri>,
    ) {
        val uris =
            com.sekereagle.android.core.NativeUploadPolicy.picked(selected.map { it.toString() })
                .map(Uri::parse)
        if (uris.isEmpty()) return
        session.authorizationEpoch()
        require(session.origin == identity.origin && identity.scope == settings.active()) {
            "账号已变化，请重新选择"
        }
        require(mutable.value.batches.size + queuedAdds < 20) { "传输列表已满，请先清理已完成任务" }
        queuedAdds++
        command {
            queuedAdds--
            if (settings.active() != identity.scope || settings.origin() != identity.origin) {
                changes.tryEmit(
                    NativeTransferEvent(
                        identity.scope,
                        mode,
                        message = "账号或服务已变化，请重新选择上传文件",
                    )
                )
                return@command
            }
            if (mutable.value.batches.size >= 20) {
                changes.tryEmit(
                    NativeTransferEvent(
                        identity.scope,
                        mode,
                        message = "传输列表已满，请先清理已完成任务",
                    )
                )
                return@command
            }
            val batch =
                NativeTransferBatch(
                    UUID.randomUUID().toString(),
                    identity.scope,
                    identity.origin,
                    mode,
                    uris.map {
                        NativeUploadEntry(it, it.lastPathSegment?.substringAfterLast('/') ?: "所选文件")
                    },
                )
            mutable.value =
                mutable.value.copy(batches = mutable.value.batches + batch, error = null)
            try {
                withContext(Dispatchers.IO) {
                    uris.forEach { uri ->
                        runCatching {
                            app.contentResolver.takePersistableUriPermission(
                                uri,
                                Intent.FLAG_GRANT_READ_URI_PERMISSION,
                            )
                        }
                    }
                }
                persist()
                startService(identity.scope)
            } catch (_: Exception) {
                update(batch.id) {
                    it.copy(waiting = false, paused = true, message = "系统暂未允许后台传输，点击继续重试")
                }
                persist()
            }
        }
    }

    private fun startService(scope: String) {
        app.startForegroundService(
            Intent(app, NativeUploadService::class.java).putExtra("scope", scope)
        )
    }

    internal fun dispatch(scope: String) = command { next(scope) }

    private suspend fun next(scope: String) {
        if (worker != null) return
        val batch =
            mutable.value.batches.firstOrNull { it.scope == scope && it.waiting }
                ?: run {
                    mutable.value = mutable.value.copy(activeId = null)
                    return
                }
        if (settings.active() != scope || settings.origin() != batch.origin) {
            clearNow()
            return
        }
        mutable.value = mutable.value.copy(activeId = batch.id, error = null)
        update(batch.id) { it.copy(waiting = false, paused = false, message = "读取所选文件") }
        val journal =
            withContext(Dispatchers.IO) {
                NativeManualJournal(app, scope, batch.id).also { it.retryFailures() }
            }
        val session = withContext(Dispatchers.IO) { NativeSession.open(app, batch.origin) }
        val runner =
            NativeUploads(
                    app,
                    applicationScope,
                    {
                        changes.tryEmit(NativeTransferEvent(scope, batch.mode, true))
                        clear()
                    },
                    { _, _ -> },
                    journal,
                )
                .also { worker = it }
        val base = batch.progress
        runner.prepare(session, scope, batch.mode, batch.unfinished.map { it.uri })
        observation = applicationScope.launch {
            try {
                var savedDone = -1
                runner.state
                    .filterNotNull()
                    .takeWhile { progress ->
                        // State collection remains on Main; persistence/control is serialized by
                        // commands.
                        val entries =
                            batch.entries.map { old ->
                                progress.entries.firstOrNull { it.uri == old.uri } ?: old
                            }
                        update(batch.id) {
                            it.copy(
                                entries = entries,
                                progress = progress.copy(entries = entries),
                                message =
                                    when (progress.phase) {
                                        NativeUploadPhase.PREPARING -> "读取所选文件"
                                        NativeUploadPhase.READY -> "准备上传"
                                        NativeUploadPhase.RUNNING ->
                                            progress.stage.ifEmpty { "正在上传" }
                                        NativeUploadPhase.FINISHED ->
                                            if (progress.cancelled)
                                                it.message.takeIf { _ -> it.paused } ?: "已暂停"
                                            else if (progress.issues.isNotEmpty()) "部分文件失败"
                                            else if (progress.completedEntries.size < entries.size)
                                                progress.current.ifEmpty { "传输未完成，请继续或重新登录" }
                                            else "上传完成"
                                    },
                            )
                        }
                        if (progress.phase == NativeUploadPhase.READY)
                            runner.start(
                                base?.uploaded ?: 0,
                                base?.skipped ?: 0,
                                base?.completedEntries.orEmpty(),
                            )
                        if (
                            progress.completedEntries.size != savedDone ||
                                progress.phase == NativeUploadPhase.FINISHED
                        ) {
                            savedDone = progress.completedEntries.size
                            command { persist() }
                        }
                        progress.phase != NativeUploadPhase.FINISHED
                    }
                    .collect()
                command {
                    if (worker === runner) {
                        worker = null
                        runner.clear()
                        changes.tryEmit(NativeTransferEvent(scope, batch.mode))
                        persist()
                        next(scope)
                    }
                }
            } finally {
                runner.clear()
                withContext(NonCancellable + Dispatchers.IO) {
                    runner.awaitStopped()
                    journal.close()
                }
            }
        }
    }

    internal fun pause(id: String) = command {
        update(id) { it.copy(waiting = false, paused = true, message = "已暂停") }
        if (mutable.value.activeId == id) worker?.cancel()
        persist()
    }

    internal fun resume(id: String) = command {
        val batch = mutable.value.batches.firstOrNull { it.id == id } ?: return@command
        if (
            mutable.value.activeId == id ||
                batch.scope != settings.active() ||
                batch.origin != settings.origin() ||
                batch.unfinished.isEmpty()
        )
            return@command
        update(id) { it.copy(waiting = true, paused = false, message = "等待上传") }
        persist()
        try {
            startService(batch.scope)
        } catch (_: RuntimeException) {
            update(id) { it.copy(waiting = false, paused = true, message = "请回到应用后重试") }
            persist()
        }
    }

    internal fun remove(id: String) = command {
        if (mutable.value.activeId == id) return@command
        val batch = mutable.value.batches.firstOrNull { it.id == id } ?: return@command
        mutable.value =
            mutable.value.copy(batches = mutable.value.batches.filterNot { it.id == id })
        persist()
        withContext(Dispatchers.IO) {
            BackupJournal(app).use { it.forget("manual:${batch.scope}:${batch.id}") }
        }
    }

    internal fun halt(scope: String, message: String) = command {
        mutable.value =
            mutable.value.copy(
                batches =
                    mutable.value.batches.map {
                        if (it.scope == scope && (it.waiting || it.id == mutable.value.activeId))
                            it.copy(waiting = false, paused = true, message = message)
                        else it
                    }
            )
        if (mutable.value.batches.any { it.id == mutable.value.activeId && it.scope == scope })
            worker?.cancel()
        persist()
    }

    internal fun clear() {
        // Revoke in-flight work immediately; persistent removal follows in command order.
        worker?.clear()
        downloads.clear()
        downloadScope = ""
        command { clearNow() }
    }

    private suspend fun clearNow() {
        val previous = worker
        val observer = observation
        val batches = mutable.value.batches
        previous?.clear()
        observer?.cancel()
        observation = null
        worker = null
        mutable.value = NativeTransferQueue()
        app.stopService(Intent(app, NativeUploadService::class.java))
        previous?.awaitStopped()
        observer?.join()
        persist()
        withContext(Dispatchers.IO) {
            BackupJournal(app).use { journal ->
                batches.forEach { journal.forget("manual:${it.scope}:${it.id}") }
            }
        }
    }

    companion object {
        @Volatile private var instance: NativeTransferManager? = null

        @JvmStatic
        @Synchronized
        fun get(context: Context): NativeTransferManager =
            instance ?: NativeTransferManager(context).also { instance = it }
    }
}
