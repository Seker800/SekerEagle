package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.File
import java.io.IOException
import org.json.JSONObject

/**
 * Editors only read bounded current browsing renditions; originals and edit/develop variants are
 * forbidden.
 */
internal fun NativeGalleryRepository.editorPreview(
    context: Context,
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
): NativeOriginal {
    val epoch = connection.authorizationEpoch()
    val base =
        NativeGalleryPolicy.base(mode.name) + "/assets/" + NativeGalleryPolicy.identifier(asset.id)
    val metadata = connection.jsonAtEpoch(epoch, "GET", base, cancellation = cancellation)
    if (metadata.getInt("mediaRevision") != asset.revision) throw IOException("照片已变化，请重新打开")
    val rows = metadata.getJSONArray("renditions")
    val preview =
        (0 until rows.length())
            .map { rows.getJSONObject(it) }
            .filter {
                it.optInt("revision") == asset.revision &&
                    it.optString("kind") in listOf("PREVIEW", "THUMBNAIL") &&
                    it.optString("variant") != "edit" &&
                    it.optString("mimeType") in listOf("image/jpeg", "image/webp", "image/png") &&
                    it.optLong("byteSize") in 1..8L * 1024 * 1024 &&
                    it.optInt("width") in 1..2048 &&
                    it.optInt("height") in 1..2048 &&
                    it.optString("status", "READY") == "READY"
            }
            .maxByOrNull { it.optLong("width") * it.optLong("height") }
            ?: throw IOException("缩略预览尚未就绪，请稍后重试")
    val file = File.createTempFile("editor-preview-", ".media", context.cacheDir)
    try {
        file.outputStream().use { output ->
            connection.downloadOriginal(
                NativeGalleryPolicy.mediaPath(mode.name, asset.id, preview.getString("id")),
                preview.getLong("byteSize"),
                preview.getString("mimeType"),
                output,
                cancellation,
            ) {}
        }
        val current = connection.jsonAtEpoch(epoch, "GET", base, cancellation = cancellation)
        if (
            current.getInt("mediaRevision") != asset.revision ||
                current.getInt("rowVersion") != metadata.getInt("rowVersion")
        )
            throw IOException("照片已变化，请重新打开")
        return NativeOriginal(
            file,
            JSONObject(metadata.toString()).put("sourceMime", preview.getString("mimeType")),
        )
    } catch (reason: Throwable) {
        file.delete()
        throw reason
    }
}
