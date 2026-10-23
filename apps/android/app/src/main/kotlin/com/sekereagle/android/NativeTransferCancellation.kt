package com.sekereagle.android

import java.net.HttpURLConnection
import java.util.concurrent.CancellationException

/** Explicit cancellation disconnects a blocked read as well as checking between chunks. */
class NativeTransferCancellation {
    @Volatile
    var cancelled = false
        private set

    private var connection: HttpURLConnection? = null

    @Synchronized
    fun bind(value: HttpURLConnection) {
        check()
        connection = value
    }

    @Synchronized
    fun cancel() {
        cancelled = true
        connection?.disconnect()
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
