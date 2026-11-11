package com.sekereagle.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

class NativePlaybackTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val requests = CopyOnWriteArrayList<Map<String, String>>()
    private val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
    private val failure = AtomicReference<Throwable>()
    @Volatile private var response = 206
    @Volatile private var mime = "video/mp4"
    @Volatile private var totalAdjustment = 0
    private val bytes =
        InstrumentationRegistry.getInstrumentation().context.assets.open("playback.mp4").use {
            it.readBytes()
        }
    @Volatile private var payload = bytes
    private val origin = "http://127.0.0.1:${server.localPort}"
    private lateinit var session: NativeSession
    private lateinit var worker: Thread
    private val path = "/api/photos/assets/video/renditions/movie/content"

    @Before
    fun start() {
        BackupSettings(context)
            .saveToken(
                "native-session:$origin",
                JSONObject()
                    .put("sekereagle_access", "playback-test-access")
                    .put("sekereagle_refresh", "playback-test-refresh")
                    .toString(),
            )
        session = NativeSession.open(context, origin)
        worker =
            Thread {
                    try {
                        while (!server.isClosed) server.accept().use { socket ->
                            socket.soTimeout = 10000
                            val reader = socket.getInputStream().bufferedReader()
                            reader.readLine()
                            val headers = mutableMapOf<String, String>()
                            while (true) {
                                val line = reader.readLine() ?: break
                                if (line.isEmpty()) break
                                headers[line.substringBefore(':').lowercase()] =
                                    line.substringAfter(':').trim()
                            }
                            requests.add(headers)
                            val body = payload
                            val range = headers["range"]!!.removePrefix("bytes=").split('-')
                            val start = range[0].toInt()
                            val end = minOf(range[1].toInt(), body.lastIndex)
                            val data = body.copyOfRange(start, end + 1)
                            val status = response
                            socket
                                .getOutputStream()
                                .write(
                                    ("HTTP/1.1 $status Test\r\nContent-Type: $mime\r\nContent-Range: bytes $start-$end/${body.size + totalAdjustment}\r\nContent-Length: ${data.size}\r\nLocation: http://127.0.0.1:1/foreign\r\nConnection: close\r\n\r\n")
                                        .toByteArray()
                                )
                            socket.getOutputStream().write(data)
                        }
                    } catch (e: Exception) {
                        if (!server.isClosed) failure.set(e)
                    }
                }
                .apply { start() }
    }

    @After
    fun stop() {
        session.clear()
        server.close()
        worker.join(5000)
        failure.get()?.let { throw AssertionError(it) }
    }

    @Test
    fun nativePlayerDecodesPausesAndSeeksWithAuthenticatedBoundedRanges() {
        val asset =
            NativeAsset(
                "video",
                "Test clip",
                "2026年10月23日",
                "10:00",
                320,
                240,
                null,
                null,
                true,
                1,
                playback = path,
                playbackSize = bytes.size.toLong(),
            )
        val repo = NativeGalleryRepository(session, "playback-test")
        val visible = androidx.compose.runtime.mutableStateOf(true)
        compose.setContent {
            NativeEvidenceHost {
                if (visible.value) NativeVideo(asset, repo)
                else androidx.compose.material3.Text("Closed")
            }
        }
        compose.waitUntil(15000) {
            compose.onAllNodesWithContentDescription("暂停视频").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("暂停视频").performClick()
        compose.onNodeWithContentDescription("播放视频").assertIsEnabled()
        captureNativeEvidence("native-video-player.png")
        compose.onNodeWithTag("video-seek").performTouchInput {
            click(androidx.compose.ui.geometry.Offset(width * 0.5f, centerY))
        }
        compose.onNodeWithContentDescription("播放视频").performClick()
        compose.onNodeWithContentDescription("暂停视频").assertIsDisplayed()
        assertTrue(requests.isNotEmpty())
        requests.forEach {
            assertEquals("sekereagle_access=playback-test-access", it["cookie"])
            assertTrue(it["range"]!!.startsWith("bytes="))
        }
        // Removing the viewer disposes the platform decoder and closes the data source.
        compose.runOnIdle { visible.value = false }
    }

    @Test
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    fun rangeRejectsWholeResponsesAndInvalidationStopsEvenCachedReads() {
        val uri = android.net.Uri.parse(origin + path)
        fun source() = NativeVideoDataSource(session, path, bytes.size.toLong(), uri)
        fun spec(length: Long) =
            androidx.media3.datasource.DataSpec.Builder()
                .setUri(uri)
                .setPosition(0)
                .setLength(length)
                .build()
        response = 200
        assertThrows(java.io.IOException::class.java) { source().open(spec(-1)) }
        response = 302
        assertThrows(NativeSession.Failure::class.java) { source().open(spec(-1)) }
        response = 206
        mime = "text/html"
        assertThrows(java.io.IOException::class.java) { source().open(spec(-1)) }
        mime = "video/mp4"
        totalAdjustment = 1
        assertThrows(java.io.IOException::class.java) { source().open(spec(-1)) }
        totalAdjustment = 0
        val source = source()
        assertEquals(100, source.open(spec(100)))
        val first = ByteArray(10)
        assertEquals(10, source.read(first, 0, 10))
        assertArrayEquals(bytes.copyOfRange(0, 10), first)
        val count = requests.size
        val foreign =
            NativeVideoDataSource(session, "https://example.invalid/video", bytes.size.toLong(), uri)
        assertThrows(IllegalArgumentException::class.java) { foreign.open(spec(-1)) }
        foreign.close()
        assertEquals(count, requests.size)
        session.invalidateLocally()
        assertThrows(NativeSession.Failure::class.java) { source.read(ByteArray(10), 0, 10) }
        assertEquals(count, requests.size)
        source.close()
        assertThrows(java.io.IOException::class.java) { source.read(ByteArray(10), 0, 10) }
    }

    @Test
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    fun sequentialPlaybackUsesOneStreamingResponseInsteadOfWindowRequests() {
        payload =
            ByteArray(4 * 1024 * 1024) {
                (it * 31 % 251).toByte()
            }
        val uri = android.net.Uri.parse(origin + path)
        val source = NativeVideoDataSource(session, path, payload.size.toLong(), uri)
        val spec =
            androidx.media3.datasource.DataSpec.Builder()
                .setUri(uri)
                .setPosition(0)
                .setLength(-1)
                .build()
        assertEquals(payload.size.toLong(), source.open(spec))
        val buffer = ByteArray(64 * 1024)
        val received = java.io.ByteArrayOutputStream()
        while (true) {
            val count = source.read(buffer, 0, buffer.size)
            if (count < 0) break
            received.write(buffer, 0, count)
        }
        source.close()
        assertArrayEquals(payload, received.toByteArray())
        assertEquals(1, requests.size)
    }
}
