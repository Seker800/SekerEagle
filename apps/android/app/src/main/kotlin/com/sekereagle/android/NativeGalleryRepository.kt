package com.sekereagle.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.IOException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject

enum class GalleryMode(val title: String) {
    PHOTO("照片"),
    MATERIAL("素材"),
}

data class NativeAsset(
    val id: String,
    val name: String,
    val date: String,
    val time: String,
    val width: Int,
    val height: Int,
    val thumbnail: String?,
    val preview: String?,
    val video: Boolean,
    val revision: Int,
)

data class NativePage(val items: List<NativeAsset>, val cursor: String?)

/** One scoped implementation for both modes; only authenticated derived media enters the cache. */
class NativeGalleryRepository(private val session: NativeSession, private val scope: String) {
    private val decoding = Semaphore(4)
    private val cache =
        object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
        }

    suspend fun page(mode: GalleryMode, search: String, cursor: String? = null): NativePage =
        withContext(Dispatchers.IO) {
            val result =
                session.json(
                    "GET",
                    NativeGalleryPolicy.listPath(mode.name, search, cursor.orEmpty()),
                )
            val items = result.getJSONArray("items")
            NativePage(
                (0 until items.length()).map { parse(items.getJSONObject(it), mode) },
                result.optString("nextCursor").takeUnless { it.isEmpty() || it == "null" },
            )
        }

    suspend fun image(path: String, full: Boolean): Bitmap =
        withContext(Dispatchers.IO) {
            val key = "$scope:$full:$path"
            cache.get(key)?.let {
                return@withContext it
            }
            decoding.withPermit {
                val bytes = session.media(path)
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                if (
                    options.outWidth <= 0 ||
                        options.outHeight <= 0 ||
                        options.outWidth.toLong() * options.outHeight > 100_000_000L
                )
                    throw IOException("预览尺寸不可用")
                val edge = if (full) 2048 else 384
                options.inSampleSize = 1
                while (
                    maxOf(options.outWidth, options.outHeight) / options.inSampleSize > edge
                ) options.inSampleSize *= 2
                options.inJustDecodeBounds = false
                options.inPreferredConfig = Bitmap.Config.ARGB_8888
                val bitmap =
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                        ?: throw IOException("预览解码失败")
                cache.put(key, bitmap)
                bitmap
            }
        }

    fun clear() = cache.evictAll()

    internal fun parse(json: JSONObject, mode: GalleryMode): NativeAsset {
        val id = NativeGalleryPolicy.identifier(json.getString("id"))
        val renditions = json.getJSONArray("renditions")
        val images =
            (0 until renditions.length())
                .map { renditions.getJSONObject(it) }
                .filter {
                    it.optInt("revision") == json.optInt("mediaRevision") &&
                        it.optString("mimeType").startsWith("image/") &&
                        it.optString("variant") != "edit"
                }
        fun path(kind: String): String? =
            images
                .firstOrNull { it.optString("kind") == kind }
                ?.let {
                    NativeGalleryPolicy.mediaPath(mode.name, id, it.getString("id"))
                }
        val rawDate =
            json.optJSONObject("photoMetadata")?.let {
                it.optString("capturedLocal").takeUnless { v -> v.isEmpty() || v == "null" }
            }
                ?: json.optString("chronologicalAt").takeUnless { it.isEmpty() || it == "null" }
                ?: json.optString("libraryAddedAt")
        val date =
            runCatching { Instant.parse(rawDate).atZone(ZoneId.systemDefault()).toLocalDateTime() }
                .getOrElse { runCatching { LocalDateTime.parse(rawDate) }.getOrNull() }
        return NativeAsset(
            id,
            json.optString("displayName", json.optString("originalName")),
            date?.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) ?: "日期未知",
            date?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: "",
            json.optInt("width", 1),
            json.optInt("height", 1),
            path("THUMBNAIL") ?: path("POSTER") ?: path("PREVIEW"),
            path("PREVIEW") ?: path("POSTER") ?: path("THUMBNAIL"),
            json.optString("mimeType").startsWith("video/"),
            json.optInt("mediaRevision"),
        )
    }
}
