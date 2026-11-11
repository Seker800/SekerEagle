package com.sekereagle.android

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

/**
 * Sequential authenticated reads for the platform decoder. One response serves the whole
 * playback position and the player buffers ahead, so decoding never waits for a round trip per
 * window. Never caches original files.
 */
@androidx.annotation.OptIn(UnstableApi::class)
internal class NativeVideoDataSource(
    private val session: NativeSession,
    private val path: String,
    private val size: Long,
    private val uri: Uri,
) : BaseDataSource(true) {
    private val ticket = session.authorizationEpoch()
    private val connection = AtomicReference<HttpURLConnection?>()
    @Volatile private var closed = false
    private var stream: NativeVideoStream? = null
    private var remaining = 0L
    private var opened = false

    override fun open(dataSpec: DataSpec): Long {
        transferInitializing(dataSpec)
        // ExoPlayer reuses one data source across loads, so each open starts a new transfer.
        closed = false
        stream?.close()
        stream = null
        val position = dataSpec.position
        val available = size - position
        if (position < 0 || available <= 0) throw IOException("播放位置超出视频范围")
        val length =
            if (dataSpec.length == C.LENGTH_UNSET.toLong()) available
            else minOf(dataSpec.length, available)
        if (length <= 0) throw IOException("播放长度无效")
        session.checkAuthorization(ticket)
        val next =
            session.openVideoStream(path, position, length, size, ticket) { current ->
                connection.set(current)
                if (closed) {
                    current.disconnect()
                    throw IOException("播放已停止")
                }
            }
        if (closed) {
            next.close()
            throw IOException("播放已停止")
        }
        stream = next
        remaining = length
        opened = true
        transferStarted(dataSpec)
        return length
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (closed) throw IOException("播放已停止")
        if (length == 0) return 0
        if (remaining == 0L) return C.RESULT_END_OF_INPUT
        val current = stream ?: throw IOException("播放已停止")
        current.checkActive()
        val count = current.input.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
        if (count < 0) throw IOException("播放数据不完整")
        remaining -= count
        bytesTransferred(count)
        return count
    }

    override fun getUri(): Uri = uri

    override fun close() {
        closed = true
        connection.getAndSet(null)?.disconnect()
        stream?.close()
        stream = null
        remaining = 0
        if (opened) {
            opened = false
            transferEnded()
        }
    }
}

internal class NativeVideoPlayback(val uri: Uri, val factory: DataSource.Factory)

@androidx.annotation.OptIn(UnstableApi::class)
internal class NativeVideoDataSourceFactory(
    private val session: NativeSession,
    private val path: String,
    private val size: Long,
    private val uri: Uri,
) : DataSource.Factory {
    override fun createDataSource(): DataSource = NativeVideoDataSource(session, path, size, uri)
}
