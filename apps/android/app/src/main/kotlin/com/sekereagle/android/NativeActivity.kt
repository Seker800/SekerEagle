package com.sekereagle.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider

/** The exported launcher contains no WebView. Legacy Java screens only host backup/cleanup. */
class NativeActivity : ComponentActivity() {
    private lateinit var model: NativeGalleryViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        window.isNavigationBarContrastEnforced = false
        model = ViewModelProvider(this)[NativeGalleryViewModel::class.java]
        setContent {
            NativeGalleryApp(model) { screen ->
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .putExtra("nativeHost", true)
                        .putExtra("screen", screen)
                )
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Rotation retains the same ViewModel and is not a user leaving the task.
        if (::model.isInitialized && !isChangingConfigurations) model.onBackground()
    }

    override fun onResume() {
        super.onResume()
        if (::model.isInitialized) model.onForeground()
    }
}
