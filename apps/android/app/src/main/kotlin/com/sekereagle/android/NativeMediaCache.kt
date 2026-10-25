package com.sekereagle.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.sekereagle.android.core.NativeCacheStatistics
import com.sekereagle.android.core.NativeDiskCache
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

internal data class NativeCacheUsage(
    val bytes: Long = 0,
    val count: Int = 0,
    val limitMb: Int = 512,
)

/**
 * Application-wide disk budget; only current, public derived media is admitted by the repository.
 */
class NativeMediaCache
internal constructor(
    context: Context,
    directory: File = File(context.cacheDir, "derived-media-v1"),
) {
    private val preferences =
        context.applicationContext.getSharedPreferences("native-media-cache", Context.MODE_PRIVATE)
    private val store = NativeDiskCache(directory, limitMb.toLong() * MIB)
    val limitMb
        get() = preferences.getInt("limit-mb", DEFAULT_MB).coerceIn(0, MAX_MB)

    internal val generation
        get() = store.generation()

    internal fun invalidate() = store.invalidate()

    private val counters = NativeCacheStatistics()
    private val mutableStatistics = MutableStateFlow(counters.snapshot())
    internal val statistics = mutableStatistics.asStateFlow()

    internal fun statisticsTicket() = counters.token()

    @Synchronized
    internal fun record(outcome: NativeCacheStatistics.Outcome, ticket: Long) {
        if (counters.record(outcome, ticket)) mutableStatistics.value = counters.snapshot()
    }

    @Synchronized
    private fun resetStatistics() {
        counters.reset()
        mutableStatistics.value = counters.snapshot()
    }

    private val keyAlias = "sekereagle-native-derived-cache-v1"

    @Synchronized
    private fun key(): SecretKey {
        val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keys.getKey(keyAlias, null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            keyAlias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    internal fun identity(scope: String, path: String, version: String): String =
        com.sekereagle.android.core.BackupPolicy.digest("$scope\n$path\n$version")

    internal fun read(id: String): ByteArray? {
        if (limitMb == 0) return null
        return try {
            val encrypted = store.get(id) ?: return null
            if (encrypted.size < 28) throw java.io.IOException("Invalid cached image")
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, encrypted.copyOfRange(0, 12)),
                )
                updateAAD(id.toByteArray())
                doFinal(encrypted, 12, encrypted.size - 12)
            }
        } catch (_: Exception) {
            runCatching { store.remove(id) }
            null
        }
    }

    internal fun write(id: String, bytes: ByteArray, ticket: Long) {
        if (limitMb == 0 || generation != ticket) return
        runCatching {
            val cipher =
                Cipher.getInstance("AES/GCM/NoPadding").apply {
                    init(Cipher.ENCRYPT_MODE, key())
                    updateAAD(id.toByteArray())
                }
            val encrypted = ByteArray(12 + cipher.getOutputSize(bytes.size))
            cipher.iv.copyInto(encrypted)
            cipher.doFinal(bytes, 0, bytes.size, encrypted, 12)
            store.put(id, encrypted, ticket)
        }
    }

    internal fun touch(id: String) {
        runCatching { store.touch(id) }
    }

    internal fun remove(id: String) {
        runCatching { store.remove(id) }
    }

    internal suspend fun usage(): NativeCacheUsage =
        withContext(Dispatchers.IO) { NativeCacheUsage(store.size(), store.count(), limitMb) }

    @android.annotation.SuppressLint(
        "UseKtx"
    ) // KTX discards the commit result needed for failure feedback.
    internal suspend fun resize(mb: Int) =
        withContext(Dispatchers.IO) {
            require(mb in 0..MAX_MB) { "请输入 0 到 16384 MB" }
            if (!preferences.edit().putInt("limit-mb", mb).commit())
                throw java.io.IOException("缓存设置未保存，请检查手机存储空间")
            store.resize(mb.toLong() * MIB)
        }

    internal suspend fun clear() =
        withContext(Dispatchers.IO) {
            store.clear()
            resetStatistics()
        }

    companion object {
        const val DEFAULT_MB = 512
        const val MAX_MB = 16384
        const val MIB = 1024L * 1024L
        @Volatile private var instance: NativeMediaCache? = null

        fun get(context: Context): NativeMediaCache =
            instance
                ?: synchronized(this) {
                    instance ?: NativeMediaCache(context.applicationContext).also { instance = it }
                }
    }
}
