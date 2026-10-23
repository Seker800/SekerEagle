package com.sekereagle.android

import android.app.Application
import android.content.ContentValues
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.sekereagle.android.core.BackupPolicy
import com.sekereagle.android.core.BackupEngine
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import org.junit.rules.ExternalResource

class NativeBackgroundTransferTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var server: Server
    private lateinit var identity: NativeIdentity
    private class Server : AutoCloseable {
        private val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val paths = CopyOnWriteArrayList<String>()
        private var held = false
        private val worker = Thread {
            try {
                while (!socket.isClosed) socket.accept().use { client ->
                    client.soTimeout = 8000
                    val reader = client.getInputStream().bufferedReader()
                    val path = reader.readLine().split(' ')[1]
                    var size = 0
                    while (true) {
                        val line = reader.readLine()
                        if (line.isEmpty()) break
                        if (line.startsWith("Content-Length:", true)) size = line.substringAfter(':').trim().toInt()
                    }
                    repeat(size) { reader.read() }
                    paths.add(path)
                    if (path.endsWith("/check-content") && !held) { held = true; entered.countDown(); release.await(20, TimeUnit.SECONDS) }
                    val body = when {
                        path == "/api/auth/me" -> """{"user":{"id":"owner","email":"fixture@example.invalid"},"desktopCache":{"deploymentId":"background"}}"""
                        path.endsWith("/check-content") -> """{"exists":false}"""
                        path.endsWith("/uploads") -> """{"id":"11111111-1111-4111-8111-111111111111","partSize":5242880}"""
                        path.endsWith("/parts") -> """{"parts":[]}"""
                        path.endsWith("/parts/1") -> """{"uploadUrl":"$origin/sekereagle-assets/test/part?X-Amz-Signature=abc"}"""
                        path.endsWith("/complete") -> """{"assetId":"uploaded","duplicate":false}"""
                        path.contains("/timeline") -> """{"days":[],"total":0}"""
                        path.contains("/assets?") -> """{"items":[],"nextCursor":null}"""
                        else -> "{}"
                    }
                    runCatching { client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: test-etag\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n$body".toByteArray()) }
                }
            } catch (_: java.io.IOException) {}
        }.apply { start() }
        override fun close() { release.countDown(); socket.close(); worker.join(9000) }
    }
    @get:Rule(order = 0) val prepare = object : ExternalResource() {
        override fun before() {
            server = Server()
            identity = NativeIdentity(BackupPolicy.digest("${server.origin}\nbackground\nowner"), "fixture@example.invalid", server.origin)
            val settings = BackupSettings(context)
            settings.origin(server.origin)
            settings.active(identity.scope)
            settings.setValue(identity.scope, "origin", server.origin)
            settings.setValue(identity.scope, "owner", "owner")
            settings.setValue(identity.scope, "deployment", "background")
            settings.setValue(identity.scope, "email", identity.email)
            settings.saveToken("native-session:${server.origin}", JSONObject().put("sekereagle_access", "fixture").toString())
        }
        override fun after() { server.close() }
    }
    @get:Rule(order = 1) val compose = createAndroidComposeRule<NativeActivity>()

    @Test fun queuedModesSurviveNavigationRecreationAndActualBackground() {
        compose.waitUntil(10000) { compose.onAllNodesWithTag("native-library").fetchSemanticsNodes().isNotEmpty() }
        val model = ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java]
        val manager = model.transfers
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put("_display_name", "background-test.png"); put("mime_type", "image/png"); put("relative_path", "Download/SekerEagle-background-test/")
        })!!
        context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(1, 2, 3)) }
        // Wait for provider metadata scanning before freezing the selected source.
        val path = context.contentResolver.query(uri, arrayOf("_data"), null, null, null)!!.use { it.moveToFirst(); it.getString(0) }
        val scanned = CountDownLatch(1)
        android.media.MediaScannerConnection.scanFile(context, arrayOf(path), null) { _, _ -> scanned.countDown() }
        assertTrue(scanned.await(5, TimeUnit.SECONDS))
        try {
            compose.runOnUiThread {
                val session = NativeSession.open(context, server.origin)
                manager.enqueue(session, identity, GalleryMode.PHOTO, listOf(uri))
                manager.enqueue(session, identity, GalleryMode.MATERIAL, listOf(uri))
            }
            assertTrue(server.entered.await(10, TimeUnit.SECONDS))
            val photoId = manager.state.value.batches.first { it.mode == GalleryMode.PHOTO }.id
            val materialId = manager.state.value.batches.first { it.mode == GalleryMode.MATERIAL }.id
            compose.runOnUiThread { manager.pause(materialId) }
            compose.waitUntil(5000) { manager.state.value.batches.first { it.id == materialId }.paused }
            compose.runOnUiThread { manager.remove(materialId) }
            compose.waitUntil(5000) { manager.state.value.batches.none { it.id == materialId } }
            compose.runOnUiThread {
                manager.enqueue(NativeSession.open(context, server.origin), identity, GalleryMode.MATERIAL, listOf(uri))
                manager.pause(photoId)
            }
            compose.waitUntil(5000) { manager.state.value.batches.first { it.id == photoId }.progress?.cancelled == true }
            compose.runOnUiThread { manager.resume(photoId) }
            compose.waitUntil(5000) { manager.state.value.batches.first { it.id == photoId }.waiting }
            compose.onNodeWithTag("native-upload-dialog").assertDoesNotExist()
            compose.onNodeWithTag("mode:MATERIAL").performClick()
            compose.onNodeWithContentDescription("更多操作").performClick()
            compose.onNodeWithText("传输列表").performClick()
            compose.onNodeWithTag("native-transfers").assertExists()
            compose.onNodeWithText("自动备份").assertExists()
            captureNativeEvidence("native-shared-transfers.png")
            compose.onNodeWithContentDescription("返回图库").performClick()
            compose.onNodeWithTag("native-transfers").assertDoesNotExist()
            compose.activityRule.scenario.recreate()
            compose.waitForIdle()
            assertSame(manager, ViewModelProvider(compose.activity)[NativeGalleryViewModel::class.java].transfers)
            compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
            assertNotNull(manager.state.value.activeId)
            server.release.countDown()
            compose.waitUntil(15000) { manager.state.value.batches.size == 2 && manager.state.value.batches.all { it.progress?.uploaded == 1 && it.progress.phase == NativeUploadPhase.FINISHED } && !manager.state.value.busy }
            assertTrue(server.paths.contains("/api/photos/uploads/check-content"))
            assertTrue(server.paths.contains("/api/eagle/uploads/check-content"))
            assertEquals(2, server.paths.count { it.contains("/sekereagle-assets/test/part?") })
            val saved = NativeTransferStore(context).load()
            compose.waitUntil(5000) { saved.size == 2 || NativeTransferStore(context).load().size == 2 }
            assertEquals(setOf(GalleryMode.PHOTO, GalleryMode.MATERIAL), NativeTransferStore(context).load().map { it.mode }.toSet())
        } finally {
            compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
            compose.runOnUiThread { manager.clear() }
            context.contentResolver.delete(uri, null, null)
        }
    }

    @Test fun durableManualCheckpointsCannotBecomeAutomaticCleanupReceipts() {
        val file = BackupEngine.File("content://fixture/one", 3, 1, { "a".repeat(64) }, { true })
        val key = BackupEngine.fileKey(identity.scope, "PHOTO", file)
        val content = "${identity.scope}:PHOTO:${"a".repeat(64)}:3"
        val checkpoint = BackupEngine.Checkpoint().apply { hash = "a".repeat(64); confirmed = true }
        val batch = java.util.UUID.randomUUID().toString()
        NativeManualJournal(context, identity.scope, batch).use { it.confirm(key, content, checkpoint) }
        NativeManualJournal(context, identity.scope, batch).use {
            assertFalse("Manual tasks must recheck server existence instead of trusting backup receipts", it.contains(content)); assertFalse(it.load(key)!!.confirmed)
            it.verifyContent(key, "b".repeat(64)); assertFalse(it.load(key)!!.confirmed)
        }
        BackupJournal(context).use { assertNull(it.load(key)); assertFalse(it.contains(content)) }
        NativeManualJournal(context, identity.scope, java.util.UUID.randomUUID().toString()).use { assertNull(it.load(key)); assertFalse(it.contains(content)) }
    }
}
