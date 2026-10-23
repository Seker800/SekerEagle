package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.BackupPolicy
import com.sekereagle.android.core.NativeCookies
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** Native first-party authentication. Never reads or writes WebView's cookie store. */
class NativeSession private constructor(context: Context, val origin: String) : SessionApi {
    private val settings = BackupSettings(context.applicationContext)
    private val jar = NativeCookies(origin)
    private val storageKey = "native-session:$origin"
    private val credentialLock = Any()
    private val refreshLock = Any()
    private var epoch = 0
    private var blocked = false
    private var pendingLogout = ""

    init {
        try {
            val saved = settings.token(storageKey)
            if (saved.isNotEmpty()) {
                val json = JSONObject(saved)
                jar.restore(json.keys().asSequence().associateWith { json.getString(it) })
            }
        } catch (_: Exception) {
            jar.clear()
            settings.setValue(storageKey, "credential", "")
        }
    }

    class Failure(val status: Int) :
        IOException(
            when (status) {
                401 -> "登录已失效，请重新登录"
                403 -> "当前账号没有此操作权限"
                429 -> "操作较频繁，请稍后重试"
                else -> "服务器暂时无法处理请求（$status）"
            }
        )

    @Synchronized
    fun json(
        method: String,
        path: String,
        body: JSONObject? = null,
        cancellation: NativeTransferCancellation? = null,
    ): JSONObject {
        val bytes =
            request(
                method,
                path,
                body?.toString()?.toByteArray(Charsets.UTF_8),
                2 * 1024 * 1024,
                true,
                cancellation,
            )
        return if (bytes.isEmpty()) JSONObject() else JSONObject(String(bytes, Charsets.UTF_8))
    }

    @Synchronized
    fun array(path: String): org.json.JSONArray =
        org.json.JSONArray(
            String(request("GET", path, null, 2 * 1024 * 1024, true), Charsets.UTF_8)
        )

    internal fun authorizationEpoch(): Int =
        synchronized(credentialLock) {
            if (blocked) throw Failure(401)
            epoch
        }

    @Synchronized
    internal fun jsonAtEpoch(
        ticket: Int,
        method: String,
        path: String,
        body: JSONObject? = null,
        cancellation: NativeTransferCancellation? = null,
    ): JSONObject {
        ensureActive(ticket)
        return json(method, path, body, cancellation)
    }

    internal fun checkAuthorization(ticket: Int) {
        ensureActive(ticket)
    }

    override fun request(method: String, path: String, body: JSONObject?): JSONObject =
        json(method, path, body)

    fun media(path: String): ByteArray = request("GET", path, null, 16 * 1024 * 1024, true)

    internal fun videoRange(
        path: String,
        position: Long,
        length: Int,
        size: Long,
        ticket: Int,
        bind: (HttpURLConnection) -> Unit,
    ): ByteArray {
        require(
            path.matches(
                Regex(
                    "/api/(photos|eagle)/assets/[a-zA-Z0-9_-]{1,100}/renditions/[a-zA-Z0-9_-]{1,100}/content"
                )
            )
        )
        require(position >= 0 && position < size && length in 1..524288)
        ensureActive(ticket)
        val end = minOf(size - 1, position + length - 1)
        return exchange(
            "GET",
            path,
            null,
            true,
            "video/mp4",
            { connection ->
                ensureActive(ticket)
                bind(connection)
                connection.setRequestProperty("Range", "bytes=$position-$end")
            },
        ) { connection, active ->
            if (
                connection.responseCode != 206 ||
                    connection.getHeaderField("Content-Range") != "bytes $position-$end/$size" ||
                    connection.contentType.orEmpty().substringBefore(';') != "video/mp4"
            )
                throw IOException("播放副本暂不可用")
            val bytes = ByteArray((end - position + 1).toInt())
            connection.inputStream.use { input ->
                var offset = 0
                while (offset < bytes.size) {
                    ensureActive(ticket)
                    active()
                    val count = input.read(bytes, offset, bytes.size - offset)
                    if (count < 0) throw IOException("播放数据不完整")
                    offset += count
                }
            }
            ensureActive(ticket)
            active()
            bytes
        }
    }

    @Synchronized
    fun login(email: String, password: String): JSONObject {
        clear()
        synchronized(credentialLock) { blocked = false }
        json(
            "POST",
            "/api/auth/login",
            JSONObject().put("email", email.trim()).put("password", password),
        )
        return json("GET", "/api/auth/me")
    }

    /** Local logout is synchronous and does not wait behind a media/network request. */
    fun invalidateLocally() =
        synchronized(credentialLock) {
            if (!blocked) pendingLogout = jar.header("/api/auth/logout")
            erase()
        }

    @Synchronized
    fun logout() {
        invalidateLocally()
        val proof = synchronized(credentialLock) { pendingLogout.also { pendingLogout = "" } }
        if (proof.isEmpty()) return
        val connection = URL(origin + "/api/auth/logout").openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.requestMethod = "POST"
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("Cookie", proof)
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.setFixedLengthStreamingMode(2)
            connection.outputStream.use { it.write("{}".toByteArray()) }
            if (connection.responseCode !in 200..299) throw Failure(connection.responseCode)
        } finally {
            connection.disconnect()
        }
    }

    fun clear() =
        synchronized(credentialLock) {
            pendingLogout = ""
            erase()
        }

    private fun erase() {
        epoch++
        blocked = true
        jar.clear()
        settings.setValue(storageKey, "credential", "")
    }

    private fun ensureActive(ticket: Int) =
        synchronized(credentialLock) {
            if (blocked || ticket != epoch) throw Failure(401)
        }

    private fun request(
        method: String,
        path: String,
        body: ByteArray?,
        limit: Int,
        refresh: Boolean,
        cancellation: NativeTransferCancellation? = null,
    ): ByteArray =
        exchange(
            method,
            path,
            body,
            refresh,
            if (limit > 2 * 1024 * 1024) "image/*" else "application/json",
            cancellation = cancellation,
        ) { connection, checkActive ->
            if (connection.contentLengthLong > limit) throw IOException("媒体超过本次读取预算")
            if (limit > 2 * 1024 * 1024 && !connection.contentType.orEmpty().startsWith("image/"))
                throw IOException("预览暂不可用")
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    checkActive()
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) throw IOException("响应超过本次读取预算")
                    output.write(buffer, 0, count)
                }
                checkActive()
                output.toByteArray()
            }
        }

    fun downloadOriginal(
        path: String,
        size: Long,
        mime: String,
        output: java.io.OutputStream,
        cancellation: NativeTransferCancellation,
        progress: (Long) -> Unit,
    ) {
        require(path.matches(Regex("/api/(photos|eagle)/assets/[a-zA-Z0-9_-]{1,100}/original")))
        com.sekereagle.android.core.NativeDownloadPolicy.validate(size, mime)
        exchange("GET", path, null, true, mime, cancellation::bind) { connection, active ->
            cancellation.check()
            if (
                connection.responseCode != 200 ||
                    (connection.contentLengthLong >= 0 && connection.contentLengthLong != size)
            )
                throw IOException("原件大小已变化，请刷新后重试")
            if (!connection.contentType.orEmpty().substringBefore(';').trim().equals(mime, true))
                throw IOException("原件格式不匹配")
            connection.inputStream.use { input ->
                com.sekereagle.android.core.NativeDownloadPolicy.copy(
                    input,
                    output,
                    size,
                    {
                        cancellation.check()
                        active()
                    },
                    { progress(it) },
                )
            }
        }
    }

    private fun <T> exchange(
        method: String,
        path: String,
        body: ByteArray?,
        refresh: Boolean,
        accept: String,
        onConnection: (HttpURLConnection) -> Unit = {},
        cancellation: NativeTransferCancellation? = null,
        consume: (HttpURLConnection, () -> Unit) -> T,
    ): T {
        NativeGalleryPolicy.safePath(path)
        val (ticket, cookie) =
            synchronized(credentialLock) {
                if (blocked) throw Failure(401)
                epoch to jar.header(path)
            }
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        try {
            cancellation?.bind(connection)
            onConnection(connection)
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.requestMethod = method
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty("Accept", accept)
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            cancellation?.check()
            ensureActive(ticket)
            if (
                status == 401 &&
                    refresh &&
                    (!path.startsWith("/api/auth/") || path == "/api/auth/me")
            ) {
                connection.disconnect()
                synchronized(refreshLock) {
                    ensureActive(ticket)
                    // A concurrent preview may already have rotated the same session.
                    val current = synchronized(credentialLock) { jar.header(path) }
                    if (current == cookie)
                        request(
                            "POST",
                            "/api/auth/refresh",
                            "{}".toByteArray(),
                            2 * 1024 * 1024,
                            false,
                            cancellation,
                        )
                }
                return exchange(
                    method,
                    path,
                    body,
                    false,
                    accept,
                    onConnection,
                    cancellation,
                    consume,
                )
            }
            if (status !in 200..299) {
                if (status == 401) clear()
                throw Failure(status)
            }
            synchronized(credentialLock) {
                ensureActive(ticket)
                var changed = false
                connection.headerFields.forEach { (name, values) ->
                    if (name?.equals("Set-Cookie", true) == true)
                        values.forEach {
                            jar.accept(it)
                            changed = true
                        }
                }
                if (changed) settings.saveToken(storageKey, JSONObject(jar.snapshot()).toString())
            }
            return consume(connection) {
                cancellation?.check()
                ensureActive(ticket)
            }
        } catch (reason: Exception) {
            cancellation?.check()
            throw reason
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private val sessions = mutableMapOf<String, NativeSession>()

        @JvmStatic
        @Synchronized
        fun open(context: Context, origin: String): NativeSession {
            val normalized = BackupPolicy.origin(origin, BuildConfig.DEBUG)
            return sessions.getOrPut(normalized) { NativeSession(context, normalized) }
        }
    }
}
