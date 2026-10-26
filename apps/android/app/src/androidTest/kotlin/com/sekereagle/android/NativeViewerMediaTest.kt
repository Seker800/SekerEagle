package com.sekereagle.android

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Real HTTP + decoder + editor protocol using only tiny generated media on loopback. */
class NativeViewerMediaTest {
    @get:Rule val compose = createComposeRule()
    private val app = InstrumentationRegistry.getInstrumentation().targetContext

    private class Fixture : AutoCloseable {
        val png =
            java.io
                .ByteArrayOutputStream()
                .also { out ->
                    Bitmap.createBitmap(100, 80, Bitmap.Config.ARGB_8888).apply {
                        eraseColor(Color.BLUE)
                        compress(Bitmap.CompressFormat.PNG, 100, out)
                        recycle()
                    }
                }
                .toByteArray()
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val paths = CopyOnWriteArrayList<String>()
        val writes = CopyOnWriteArrayList<String>()
        @Volatile var renderStatus = "COMPLETED"
        @Volatile var frozenRecipe = false
        @Volatile var supportsEditing = true
        @Volatile var revision = 1
        @Volatile var complete = false
        @Volatile var drops = 0
        @Volatile var revisionAfterDrop = false
        @Volatile var originalStatus = 200
        @Volatile var previewVariant = "browse"

        fun metadata() =
            JSONObject()
                .put("id", "source")
                .put("displayName", "fixture.png")
                .put("originalName", "fixture.png")
                .put("width", 100)
                .put("height", 80)
                .put("rowVersion", 3)
                .put("mediaRevision", revision)
                .put("mimeType", "image/png")
                .put("byteSize", png.size)
                .put(
                    "renditions",
                    org.json
                        .JSONArray()
                        .put(
                            JSONObject()
                                .put("id", "browse")
                                .put("revision", revision)
                                .put("kind", "PREVIEW")
                                .put("variant", previewVariant)
                                .put("status", "READY")
                                .put("mimeType", "image/png")
                                .put("byteSize", png.size)
                                .put("width", 100)
                                .put("height", 80)
                        ),
                )
                .put("chronologicalAt", "2026-10-20T12:00:00Z")
                .put(
                    "photoMetadata",
                    JSONObject()
                        .put("latitude", 31.23)
                        .put("longitude", 121.47)
                        .put("cameraModel", "Test Camera"),
                )

        val thread =
            Thread {
                    try {
                        while (!socket.isClosed) socket.accept().use { client ->
                            client.soTimeout = 10000
                            val input = java.io.BufferedInputStream(client.getInputStream())
                            fun line(): String {
                                val out = java.io.ByteArrayOutputStream()
                                while (true) {
                                    val b = input.read()
                                    if (b < 0 || b == 10) break
                                    if (b != 13) out.write(b)
                                }
                                return out.toString("UTF-8")
                            }
                            val first = line().split(' ')
                            if (first.size < 2) return@use
                            val method = first[0]
                            val path = first[1]
                            var length = 0
                            while (true) {
                                val header = line()
                                if (header.isEmpty()) break
                                if (header.startsWith("Content-Length:", true))
                                    length = header.substringAfter(':').trim().toInt()
                            }
                            val body = ByteArray(length)
                            java.io.DataInputStream(input).readFully(body)
                            paths.add(path)
                            if (method != "GET") writes.add("$method $path ${String(body)}")
                            val payload =
                                when {
                                    path.endsWith("/original") || path.contains("/renditions/") ->
                                        png
                                    path.endsWith("/media-capabilities") ->
                                        JSONObject()
                                            .put(
                                                "serverPhotoEditing",
                                                if (supportsEditing) 1 else 0,
                                            )
                                            .toString()
                                            .toByteArray()
                                    path.endsWith("/edit-recipe") ->
                                        (if (frozenRecipe && path.contains("/assets/edited/"))
                                            """{"entry":{"baseAssetId":"source","baseMediaRevision":1,"recipe":{"edits":{"marker":"frozen"}}}}"""
                                        else "{\"entry\":null}").toByteArray()
                                    path.endsWith("/assets/source") ->
                                        metadata().toString().toByteArray()
                                    path.endsWith("/edit-renders") ->
                                        "{\"id\":\"render-job\"}".toByteArray()
                                    path.endsWith("/edit-renders/render-job") -> {
                                        complete = true
                                        "{\"status\":\"$renderStatus\",\"asset\":{\"id\":\"saved\",\"name\":\"saved.png\"}}"
                                            .toByteArray()
                                    }
                                    path.endsWith("/parts/1") ->
                                        "{\"uploadUrl\":\"$origin/sekereagle-assets/synthetic?X-Amz-Signature=abc\"}"
                                            .toByteArray()
                                    path.contains("/sekereagle-assets/") -> byteArrayOf()
                                    path.endsWith("/complete") -> {
                                        complete = true
                                        "{\"assetId\":\"saved\"}".toByteArray()
                                    }
                                    path.endsWith("/uploads") ->
                                        "{\"id\":\"upload\",\"partSize\":5242880}".toByteArray()
                                    path.endsWith("/uploads/upload") ->
                                        (if (complete)
                                                "{\"status\":\"COMPLETED\",\"eagleAssetId\":\"saved\"}"
                                            else "{\"status\":\"INITIATED\"}")
                                            .toByteArray()
                                    else -> "{}".toByteArray()
                                }
                            val type =
                                if (path.endsWith("/original") || path.contains("/renditions/"))
                                    "image/png"
                                else "application/json"
                            val output = client.getOutputStream()
                            output.write(
                                "HTTP/1.1 ${if (path.endsWith("/original")) originalStatus else 200} Result\r\nContent-Type: $type\r\nContent-Length: ${payload.size}\r\nETag: fixture\r\nConnection: close\r\n\r\n"
                                    .toByteArray()
                            )
                            if (
                                (path.endsWith("/original") || path.contains("/renditions/")) &&
                                    drops > 0
                            ) {
                                drops--
                                if (revisionAfterDrop) revision++
                                output.write(payload, 0, payload.size / 2)
                            } else output.write(payload)
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            thread.join(11000)
        }
    }

    private fun repo(fixture: Fixture): NativeGalleryRepository {
        BackupSettings(app)
            .saveToken(
                "native-session:${fixture.origin}",
                JSONObject().put("sekereagle_access", "synthetic").toString(),
            )
        NativeCity.initialize(app)
        return NativeGalleryRepository(
            NativeSession.open(app, fixture.origin),
            "synthetic-owner:${fixture.origin}",
        )
    }

    @Test
    fun olderServerCanPreviewButCannotSubmitUnsupportedRender() {
        Fixture().use { f ->
            f.supportsEditing = false
            val repo = repo(f)
            NativeEditorSession(
                    app,
                    repo,
                    GalleryMode.PHOTO,
                    repo.parse(f.metadata(), GalleryMode.PHOTO),
                )
                .use { editor ->
                    val opened = editor.request("open", JSONObject()) as JSONObject
                    assertFalse(opened.getBoolean("serverEditing"))
                    assertArrayEquals(f.png, editor.source().file.readBytes())
                    try {
                        editor.request("saveRecipe", JSONObject())
                        fail("Unsupported render must be blocked before submitting")
                    } catch (error: IllegalStateException) {
                        assertTrue(error.message!!.contains("服务器编辑服务尚未更新"))
                    }
                    assertTrue(f.writes.isEmpty())
                    assertFalse(f.paths.any { it.endsWith("/original") })
                }
        }
    }

    @Test
    fun editorRecoversInterruptedSourceWithoutSavingPartialBytes() {
        Fixture().use { f ->
            f.drops = 2
            val repo = repo(f)
            NativeEditorSession(
                    app,
                    repo,
                    GalleryMode.PHOTO,
                    repo.parse(f.metadata(), GalleryMode.PHOTO),
                )
                .use { editor ->
                    editor.request("open", JSONObject())
                    assertArrayEquals(f.png, editor.source().file.readBytes())
                    assertEquals(3, f.paths.count { it.contains("/renditions/") })
                    assertFalse(f.paths.any { it.endsWith("/original") })
                    assertTrue(f.writes.isEmpty())
                }
        }
    }

    @Test
    fun editorSourceRetryIsBoundedAndCanBeRetriedByUser() {
        Fixture().use { f ->
            f.drops = 10
            val repo = repo(f)
            NativeEditorSession(
                    app,
                    repo,
                    GalleryMode.PHOTO,
                    repo.parse(f.metadata(), GalleryMode.PHOTO),
                )
                .use { editor ->
                    try {
                        editor.request("open", JSONObject())
                        fail("Incomplete source must fail")
                    } catch (_: java.io.IOException) {}
                    assertEquals(3, f.paths.count { it.contains("/renditions/") })
                    assertFalse(f.paths.any { it.endsWith("/original") })
                    f.drops = 0
                    editor.request("open", JSONObject())
                    assertArrayEquals(f.png, editor.source().file.readBytes())
                }
        }
    }

    @Test
    fun editorNeverFallsBackToAnOriginalOrFullEditRendition() {
        Fixture().use { f ->
            f.previewVariant = "edit"
            val repo = repo(f)
            NativeEditorSession(
                    app,
                    repo,
                    GalleryMode.PHOTO,
                    repo.parse(f.metadata(), GalleryMode.PHOTO),
                )
                .use { editor ->
                    try {
                        editor.request("open", JSONObject())
                        fail("Browsing preview is required")
                    } catch (_: java.io.IOException) {}
                    assertFalse(
                        f.paths.any {
                            it.endsWith("/original") ||
                                it.contains("/renditions/") ||
                                it.contains("/uploads")
                        }
                    )
                    assertTrue(f.writes.isEmpty())
                }
        }
    }

    @Test
    fun interruptedSourceCannotRetryIntoAReplacementVersion() {
        Fixture().use { f ->
            f.drops = 1
            f.revisionAfterDrop = true
            val repo = repo(f)
            try {
                runBlocking {
                    repo.original(
                        app,
                        GalleryMode.PHOTO,
                        repo.parse(f.metadata(), GalleryMode.PHOTO),
                        NativeTransferCancellation(),
                        editable = true,
                    )
                }
                fail("Replacement must not be edited as the original version")
            } catch (reason: java.io.IOException) {
                assertTrue(reason.message.orEmpty().contains("变化"))
            }
            assertEquals(1, f.paths.count { it.endsWith("/original") })
        }
    }

    @Test
    fun sourcePermissionFailureIsNotRetried() {
        Fixture().use { f ->
            f.originalStatus = 403
            val repo = repo(f)
            try {
                runBlocking {
                    repo.original(
                        app,
                        GalleryMode.PHOTO,
                        repo.parse(f.metadata(), GalleryMode.PHOTO),
                        NativeTransferCancellation(),
                        editable = true,
                    )
                }
                fail("Forbidden source")
            } catch (reason: NativeSession.Failure) {
                assertEquals(403, reason.status)
            }
            assertEquals(1, f.paths.count { it.endsWith("/original") })
        }
    }

    @Test
    fun originalIsRequestedOnlyAfterZoomAndReleasedAtFit() {
        Fixture().use { f ->
            val repo = repo(f)
            val asset = repo.parse(f.metadata(), GalleryMode.PHOTO)
            compose.setContent { ZoomPhoto(asset, repo, GalleryMode.PHOTO, true, 0f, {}, {}) }
            compose.waitForIdle()
            assertFalse(f.paths.any { it.endsWith("/original") })
            compose.onNodeWithTag("viewer-photo:source").performTouchInput { doubleClick() }
            compose.waitUntil(10000) { f.paths.any { it.endsWith("/original") } }
            compose.waitUntil(10000) { f.paths.count { it.endsWith("/assets/source") } == 2 }
            compose.onNodeWithTag("viewer-photo:source").performTouchInput { doubleClick() }
            compose.waitForIdle()
            assertEquals(1, f.paths.count { it.endsWith("/original") })
            assertTrue(asset.city?.contains("上海") == true)
        }
    }

    @Test
    fun editorSavesIndependentCopyWithFrozenSourceAndRetryDoesNotDuplicate() {
        Fixture().use { f ->
            val repo = repo(f)
            NativeEditorSession(
                    app,
                    repo,
                    GalleryMode.MATERIAL,
                    repo.parse(f.metadata(), GalleryMode.MATERIAL),
                )
                .use { editor ->
                    editor.request("open", JSONObject())
                    assertEquals(f.png.size.toLong(), editor.source().file.length())
                    val recipe = JSONObject("{\"version\":1,\"edits\":{}}")
                    editor.request("draft", JSONObject().put("recipe", recipe))
                    editor.request("saveRecipe", JSONObject().put("recipe", recipe))
                    val result = editor.request("saveStatus", JSONObject()) as JSONObject
                    assertEquals("saved", result.getJSONObject("asset").getString("id"))
                    editor.request("saveRecipe", JSONObject().put("recipe", recipe))
                    val requests =
                        f.writes.filter {
                            it.startsWith("POST /api/eagle/assets/source/edit-renders ")
                        }
                    assertEquals(2, requests.size)
                    assertEquals(
                        JSONObject(requests[0].substringAfter("edit-renders "))
                            .getString("requestId"),
                        JSONObject(requests[1].substringAfter("edit-renders "))
                            .getString("requestId"),
                    )
                    assertTrue(requests[0].contains("rowVersion\":3"))
                    assertFalse(f.paths.any { it.endsWith("/original") || it.contains("/uploads") })
                    assertFalse(f.paths.any { it.startsWith("/api/photos") })
                    try {
                        editor.request("/api/auth/me", JSONObject())
                        fail("Arbitrary API must be rejected")
                    } catch (_: java.io.IOException) {}
                    try {
                        editor.request(
                            "lutChunk",
                            JSONObject().put("offset", 1).put("data", "YQ=="),
                        )
                        fail("Out of order chunk must be rejected")
                    } catch (_: IllegalArgumentException) {}
                }
        }
    }

    @Test
    fun failedSaveGetsNewIdentityButSuccessfulRetryKeepsIdentity() {
        Fixture().use { f ->
            val repo = repo(f)
            NativeEditorSession(app, repo, GalleryMode.PHOTO, repo.parse(f.metadata(), GalleryMode.PHOTO)).use { editor ->
                editor.request("open", JSONObject())
                val input = JSONObject().put("recipe", JSONObject("{\"version\":1,\"edits\":{}}"))
                editor.request("saveRecipe", input)
                f.renderStatus = "FAILED"
                editor.request("saveStatus", JSONObject())
                editor.request("saveRecipe", input)
                f.renderStatus = "COMPLETED"
                editor.request("saveStatus", JSONObject())
                editor.request("saveRecipe", input)
                val ids = f.writes.filter { it.startsWith("POST ") }.map { JSONObject(it.substringAfter("edit-renders ")).getString("requestId") }
                assertEquals(3, ids.size)
                assertNotEquals(ids[0], ids[1])
                assertEquals(ids[1], ids[2])
            }
        }
    }

    @Test
    fun interruptedEditedCopyOpenRetainsItsFrozenRecipe() {
        Fixture().use { f ->
            f.frozenRecipe = true
            f.drops = 3
            val repo = repo(f)
            NativeEditorSession(app, repo, GalleryMode.PHOTO, repo.parse(f.metadata().put("id", "edited"), GalleryMode.PHOTO)).use { editor ->
                try {
                    editor.request("open", JSONObject())
                    fail("Interrupted preview must fail")
                } catch (_: java.io.IOException) {}
                f.drops = 0
                val opened = editor.request("open", JSONObject()) as JSONObject
                assertEquals("frozen", opened.getJSONObject("edits").getString("marker"))
                assertEquals(2, f.paths.count { it.endsWith("/assets/edited/edit-recipe") })
                assertFalse(f.paths.any { it.endsWith("/assets/source/edit-recipe") })
                assertFalse(f.paths.any { it.endsWith("/original") })
            }
        }
    }

    @Test
    fun bundledWebEditorStartsAtWatermarkRendersAndSavesOnDevice() {
        Fixture().use { f ->
            val repo = repo(f)
            var closed = false
            var openedSaved: String? = null
            compose.setContent {
                NativeTheme {
                    androidx.compose.foundation.layout.Box(
                        androidx.compose.ui.Modifier.fillMaxSize().safeDrawingPadding()
                    ) {
                        NativeEditor(
                            repo,
                            GalleryMode.PHOTO,
                            repo.parse(f.metadata(), GalleryMode.PHOTO),
                            onOpenSaved = { openedSaved = it },
                        ) {
                            closed = true
                        }
                    }
                }
            }
            fun webViews(view: android.view.View): List<android.webkit.WebView> =
                if (view is android.webkit.WebView) listOf(view)
                else if (view is android.view.ViewGroup)
                    (0 until view.childCount).flatMap { webViews(view.getChildAt(it)) }
                else emptyList()
            var web: android.webkit.WebView? = null
            compose.waitUntil(10000) {
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    web =
                        android.view.inspector.WindowInspector.getGlobalWindowViews()
                            .flatMap { webViews(it) }
                            .firstOrNull()
                }
                web != null
            }
            fun js(script: String): String {
                val result = java.util.concurrent.atomic.AtomicReference<String?>(null)
                InstrumentationRegistry.getInstrumentation().runOnMainSync {
                    web!!.evaluateJavascript(script) { result.set(it) }
                }
                compose.waitUntil(10000) { result.get() != null }
                return result.get()!!
            }
            try {
                compose.waitUntil(30000) {
                    js(
                        "Boolean(document.querySelector('nav[aria-label=\"照片编辑工具\"] button[aria-pressed=\"true\"]')?.textContent.includes('水印'))"
                    ) == "true"
                }
            } catch (error: Throwable) {
                println("EDITOR DOM: " + js("document.body.innerText"))
                println("EDITOR PATHS: " + f.paths)
                throw error
            }
            compose.waitUntil(30000) {
                js("Boolean(document.querySelector('canvas[aria-label=\"照片编辑预览\"]'))") == "true"
            }
            js(
                "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim()==='调整')?.click()"
            )
            compose.waitUntil(10000) {
                js("Boolean(document.querySelector('input[type=range]'))") == "true"
            }
            assertEquals(
                "true",
                js(
                    "document.querySelector('input[type=range]').getBoundingClientRect().width / innerWidth >= 0.7"
                ),
            )
            assertEquals(
                "true",
                js(
                    "['HSL','曲线','色彩分级'].every(label => !Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===label))"
                ),
            )
            val adjustmentScreenshot =
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            java.io
                .File(app.getExternalFilesDir(null), "native-adjustments-editor.png")
                .outputStream()
                .use { adjustmentScreenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            adjustmentScreenshot.recycle()
            js(
                "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='滤镜')?.click()"
            )
            compose.waitUntil(10000) {
                js("Boolean(document.querySelector('button[aria-label=VIV]:not(:disabled)'))") ==
                    "true"
            }
            js("document.querySelector('button[aria-label=VIV]').click()")
            js(
                "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim()==='水印')?.click()"
            )
            compose.waitUntil(30000) {
                js(
                    "Boolean(document.querySelector('button[aria-label=\"简洁叠印\"]:not(:disabled)'))"
                ) == "true"
            }
            js("document.querySelector('button[aria-label=\"简洁叠印\"]')?.click()")
            compose.waitUntil(30000) {
                js(
                    "Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim()==='保存到相册' && !b.disabled))"
                ) == "true"
            }
            assertEquals(
                js(
                    "JSON.stringify({innerHeight:innerHeight, innerWidth:innerWidth, editor:document.querySelector('[aria-label=\"编辑照片\"]').getBoundingClientRect().height, navBottom:document.querySelector('nav').getBoundingClientRect().bottom})"
                ),
                "true",
                js(
                    "document.querySelector('nav').getBoundingClientRect().bottom > innerHeight - 20"
                ),
            )
            androidx.test.espresso.Espresso.pressBack()
            compose.waitUntil(5000) {
                js("Boolean(document.querySelector('[role=alertdialog]'))") == "true"
            }
            assertFalse(closed)
            androidx.test.espresso.Espresso.pressBack()
            compose.waitUntil(5000) {
                js("!document.querySelector('[role=alertdialog]')") == "true"
            }
            val previewShot =
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val shotFile =
                java.io.File(app.getExternalFilesDir(null), "native-watermark-editor.png")
            shotFile.outputStream().use { previewShot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            previewShot.recycle()
            android.os.ParcelFileDescriptor.AutoCloseInputStream(
                    InstrumentationRegistry.getInstrumentation()
                        .uiAutomation
                        .executeShellCommand(
                            "cp ${shotFile.absolutePath} /sdcard/Download/sekereagle-test-watermark-editor.png"
                        )
                )
                .use { it.readBytes() }
            js(
                "Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim()==='保存到相册')?.click()"
            )
            try {
                compose.waitUntil(30000) { f.complete }
            } catch (error: Throwable) {
                println("EDITOR SAVE DOM: " + js("document.body.innerText"))
                println("EDITOR SAVE PATHS: " + f.paths)
                throw error
            }
            assertEquals(
                1,
                f.writes.count { it.startsWith("POST /api/photos/assets/source/edit-renders ") },
            )
            assertFalse(f.paths.any { it.endsWith("/original") || it.contains("/uploads") })
            js("fetch('https://forbidden.example.invalid/private').catch(()=>undefined)")
            assertFalse(f.paths.any { it.contains("private") })
            compose.waitUntil(10000) {
                js(
                    "Boolean(Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('查看已保存照片')))"
                ) == "true"
            }
            js(
                "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('查看已保存照片'))?.click()"
            )
            compose.waitUntil(10000) { openedSaved == "saved" }
            val screenshot =
                InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            java.io
                .File(app.getExternalFilesDir(null), "native-watermark-editor.png")
                .outputStream()
                .use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
    }

    @Test
    fun originalRejectsStaleRevisionAndCancelledEditorCannotReadOrWrite() {
        Fixture().use { f ->
            val repo = repo(f)
            val asset = runBlocking { repo.detail(GalleryMode.PHOTO, "source") }
            f.revision = 2
            try {
                runBlocking {
                    repo.original(app, GalleryMode.PHOTO, asset, NativeTransferCancellation())
                }
                fail("Stale revision")
            } catch (_: java.io.IOException) {}
            assertFalse(f.paths.any { it.endsWith("/original") })
            val editor = NativeEditorSession(app, repo, GalleryMode.PHOTO, asset)
            editor.close()
            try {
                editor.request("draft", JSONObject())
                fail("Closed editor")
            } catch (_: IllegalStateException) {}
            assertTrue(f.writes.isEmpty())
        }
    }
}
