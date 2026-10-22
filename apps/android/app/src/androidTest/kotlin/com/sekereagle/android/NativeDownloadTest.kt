package com.sekereagle.android

import android.content.ContentUris
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Loopback protocol fixtures and app-owned MediaStore entries only. */
class NativeDownloadTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val asset = NativeAsset("fixture", "fixture.png", "", "", 1, 1, null, null, false, 1)

    private fun metadata(size: Int, revision: Int = 1) =
        JSONObject()
            .put("mediaRevision", revision)
            .put("byteSize", size)
            .put("mimeType", "image/png")
            .put("originalName", "../../fixture.png")
            .toString()
            .toByteArray()

    private data class Reply(
        val body: ByteArray,
        val type: String = "application/json",
        val status: Int = 200,
        val length: Int = body.size,
        val headers: String = "",
    )

    private class Server(private val replies: List<Reply>) : AutoCloseable {
        private val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val paths = CopyOnWriteArrayList<String>()
        val cookies = CopyOnWriteArrayList<String>()
        private val worker =
            Thread {
                    try {
                        for (reply in replies) socket.accept().use { client ->
                            client.soTimeout = 10000
                            val reader = client.getInputStream().bufferedReader()
                            paths.add(reader.readLine().split(" ")[1])
                            while (true) {
                                val line = reader.readLine()
                                if (line.isEmpty()) break
                                if (line.startsWith("Cookie:", true))
                                    cookies.add(line.substringAfter(':').trim())
                            }
                            runCatching {
                                client
                                    .getOutputStream()
                                    .write(
                                        "HTTP/1.1 ${reply.status} Test\r\nContent-Type: ${reply.type}\r\nContent-Length: ${reply.length}\r\nLocation: https://foreign.invalid/file\r\nConnection: close\r\n${reply.headers}\r\n"
                                            .toByteArray()
                                    )
                                client.getOutputStream().write(reply.body)
                            }
                        }
                    } catch (_: IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            worker.join(10000)
            assertFalse(worker.isAlive)
        }
    }

    private fun rows(): Set<Uri> {
        val args =
            Bundle().apply {
                putInt(MediaStore.QUERY_ARG_MATCH_PENDING, MediaStore.MATCH_INCLUDE)
                putString(
                    android.content.ContentResolver.QUERY_ARG_SQL_SELECTION,
                    "${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
                )
                putStringArray(
                    android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,
                    arrayOf("Download/SekerEagle/"),
                )
            }
        return context.contentResolver
            .query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                arrayOf(MediaStore.MediaColumns._ID),
                args,
                null,
            )!!
            .use { cursor ->
                buildSet {
                    while (cursor.moveToNext()) add(
                        ContentUris.withAppendedId(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                            cursor.getLong(0),
                        )
                    )
                }
            }
    }

    @Test
    fun originalRefreshKeepsRefreshCookiesOffMediaRequests() {
        val data = byteArrayOf(1, 2, 3)
        Server(
                listOf(
                    Reply("{}".toByteArray(), status = 401),
                    Reply(
                        "{}".toByteArray(),
                        headers =
                            "Set-Cookie: sekereagle_access=new-access; Path=/\r\nSet-Cookie: sekereagle_refresh=new-refresh; Path=/api/auth\r\n",
                    ),
                    Reply(data, "image/png"),
                )
            )
            .use { server ->
                BackupSettings(context)
                    .saveToken(
                        "native-session:${server.origin}",
                        JSONObject()
                            .put("sekereagle_access", "old-access")
                            .put("sekereagle_refresh", "old-refresh")
                            .toString(),
                    )
                val session = NativeSession.open(context, server.origin)
                val output = java.io.ByteArrayOutputStream()
                session.downloadOriginal(
                    "/api/photos/assets/fixture/original",
                    3,
                    "image/png",
                    output,
                    NativeDownloadCancellation(),
                ) {}
                assertArrayEquals(data, output.toByteArray())
                assertEquals(
                    listOf(
                        "/api/photos/assets/fixture/original",
                        "/api/auth/refresh",
                        "/api/photos/assets/fixture/original",
                    ),
                    server.paths.toList(),
                )
                assertEquals(
                    listOf(
                        "sekereagle_access=old-access",
                        "sekereagle_access=old-access; sekereagle_refresh=old-refresh",
                        "sekereagle_access=new-access",
                    ),
                    server.cookies.toList(),
                )
            }
    }

    @Test
    fun invalidTransportAndChangedOriginalLeaveNoPendingFiles() {
        val before = rows()
        val data = ByteArray(12) { 7 }
        val invalid =
            listOf(
                listOf(Reply(metadata(12)), Reply(data, "image/png", 302)),
                listOf(Reply(metadata(12)), Reply(data, "text/html")),
                listOf(Reply(metadata(12)), Reply(data, "image/png", length = 13)),
                listOf(Reply(metadata(12)), Reply(byteArrayOf(1, 2), "image/png", length = 12)),
                listOf(Reply(metadata(12)), Reply(data, "image/png"), Reply(metadata(12, 2))),
            )
        invalid.forEach { replies ->
            Server(replies).use { server ->
                val session = NativeSession.open(context, server.origin)
                assertThrows(IOException::class.java) {
                    NativeDownloadStore(context).save(
                        session,
                        GalleryMode.PHOTO,
                        asset,
                        NativeDownloadCancellation(),
                    ) { _, _ ->
                    }
                }
                assertEquals(before, rows())
            }
        }
    }

    @Test
    fun cancellationAndLogoutDiscardIncompleteOutput() {
        val before = rows()
        repeat(2) { logout ->
            val data = ByteArray(200_000)
            Server(listOf(Reply(metadata(data.size)), Reply(data, "image/png"))).use { server ->
                val session = NativeSession.open(context, server.origin)
                val cancel = NativeDownloadCancellation()
                assertThrows(Exception::class.java) {
                    NativeDownloadStore(context).save(session, GalleryMode.PHOTO, asset, cancel) {
                        bytes,
                        _ ->
                        if (bytes > 0) {
                            if (logout == 0) cancel.cancel() else session.invalidateLocally()
                        }
                    }
                }
                assertEquals(before, rows())
            }
        }
    }

    @Test
    fun batchRetrySavesOnlyFailedItemsAndNeverOverwritesCompletedFiles() = runBlocking {
        val before = rows()
        val data = byteArrayOf(4, 3, 2, 1)
        val replies =
            listOf(
                Reply(metadata(4)),
                Reply(data, "image/png"),
                Reply(metadata(4)),
                Reply("{}".toByteArray(), status = 404),
                Reply(metadata(4)),
                Reply(data, "image/png"),
                Reply(metadata(4)),
            )
        Server(replies).use { server ->
            BackupSettings(context)
                .saveToken(
                    "native-session:${server.origin}",
                    JSONObject()
                        .put("sekereagle_access", "test-access")
                        .put("sekereagle_refresh", "test-refresh")
                        .toString(),
                )
            val session = NativeSession.open(context, server.origin)
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
            val downloads = NativeDownloads(context, scope) { fail("Unexpected auth failure") }
            try {
                downloads.start(
                    session,
                    GalleryMode.MATERIAL,
                    listOf(asset, asset.copy(id = "second")),
                )
                withTimeout(10000) { while (downloads.state.value?.running != false) delay(20) }
                assertEquals(1, downloads.state.value!!.completed)
                assertEquals(1, downloads.state.value!!.failures.size)
                downloads.retry()
                withTimeout(10000) { while (downloads.state.value?.running != false) delay(20) }
                assertEquals(2, downloads.state.value!!.completed)
                assertTrue(downloads.state.value!!.failures.isEmpty())
                val saved = rows() - before
                assertEquals(2, saved.size)
                saved.forEach { uri ->
                    assertArrayEquals(
                        data,
                        context.contentResolver.openInputStream(uri)!!.use { it.readBytes() },
                    )
                }
                assertEquals(3, server.paths.count { it.contains("/fixture") })
                assertTrue(server.paths.all { it.startsWith("/api/eagle/assets/") })
                assertTrue(server.cookies.all { it == "sekereagle_access=test-access" })
            } finally {
                downloads.clear()
                scope.cancel()
                (rows() - before).forEach { context.contentResolver.delete(it, null, null) }
            }
        }
    }
}
