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
    val rowVersion: Int = 1,
    val groupDate: String = date,
)

data class NativePage(val items: List<NativeAsset>, val cursor: String?)

/** One scoped implementation for both modes; only authenticated derived media enters the cache. */
class NativeGalleryRepository(private val session: NativeSession, private val scope: String) {
    private val decoding = Semaphore(4)
    private val cache =
        object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
            override fun sizeOf(key: String, value: Bitmap) = value.allocationByteCount
        }

    suspend fun page(
        mode: GalleryMode,
        search: String,
        cursor: String? = null,
        filters: NativeFilters = NativeFilters(),
        trash: Boolean = false,
        sort: GallerySort = GallerySort.default(mode),
    ): NativePage =
        withContext(Dispatchers.IO) {
            val result =
                session.json(
                    "GET",
                    NativeGalleryPolicy.listPath(mode.name, search, cursor.orEmpty()).let {
                        if (trash) it.replace("/assets?", "/trash?") else it
                    } + "&sort=${sort.name}" + filters.parameters().querySuffix(),
                )
            val items = result.getJSONArray("items")
            NativePage(
                (0 until items.length()).map { parse(items.getJSONObject(it), mode, sort) },
                result.optString("nextCursor").takeUnless { it.isEmpty() || it == "null" },
            )
        }

    suspend fun options(mode: GalleryMode): NativeOptions =
        withContext(Dispatchers.IO) {
            val base = NativeGalleryPolicy.base(mode.name)
            val tags = session.array("$base/manual-tags")
            val capabilities = session.json("GET", "$base/media-capabilities")
            val facets =
                if (mode == GalleryMode.PHOTO) session.json("GET", "$base/photography/facets")
                else JSONObject()
            fun strings(json: JSONObject, key: String): List<String> =
                json
                    .optJSONArray(key)
                    ?.let { a -> (0 until a.length()).map { a.getString(it) } }
                    .orEmpty()
            NativeOptions(
                (0 until tags.length()).map {
                    tags.getJSONObject(it).let { t ->
                        NativeTag(t.getString("id"), t.getString("name"))
                    }
                },
                strings(facets, "cameras"),
                strings(facets, "lenses"),
                (strings(capabilities.getJSONObject("images"), "extensions") +
                        strings(capabilities.getJSONObject("videos"), "extensions"))
                    .map { it.removePrefix(".") }
                    .distinct()
                    .sorted(),
            )
        }

    suspend fun change(
        mode: GalleryMode,
        assets: List<NativeAsset>,
        action: String,
        tagIds: Set<String> = emptySet(),
        rating: Int? = null,
    ) =
        withContext(Dispatchers.IO) {
            require(assets.isNotEmpty() && assets.size <= NativeSelection.LIMIT)
            val base = NativeGalleryPolicy.base(mode.name)
            val ids = org.json.JSONArray(assets.map { NativeGalleryPolicy.identifier(it.id) })
            when (action) {
                "trash",
                "restore" ->
                    session.json(
                        "POST",
                        "$base/assets/batch/$action",
                        JSONObject().put("assetIds", ids),
                    )
                "tags",
                "removeTags" ->
                    session.json(
                        "POST",
                        "$base/assets/batch/manual-tags",
                        JSONObject()
                            .put("assetIds", ids)
                            .put(
                                "addTagIds",
                                org.json.JSONArray(
                                    if (action == "tags") tagIds.toList() else emptyList<String>()
                                ),
                            )
                            .put(
                                "removeTagIds",
                                org.json.JSONArray(
                                    if (action == "removeTags") tagIds.toList()
                                    else emptyList<String>()
                                ),
                            ),
                    )
                "rating" ->
                    session.json(
                        "PATCH",
                        "$base/assets/batch",
                        JSONObject()
                            .put(
                                "assets",
                                org.json.JSONArray(
                                    assets.map {
                                        JSONObject()
                                            .put("assetId", it.id)
                                            .put("rowVersion", it.rowVersion)
                                    }
                                ),
                            )
                            .put("rating", rating ?: JSONObject.NULL),
                    )
                else -> error("未知操作")
            }
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

    internal fun parse(
        json: JSONObject,
        mode: GalleryMode,
        sort: GallerySort = GallerySort.default(mode),
    ): NativeAsset {
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
        fun localDate(value: String) =
            runCatching { Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime() }
                .getOrElse { runCatching { LocalDateTime.parse(value) }.getOrNull() }
        val date = localDate(rawDate)
        val groupDate =
            localDate(
                json.optString(
                    if (sort == GallerySort.ADDED_AT) "libraryAddedAt" else "chronologicalAt"
                )
            ) ?: date
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
            json.optInt("rowVersion", 1),
            groupDate?.format(DateTimeFormatter.ofPattern("yyyy年M月d日")) ?: "日期未知",
        )
    }
}
