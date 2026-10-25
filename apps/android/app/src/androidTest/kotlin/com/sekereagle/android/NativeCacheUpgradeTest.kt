package com.sekereagle.android

import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

/** Deliberately uses only 0.9.9 APIs so the write phase runs in the actual previous APK. */
class NativeCacheUpgradeTest {
    @Test
    fun encryptedCacheAndLimitSurviveCoveringApkUpgrade() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val phase = InstrumentationRegistry.getArguments().getString("cachePhase", "both")
        require(phase in listOf("write", "read", "both"))
        val root = File(app.cacheDir, "cache-test-apk-upgrade")
        val priorLimit = File(app.cacheDir, "cache-test-apk-upgrade-limit")
        val cache = NativeMediaCache(app, root)
        val id =
            cache.identity(
                "synthetic-upgrade-owner",
                "/api/photos/assets/synthetic/renditions/tiny/content",
                "v1",
            )
        val bytes = "synthetic encrypted upgrade cache fixture".toByteArray()
        if (phase != "read") {
            priorLimit.writeText(cache.limitMb.toString())
            cache.clear()
            cache.resize(256)
            cache.write(id, bytes, cache.generation)
            assertEquals(1, cache.usage().count)
        }
        if (phase != "write") {
            assertEquals(256, cache.limitMb)
            assertArrayEquals(bytes, cache.read(id))
            assertEquals(1, cache.usage().count)
            cache.clear()
            cache.resize(priorLimit.readText().toInt())
            root.deleteRecursively()
            priorLimit.delete()
        }
    }
}
