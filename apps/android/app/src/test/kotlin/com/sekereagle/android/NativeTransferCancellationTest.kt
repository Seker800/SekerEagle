package com.sekereagle.android

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.*
import org.junit.Test

class NativeTransferCancellationTest {
    private class Connection : HttpURLConnection(URL("http://localhost")) {
        var disconnected = false

        override fun connect() {}

        override fun usingProxy() = false

        override fun disconnect() {
            disconnected = true
        }
    }

    @Test
    fun pauseDisconnectsAllParallelRequestsButNotCompletedOnes() {
        val cancellation = NativeTransferCancellation()
        val first = Connection()
        val second = Connection()
        val completed = Connection()
        cancellation.bind(first)
        cancellation.bind(second)
        cancellation.bind(completed)
        cancellation.unbind(completed)
        cancellation.cancel()
        assertTrue(first.disconnected)
        assertTrue(second.disconnected)
        assertFalse(completed.disconnected)
        assertThrows(java.util.concurrent.CancellationException::class.java) {
            cancellation.bind(Connection())
        }
    }
}
