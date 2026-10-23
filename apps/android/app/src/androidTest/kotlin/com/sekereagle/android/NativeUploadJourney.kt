package com.sekereagle.android

import android.app.Activity
import android.app.Instrumentation
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*

/**
 * Real picker contract callback + real multipart/API. Inputs are app-owned synthetic files only.
 */
internal class NativeUploadJourney(
    private val compose: AndroidComposeTestRule<*, NativeActivity>,
    private val context: Context,
    private val session: NativeSession,
) {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val prefix = "manual-${System.nanoTime()}"

    private data class Source(val uri: Uri, val name: String, val bytes: ByteArray)

    private val sources = mutableListOf<Source>()
    private var batchId = ""

    private fun model() = ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]

    private fun create(suffix: String): Source {
        val bitmap =
            android.graphics.Bitmap.createBitmap(16, 16, android.graphics.Bitmap.Config.ARGB_8888)
        val random = java.security.SecureRandom()
        repeat(16) { bitmap.setPixel(it, 0, random.nextInt()) }
        val bytes =
            java.io
                .ByteArrayOutputStream()
                .also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                .toByteArray()
        bitmap.recycle()
        val name = "$prefix-$suffix"
        val uri =
            context.contentResolver.insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                ContentValues().apply {
                    put("_display_name", name)
                    put(
                        "mime_type",
                        if (suffix.endsWith(".pdf")) "application/pdf" else "image/png",
                    )
                    put("relative_path", "Download/SekerEagle-upload-test/")
                },
            )!!
        context.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        return Source(uri, name, bytes).also { sources.add(it) }
    }

    private fun choose(selected: List<Source>, mode: String) {
        val result =
            Intent().apply {
                data = selected.first().uri
                clipData =
                    ClipData.newRawUri("test files", selected.first().uri).also { clip ->
                        selected.drop(1).forEach { clip.addItem(ClipData.Item(it.uri)) }
                    }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        val filter =
            IntentFilter(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                addDataType("*/*")
            }
        val monitor =
            instrumentation.addMonitor(
                filter,
                Instrumentation.ActivityResult(Activity.RESULT_OK, result),
                true,
            )
        val previous = model().transfers.state.value.batches.map { it.id }.toSet()
        try {
            compose.onNodeWithContentDescription("更多操作").performClick()
            compose.onNodeWithText("上传").performClick()
            compose.waitUntil(15000) {
                model().transfers.state.value.batches.any { it.id !in previous }
            }
            assertTrue(monitor.hits > 0)
            val batch = model().transfers.state.value.batches.first { it.id !in previous }
            batchId = batch.id
            assertEquals(mode, batch.mode.title)
            compose.onNodeWithTag("native-upload-dialog").assertDoesNotExist()
            compose.onNodeWithTag("native-library").assertExists()
        } finally {
            instrumentation.removeMonitor(monitor)
        }
    }

    private fun finish(uploaded: Int, skipped: Int) {
        compose.runOnUiThread { model().openTransfers() }
        compose.waitUntil(30000) {
            model()
                .transfers
                .state
                .value
                .batches
                .firstOrNull { it.id == batchId }
                ?.let {
                    !it.waiting &&
                        it.progress?.phase == NativeUploadPhase.FINISHED &&
                        it.progress.uploaded == uploaded &&
                        it.progress.skipped == skipped
                } == true
        }
        compose
            .onNodeWithTag("upload-summary:$batchId")
            .performScrollTo()
            .assertTextEquals("已上传 $uploaded · 重复跳过 $skipped")
    }

    private fun dismiss() {
        compose.runOnUiThread { model().back() }
        compose.onNodeWithTag("native-transfers").assertDoesNotExist()
    }

    private fun list(mode: GalleryMode): List<JSONObject> {
        val items =
            session
                .json(
                    "GET",
                    "/api/${if (mode == GalleryMode.PHOTO) "photos" else "eagle"}/assets?search=$prefix&limit=100",
                )
                .getJSONArray("items")
        return (0 until items.length()).map { items.getJSONObject(it) }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        Thread.sleep(250)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        java.io.File(context.getExternalFilesDir(null), name).outputStream().use {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
        bitmap.recycle()
    }

    fun verify() {
        val model = ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
        val scope = model.state.value.identity!!.scope
        val settings = BackupSettings(context)
        val enabled = settings.flag(scope, "enabled", false)
        val rules = settings.rules(scope).toString()
        try {
            val first = create("one.png")
            val second = create("two.png")
            val invalid = create("invalid.pdf")
            choose(listOf(first, first, second), "照片")
            assertEquals(
                2,
                model.transfers.state.value.batches.first { it.id == batchId }.entries.size,
            )
            capture("native-upload-confirm.png")
            finish(2, 0)
            val photo = list(GalleryMode.PHOTO)
            assertEquals(2, photo.size)
            for (source in listOf(first, second)) {
                val id = photo.first { it.getString("originalName") == source.name }.getString("id")
                assertArrayEquals(source.bytes, session.media("/api/photos/assets/$id/original"))
            }
            capture("native-upload-result.png")
            dismiss()
            choose(listOf(first, second), "照片")
            finish(0, 2)
            dismiss()
            val old = photo.first { it.getString("originalName") == first.name }.getString("id")
            session.json(
                "POST",
                "/api/photos/assets/batch/trash",
                JSONObject().put("assetIds", JSONArray(listOf(old))),
            )
            choose(listOf(first), "照片")
            finish(1, 0)
            dismiss()
            assertFalse(
                list(GalleryMode.PHOTO)
                    .first { it.getString("originalName") == first.name }
                    .getString("id") == old
            )
            choose(listOf(second, invalid), "照片")
            finish(0, 1)
            compose.onNodeWithText("1 项失败").assertExists()
            context.contentResolver.update(
                invalid.uri,
                ContentValues().apply {
                    put("_display_name", "$prefix-fixed.png")
                    put("mime_type", "image/png")
                },
                null,
                null,
            )
            context.contentResolver.delete(
                second.uri,
                null,
                null,
            ) // Retry must not read an already successful input again.
            compose.onNodeWithText("重试未完成项").performScrollTo().performClick()
            finish(1, 1)
            dismiss()
            compose.onNodeWithTag("mode:MATERIAL").performClick()
            choose(listOf(first), "素材")
            finish(1, 0)
            dismiss()
            val material = list(GalleryMode.MATERIAL).single()
            assertTrue(photo.none { it.getString("id") == material.getString("id") })
            assertArrayEquals(
                first.bytes,
                session.media("/api/eagle/assets/${material.getString("id")}/original"),
            )
            compose.onNodeWithTag("mode:PHOTO").performClick()
            compose.runOnIdle {
                assertTrue(model.prepareUploadSelection())
                model.switchMode(GalleryMode.MATERIAL)
                model.acceptUploadSelection(listOf(first.uri))
                model.switchMode(GalleryMode.PHOTO)
            }
            compose.onNodeWithTag("native-upload-dialog").assertDoesNotExist()
            assertEquals(enabled, settings.flag(scope, "enabled", false))
            assertEquals(rules, settings.rules(scope).toString())
        } finally {
            sources.forEach { runCatching { context.contentResolver.delete(it.uri, null, null) } }
            GalleryMode.entries.forEach { mode ->
                runCatching {
                    val ids = list(mode).map { it.getString("id") }
                    if (ids.isNotEmpty())
                        session.json(
                            "POST",
                            "/api/${if(mode == GalleryMode.PHOTO) "photos" else "eagle"}/assets/batch/trash",
                            JSONObject().put("assetIds", JSONArray(ids)),
                        )
                }
            }
        }
    }
}
