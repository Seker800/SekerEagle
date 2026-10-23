package com.sekereagle.android

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

internal fun captureNativeEvidence(name: String) {
    if (InstrumentationRegistry.getArguments().getString("screenshots") != "true") return
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val bitmap =
        instrumentation.uiAutomation.takeScreenshot() ?: error("Cannot capture native preview")
    File(instrumentation.targetContext.getExternalFilesDir(null), name).outputStream().use {
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
    }
    bitmap.recycle()
}

@androidx.compose.runtime.Composable
internal fun NativeEvidenceHost(content: @androidx.compose.runtime.Composable () -> Unit) {
    NativeTheme {
        androidx.compose.material3.Surface(
            androidx.compose.ui.Modifier.fillMaxSize(),
            color = androidx.compose.ui.graphics.Color.Black,
        ) {
            androidx.compose.foundation.layout.Box(
                androidx.compose.ui.Modifier.fillMaxSize().safeDrawingPadding()
            ) {
                content()
            }
        }
    }
}
