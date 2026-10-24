package com.sekereagle.android

import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test

class NativeCredentialTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun failedCredentialCommitIsNotReportedAsSuccess() {
        val preferences = failingPreferences()
        assertThrows(IllegalStateException::class.java) {
            BackupSettings(preferences).setValue("scope", "credential", "encrypted")
        }
    }

    private fun failingPreferences(): SharedPreferences {
        val real = context.getSharedPreferences("credential-failure-test", 0)
        return Proxy.newProxyInstance(
            SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java),
        ) { _, method, args ->
            if (method.name == "edit") {
                val editor = real.edit()
                lateinit var proxy: Any
                proxy =
                    Proxy.newProxyInstance(
                        SharedPreferences.Editor::class.java.classLoader,
                        arrayOf(SharedPreferences.Editor::class.java),
                    ) { _, editMethod, editArgs ->
                        when (editMethod.name) {
                            "commit" -> false
                            else -> {
                                val result = editMethod.invoke(editor, *(editArgs ?: emptyArray()))
                                if (result is SharedPreferences.Editor) proxy else result
                            }
                        }
                    }
                proxy
            } else method.invoke(real, *(args ?: emptyArray()))
        } as SharedPreferences
    }

    @Test
    fun erasureDestroysOnlyTheScopedKeyEvenWhenTheOldCiphertextSurvives() {
        val settings = BackupSettings(context)
        val scope = "credential-erasure-test"
        val other = "credential-other-test"
        settings.saveToken(scope, "old-proof")
        settings.saveToken(other, "other-proof")
        val ciphertext = settings.value(scope, "credential", "")
        settings.clearToken(scope)
        settings.setValue(scope, "credential", ciphertext)
        assertThrows(Exception::class.java) { BackupSettings(context).token(scope) }
        assertEquals("other-proof", settings.token(other))
        settings.clearToken(scope)
        settings.clearToken(other)
    }

    @Test
    fun clearingLegacyCredentialsRejectsReplayedV1CiphertextWithoutErasingAnotherScope() {
        val store = java.security.KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key =
            if (store.containsAlias("sekereagle-backup-v1"))
                store.getKey("sekereagle-backup-v1", null) as javax.crypto.SecretKey
            else
                javax.crypto.KeyGenerator.getInstance("AES", "AndroidKeyStore")
                    .apply {
                        init(
                            android.security.keystore.KeyGenParameterSpec.Builder(
                                    "sekereagle-backup-v1",
                                    android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                                        android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
                                )
                                .setBlockModes("GCM")
                                .setEncryptionPaddings("NoPadding")
                                .build()
                        )
                    }
                    .generateKey()
        val settings = BackupSettings(context)
        val scope = "legacy-erasure-${java.util.UUID.randomUUID()}"
        val other = "legacy-other-${java.util.UUID.randomUUID()}"
        fun legacyRecord(target: String, value: String): String {
            val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, key)
            cipher.updateAAD(target.toByteArray())
            return org.json
                .JSONObject()
                .put(
                    "iv",
                    android.util.Base64.encodeToString(cipher.iv, android.util.Base64.NO_WRAP),
                )
                .put(
                    "data",
                    android.util.Base64.encodeToString(
                        cipher.doFinal(value.toByteArray()),
                        android.util.Base64.NO_WRAP,
                    ),
                )
                .toString()
        }
        val old = legacyRecord(scope, "legacy-proof")
        settings.setValue(scope, "credential", old)
        settings.setValue(other, "credential", legacyRecord(other, "other-legacy-proof"))
        assertEquals("legacy-proof", settings.token(scope))
        settings.clearToken(scope)
        settings.setValue(scope, "credential", old)
        assertThrows(Exception::class.java) { BackupSettings(context).token(scope) }
        assertEquals("other-legacy-proof", settings.token(other))
        settings.clearToken(scope)
        settings.clearToken(other)
    }

    @Test
    fun failedSessionPersistenceRevokesTheIssuedFamilyAndBlocksFurtherRequests() {
        val socket = java.net.ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        val requests = java.util.concurrent.CopyOnWriteArrayList<String>()
        val failure = java.util.concurrent.atomic.AtomicReference<Throwable>()
        val server =
            Thread {
                    try {
                        repeat(2) { index ->
                            socket.accept().use { client ->
                                client.soTimeout = 5000
                                val reader = client.getInputStream().bufferedReader()
                                requests.add(reader.readLine().split(" ")[1])
                                var cookie = ""
                                var length = 0
                                while (true) {
                                    val line = reader.readLine()
                                    if (line.isEmpty()) break
                                    if (line.startsWith("Cookie:", true))
                                        cookie = line.substringAfter(':').trim()
                                    if (line.startsWith("Content-Length:", true))
                                        length = line.substringAfter(':').trim().toInt()
                                }
                                repeat(length) { reader.read() }
                                if (index == 1)
                                    assertTrue(cookie.contains("sekereagle_refresh=issued-refresh"))
                                val cookies =
                                    if (index == 0)
                                        "Set-Cookie: sekereagle_access=issued-access; Path=/\r\nSet-Cookie: sekereagle_refresh=issued-refresh; Path=/api/auth\r\n"
                                    else ""
                                client
                                    .getOutputStream()
                                    .write(
                                        ("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n" +
                                                cookies +
                                                "\r\n{}")
                                            .toByteArray()
                                    )
                            }
                        }
                    } catch (reason: Throwable) {
                        failure.set(reason)
                    }
                }
                .apply { start() }
        val preferences = failingPreferences()
        val failingContext =
            object : android.content.ContextWrapper(context) {
                override fun getApplicationContext(): android.content.Context = this

                override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                    preferences
            }
        try {
            val session = NativeSession.open(failingContext, origin)
            assertThrows(java.io.IOException::class.java) {
                session.login("fixture@example.invalid", "fixture")
            }
            server.join(7000)
            assertFalse(server.isAlive)
            failure.get()?.let { throw AssertionError(it) }
            assertEquals(listOf("/api/auth/login", "/api/auth/logout"), requests.toList())
            assertThrows(NativeSession.Failure::class.java) { session.json("GET", "/api/auth/me") }
        } finally {
            socket.close()
            server.join(5000)
        }
    }
}
