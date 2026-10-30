package com.sekereagle.android

import android.content.ContentValues
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import com.sekereagle.android.core.BackupEngine
import java.io.InputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeMultipartConcurrencyTest {
    @Test
    fun boundedParallelPartsPreserveResumeInventoryAndOriginalBytes() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val partSize = 5 * 1024 * 1024
        val size = partSize * 3 + 17
        val uri =
            context.contentResolver.insert(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                ContentValues().apply {
                    put(
                        MediaStore.MediaColumns.DISPLAY_NAME,
                        "multipart-${java.util.UUID.randomUUID()}.jpg",
                    )
                    put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                },
            )!!
        try {
            context.contentResolver.openOutputStream(uri)!!.use { output ->
                for (part in 1..4) {
                    var left = if (part == 4) 17 else partSize
                    val buffer = ByteArray(256 * 1024) { part.toByte() }
                    while (left > 0) {
                        val count = minOf(left, buffer.size)
                        output.write(buffer, 0, count)
                        left -= count
                    }
                }
            }
            val active = AtomicInteger()
            val maximum = AtomicInteger()
            val started = CountDownLatch(3)
            val api =
                object : UploadApi {
                    override fun request(
                        method: String,
                        path: String,
                        body: JSONObject?,
                    ): JSONObject =
                        when {
                            path.endsWith("/parts") ->
                                JSONObject()
                                    .put(
                                        "parts",
                                        JSONArray()
                                            .put(
                                                JSONObject()
                                                    .put("partNumber", 2)
                                                    .put("etag", "existing")
                                                    .put("size", partSize)
                                            ),
                                    )
                            path.contains("/parts/") ->
                                JSONObject().put("uploadUrl", path.substringAfterLast('/'))
                            path.endsWith("/complete") -> {
                                val parts = body!!.getJSONArray("parts")
                                assertEquals(4, parts.length())
                                assertEquals(
                                    setOf(1, 2, 3, 4),
                                    (0 until parts.length())
                                        .map { parts.getJSONObject(it).getInt("partNumber") }
                                        .toSet(),
                                )
                                JSONObject().put("assetId", "saved")
                            }
                            else ->
                                JSONObject()
                                    .put("id", "12345678-1234-4234-8234-123456789abc")
                                    .put("partSize", partSize)
                        }

                    override fun put(
                        url: String,
                        input: InputStream,
                        bytes: Long,
                        guard: BackupEngine.Guard,
                    ): String {
                        val number = url.toInt()
                        val count = active.incrementAndGet()
                        maximum.accumulateAndGet(count, ::maxOf)
                        started.countDown()
                        try {
                            assertTrue(
                                "three parts must overlap",
                                started.await(5, TimeUnit.SECONDS),
                            )
                            var received = 0L
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                guard.check()
                                val read = input.read(buffer)
                                if (read < 0) break
                                assertTrue(buffer.take(read).all { it == number.toByte() })
                                received += read
                            }
                            assertEquals(bytes, received)
                            return "etag-$number"
                        } finally {
                            active.decrementAndGet()
                        }
                    }
                }
            val item = MediaCatalog.Item(uri, "test.jpg", "", "image/jpeg", size.toLong(), 1, false)
            val checkpoint = BackupEngine.Checkpoint().apply { hash = "a".repeat(64) }
            MultipartTransport(api, "PHOTO", MediaCatalog(context), item)
                .upload(
                    BackupEngine.File(
                        uri.toString(),
                        size.toLong(),
                        1,
                        { checkpoint.hash },
                        { true },
                    ),
                    checkpoint,
                    {},
                    {},
                )
            assertEquals(3, maximum.get())
            assertEquals(0, active.get())
        } finally {
            context.contentResolver.delete(uri, null, null)
        }
    }
}
