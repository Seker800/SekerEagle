package com.sekereagle.android

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeViewportTest {
    @Test
    fun rotatingPortraitPhotoRefitsTheWholeImage() {
        assertEquals(0.5f, rotationFit(1000, 2000, 1000, 2000, 90f), 0.001f)
        assertEquals(0.5f, rotationFit(1000, 2000, 1000, 2000, 270f), 0.001f)
        assertEquals(2f, rotationFit(2000, 1000, 1000, 2000, 90f), 0.001f)
        assertEquals(1f, rotationFit(1000, 2000, 1000, 2000, 0f), 0.001f)
        assertEquals(1f, rotationFit(1000, 2000, 1000, 2000, 180f), 0.001f)
        assertEquals(1f, rotationFit(1000, 2000, 0, 0, 90f), 0.001f)
    }
}
