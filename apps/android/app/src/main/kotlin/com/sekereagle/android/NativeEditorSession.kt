package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

/** Frozen source and mode; the script cannot supply paths, owners, upload URLs or credentials. */
internal class NativeEditorSession(
    private val context: Context,
    private val repo: NativeGalleryRepository,
    private val mode: GalleryMode,
    private val initial: NativeAsset,
) : AutoCloseable {
    val cancellation = NativeTransferCancellation()
    private val session = repo.connection
    private val epoch = session.authorizationEpoch()
    private var source: NativeOriginal? = null
    private var asset = initial
    private val base
        get() = NativeGalleryPolicy.base(mode.name)

    private val path
        get() = "$base/assets/${NativeGalleryPolicy.identifier(asset.id)}"

    private var saveIntent = ""
    private var requestId = ""
    private var jobId: String? = null
    private var lut = StringBuilder()
    private var lutSize = 0
    private var serverEditing = false
    private var saved: JSONObject? = null
    @Volatile private var closed = false

    fun source(): NativeOriginal {
        cancellation.check()
        session.checkAuthorization(epoch)
        return source ?: throw IOException("照片尚未就绪")
    }

    private fun read(path: String): JSONObject = runBlocking {
        retryOriginalRead(cancellation) {
            session.jsonAtEpoch(epoch, "GET", path, cancellation = cancellation)
        }
    }

    @Synchronized
    fun request(action: String, input: JSONObject): Any {
        check(!closed) { "编辑会话已关闭" }
        cancellation.check()
        session.checkAuthorization(epoch)
        return when (action) {
            "open" -> {
                serverEditing = read("$base/media-capabilities").optInt("serverPhotoEditing") == 1
                val entry = read("$base/assets/${NativeGalleryPolicy.identifier(initial.id)}/edit-recipe").optJSONObject("entry")
                if (entry != null) {
                    val id =
                        entry.optString("baseAssetId").takeUnless { it.isEmpty() || it == "null" }
                            ?: initial.id
                    val original = read("$base/assets/${NativeGalleryPolicy.identifier(id)}")
                    if (original.getInt("mediaRevision") != entry.getInt("baseMediaRevision"))
                        throw IOException("原照片已变化，无法恢复编辑参数")
                    asset = repo.parse(original, mode)
                }
                source?.close()
                source = null
                source = runBlocking {
                    retryOriginalRead(cancellation) {
                        repo.editorPreview(context, mode, asset, cancellation)
                    }
                }
                JSONObject()
                    .put("asset", source().metadata)
                    .put("serverEditing", serverEditing)
                    .put(
                        "edits",
                        entry?.optJSONObject("recipe")?.optJSONObject("edits") ?: JSONObject.NULL,
                    )
            }
            "draft" ->
                session.jsonAtEpoch(
                    epoch,
                    "PUT",
                    "$path/edit-recipe",
                    JSONObject()
                        .put("mediaRevision", asset.revision)
                        .put("recipe", input.getJSONObject("recipe")),
                    cancellation,
                )
            "lutBegin" -> {
                lutSize = input.getInt("size")
                require(lutSize in 0..4_500_000)
                lut = StringBuilder()
                JSONObject()
            }
            "lutChunk" -> {
                val data = input.getString("data")
                require(
                    data.length <= 65536 &&
                        input.getInt("offset") == lut.length &&
                        lut.length + data.length <= lutSize
                )
                lut.append(data)
                JSONObject()
            }
            "saveRecipe" -> {
                check(serverEditing) { "服务器编辑服务尚未更新，暂时无法保存成片。" }
                require(lut.length == lutSize)
                val recipe = input.getJSONObject("recipe")
                require(recipe.toString().length <= 65536)
                val intent = recipe.toString() + lut.toString()
                if (saveIntent != intent) {
                    saveIntent = intent
                    requestId = java.util.UUID.randomUUID().toString()
                    jobId = null
                    saved = null
                }
                val result =
                    session.jsonAtEpoch(
                        epoch,
                        "POST",
                        "$path/edit-renders",
                        JSONObject()
                            .put("requestId", requestId)
                            .put("mediaRevision", asset.revision)
                            .put("rowVersion", source().metadata.getInt("rowVersion"))
                            .put("recipe", recipe)
                            .apply { if (lut.isNotEmpty()) put("lut", lut.toString()) },
                        cancellation,
                    )
                jobId = NativeGalleryPolicy.identifier(result.getString("id"))
                result
            }
            "saveStatus" -> {
                val id = jobId ?: throw IOException("尚未开始保存")
                val status = read("$path/edit-renders/$id")
                when (status.optString("status")) {
                    "COMPLETED" -> saved = status.getJSONObject("asset")
                    // Only a definitive terminal failure permits another durable render intent.
                    // Transport uncertainty and pending/completed retries retain their identity.
                    "FAILED" -> {
                        saveIntent = ""
                        requestId = ""
                        jobId = null
                        saved = null
                    }
                }
                status
            }
            else -> throw IOException("不支持的编辑操作")
        }
    }

    @Synchronized
    fun savedAssetId(): String {
        session.checkAuthorization(epoch)
        cancellation.check()
        return saved?.getString("id") ?: throw IOException("尚未保存照片")
    }

    override fun close() {
        closed = true
        cancellation.cancel()
        synchronized(this) {
            source?.close()
            lut.clear()
        }
    }
}
