package com.sekereagle.android

import android.os.SystemClock

/**
 * Test-only spacing for the real login endpoint. The server keeps its five-per-minute security
 * limit; the suite must not run several accounts through it within the same window.
 */
object TestLoginThrottle {
    private const val INTERVAL_MS = 12_800L
    private var lastLoginAt = 0L

    @JvmStatic
    @Synchronized
    fun await() {
        val wait = INTERVAL_MS - (SystemClock.elapsedRealtime() - lastLoginAt)
        if (wait > 0) Thread.sleep(wait)
        lastLoginAt = SystemClock.elapsedRealtime()
    }
}
