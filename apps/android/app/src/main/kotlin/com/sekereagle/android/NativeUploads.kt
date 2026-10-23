package com.sekereagle.android

import android.content.Context
import android.net.Uri
import com.sekereagle.android.core.BackupEngine
import com.sekereagle.android.core.NativeUploadPolicy
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

internal enum class NativeUploadPhase {
    PREPARING,
    READY,
    RUNNING,
    FINISHED,
}

internal data class NativeUploadEntry(
    val uri: Uri,
    val name: String,
    val size: Long = 0,
    val error: String? = null,
)

internal data class NativeUploadIssue(val entry: NativeUploadEntry, val reason: String)

internal data class NativeUploadState(
    val mode: GalleryMode,
    val phase: NativeUploadPhase,
    val entries: List<NativeUploadEntry>,
    val uploaded: Int = 0,
    val skipped: Int = 0,
    val issues: List<NativeUploadIssue> = emptyList(),
    val remaining: List<NativeUploadEntry> = emptyList(),
    val current: String = "",
    val stage: String = "",
    val bytes: Long = 0,
    val size: Long = 0,
    val cancelled: Boolean = false,
)

/** A selected-file queue reuses the backup engine, without enabling or editing automatic backup. */
class NativeUploads(
    context: Context,
    private val scope: CoroutineScope,
    private val unauthorized: (NativeSession) -> Unit,
    private val completed: (String, GalleryMode) -> Unit,
) {
    private val app = context.applicationContext
    private val generation = AtomicInteger()
    private val mutable = MutableStateFlow<NativeUploadState?>(null)
    internal val state = mutable.asStateFlow()
    private var session: NativeSession? = null
    private var identity = ""
    private var sessionEpoch = 0
    private var journal = NativeUploadPolicy.Journal()
    private var cancelled = AtomicBoolean()
    private var requestCancellation = NativeTransferCancellation()
    private var job: Job? = null

    fun prepare(session: NativeSession, identity: String, mode: GalleryMode, uris: List<Uri>) {
        clear()
        cancelled = AtomicBoolean()
        try {
            sessionEpoch = session.authorizationEpoch()
        } catch (_: NativeSession.Failure) {
            unauthorized(session)
            return
        }
        this.session = session
        this.identity = identity
        journal = NativeUploadPolicy.Journal()
        val ticket = generation.get()
        val guard = cancelled
        val selected =
            try {
                NativeUploadPolicy.picked(uris.map { it.toString() }).map(Uri::parse)
            } catch (reason: IllegalArgumentException) {
                mutable.value =
                    NativeUploadState(
                        mode,
                        NativeUploadPhase.FINISHED,
                        emptyList(),
                        current = reason.message.orEmpty(),
                    )
                return
            }
        if (selected.isEmpty()) return
        mutable.value = NativeUploadState(mode, NativeUploadPhase.PREPARING, emptyList())
        job =
            scope.launch(Dispatchers.IO) {
                try {
                    val catalog = MediaCatalog(app)
                    val entries = selected.mapIndexed { index, uri ->
                        if (guard.get()) throw CancellationException()
                        try {
                            catalog.selected(uri).let { NativeUploadEntry(uri, it.name, it.size) }
                        } catch (reason: Exception) {
                            NativeUploadEntry(uri, "文件 ${index + 1}", error = safeMessage(reason))
                        }
                    }
                    publish(ticket, NativeUploadState(mode, NativeUploadPhase.READY, entries))
                } catch (reason: CancellationException) {
                    throw reason
                } catch (reason: Exception) {
                    publish(
                        ticket,
                        NativeUploadState(
                            mode,
                            NativeUploadPhase.FINISHED,
                            emptyList(),
                            current = safeMessage(reason),
                        ),
                    )
                }
            }
    }

    fun start() {
        val current = mutable.value ?: return
        if (current.phase != NativeUploadPhase.READY) return
        run(current.entries, current.copy(phase = NativeUploadPhase.RUNNING))
    }

    private fun run(entries: List<NativeUploadEntry>, initial: NativeUploadState) {
        val connection = session ?: return
        val target = identity
        val authEpoch = sessionEpoch
        val taskJournal = journal
        val ticket = generation.incrementAndGet()
        val cancellation = AtomicBoolean().also { cancelled = it }
        val requestGuard = NativeTransferCancellation().also { requestCancellation = it }
        mutable.value = initial
        fun check() {
            if (cancellation.get() || generation.get() != ticket) throw CancellationException()
            connection.checkAuthorization(authEpoch)
        }
        job =
            scope.launch(Dispatchers.IO) {
                var result = initial
                try {
                    check()
                    val me =
                        connection.jsonAtEpoch(
                            authEpoch,
                            "GET",
                            "/api/auth/me",
                            cancellation = requestGuard,
                        )
                    val actual =
                        com.sekereagle.android.core.BackupPolicy.digest(
                            "${connection.origin}\n${me.getJSONObject("desktopCache").getString("deploymentId")}\n${me.getJSONObject("user").getString("id")}"
                        )
                    if (actual != target) throw NativeSession.Failure(401)
                    val catalog = MediaCatalog(app)
                    for ((index, entry) in entries.withIndex()) {
                        if (cancellation.get()) {
                            result = result.copy(cancelled = true, remaining = entries.drop(index))
                            break
                        }
                        result =
                            result.copy(
                                current = entry.name,
                                stage = "校验原文件",
                                bytes = 0,
                                size = entry.size,
                            )
                        publish(ticket, result)
                        try {
                            val item = catalog.selected(entry.uri)
                            result = result.copy(current = item.name, size = item.size)
                            var lastUpdate = 0L
                            val api =
                                NativeUploadApi(
                                    connection,
                                    authEpoch,
                                    { stage ->
                                        result = result.copy(stage = stage)
                                        publish(ticket, result)
                                    },
                                    { bytes ->
                                        val now = android.os.SystemClock.elapsedRealtime()
                                        if (now - lastUpdate > 100 || bytes >= item.size) {
                                            lastUpdate = now
                                            publish(
                                                ticket,
                                                result.copy(bytes = bytes.coerceAtMost(item.size)),
                                            )
                                        }
                                    },
                                    requestGuard,
                                )
                            val hash = catalog.hash(item, ::check)
                            val source =
                                BackupEngine.File(
                                    item.uri.toString(),
                                    item.size,
                                    item.modified,
                                    { hash },
                                    { catalog.selectedStable(item) },
                                )
                            taskJournal.verifyContent(
                                BackupEngine.fileKey(target, initial.mode.name, source),
                                hash,
                            )
                            val outcome =
                                BackupEngine(
                                        taskJournal,
                                        MultipartTransport(api, initial.mode.name, catalog, item),
                                        ::check,
                                    )
                                    .process(target, initial.mode.name, source)
                            result =
                                if (outcome == BackupEngine.Result.UPLOADED && !api.duplicate)
                                    result.copy(uploaded = result.uploaded + 1)
                                else result.copy(skipped = result.skipped + 1)
                        } catch (reason: Exception) {
                            if (cancellation.get() || reason is CancellationException) {
                                result =
                                    result.copy(cancelled = true, remaining = entries.drop(index))
                                break
                            }
                            if (
                                (reason is ApiClient.Failure && reason.invalidatesCredential()) ||
                                    (reason is NativeSession.Failure && reason.status == 401)
                            ) {
                                withContext(Dispatchers.Main) {
                                    if (generation.get() == ticket) unauthorized(connection)
                                }
                                return@launch
                            }
                            result =
                                result.copy(
                                    issues =
                                        result.issues +
                                            NativeUploadIssue(entry, safeMessage(reason))
                                )
                        }
                    }
                } catch (reason: Exception) {
                    if (reason is NativeSession.Failure && reason.status == 401) {
                        withContext(Dispatchers.Main) {
                            if (generation.get() == ticket) unauthorized(connection)
                        }
                        return@launch
                    }
                    result =
                        if (cancellation.get() || reason is CancellationException)
                            result.copy(cancelled = true, remaining = entries)
                        else result.copy(current = safeMessage(reason), remaining = entries)
                } finally {
                    publish(ticket, result.copy(phase = NativeUploadPhase.FINISHED))
                    if (generation.get() == ticket && (result.uploaded > 0 || result.skipped > 0))
                        withContext(NonCancellable + Dispatchers.Main) {
                            if (generation.get() == ticket) completed(target, initial.mode)
                        }
                }
            }
    }

    fun retry() {
        val old = mutable.value ?: return
        if (old.phase != NativeUploadPhase.FINISHED) return
        val entries = (old.issues.map { it.entry } + old.remaining).distinctBy { it.uri }
        if (entries.isEmpty()) return
        journal.retryFailures()
        run(
            entries,
            old.copy(
                phase = NativeUploadPhase.RUNNING,
                issues = emptyList(),
                remaining = emptyList(),
                current = "",
                cancelled = false,
            ),
        )
    }

    fun cancel() {
        val current = mutable.value ?: return
        if (current.phase == NativeUploadPhase.PREPARING) clear()
        else {
            cancelled.set(true)
            requestCancellation.cancel()
        }
    }

    fun dismiss() {
        val phase = mutable.value?.phase
        if (phase != NativeUploadPhase.RUNNING && phase != NativeUploadPhase.PREPARING) clear()
    }

    fun clear() {
        generation.incrementAndGet()
        cancelled.set(true)
        requestCancellation.cancel()
        job?.cancel()
        session = null
        identity = ""
        sessionEpoch = 0
        journal = NativeUploadPolicy.Journal()
        mutable.value = null
    }

    private fun publish(ticket: Int, value: NativeUploadState) {
        mutable.update { if (generation.get() == ticket) value else it }
    }

    private fun safeMessage(reason: Exception): String =
        when (reason) {
            is SecurityException -> "文件访问权限已失效，请重新选择"
            is IOException -> reason.message?.takeUnless { it.contains("://") } ?: "网络或文件读取失败，请重试"
            else -> "文件未能上传，请重新选择或重试"
        }
}
