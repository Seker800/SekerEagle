package com.sekereagle.android

import android.media.MediaDataSource
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.atomic.AtomicReference

/** Bounded authenticated random access for the platform decoder. Never caches original files. */
internal class NativeVideoSource(
    private val session: NativeSession,
    private val path: String,
    private val size: Long,
) : MediaDataSource() {
    private val ticket = session.authorizationEpoch()
    private val connection = AtomicReference<HttpURLConnection?>()
    @Volatile private var closed = false
    private var start = -1L
    private var window = ByteArray(0)

    override fun getSize() = size

    @Synchronized
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, count: Int): Int {
        if (closed) throw IOException("播放已停止")
        session.checkAuthorization(ticket)
        require(position >= 0 && offset >= 0 && count >= 0 && offset <= buffer.size - count)
        if (count == 0) return 0
        if (position >= size) return -1
        if (position < start || position >= start + window.size) {
            val next =
                session.videoRange(path, position, 524288, size, ticket) {
                    connection.set(it)
                    if (closed) {
                        it.disconnect()
                        throw IOException("播放已停止")
                    }
                }
            start = position
            window = next
        }
        if (closed) throw IOException("播放已停止")
        session.checkAuthorization(ticket)
        val index = (position - start).toInt()
        val amount = minOf(count, window.size - index)
        window.copyInto(buffer, offset, index, index + amount)
        return amount
    }

    override fun close() {
        closed = true
        connection.getAndSet(null)?.disconnect()
    }
}
