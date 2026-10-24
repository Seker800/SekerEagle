package com.sekereagle.android

import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId

/** API query semantics, shared by the two native modes. Time ranges are local calendar days. */
data class NativeFilters(
    val tags: Set<String> = emptySet(),
    val camera: String = "",
    val lens: String = "",
    val formats: Set<String> = emptySet(),
    val from: String = "",
    val to: String = "",
    val rating: Int? = null,
    val gps: String = "",
    val smartFolderId: String = "",
) {
    fun validationError(): String? {
        if (tags.size > 100) return "最多选择 100 个标签"
        if (rating != null && rating !in 1..5) return "评分必须在 1 到 5 星之间"
        if (gps.isNotEmpty() && gps !in setOf("WITH", "WITHOUT")) return "请选择有效的位置条件"
        return try {
            val start = from.takeIf { it.isNotBlank() }?.let(LocalDate::parse)
            val end = to.takeIf { it.isNotBlank() }?.let(LocalDate::parse)
            if (start != null && end != null && start > end) "开始日期不能晚于结束日期" else null
        } catch (_: Exception) {
            "请输入有效日期，例如 2026-10-22"
        }
    }

    fun parameters(zone: ZoneId = ZoneId.systemDefault()): Map<String, String> {
        require(validationError() == null) { validationError().orEmpty() }
        return buildMap {
            if (tags.isNotEmpty()) {
                put("manualTagIds", tags.sorted().joinToString(","))
                put("tagMatch", "ANY")
            }
            if (camera.isNotBlank()) put("cameraModel", camera)
            if (lens.isNotBlank()) put("lensModel", lens)
            if (formats.isNotEmpty()) put("formats", formats.sorted().joinToString(","))
            if (from.isNotBlank())
                put("createdFrom", LocalDate.parse(from).atStartOfDay(zone).toInstant().toString())
            if (to.isNotBlank())
                put(
                    "createdTo",
                    LocalDate.parse(to)
                        .plusDays(1)
                        .atStartOfDay(zone)
                        .toInstant()
                        .minusMillis(1)
                        .toString(),
                )
            rating?.let { put("rating", it.toString()) }
            if (gps.isNotBlank()) put("gps", gps)
            if (smartFolderId.isNotBlank()) put("smartFolderId", smartFolderId)
        }
    }

    fun without(key: String): NativeFilters =
        when {
            key.startsWith("tag:") -> copy(tags = tags - key.removePrefix("tag:"))
            key.startsWith("format:") -> copy(formats = formats - key.removePrefix("format:"))
            key == "camera" -> copy(camera = "")
            key == "lens" -> copy(lens = "")
            key == "date" -> copy(from = "", to = "")
            key == "rating" -> copy(rating = null)
            key == "gps" -> copy(gps = "")
            key == "smartFolder" -> copy(smartFolderId = "")
            else -> this
        }

    fun tokens(
        availableTags: List<NativeTag>,
        folders: List<NativeChoice> = emptyList(),
    ): List<NativeFilterToken> = buildList {
        val names = availableTags.associate { it.id to it.name }
        if (smartFolderId.isNotEmpty())
            add(
                NativeFilterToken(
                    "smartFolder",
                    "智能文件夹：${folders.firstOrNull { it.id == smartFolderId }?.label ?: "已选文件夹"}",
                )
            )
        tags.sorted().forEach { add(NativeFilterToken("tag:$it", "标签：${names[it] ?: "已选标签"}")) }
        if (camera.isNotEmpty()) add(NativeFilterToken("camera", "相机：$camera"))
        if (lens.isNotEmpty()) add(NativeFilterToken("lens", "镜头：$lens"))
        formats.sorted().forEach {
            add(NativeFilterToken("format:$it", "格式：${it.uppercase(java.util.Locale.ROOT)}"))
        }
        if (from.isNotEmpty() || to.isNotEmpty())
            add(NativeFilterToken("date", "导入：${from.ifEmpty { "不限" }} 至 ${to.ifEmpty { "不限" }}"))
        rating?.let { add(NativeFilterToken("rating", "至少 $it 星")) }
        if (gps.isNotEmpty()) add(NativeFilterToken("gps", if (gps == "WITH") "有 GPS" else "无 GPS"))
    }

    val active: Boolean
        get() = this != NativeFilters()
}

internal fun Map<String, String>.querySuffix(): String =
    entries.joinToString("") { (k, v) ->
        "&${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
    }

object NativeSelection {
    const val LIMIT = 100

    fun all(available: Set<String>): Set<String> = available.take(LIMIT).toSet()

    fun toggle(selected: Set<String>, id: String, available: Set<String>): Set<String> =
        when {
            id !in available -> selected
            id in selected -> selected - id
            selected.size >= LIMIT -> selected
            else -> selected + id
        }
}

data class NativeFilterToken(val key: String, val label: String)

data class NativeTag(
    val id: String,
    val name: String,
    val searchText: String = normalizeTagSearch(name),
) {
    fun matches(query: String) = searchText.contains(normalizeTagSearch(query))
}

internal fun normalizeTagSearch(value: String) =
    java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFKC)
        .lowercase(java.util.Locale.ROOT)
        .filterNot { it.isWhitespace() }

enum class NativeOptionSection {
    TAGS,
    FORMATS,
    PHOTOGRAPHY,
    SMART_FOLDERS,
}

data class NativeOptionStatus(val loading: Boolean = false, val error: String? = null)

data class NativeOptions(
    val tags: List<NativeTag> = emptyList(),
    val cameras: List<String> = emptyList(),
    val lenses: List<String> = emptyList(),
    val formats: List<String> = emptyList(),
    val folders: List<NativeChoice> = emptyList(),
)

internal fun NativeOptions.merge(section: NativeOptionSection, incoming: NativeOptions) =
    when (section) {
        NativeOptionSection.TAGS -> copy(tags = incoming.tags)
        NativeOptionSection.SMART_FOLDERS -> copy(folders = incoming.folders)
        NativeOptionSection.FORMATS -> copy(formats = incoming.formats)
        NativeOptionSection.PHOTOGRAPHY ->
            copy(cameras = incoming.cameras, lenses = incoming.lenses)
    }

data class NativeChoice(val id: String, val label: String)

data class NativeFolder(val id: String, val name: String, val parentId: String? = null)

internal fun nativeFolderChoices(folders: List<NativeFolder>): List<NativeChoice> {
    val byId = folders.associateBy { it.id }
    return folders
        .distinctBy { it.id }
        .map { folder ->
            val parts = mutableListOf<String>()
            val visited = mutableSetOf<String>()
            var current: NativeFolder? = folder
            while (current != null && visited.add(current.id)) {
                parts.add(current.name)
                current = current.parentId?.let(byId::get)
            }
            NativeChoice(folder.id, parts.asReversed().joinToString(" / "))
        }
}
