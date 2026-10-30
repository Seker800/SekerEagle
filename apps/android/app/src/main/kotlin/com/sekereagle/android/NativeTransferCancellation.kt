package com.sekereagle.android

import java.net.HttpURLConnection
import java.util.concurrent.CancellationException

/** Explicit cancellation disconnects a blocked read as well as checking between chunks. */
class NativeTransferCancellation {
    @Volatile
    var cancelled = false
        private set

    private val connections = mutableSetOf<HttpURLConnection>()

    @Synchronized
    fun bind(value: HttpURLConnection) {
        check()
        connections.add(value)
    }

    @Synchronized
    fun unbind(value: HttpURLConnection) {
        connections.remove(value)
    }

    @Synchronized
    fun cancel() {
        cancelled = true
        connections.forEach { it.disconnect() }
        connections.clear()
    }

    fun check() {
        if (cancelled || Thread.currentThread().isInterrupted) throw CancellationException()
    }

    @Synchronized
    fun <T> commit(block: () -> T): T {
        check()
        return block()
    }
}
