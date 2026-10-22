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
    fun json(method: String, path: String, body: JSONObject? = null): JSONObject {
        val bytes =
            request(
                method,
                path,
                body?.toString()?.toByteArray(Charsets.UTF_8),
                2 * 1024 * 1024,
                true,
            )
        return if (bytes.isEmpty()) JSONObject() else JSONObject(String(bytes, Charsets.UTF_8))
    }

    @Synchronized
    fun array(path: String): org.json.JSONArray =
        org.json.JSONArray(
            String(request("GET", path, null, 2 * 1024 * 1024, true), Charsets.UTF_8)
        )

    override fun request(method: String, path: String, body: JSONObject?): JSONObject =
        json(method, path, body)

    fun media(path: String): ByteArray = request("GET", path, null, 16 * 1024 * 1024, true)

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
    ): ByteArray {
        NativeGalleryPolicy.safePath(path)
        val (ticket, cookie) =
            synchronized(credentialLock) {
                if (blocked) throw Failure(401)
                epoch to jar.header(path)
            }
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.requestMethod = method
            connection.setRequestProperty("Origin", origin)
            connection.setRequestProperty("Cookie", cookie)
            connection.setRequestProperty(
                "Accept",
                if (limit > 2 * 1024 * 1024) "image/*" else "application/json",
            )
            if (body != null) {
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
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
                        )
                }
                return request(method, path, body, limit, false)
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
            if (connection.contentLengthLong > limit) throw IOException("媒体超过本次读取预算")
            if (limit > 2 * 1024 * 1024 && !connection.contentType.orEmpty().startsWith("image/"))
                throw IOException("预览暂不可用")
            return connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    ensureActive(ticket)
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (output.size() + count > limit) throw IOException("响应超过本次读取预算")
                    output.write(buffer, 0, count)
                }
                ensureActive(ticket)
                output.toByteArray()
            }
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
