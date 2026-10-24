package com.sekereagle.android

import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import org.json.JSONObject

/** The only embedded surface: immutable APK assets, one frozen resource, no remote navigation. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun NativeEditor(
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    asset: NativeAsset,
    onOpenSaved: (String) -> Unit = {},
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    val editorOrigin = "https://${repo.editorHost}"
    val editor = remember(repo, mode, asset.id) { NativeEditorSession(context, repo, mode, asset) }
    val executor = remember(editor) { Executors.newSingleThreadExecutor() }
    var rendererFailed by remember { mutableStateOf(false) }
    var view by remember { mutableStateOf<WebView?>(null) }
    var chooser by remember {
        mutableStateOf<android.webkit.ValueCallback<Array<android.net.Uri>>?>(null)
    }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            chooser?.onReceiveValue(uri?.let { arrayOf(it) })
            chooser = null
        }
    val close by rememberUpdatedState(onClose)
    val openSaved by rememberUpdatedState(onOpenSaved)
    BackHandler {
        view?.evaluateJavascript(
            "(() => { const buttons = [...document.querySelectorAll('[data-mobile-back]:not(:disabled)')].filter(b => !b.closest('[inert]')); const button = buttons.at(-1); if (button) { button.click(); return true; } return false; })()",
            { if (it == "false") close() },
        )
    }
    DisposableEffect(editor) {
        onDispose {
            chooser?.onReceiveValue(null)
            editor.cancellation.cancel()
            executor.execute { editor.close() }
            executor.shutdown()
            view?.apply {
                removeJavascriptInterface("EditorHost")
                stopLoading()
                destroy()
            }
        }
    }
    if (rendererFailed) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { close() },
            title = { androidx.compose.material3.Text("编辑暂时中断") },
            text = { androidx.compose.material3.Text("手机可能内存不足，请关闭后重新打开。原图不会改变。") },
            confirmButton = {
                androidx.compose.material3.TextButton({ close() }) {
                    androidx.compose.material3.Text("关闭")
                }
            },
        )
        return
    }
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = {
            WebView(it).apply {
                view = this
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess =
                    true // Only explicit system picker grants reach file inputs.
                settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                settings.setSupportMultipleWindows(false)
                settings.cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
                webChromeClient =
                    object : android.webkit.WebChromeClient() {
                        override fun onShowFileChooser(
                            webView: WebView,
                            callback: android.webkit.ValueCallback<Array<android.net.Uri>>,
                            params: FileChooserParams,
                        ): Boolean {
                            chooser?.onReceiveValue(null)
                            chooser = callback
                            picker.launch(arrayOf("*/*"))
                            return true
                        }
                    }
                webViewClient =
                    object : WebViewClient() {
                        override fun onRenderProcessGone(
                            webView: WebView,
                            detail: android.webkit.RenderProcessGoneDetail,
                        ): Boolean {
                            editor.cancellation.cancel()
                            rendererFailed = true
                            return true
                        }

                        override fun shouldOverrideUrlLoading(
                            webView: WebView,
                            request: WebResourceRequest,
                        ) = true

                        override fun shouldInterceptRequest(
                            webView: WebView,
                            request: WebResourceRequest,
                        ): WebResourceResponse {
                            fun denied() =
                                WebResourceResponse(
                                    "text/plain",
                                    "UTF-8",
                                    403,
                                    "Forbidden",
                                    emptyMap(),
                                    ByteArrayInputStream(byteArrayOf()),
                                )
                            val uri = request.url
                            if (
                                uri.scheme != "https" ||
                                    uri.host != repo.editorHost ||
                                    uri.port != -1 ||
                                    request.method != "GET"
                            )
                                return denied()
                            val path = uri.path.orEmpty()
                            if (!path.matches(Regex("/[a-zA-Z0-9_./-]+")) || path.contains(".."))
                                return denied()
                            return try {
                                if (path == "/source") {
                                    val source = editor.source()
                                    editor.cancellation.check()
                                    WebResourceResponse(
                                        source.metadata.getString("sourceMime"),
                                        null,
                                        source.file.inputStream(),
                                    )
                                } else {
                                    if (
                                        path != "/native-editor.html" &&
                                            !path.startsWith("/assets/")
                                    )
                                        return denied()
                                    val mime =
                                        when (path.substringAfterLast('.')) {
                                            "html" -> "text/html"
                                            "js" -> "text/javascript"
                                            "css" -> "text/css"
                                            "wasm" -> "application/wasm"
                                            "svg" -> "image/svg+xml"
                                            "png" -> "image/png"
                                            "woff2" -> "font/woff2"
                                            else -> "application/octet-stream"
                                        }
                                    WebResourceResponse(
                                        mime,
                                        "UTF-8",
                                        context.assets.open("editor$path"),
                                    )
                                }
                            } catch (_: Exception) {
                                denied()
                            }
                        }
                    }
                addJavascriptInterface(
                    object {
                        @JavascriptInterface
                        fun request(id: Int, action: String, payload: String) {
                            if (id < 1 || payload.length > 100_000 || executor.isShutdown) return
                            if (action == "close") {
                                editor.cancellation.cancel()
                                post { close() }
                                return
                            }
                            executor.execute {
                                val reply =
                                    try {
                                        if (action == "showSaved") {
                                            val savedId = editor.savedAssetId()
                                            post { openSaved(savedId) }
                                            return@execute
                                        }
                                        JSONObject()
                                            .put(
                                                "value",
                                                editor.request(action, JSONObject(payload)),
                                            )
                                    } catch (error: Exception) {
                                        JSONObject().put("error", error.message ?: "操作未完成，请重试")
                                    }
                                post {
                                    if (!editor.cancellation.cancelled)
                                        evaluateJavascript(
                                            "window.editorReply($id,${reply});",
                                            null,
                                        )
                                }
                            }
                        }
                    },
                    "EditorHost",
                )
                loadUrl("$editorOrigin/native-editor.html?lang=zh-CN")
            }
        },
    )
}
