package com.sekereagle.android

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class NativeLibraryControlsTest {
    @Test fun filtersEncodeValuesWithoutChangingTheApiScope() {
        val filter = NativeFilters(camera = "Sony & α", lens = "50/1.4", tags = setOf("tag-a"), format = "dng", rating = 4, gps = "WITH", from = "2026-10-01", to = "2026-10-22")
        val query = filter.parameters(java.time.ZoneOffset.UTC)
        assertEquals("Sony & α", query["cameraModel"])
        assertEquals("50/1.4", query["lensModel"])
        assertEquals("tag-a", query["manualTagIds"])
        assertEquals("2026-10-01T00:00:00Z", query["createdFrom"])
        assertEquals("2026-10-22T23:59:59.999Z", query["createdTo"])
        assertEquals("4", query["rating"])
        assertTrue(NativeFilters().parameters().isEmpty())
    }
    @Test fun invalidTimeRangesNeverReachTheServer() {
        assertNotNull(NativeFilters(from = "bad").validationError())
        assertNotNull(NativeFilters(from = "2026-10-22", to = "2026-10-01").validationError())
        assertNull(NativeFilters(from = "2026-10-01").validationError())
    }
    @Test fun selectionIsBoundedAndCannotIncludeUnloadedAssets() {
        val available = (1..120).map { "id-$it" }.toSet()
        assertEquals(100, NativeSelection.all(available).size)
        assertEquals(emptySet<String>(), NativeSelection.toggle(emptySet(), "foreign", available))
        assertEquals(setOf("id-1"), NativeSelection.toggle(emptySet(), "id-1", available))
        assertTrue(NativeSelection.toggle(setOf("id-1"), "id-1", available).isEmpty())
        assertEquals(100, NativeSelection.toggle(NativeSelection.all(available), "id-120", available).size)
    }
}
