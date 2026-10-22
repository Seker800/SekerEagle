package com.sekereagle.android

import android.content.ContentValues
import android.net.Uri
import android.provider.MediaStore
import androidx.test.platform.app.InstrumentationRegistry
import com.sekereagle.android.core.UploadFailure
import java.io.ByteArrayInputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NativeUploadTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun pickerMetadataUsesSharedFormatPolicyAndDoesNotModifyTheSource() {
        val values =
            ContentValues().apply {
                put("_display_name", "manual-test.dng")
                put("mime_type", "application/octet-stream")
                put("relative_path", "Download/SekerEagle-upload-test/")
            }
        val uri =
            context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
        try {
            context.contentResolver.openOutputStream(uri)!!.use { it.write(byteArrayOf(1, 2, 3)) }
            val catalog = MediaCatalog(context)
            val item = catalog.selected(uri)
            assertEquals(3, item.size)
            assertTrue(item.mime.startsWith("image/"))
            assertTrue(catalog.selectedStable(item))
            assertThrows(IllegalArgumentException::class.java) {
                catalog.selected(Uri.parse("file:///private/file.dng"))
            }
            context.contentResolver.update(
                uri,
                ContentValues().apply {
                    put("_display_name", "manual-test.pdf")
                    put("mime_type", "application/pdf")
                },
                null,
                null,
            )
            assertThrows(java.io.IOException::class.java) { catalog.selected(uri) }
            assertArrayEquals(
                byteArrayOf(1, 2, 3),
                context.contentResolver.openInputStream(uri)!!.use { it.readBytes() },
            )
        } finally {
            context.contentResolver.delete(uri, null, null)
        }
    }

    @Test
    fun signedPartsNeverCarryCookiesAndPreserveSignatureErrorSemantics() {
        val server = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val headers = CopyOnWriteArrayList<Map<String, String>>()
        val errors = AtomicReference<Throwable>()
        val worker =
            Thread {
                    try {
                        repeat(3) { index ->
                            server.accept().use { socket ->
                                socket.soTimeout = 10000
                                val reader = socket.getInputStream().bufferedReader()
                                val line = reader.readLine()
                                val current = mutableMapOf<String, String>("request" to line)
                                while (true) {
                                    val value = reader.readLine()
                                    if (value.isEmpty()) break
                                    current[value.substringBefore(':').lowercase()] =
                                        value.substringAfter(':').trim()
                                }
                                repeat(current["content-length"]?.toInt() ?: 0) { reader.read() }
                                headers.add(current)
                                val response =
                                    "HTTP/1.1 ${if(index == 2) "403 Forbidden" else "200 OK"}\r\nContent-Type: application/json\r\nETag: test-etag\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                                socket.getOutputStream().write(response.toByteArray())
                            }
                        }
                    } catch (reason: Throwable) {
                        errors.set(reason)
                    }
                }
                .apply { start() }
        try {
            val origin = "http://127.0.0.1:${server.localPort}"
            BackupSettings(context)
                .saveToken(
                    "native-session:$origin",
                    JSONObject()
                        .put("sekereagle_access", "upload-access")
                        .put("sekereagle_refresh", "upload-refresh")
                        .toString(),
                )
            val session = NativeSession.open(context, origin)
            var bytes = 0L
            val api = NativeUploadApi(session, session.authorizationEpoch(), {}, { bytes = it })
            api.request("GET", "/api/photos/uploads/test", null)
            val url = "$origin/sekereagle-assets/test/part?X-Amz-Signature=abc"
            assertEquals(
                "test-etag",
                api.put(url, ByteArrayInputStream(byteArrayOf(1, 2, 3)), 3) {},
            )
            assertEquals(3, bytes)
            val failure =
                assertThrows(ApiClient.Failure::class.java) {
                    api.put(url, ByteArrayInputStream(byteArrayOf(4)), 1) {}
                }
            assertEquals(UploadFailure.Endpoint.SIGNED_PART, failure.endpoint)
            assertTrue(failure.renewSignature())
            assertThrows(IllegalArgumentException::class.java) {
                api.put(
                    "https://foreign.invalid/sekereagle-assets/test/part?X-Amz-Signature=abc",
                    ByteArrayInputStream(byteArrayOf(1)),
                    1,
                ) {}
            }
            worker.join(10000)
            errors.get()?.let { throw AssertionError(it) }
            assertFalse(worker.isAlive)
            assertEquals("sekereagle_access=upload-access", headers[0]["cookie"])
            assertFalse(headers[1].containsKey("cookie"))
            assertFalse(headers[1].containsKey("authorization"))
            assertFalse(headers[2].containsKey("cookie"))
        } finally {
            server.close()
            worker.join(10000)
        }
    }

    @Test
    fun staleSessionAndForeignPartUrlsFailBeforeNetworkTransmission() {
        val session = NativeSession.open(context, "http://127.0.0.1:1")
        // A fresh local session is sufficient here: requests must be rejected before connecting.
        val epoch =
            try {
                session.authorizationEpoch()
            } catch (_: NativeSession.Failure) {
                0
            }
        val api = NativeUploadApi(session, epoch, {}, {})
        session.invalidateLocally()
        val metadata =
            assertThrows(ApiClient.Failure::class.java) {
                api.request("POST", "/api/photos/uploads", JSONObject())
            }
        assertTrue(metadata.invalidatesCredential())
        val part =
            assertThrows(ApiClient.Failure::class.java) {
                api.put(
                    "http://127.0.0.1:1/sekereagle-assets/test/part?X-Amz-Signature=abc",
                    ByteArrayInputStream(byteArrayOf(1)),
                    1,
                ) {}
            }
        assertTrue(part.invalidatesCredential())
    }
}
