package com.sekereagle.android

import android.content.Context
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

internal data class NativeDownloadFailure(val asset: NativeAsset, val reason: String)

internal data class NativeDownloadState(
    val total: Int,
    val completed: Int = 0,
    val failures: List<NativeDownloadFailure> = emptyList(),
    val remaining: List<NativeAsset> = emptyList(),
    val current: String = "",
    val bytes: Long = 0,
    val size: Long = 0,
    val running: Boolean = true,
    val cancelled: Boolean = false,
)

/** One queue per native session owner; retry contains only failed or unstarted items. */
class NativeDownloads(
    context: Context,
    private val scope: CoroutineScope,
    private val unauthorized: (NativeSession) -> Unit,
) {
    private val store = NativeDownloadStore(context)
    private val generation = AtomicInteger()
    private val mutable = MutableStateFlow<NativeDownloadState?>(null)
    internal val state = mutable.asStateFlow()
    private var cancellation: NativeTransferCancellation? = null
    private var job: Job? = null
    private var connection: NativeSession? = null
    private var mode = GalleryMode.PHOTO
    internal var startForeground: (() -> Unit)? = null

    fun start(
        session: NativeSession,
        mode: GalleryMode,
        assets: List<NativeAsset>,
        completed: Int = 0,
    ) {
        if (mutable.value?.running == true || assets.isEmpty()) return
        require(
            assets.size <= NativeSelection.LIMIT &&
                assets.map { it.id }.distinct().size == assets.size
        )
        this.connection = session
        this.mode = mode
        val ticket = generation.incrementAndGet()
        val cancel = NativeTransferCancellation().also { cancellation = it }
        val initial = NativeDownloadState(total = completed + assets.size, completed = completed)
        mutable.value = initial
        try {
            startForeground?.invoke()
        } catch (_: RuntimeException) {
            mutable.value =
                initial.copy(
                    running = false,
                    cancelled = true,
                    remaining = assets,
                    current = "系统暂未允许后台传输，请回到应用后重试",
                )
            return
        }
        fun publish(value: NativeDownloadState) {
            mutable.update { if (generation.get() == ticket) value else it }
        }
        job =
            scope.launch(Dispatchers.IO) {
                var result = initial
                try {
                    for ((index, asset) in assets.withIndex()) {
                        if (cancel.cancelled) {
                            result = result.copy(cancelled = true, remaining = assets.drop(index))
                            break
                        }
                        result = result.copy(current = asset.name, bytes = 0, size = 0)
                        publish(result)
                        try {
                            var last = 0L
                            store.save(session, mode, asset, cancel) { bytes, size ->
                                val now = android.os.SystemClock.elapsedRealtime()
                                if (bytes == size || bytes == 0L || now - last > 100) {
                                    last = now
                                    publish(result.copy(bytes = bytes, size = size))
                                }
                            }
                            result = result.copy(completed = result.completed + 1)
                        } catch (reason: Exception) {
                            if (cancel.cancelled || reason is CancellationException) {
                                result =
                                    result.copy(cancelled = true, remaining = assets.drop(index))
                                break
                            }
                            if (reason is NativeSession.Failure && reason.status == 401) {
                                withContext(Dispatchers.Main) {
                                    if (generation.get() == ticket) unauthorized(session)
                                }
                                return@launch
                            }
                            result =
                                result.copy(
                                    failures =
                                        result.failures +
                                            NativeDownloadFailure(
                                                asset,
                                                reason.message ?: "下载失败，请重试",
                                            )
                                )
                        }
                    }
                } finally {
                    cancel.cancel()
                    publish(result.copy(running = false))
                }
            }
    }

    fun cancel() {
        cancellation?.cancel()
    }

    fun retry() {
        val old = mutable.value ?: return
        if (old.running) return
        val session = connection ?: return
        start(
            session,
            mode,
            (old.failures.map { it.asset } + old.remaining).distinctBy { it.id },
            old.completed,
        )
    }

    fun dismiss() {
        if (mutable.value?.running != true) mutable.value = null
    }

    fun clear() {
        generation.incrementAndGet()
        cancellation?.cancel()
        job?.cancel()
        connection = null
        mutable.value = null
    }
}
