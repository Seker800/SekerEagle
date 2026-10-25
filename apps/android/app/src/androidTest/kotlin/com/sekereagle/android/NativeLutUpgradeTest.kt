package com.sekereagle.android

import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Dedicated origin: never touches personal editor databases in the fixed test gallery. */
class NativeLutUpgradeTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun personalLutDatabaseSurvivesCoveringApkUpgrade() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val phase = InstrumentationRegistry.getArguments().getString("lutPhase", "both")
        require(phase in listOf("write", "read", "both"))
        var ready = false
        var web: WebView? = null
        compose.setContent {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        web = this
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        webViewClient =
                            object : WebViewClient() {
                                override fun onPageFinished(view: WebView, url: String) {
                                    ready = true
                                }
                            }
                        loadDataWithBaseURL(
                            "https://lut-upgrade-fixture.sekereagle-editor.invalid/",
                            "<html><body>LUT upgrade fixture</body></html>",
                            "text/html",
                            "utf-8",
                            null,
                        )
                    }
                }
            )
        }
        compose.waitUntil(10000) { ready }
        val script =
            """
            window.result = null;
            const request = indexedDB.open('sekereagle-personal-luts-v1', 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore('entries', {keyPath:'id'});
                request.result.createObjectStore('tables');
            };
            request.onerror = () => window.result = 'open failed';
            request.onsuccess = () => {
                const db = request.result;
                const write = '${phase}' !== 'read';
                const tx = db.transaction(['entries','tables'], write ? 'readwrite' : 'readonly');
                const entries = tx.objectStore('entries'), tables = tx.objectStore('tables');
                if (write) {
                    entries.put({id:'upgrade-fixture',name:'Personal upgrade LUT',size:2,group:'My filters'});
                    tables.put({size:2,data:new Float32Array(24).fill(0.25),domainMin:[0,0,0],domainMax:[1,1,1]},'upgrade-fixture');
                } else {
                    entries.get('upgrade-fixture').onsuccess = e => window.entry = e.target.result;
                    tables.get('upgrade-fixture').onsuccess = e => window.table = e.target.result;
                }
                tx.oncomplete = () => {
                    window.result = write || (window.entry?.name === 'Personal upgrade LUT' && window.entry.group === 'My filters' && window.table?.data[23] === 0.25) ? 'ok' : 'lost';
                    db.close();
                };
                tx.onerror = () => window.result = 'transaction failed';
            };
        """
                .trimIndent()
        instrumentation.runOnMainSync { web!!.evaluateJavascript(script, null) }
        var result = "null"
        compose.waitUntil(10000) {
            instrumentation.runOnMainSync {
                web!!.evaluateJavascript("window.result") { result = it }
            }
            result != "null"
        }
        assertEquals("\"ok\"", result)
        instrumentation.runOnMainSync { web!!.destroy() }
    }
}
