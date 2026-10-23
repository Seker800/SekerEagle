package com.sekereagle.android

import android.content.ContentValues
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import com.sekereagle.android.core.BackupPolicy
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeTransferQueueTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val me = """{"user":{"id":"owner"},"desktopCache":{"deploymentId":"queue"}}"""

    private class Server(private val body: (String) -> String) : AutoCloseable {
        private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${server.localPort}"
        val accepted = CountDownLatch(1)
        val release = CountDownLatch(1)
        private val thread =
            Thread {
                    var first = true
                    try {
                        while (!server.isClosed) server.accept().use { client ->
                            val reader = client.getInputStream().bufferedReader()
                            val path = reader.readLine().split(' ')[1]
                            var length = 0
                            while (true) {
                                val line = reader.readLine()
                                if (line.isEmpty()) break
                                if (line.startsWith("Content-Length:", true))
                                    length = line.substringAfter(':').trim().toInt()
                            }
                            repeat(length) { reader.read() }
                            if (first) {
                                first = false
                                accepted.countDown()
                                release.await(8, TimeUnit.SECONDS)
                            }
                            val json = body(path)
                            val mime =
                                if (path.endsWith("/original")) "image/png" else "application/json"
                            runCatching {
                                client
                                    .getOutputStream()
                                    .write(
                                        "HTTP/1.1 200 OK\r\nContent-Type: $mime\r\nContent-Length: ${json.length}\r\nConnection: close\r\n\r\n$json"
                                            .toByteArray()
                                    )
                            }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            release.countDown()
            server.close()
            thread.join(9000)
        }
    }

    private suspend fun waitFor(condition: () -> Boolean) =
        withTimeout(10000) {
            while (!condition()) delay(20)
        }

    @Test
    fun cancellingBeforeUploadLoopKeepsEveryFileForRetry() = runBlocking {
        Server { path -> if (path == "/api/auth/me") me else """{"exists":true}""" }
            .use { server ->
                val session = NativeSession.open(context, server.origin)
                val target = BackupPolicy.digest("${server.origin}\nqueue\nowner")
                val uris =
                    (1..2).map { number ->
                        context.contentResolver
                            .insert(
                                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                ContentValues().apply {
                                    put("_display_name", "queue-$number.png")
                                    put("mime_type", "image/png")
                                    put("relative_path", "Download/SekerEagle-queue-test/")
                                },
                            )!!
                            .also { uri ->
                                context.contentResolver.openOutputStream(uri)!!.use {
                                    it.write(byteArrayOf(1, 2, 3))
                                }
                            }
                    }
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
                val uploads =
                    NativeUploads(context, scope, { fail("Unexpected logout") }, { _, _ -> })
                try {
                    uploads.prepare(session, target, GalleryMode.PHOTO, uris)
                    waitFor { uploads.state.value?.phase == NativeUploadPhase.READY }
                    uploads.start()
                    assertTrue(server.accepted.await(5, TimeUnit.SECONDS))
                    uploads.cancel()
                    waitFor { uploads.state.value?.phase == NativeUploadPhase.FINISHED }
                    assertTrue(uploads.state.value!!.cancelled)
                    assertEquals(
                        uris.toSet(),
                        uploads.state.value!!.remaining.map { it.uri }.toSet(),
                    )
                    server.release.countDown()
                    uploads.retry()
                    waitFor { uploads.state.value?.phase == NativeUploadPhase.FINISHED }
                    assertEquals(2, uploads.state.value!!.skipped)
                    assertTrue(uploads.state.value!!.issues.isEmpty())
                    assertTrue(uploads.state.value!!.remaining.isEmpty())
                } finally {
                    uploads.clear()
                    scope.cancel()
                    uris.forEach { context.contentResolver.delete(it, null, null) }
                }
            }
    }

    @Test
    fun cancellingCurrentDownloadKeepsCurrentAndUnstartedItemsForRetry() = runBlocking {
        val fileName = "review-queue-${System.nanoTime()}.png"
        fun outputs(): List<android.net.Uri> =
            context.contentResolver
                .query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    arrayOf("_id"),
                    "_display_name LIKE ?",
                    arrayOf(fileName.removeSuffix(".png") + "%"),
                    null,
                )!!
                .use { cursor ->
                    buildList {
                        while (cursor.moveToNext()) add(
                            android.content.ContentUris.withAppendedId(
                                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                                cursor.getLong(0),
                            )
                        )
                    }
                }
        Server { path ->
                if (path.endsWith("/original")) "abc"
                else
                    JSONObject()
                        .put("mediaRevision", 1)
                        .put("byteSize", 3)
                        .put("mimeType", "image/png")
                        .put("originalName", fileName)
                        .toString()
            }
            .use { server ->
                val session = NativeSession.open(context, server.origin)
                val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
                val downloads = NativeDownloads(context, scope) { fail("Unexpected logout") }
                val assets =
                    (1..2).map {
                        NativeAsset("item$it", "item$it.png", "", "", 1, 1, null, null, false, 1)
                    }
                try {
                    downloads.start(session, GalleryMode.MATERIAL, assets)
                    assertTrue(server.accepted.await(5, TimeUnit.SECONDS))
                    downloads.cancel()
                    waitFor { downloads.state.value?.running == false }
                    assertTrue(downloads.state.value!!.cancelled)
                    assertEquals(assets, downloads.state.value!!.remaining)
                    assertTrue(downloads.state.value!!.failures.isEmpty())
                    assertEquals(0, downloads.state.value!!.completed)
                    server.release.countDown()
                    downloads.retry()
                    waitFor { downloads.state.value?.running == false }
                    assertEquals(2, downloads.state.value!!.completed)
                    assertTrue(downloads.state.value!!.failures.isEmpty())
                    assertEquals(2, outputs().size)
                    outputs().forEach { uri ->
                        assertArrayEquals(
                            "abc".toByteArray(),
                            context.contentResolver.openInputStream(uri)!!.use { it.readBytes() },
                        )
                    }
                } finally {
                    downloads.clear()
                    scope.cancel()
                    outputs().forEach { context.contentResolver.delete(it, null, null) }
                }
            }
    }
}
