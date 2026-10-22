package com.sekereagle.android

import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId

/** API query semantics, shared by the two native modes. Time ranges are local calendar days. */
data class NativeFilters(
    val tags: Set<String> = emptySet(),
    val camera: String = "",
    val lens: String = "",
    val format: String = "",
    val from: String = "",
    val to: String = "",
    val rating: Int? = null,
    val gps: String = "",
) {
    fun validationError(): String? {
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
                put("tagMatch", "ALL")
            }
            if (camera.isNotBlank()) put("cameraModel", camera)
            if (lens.isNotBlank()) put("lensModel", lens)
            if (format.isNotBlank()) put("format", format)
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
        }
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

data class NativeTag(val id: String, val name: String)

data class NativeOptions(
    val tags: List<NativeTag> = emptyList(),
    val cameras: List<String> = emptyList(),
    val lenses: List<String> = emptyList(),
    val formats: List<String> = emptyList(),
)
