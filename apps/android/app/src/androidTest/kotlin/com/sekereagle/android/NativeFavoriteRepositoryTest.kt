package com.sekereagle.android

import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Only loopback HTTP: verify the exact existing tag contract, including conflict and privacy. */
class NativeFavoriteRepositoryTest {
    private class Fixture : AutoCloseable {
        val socket = ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val writes = CopyOnWriteArrayList<Pair<String, JSONObject>>()
        @Volatile var exists = true
        @Volatile var privateTag = false
        @Volatile var conflict = false
        val thread =
            Thread {
                    try {
                        while (!socket.isClosed) socket.accept().use { client ->
                            val input = java.io.BufferedInputStream(client.getInputStream())
                            fun line(): String {
                                val bytes = java.io.ByteArrayOutputStream()
                                while (true) {
                                    val b = input.read()
                                    if (b < 0 || b == 10) break
                                    if (b != 13) bytes.write(b)
                                }
                                return bytes.toString("UTF-8")
                            }
                            val request = line().split(' ')
                            if (request.size < 2) return@use
                            var length = 0
                            while (true) {
                                val header = line()
                                if (header.isEmpty()) break
                                if (header.startsWith("Content-Length:", true))
                                    length = header.substringAfter(':').trim().toInt()
                            }
                            val body = ByteArray(length)
                            java.io.DataInputStream(input).readFully(body)
                            val path = request[1]
                            val post = request[0] == "POST"
                            if (post) writes.add(path to JSONObject(String(body)))
                            val creating =
                                post && path.endsWith("/manual-tags") && !path.contains("/batch/")
                            val status = if (creating && conflict) 409 else 200
                            val payload =
                                when {
                                    creating -> {
                                        exists = true
                                        "{\"id\":\"favorite\",\"name\":\"收藏\"}"
                                    }
                                    path.endsWith("/manual-tags") && !post ->
                                        if (exists) "[{\"id\":\"favorite\",\"name\":\"收藏\"}]"
                                        else "[]"
                                    path.endsWith("/privacy-settings") ->
                                        if (privateTag) "{\"tagIds\":[\"favorite\"]}"
                                        else "{\"tagIds\":[]}"
                                    else -> "{}"
                                }.toByteArray()
                            client.getOutputStream().apply {
                                write(
                                    "HTTP/1.1 $status Result\r\nContent-Type: application/json\r\nContent-Length: ${payload.size}\r\nConnection: close\r\n\r\n"
                                        .toByteArray()
                                )
                                write(payload)
                            }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }

        override fun close() {
            socket.close()
            thread.join(2000)
        }
    }

    private fun repo(fixture: Fixture): NativeGalleryRepository {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        BackupSettings(context)
            .saveToken(
                "native-session:${fixture.origin}",
                JSONObject().put("sekereagle_access", "synthetic").toString(),
            )
        return NativeGalleryRepository(
            NativeSession.open(context, fixture.origin),
            "favorite-fixture",
        )
    }

    @Test
    fun reusesTagAndRemovesOnlyThatTagInBothModes() = runBlocking {
        Fixture().use { fixture ->
            val repo = repo(fixture)
            for (mode in GalleryMode.entries) {
                repo.setFavorite(mode, "asset", true)
                val (path, body) = fixture.writes.last()
                assertEquals(
                    "/api/${if (mode == GalleryMode.PHOTO) "photos" else "eagle"}/assets/batch/manual-tags",
                    path,
                )
                assertEquals("favorite", body.getJSONArray("addTagIds").getString(0))
                assertEquals(0, body.getJSONArray("removeTagIds").length())
                repo.setFavorite(mode, "asset", false)
                assertEquals(
                    "favorite",
                    fixture.writes.last().second.getJSONArray("removeTagIds").getString(0),
                )
                assertEquals(0, fixture.writes.last().second.getJSONArray("addTagIds").length())
            }
            assertEquals(4, fixture.writes.size)
        }
    }

    @Test
    fun missingTagIsNotCreatedForRemovalAndConcurrentCreationIsReused() = runBlocking {
        Fixture().use { fixture ->
            fixture.exists = false
            val repo = repo(fixture)
            repo.setFavorite(GalleryMode.PHOTO, "asset", false)
            assertTrue(fixture.writes.isEmpty())
            fixture.conflict = true
            repo.setFavorite(GalleryMode.PHOTO, "asset", true)
            assertEquals("收藏", fixture.writes.first().second.getString("name"))
            assertEquals(
                "favorite",
                fixture.writes.last().second.getJSONArray("addTagIds").getString(0),
            )
        }
    }

    @Test
    fun privateFavoriteCannotChangeAssetPrivacy() = runBlocking {
        Fixture().use { fixture ->
            fixture.privateTag = true
            try {
                repo(fixture).setFavorite(GalleryMode.PHOTO, "asset", true)
                fail("Private favorite tag must not be attached by a shortcut")
            } catch (reason: IllegalArgumentException) {
                assertTrue(reason.message.orEmpty().contains("私密"))
            }
            assertTrue(fixture.writes.isEmpty())
        }
    }
}
