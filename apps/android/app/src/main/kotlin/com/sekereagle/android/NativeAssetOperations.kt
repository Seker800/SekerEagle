package com.sekereagle.android

import com.sekereagle.android.core.NativeGalleryPolicy
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal data class NativeAssetOperation(
    val id: String,
    val mode: GalleryMode,
    val kind: String,
    val total: Int,
    val completed: Int,
    val failed: Int,
    val cancelled: Int,
    val queued: Int,
    val running: Int,
) {
    val pending
        get() = queued + running > 0

    val title
        get() =
            when (kind) {
                "SEND" -> if (mode == GalleryMode.PHOTO) "发送到素材" else "发送到照片"
                "TRASH" -> "移入回收站"
                "RESTORE" -> "恢复"
                else -> "清空回收站"
            }

    val progress
        get() =
            "已完成 $completed/$total" +
                (if (pending) " · 正在处理" else "") +
                (if (failed > 0) " · 失败 $failed 项" else "") +
                (if (cancelled > 0) " · 已取消 $cancelled 项" else "")
}

/** Uses the shared server queue: accepting a command never retires local source cards. */
internal class NativeAssetOperations(private val session: NativeSession) {
    suspend fun send(mode: GalleryMode, ids: Set<String>, operationId: String) =
        withContext(Dispatchers.IO) {
            require(ids.isNotEmpty() && ids.size <= NativeSelection.LIMIT)
            session.json(
                "POST",
                "${NativeGalleryPolicy.base(mode.name)}/operations",
                JSONObject()
                    .put("kind", "SEND")
                    .put("operationId", operationId)
                    .put("assetIds", JSONArray(ids.map { NativeGalleryPolicy.identifier(it) })),
            )
        }

    suspend fun list(): List<NativeAssetOperation> =
        withContext(Dispatchers.IO) {
            GalleryMode.entries.flatMap { mode ->
                val rows =
                    session.array(
                        "${NativeGalleryPolicy.base(mode.name)}/operations?publicOnly=true"
                    )
                (0 until rows.length()).map { index ->
                    val row = rows.getJSONObject(index)
                    NativeAssetOperation(
                        row.getString("id"),
                        mode,
                        row.getString("kind"),
                        row.getInt("total"),
                        row.getInt("completed"),
                        row.getInt("failed"),
                        row.getInt("cancelled"),
                        row.getInt("queued"),
                        row.getInt("running"),
                    )
                }
            }
        }
}
