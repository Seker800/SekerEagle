package com.sekereagle.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** The exported launcher contains no WebView. Legacy Java screens only host backup/cleanup. */
class NativeActivity : ComponentActivity() {
    private lateinit var model: NativeGalleryViewModel
    private var revalidateOnResume = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        revalidateOnResume = savedInstanceState != null
        clearLegacyWebSessionOnce()
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        window.isNavigationBarContrastEnforced = false
        model = ViewModelProvider(this)[NativeGalleryViewModel::class.java]
        setContent {
            val state by model.state.collectAsStateWithLifecycle()
            androidx.compose.runtime.LaunchedEffect(
                state.identity,
                intent.getBooleanExtra("transfers", false),
            ) {
                if (state.identity != null && intent.getBooleanExtra("transfers", false)) {
                    intent.removeExtra("transfers")
                    model.openTransfers()
                }
            }
            NativeGalleryApp(model) { screen ->
                startActivity(
                    Intent(this, MainActivity::class.java)
                        .putExtra("nativeHost", true)
                        .putExtra("screen", screen)
                )
            }
        }
    }

    /**
     * The 0.2 upgrade made this native activity the launcher but left old WebView credentials on
     * disk. Clear them once so a restarted legacy task cannot resurrect an unencrypted session.
     */
    private fun clearLegacyWebSessionOnce() {
        LegacyWebSession.migrate(this) {}
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("transfers", false) && model.state.value.identity != null) {
            model.openTransfers()
            intent.removeExtra("transfers")
        }
    }

    override fun onStop() {
        super.onStop()
        // Rotation retains the same ViewModel and is not a user leaving the task.
        if (::model.isInitialized && !isChangingConfigurations) model.onBackground()
    }

    override fun onResume() {
        super.onResume()
        if (::model.isInitialized) {
            model.onForeground(recreated = revalidateOnResume)
            revalidateOnResume = false
        }
    }
}
