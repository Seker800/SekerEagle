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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
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
    val playback: String? = null,
    val playbackSize: Long = 0,
    val city: String? = null,
    val cacheVersion: String? = null,
)

data class NativeDay(val date: String, val before: String, val count: Long, val offset: Long) {
    val label: String
        get() = java.time.LocalDate.parse(date).format(DateTimeFormatter.ofPattern("yyyy年M月d日"))
}

data class NativeTimeline(val days: List<NativeDay>, val total: Long) {
    fun dayAt(position: Long): NativeDay? {
        if (days.isEmpty()) return null
        var low = 0
        var high = days.size
        while (low < high) {
            val middle = low + (high - low) / 2
            if (days[middle].offset <= position) low = middle + 1 else high = middle
        }
        return days[(low - 1).coerceAtLeast(0)]
    }
}

data class NativePage(val items: List<NativeAsset>, val cursor: String?)

/**
 * Older servers only expose extensions. Map the aliases whose stored inspection format differs, so
 * the list format filter still matches rather than silently returning an empty page.
 */
internal fun canonicalFormat(extension: String): String =
    when (val value = extension.lowercase(java.util.Locale.ROOT).removePrefix(".")) {
        "jpg" -> "jpeg"
        "heic" -> "heif"
        "tif" -> "tiff"
        "m4v" -> "mp4"
        "m2ts" -> "mts"
        "mpeg" -> "mpg"
        else -> value
    }

/** One scoped implementation for both modes; only authenticated derived media enters the cache. */
class NativeGalleryRepository(
    private val session: NativeSession,
    private val scope: String,
    private val disk: NativeMediaCache? = null,
) {
    internal val editorHost
        get() =
            "e" +
                java.security.MessageDigest.getInstance("SHA-256")
                    .digest(scope.toByteArray())
                    .joinToString("") { "%02x".format(it) } +
                ".editor.sekereagle.invalid"

    internal val connection
        get() = session

    private val imagesLock = Any()
    private var memoryEpoch = 0
    private val imageVersions = LruCache<String, String>(4096)
    private val imageLoads = Array(32) { Mutex() }
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
        before: String? = null,
        offset: Long = 0,
    ): NativePage =
        withContext(Dispatchers.IO) {
            val result =
                session.json(
                    "GET",
                    NativeGalleryPolicy.listPath(mode.name, search, cursor.orEmpty()).let {
                        if (trash) it.replace("/assets?", "/trash?") else it
                    } +
                        "&sort=${sort.name}" +
                        (before?.let { "&before=" + java.net.URLEncoder.encode(it, "UTF-8") }
                            ?: "") +
                        (if (offset > 0) "&offset=$offset" else "") +
                        filters.parameters().querySuffix(),
                )
            val items = result.getJSONArray("items")
            NativePage(
                (0 until items.length()).map { parse(items.getJSONObject(it), mode, sort) },
                result.optString("nextCursor").takeUnless { it.isEmpty() || it == "null" },
            )
        }

    suspend fun timeline(mode: GalleryMode, sort: GallerySort): NativeTimeline =
        withContext(Dispatchers.IO) {
            val zone = java.net.URLEncoder.encode(ZoneId.systemDefault().id, "UTF-8")
            val json =
                session.json(
                    "GET",
                    "${NativeGalleryPolicy.base(mode.name)}/assets/timeline?sort=${sort.name}&timeZone=$zone",
                )
            val days = json.getJSONArray("days")
            NativeTimeline(
                (0 until days.length()).map {
                    days.getJSONObject(it).let { day ->
                        NativeDay(
                            day.getString("date"),
                            day.getString("before"),
                            day.getLong("count"),
                            day.getLong("offset"),
                        )
                    }
                },
                json.getLong("total"),
            )
        }

    internal fun videoSource(asset: NativeAsset): NativeVideoSource {
        require(asset.video && asset.playback != null && asset.playbackSize > 0)
        return NativeVideoSource(session, asset.playback, asset.playbackSize)
    }

    suspend fun options(
        mode: GalleryMode,
        section: NativeOptionSection,
        cancellation: NativeTransferCancellation? = null,
    ): NativeOptions =
        withContext(Dispatchers.IO) {
            val base = NativeGalleryPolicy.base(mode.name)
            fun strings(json: JSONObject, key: String): List<String> =
                json
                    .optJSONArray(key)
                    ?.let { a -> (0 until a.length()).map { a.getString(it) } }
                    .orEmpty()
                    .filter { it.isNotBlank() }
                    .distinct()
            when (section) {
                NativeOptionSection.TAGS -> {
                    // Legacy catalogs include counts and groups for every tag. Keep this larger
                    // read budget local to catalogs; ordinary JSON and media budgets are unchanged.
                    val rows = session.array("$base/manual-tags", 16 * 1024 * 1024, cancellation)
                    NativeOptions(
                        tags =
                            (0 until rows.length())
                                .map { i ->
                                    cancellation?.check()
                                    val row = rows.getJSONObject(i)
                                    val name = row.getString("name")
                                    NativeTag(
                                        row.getString("id"),
                                        name,
                                        normalizeTagSearch(
                                            "$name ${row.optString("pinyin")} ${row.optString("pinyinInitials")}"
                                        ),
                                    )
                                }
                                .distinctBy { it.id }
                    )
                }
                NativeOptionSection.SMART_FOLDERS -> {
                    val rows = session.array("$base/smart-folders", 16 * 1024 * 1024, cancellation)
                    NativeOptions(
                        folders =
                            nativeFolderChoices(
                                (0 until rows.length()).map { i ->
                                    cancellation?.check()
                                    val row = rows.getJSONObject(i)
                                    NativeFolder(
                                        row.getString("id"),
                                        row.getString("name"),
                                        row.optString("parentId").takeUnless {
                                            it.isBlank() || it == "null"
                                        },
                                    )
                                }
                            )
                    )
                }
                NativeOptionSection.FORMATS -> {
                    val json =
                        session.json("GET", "$base/media-capabilities", cancellation = cancellation)
                    fun formats(part: JSONObject) =
                        strings(part, "formats")
                            .ifEmpty { strings(part, "extensions") }
                            .map(::canonicalFormat)
                    NativeOptions(
                        formats =
                            (formats(json.getJSONObject("images")) +
                                    formats(json.getJSONObject("videos")))
                                .distinct()
                                .sorted()
                    )
                }
                NativeOptionSection.PHOTOGRAPHY -> {
                    if (mode != GalleryMode.PHOTO) NativeOptions()
                    else
                        session
                            .json("GET", "$base/photography/facets", cancellation = cancellation)
                            .let {
                                NativeOptions(
                                    cameras = strings(it, "cameras"),
                                    lenses = strings(it, "lenses"),
                                )
                            }
                }
            }
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

    internal fun imageVersion(path: String?): String? = path?.let { imageVersions.get(it) }

    suspend fun image(
        path: String,
        full: Boolean,
        sourceVersion: String? = imageVersion(path),
    ): Bitmap =
        withContext(Dispatchers.IO) {
            val epoch = session.authorizationEpoch()
            val local = synchronized(imagesLock) { memoryEpoch }
            val ticket = disk?.generation ?: 0
            val version = sourceVersion
            val key = "$scope:$full:$path:$version:$ticket"
            val id = version?.let { disk?.identity(scope, path, it) }
            fun checkActive() {
                session.checkAuthorization(epoch)
                synchronized(imagesLock) {
                    if (memoryEpoch != local) throw kotlinx.coroutines.CancellationException()
                }
            }
            checkActive()
            cache.get(key)?.let {
                checkActive()
                id?.let { entry -> disk?.touch(entry) }
                checkActive()
                return@withContext it
            }
            imageLoads[(path.hashCode() and Int.MAX_VALUE) % imageLoads.size].withLock {
                decoding.withPermit {
                    checkActive()
                    cache.get(key)?.let {
                        return@withPermit it
                    }
                    val cached = id?.let { disk?.read(it) }
                    fun decode(bytes: ByteArray): Bitmap {
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
                        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                            ?: throw IOException("预览解码失败")
                    }
                    var bitmap = cached?.let {
                        try {
                            decode(it)
                        } catch (_: Exception) {
                            null
                        }
                    }
                    if (bitmap == null) {
                        if (id != null && cached != null) disk?.remove(id)
                        val bytes = session.media(path)
                        checkActive()
                        bitmap = decode(bytes)
                        if (id != null) disk?.write(id, bytes, ticket)
                    }
                    checkActive()
                    val result = bitmap!!
                    synchronized(imagesLock) {
                        checkActive()
                        if (disk == null || ticket == disk.generation) cache.put(key, result)
                    }
                    result
                }
            }
        }

    internal fun evictImages() = synchronized(imagesLock) { cache.evictAll() }

    fun clear() =
        synchronized(imagesLock) {
            memoryEpoch++
            cache.evictAll()
            imageVersions.evictAll()
        }

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
        val stamp =
            if (!json.optBoolean("isPrivate") && json.isNull("deletedAt"))
                com.sekereagle.android.core.BackupPolicy.digest(
                    "${json.optInt("mediaRevision")}:${json.optString("updatedAt")}:" +
                        images
                            .sortedBy { it.getString("id") }
                            .joinToString(";") { row ->
                                listOf(
                                        row.getString("id"),
                                        row.optInt("revision"),
                                        row.optString("mimeType"),
                                        row.optLong("byteSize"),
                                        row.optInt("width"),
                                        row.optInt("height"),
                                    )
                                    .joinToString(":")
                            }
                )
            else null
        for (row in images) {
            val mediaPath = NativeGalleryPolicy.mediaPath(mode.name, id, row.getString("id"))
            if (stamp != null) imageVersions.put(mediaPath, stamp)
            else imageVersions.remove(mediaPath)
        }
        fun path(kind: String): String? =
            images
                .firstOrNull { it.optString("kind") == kind }
                ?.let {
                    NativeGalleryPolicy.mediaPath(mode.name, id, it.getString("id"))
                }
        val movie =
            (0 until renditions.length())
                .map { renditions.getJSONObject(it) }
                .firstOrNull {
                    it.optInt("revision") == json.optInt("mediaRevision") &&
                        it.optString("kind") == "PREVIEW" &&
                        it.optString("mimeType") == "video/mp4" &&
                        it.optLong("byteSize") > 0
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
            movie?.let { NativeGalleryPolicy.mediaPath(mode.name, id, it.getString("id")) },
            movie?.optLong("byteSize") ?: 0,
            NativeCity.label(json),
            stamp,
        )
    }
}
