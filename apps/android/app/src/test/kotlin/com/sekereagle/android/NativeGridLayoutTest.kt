package com.sekereagle.android

import org.junit.Assert.*
import org.junit.Test

class NativeGridLayoutTest {
    private fun asset(id: String, date: String) =
        NativeAsset(id, id, date, "", 1, 1, null, null, false, 1)

    @Test
    fun photoAnchorsIncludeDateHeadersAndLeadingControls() {
        val layout =
            NativeGridLayout(
                listOf(asset("a", "day-1"), asset("b", "day-1"), asset("c", "day-2")),
                true,
                2,
            )
        assertEquals(setOf("a", "c"), layout.dayStarts)
        assertEquals(3, layout.indexOf("a"))
        assertEquals(4, layout.indexOf("b"))
        assertEquals(6, layout.indexOf("c"))
        assertNull(layout.indexOf("missing"))
    }

    @Test
    fun materialsDoNotInsertPhotographyHeaders() {
        val layout = NativeGridLayout(listOf(asset("a", "day-1"), asset("b", "day-2")), false, 0)
        assertTrue(layout.dayStarts.isEmpty())
        assertEquals(0, layout.indexOf("a"))
        assertEquals(1, layout.indexOf("b"))
    }
}
