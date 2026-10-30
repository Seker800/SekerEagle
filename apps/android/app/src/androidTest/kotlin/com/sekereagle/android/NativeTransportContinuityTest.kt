package com.sekereagle.android

import androidx.test.platform.app.InstrumentationRegistry
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class NativeTransportContinuityTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun slowJsonDoesNotBlockUnrelatedRequestsAndLogoutRejectsOldEpoch() = runBlocking {
        val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val workers = Executors.newCachedThreadPool()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val listener =
            Thread {
                    try {
                        while (!socket.isClosed) {
                            val client = socket.accept()
                            workers.execute {
                                client.use {
                                    val input = it.getInputStream().bufferedReader()
                                    val slow = input.readLine().contains("slow")
                                    while (!input.readLine().isNullOrEmpty()) {}
                                    if (slow) {
                                        entered.countDown()
                                        release.await(10, TimeUnit.SECONDS)
                                    }
                                    runCatching {
                                        it.getOutputStream()
                                            .write(
                                                "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                                                    .toByteArray()
                                            )
                                    }
                                }
                            }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }
        val session = NativeSession.open(context, "http://127.0.0.1:${socket.localPort}")
        val ticket = session.authorizationEpoch()
        try {
            val slow =
                async(Dispatchers.IO) {
                    runCatching { session.jsonAtEpoch(ticket, "GET", "/api/photos/assets?slow=1") }
                }
            assertTrue(withContext(Dispatchers.IO) { entered.await(5, TimeUnit.SECONDS) })
            withTimeout(2000) {
                withContext(Dispatchers.IO) {
                    session.jsonAtEpoch(ticket, "GET", "/api/photos/assets?fast=1")
                }
            }
            session.invalidateLocally()
            assertThrows(NativeSession.Failure::class.java) {
                session.jsonAtEpoch(ticket, "GET", "/api/photos/assets")
            }
            release.countDown()
            assertTrue(slow.await().exceptionOrNull() is NativeSession.Failure)
        } finally {
            release.countDown()
            socket.close()
            workers.shutdownNow()
            listener.join(2000)
        }
    }

    @Test
    fun successfulSignedPartsReuseOneConnectionWithoutSendingCredentials() {
        val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val workers = Executors.newCachedThreadPool()
        val clients = java.util.concurrent.ConcurrentHashMap.newKeySet<java.net.Socket>()
        val accepted = java.util.concurrent.atomic.AtomicInteger()
        val requests = java.util.concurrent.CopyOnWriteArrayList<Int>()
        val leaked = java.util.concurrent.atomic.AtomicBoolean()
        val listener =
            Thread {
                    try {
                        while (!socket.isClosed) {
                            val client = socket.accept()
                            val clientId = accepted.incrementAndGet()
                            clients.add(client)
                            workers.execute {
                                client.use {
                                    val input = java.io.BufferedInputStream(it.getInputStream())
                                    fun line(): String? {
                                        val result = StringBuilder()
                                        while (true) {
                                            val char = input.read()
                                            if (char < 0) return null
                                            if (char == 10) return result.toString().trimEnd('\r')
                                            result.append(char.toChar())
                                        }
                                    }
                                    try {
                                        while (line() != null) {
                                            requests.add(clientId)
                                            var size = 0
                                            while (true) {
                                                val header = line() ?: return@execute
                                                if (header.isEmpty()) break
                                                if (header.startsWith("Content-Length:", true))
                                                    size = header.substringAfter(':').trim().toInt()
                                                if (
                                                    header.startsWith("Authorization:", true) ||
                                                        header.startsWith("Cookie:", true)
                                                )
                                                    leaked.set(true)
                                            }
                                            repeat(size) { input.read() }
                                            it.getOutputStream()
                                                .write(
                                                    "HTTP/1.1 200 OK\r\nETag: part\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n"
                                                        .toByteArray()
                                                )
                                            it.getOutputStream().flush()
                                        }
                                    } catch (_: java.io.IOException) {}
                                }
                            }
                        }
                    } catch (_: java.io.IOException) {}
                }
                .apply { start() }
        try {
            val origin = "http://127.0.0.1:${socket.localPort}"
            ApiClient(origin, "must-stay-on-api").use { api ->
                repeat(2) { part ->
                    assertEquals(
                        "part",
                        api.put(
                            "$origin/sekereagle-assets/test?part=$part&X-Amz-Signature=abc",
                            java.io.ByteArrayInputStream(byteArrayOf(1)),
                            1,
                            {},
                        ),
                    )
                }
            }
            assertEquals(1, accepted.get())
            repeat(2) { part ->
                val connection =
                    java.net.URL("$origin/sekereagle-assets/test?legacy=$part").openConnection()
                        as java.net.HttpURLConnection
                try {
                    connection.requestMethod = "PUT"
                    connection.doOutput = true
                    connection.setFixedLengthStreamingMode(1)
                    connection.outputStream.use { it.write(1) }
                    assertEquals(200, connection.responseCode)
                    assertEquals("part", connection.getHeaderField("ETag"))
                } finally {
                    connection.disconnect()
                }
            }
            assertEquals(4, requests.size)
            assertEquals(1, requests.take(2).toSet().size)
            println(
                "HTTP keep-alive acceptance: pooled=${requests.take(2).toSet().size}, legacy=${requests.drop(2).toSet().size}"
            )
            assertFalse(leaked.get())
        } finally {
            socket.close()
            clients.forEach { it.close() }
            workers.shutdownNow()
            listener.join(2000)
        }
    }

    @Test
    fun mediaCatalogScansPastOnePageWithoutKeepingACursorAcrossVisits() {
        val uris = mutableListOf<android.net.Uri>()
        val folder = "Pictures/catalog-${java.util.UUID.randomUUID()}/"
        try {
            repeat(260) { index ->
                uris.add(
                    context.contentResolver.insert(
                        android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        android.content.ContentValues().apply {
                            put("_display_name", "scan-$index.jpg")
                            put("mime_type", "image/jpeg")
                            put("relative_path", folder)
                        },
                    )!!
                )
            }
            val selected = mutableSetOf<android.net.Uri>()
            val rule =
                org.json.JSONObject().put("type", "media").put("path", folder).put("mode", "PHOTO")
            MediaCatalog(context)
                .scan(
                    org.json.JSONArray().put(rule),
                    { item, mode ->
                        assertEquals("PHOTO", mode)
                        selected.add(item.uri)
                    },
                    {},
                )
            assertEquals(
                uris.map { android.content.ContentUris.parseId(it) }.toSet(),
                selected.map { android.content.ContentUris.parseId(it) }.toSet(),
            )
        } finally {
            uris.forEach { context.contentResolver.delete(it, null, null) }
        }
    }

    @Test
    fun journalUpgradePreservesReceiptsAndResumeDoesNotDoubleCount() {
        val name = "continuity-${java.util.UUID.randomUUID()}.db"
        val path = context.getDatabasePath(name)
        path.parentFile!!.mkdirs()
        try {
            android.database.sqlite.SQLiteDatabase.openOrCreateDatabase(path, null).use { db ->
                db.execSQL(
                    "CREATE TABLE files (key TEXT PRIMARY KEY, hash TEXT NOT NULL, session TEXT NOT NULL, part_size INTEGER NOT NULL, confirmed INTEGER NOT NULL, terminal_error TEXT NOT NULL DEFAULT '')"
                )
                db.execSQL("CREATE TABLE receipts (key TEXT PRIMARY KEY)")
                db.execSQL("INSERT INTO receipts VALUES ('owner:PHOTO:old')")
                db.version = 2
            }
            BackupJournal(context, name).use { journal ->
                assertTrue(journal.contains("owner:PHOTO:old"))
                journal.beginScan("owner", false)
                journal.scanResult("owner", "PHOTO:a", "UPLOADED")
                journal.scanResult("owner", "PHOTO:b", "CHECKING")
                assertArrayEquals(intArrayOf(2, 1, 0, 0), journal.scanCounts("owner"))
            }
            BackupJournal(context, name).use { journal ->
                journal.beginScan("owner", true)
                assertTrue(journal.scanCompleted("owner", "PHOTO:a"))
                assertFalse(journal.scanCompleted("other", "PHOTO:a"))
                journal.scanResult("owner", "PHOTO:b", "SKIPPED")
                assertArrayEquals(intArrayOf(2, 1, 1, 0), journal.scanCounts("owner"))
                journal.beginScan("owner", false)
                assertArrayEquals(intArrayOf(0, 0, 0, 0), journal.scanCounts("owner"))
                assertTrue(journal.contains("owner:PHOTO:old"))
            }
        } finally {
            context.deleteDatabase(name)
        }
    }
}
