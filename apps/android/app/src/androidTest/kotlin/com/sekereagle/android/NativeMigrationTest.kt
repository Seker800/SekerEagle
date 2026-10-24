package com.sekereagle.android

import android.app.Instrumentation
import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

class NativeMigrationTest {
    @Test
    fun restoredLegacyTaskMustEnterNativeMigrationBeforeLoadingTheWeb() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val settings = BackupSettings(context)
        settings.setFlag("legacy", "web-session-cleared-v1", false)
        val monitor = Instrumentation.ActivityMonitor(NativeActivity::class.java.name, null, false)
        instrumentation.addMonitor(monitor)
        try {
            ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use {
                val migrated = instrumentation.waitForMonitorWithTimeout(monitor, 5000)
                assertNotNull("Restored legacy tasks must migrate to the native launcher", migrated)
                if (migrated != null) instrumentation.runOnMainSync { migrated.finish() }
                assertTrue(settings.flag("legacy", "web-session-cleared-v1", false))
            }
        } finally {
            instrumentation.removeMonitor(monitor)
            settings.setFlag("legacy", "web-session-cleared-v1", true)
        }
    }
}
