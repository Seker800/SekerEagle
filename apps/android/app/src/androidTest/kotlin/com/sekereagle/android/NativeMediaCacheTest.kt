package com.sekereagle.android

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*

class NativeMediaCacheTest {
    @get:Rule val compose = createComposeRule()
    private val app = InstrumentationRegistry.getInstrumentation().targetContext
    private val directory = File(app.cacheDir, "cache-test-${java.util.UUID.randomUUID()}")
    private val cache = NativeMediaCache(app, directory)

    private class Server : AutoCloseable {
        val png =
            java.io
                .ByteArrayOutputStream()
                .also { out ->
                    Bitmap.createBitmap(50, 40, Bitmap.Config.ARGB_8888).apply {
                        eraseColor(Color.GREEN)
                        compress(Bitmap.CompressFormat.PNG, 100, out)
                        recycle()
                    }
                }
                .toByteArray()
        val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val requests = CopyOnWriteArrayList<String>()
        @Volatile var delayMillis = 0L
        val worker =
            Thread {
                    try {
                        while (!socket.isClosed) socket.accept().use { client ->
                            val reader = client.getInputStream().bufferedReader()
                            val path = reader.readLine().split(' ')[1]
                            while (!reader.readLine().isEmpty()) {}
                            requests.add(path)
                            Thread.sleep(delayMillis)
                            client.getOutputStream().apply {
                                write(
                                    "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${png.size}\r\nConnection: close\r\n\r\n"
                                        .toByteArray()
                                )
                                write(png)
                            }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            worker.join(10000)
        }
    }

    @Before
    fun reset() {
        runBlocking {
            cache.resize(512)
            cache.clear()
        }
    }

    @After
    fun cleanup() {
        runBlocking {
            cache.resize(512)
            cache.clear()
        }
        directory.deleteRecursively()
    }

    private fun session(server: Server): NativeSession {
        BackupSettings(app)
            .saveToken(
                "native-session:${server.origin}",
                JSONObject().put("sekereagle_access", "synthetic-cache-user").toString(),
            )
        return NativeSession.open(app, server.origin)
    }

    private fun asset(mode: GalleryMode, stamp: String = "v1", privateContent: Boolean = false) =
        JSONObject()
            .put("id", "asset")
            .put("displayName", "synthetic.png")
            .put("mediaRevision", 1)
            .put("isPrivate", privateContent)
            .put("libraryAddedAt", "2026-10-20T00:00:00Z")
            .put("updatedAt", stamp)
            .put(
                "renditions",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("id", "thumb")
                            .put("kind", "THUMBNAIL")
                            .put("mimeType", "image/png")
                            .put("revision", 1)
                            .put("byteSize", 100)
                            .put("width", 50)
                            .put("height", 40)
                    ),
            )

    private fun repository(
        session: NativeSession,
        mode: GalleryMode,
        scope: String = "owner-A",
        store: NativeMediaCache = cache,
        stamp: String = "v1",
        privateContent: Boolean = false,
    ): Pair<NativeGalleryRepository, String> {
        val repo = NativeGalleryRepository(session, scope, store)
        val item = repo.parse(asset(mode, stamp, privateContent), mode)
        return repo to item.thumbnail!!
    }

    @Test
    fun persistentHitsReuseBytesAcrossRepositoryAndCacheRecreation() = runBlocking {
        Server().use { server ->
            val session = session(server)
            val (first, path) = repository(session, GalleryMode.PHOTO)
            first.image(path, false)
            first.clear()
            val reopened = NativeMediaCache(app, directory)
            val (second, next) = repository(session, GalleryMode.PHOTO, store = reopened)
            assertEquals(Color.GREEN, second.image(next, false).getPixel(0, 0))
            assertEquals(1, server.requests.size)
            assertEquals(1, reopened.usage().count)
            val stored = directory.listFiles()!!.single().readBytes()
            assertFalse(stored.contentEquals(server.png))
            assertFalse(
                stored.take(8).toByteArray().contentEquals(server.png.take(8).toByteArray())
            )
        }
    }

    @Test
    fun hitRateTracksSuccessfulLoadsAcrossMemoryDiskAndDownloadAndResetsOnClear() = runBlocking {
        Server().use { server ->
            val (repo, path) = repository(session(server), GalleryMode.PHOTO)
            repo.image(path, false)
            repo.image(path, false)
            repo.evictImages()
            repo.image(path, false)
            val stats = cache.statistics.value
            assertEquals(3L, stats.requests)
            assertEquals(1L, stats.memoryHits)
            assertEquals(1L, stats.diskHits)
            assertEquals(1L, stats.downloads)
            assertEquals(2.0 / 3, stats.hitRate, 0.000001)
            assertEquals(1, server.requests.size)
            cache.clear()
            repo.evictImages()
            assertEquals(0L, cache.statistics.value.requests)
            repo.image(path, false)
            assertEquals(1L, cache.statistics.value.downloads)
        }
    }

    @Test
    fun concurrentRequestsCoalesceAndVersionsOwnersAndModesStaySeparate() = runBlocking {
        Server().use { server ->
            val session = session(server)
            val (repo, path) = repository(session, GalleryMode.PHOTO)
            coroutineScope { (1..8).map { async { repo.image(path, it % 2 == 0) } }.awaitAll() }
            assertEquals(1, server.requests.size)
            val version = repo.parse(asset(GalleryMode.PHOTO), GalleryMode.PHOTO).cacheVersion
            repeat(4200) { index ->
                repo.parse(asset(GalleryMode.PHOTO).put("id", "other$index"), GalleryMode.PHOTO)
            }
            assertNull(repo.imageVersion(path))
            repo.evictImages()
            repo.image(path, false, version)
            assertEquals(1, server.requests.size)

            for (parameters in
                listOf(
                    Triple(GalleryMode.PHOTO, "owner-B", "v1"),
                    Triple(GalleryMode.MATERIAL, "owner-A", "v1"),
                    Triple(GalleryMode.PHOTO, "owner-A", "v2"),
                )) {
                val (next, nextPath) =
                    repository(
                        session,
                        parameters.first,
                        parameters.second,
                        stamp = parameters.third,
                    )
                next.image(nextPath, false)
            }
            assertEquals(4, server.requests.size)
        }
    }

    @Test
    fun clearingDisablingAndCorruptionCauseSafeNetworkMisses() = runBlocking {
        Server().use { server ->
            val session = session(server)
            suspend fun load() {
                val (repo, path) = repository(session, GalleryMode.PHOTO)
                repo.image(path, false)
            }
            load()
            directory.listFiles()!!.single().writeBytes(byteArrayOf(1, 2, 3))
            load()
            assertEquals(2, server.requests.size)
            cache.invalidate()
            cache.clear()
            load()
            assertEquals(3, server.requests.size)
            cache.resize(0)
            load()
            load()
            assertEquals(5, server.requests.size)
            assertEquals(0, cache.usage().bytes)
        }
    }

    @Test
    fun privateMediaNeverPersistsAndRevokedSessionsCannotUseDiskOrMemoryHits() = runBlocking {
        Server().use { server ->
            val session = session(server)
            val (publicRepo, publicPath) = repository(session, GalleryMode.PHOTO)
            publicRepo.image(publicPath, false)
            val (repo, path) = repository(session, GalleryMode.PHOTO, privateContent = true)
            repo.image(path, false)
            assertEquals(1, cache.usage().count)
            session.invalidateLocally()
            try {
                repo.image(path, false)
                fail("Revoked session must not use memory")
            } catch (failure: NativeSession.Failure) {
                assertEquals(401, failure.status)
            }
            val (reopened, cachedPath) = repository(session, GalleryMode.PHOTO)
            try {
                reopened.image(cachedPath, false)
                fail("Revoked session must not use disk")
            } catch (failure: NativeSession.Failure) {
                assertEquals(401, failure.status)
            }
            assertEquals(2, server.requests.size)
        }
    }

    @Test
    fun clearingDuringDownloadDoesNotBlankTheImageOrRefillClearedCache() = runBlocking {
        Server().use { server ->
            server.delayMillis = 500
            val (repo, path) = repository(session(server), GalleryMode.PHOTO)
            val pending = async { repo.image(path, false) }
            withTimeout(10000) { while (server.requests.isEmpty()) delay(10) }
            cache.invalidate()
            repo.evictImages()
            cache.clear()
            assertEquals(Color.GREEN, pending.await().getPixel(0, 0))
            assertEquals(0, cache.usage().count)
            server.delayMillis = 0
            repo.image(path, false)
            assertEquals(2, server.requests.size)
            assertEquals(1, cache.usage().count)
        }
    }

    @Test
    fun encryptedCacheSurvivesProcessRestart() = runBlocking {
        val phase = InstrumentationRegistry.getArguments().getString("cachePhase", "both")
        require(phase in listOf("write", "read", "both"))
        val root = File(app.cacheDir, "cache-test-process-restart")
        val store = NativeMediaCache(app, root)
        val id =
            store.identity(
                "synthetic-owner",
                "/api/photos/assets/synthetic/renditions/tiny/content",
                "v1",
            )
        val bytes = "synthetic encrypted cache fixture".toByteArray()
        if (phase != "read") {
            store.clear()
            store.write(id, bytes, store.generation)
            assertEquals(1, store.usage().count)
        }
        if (phase != "write") {
            assertArrayEquals(bytes, store.read(id))
            store.clear()
            root.deleteRecursively()
        }
    }

    @Test
    fun settingsSaveValidateAndClearWithVisibleFeedback() {
        val leaked = java.util.concurrent.atomic.AtomicInteger()
        compose.setContent {
            NativeTheme {
                androidx.compose.material3.Surface(
                    androidx.compose.ui.Modifier.fillMaxSize(),
                    color = androidx.compose.ui.graphics.Color.Black,
                ) {
                    androidx.compose.foundation.layout.Box(
                        androidx.compose.ui.Modifier.fillMaxSize()
                    ) {
                        androidx.compose.material3.Button(
                            { leaked.incrementAndGet() },
                            androidx.compose.ui.Modifier.fillMaxSize(),
                        ) {
                            androidx.compose.material3.Text("Underlying gallery")
                        }
                        NativeCacheScreen(cache, {}, {})
                    }
                }
            }
        }
        compose.onNodeWithTag("native-cache").performTouchInput {
            click(androidx.compose.ui.geometry.Offset(8f, height - 8f))
        }
        assertEquals(0, leaked.get())
        compose.waitUntil(10000) {
            compose.onAllNodesWithTag("cache-limit").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("cache-hit-rate").assertTextContains("暂无记录")
        compose.onNodeWithTag("cache-size").performTextReplacement("20000")
        compose.onNodeWithText("保存上限").assertIsNotEnabled()
        compose.onNodeWithTag("cache-size").performTextReplacement("256")
        compose.onNodeWithText("保存上限").performClick()
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("当前上限 256 MB").fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(256, NativeMediaCache(app, directory).limitMb)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        compose.waitUntil(5000) {
            var ime = false
            instrumentation.runOnMainSync {
                ime =
                    android.view.inspector.WindowInspector.getGlobalWindowViews().any {
                        it.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == true
                    }
            }
            !ime
        }
        val screenshot = instrumentation.uiAutomation.takeScreenshot()
        val file = File(app.getExternalFilesDir(null), "native-cache-settings.png")
        file.outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
        screenshot.recycle()
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
                instrumentation.uiAutomation.executeShellCommand(
                    "cp ${file.absolutePath} /sdcard/Download/sekereagle-test-cache-settings.png"
                )
            )
            .use { it.readBytes() }

        compose.onNodeWithText("清空缓存").performScrollTo().performClick()
        compose.onNodeWithText("清空", substring = false).performClick()
        compose.waitUntil(10000) {
            compose.onAllNodesWithText("缓存已清空").fetchSemanticsNodes().isNotEmpty()
        }
    }
}
