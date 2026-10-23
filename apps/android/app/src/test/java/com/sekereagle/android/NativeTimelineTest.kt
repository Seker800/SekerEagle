package com.sekereagle.android

import org.junit.Assert.*
import org.junit.Test

class NativeTimelineTest {
    @Test
    fun globalIndexHandlesUnloadedDatesAndDenseSingleDays() {
        val first = NativeDay("2026-10-23", "", 99000, 0)
        val second = NativeDay("2025-01-02", "", 800, 99000)
        val last = NativeDay("2020-01-01", "", 200, 99800)
        val timeline = NativeTimeline(listOf(first, second, last), 100000)
        assertEquals(first, timeline.dayAt(0))
        assertEquals(first, timeline.dayAt(98999))
        assertEquals(second, timeline.dayAt(99000))
        assertEquals(second, timeline.dayAt(99799))
        assertEquals(last, timeline.dayAt(99800))
        assertEquals(last, timeline.dayAt(99999))
        assertEquals(first, timeline.dayAt(-1))
        assertEquals(last, timeline.dayAt(Long.MAX_VALUE))
        assertNull(NativeTimeline(emptyList(), 0).dayAt(1))
        assertEquals(first, NativeTimeline(listOf(first), 99000).dayAt(98999))
    }
}
