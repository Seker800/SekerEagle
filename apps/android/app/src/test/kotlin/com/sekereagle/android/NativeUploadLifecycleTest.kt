package com.sekereagle.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeUploadLifecycleTest {
    @Test
    fun aCancelledPreparationCannotStartTransferring() {
        assertFalse(uploadMayStart(NativeUploadPhase.READY, cancelled = true))
        assertTrue(uploadMayStart(NativeUploadPhase.READY, cancelled = false))
        assertFalse(uploadMayStart(NativeUploadPhase.PREPARING, cancelled = false))
        assertFalse(uploadMayStart(NativeUploadPhase.RUNNING, cancelled = false))
        assertFalse(uploadMayStart(NativeUploadPhase.FINISHED, cancelled = false))
    }
}
