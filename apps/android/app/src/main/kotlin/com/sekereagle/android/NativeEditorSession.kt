package com.sekereagle.android

import android.content.Context
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.File
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
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

    private var output: File? = null
    private var expected = 0L
    private var name = ""
    private var recipe = JSONObject()
    private var upload: JSONObject? = null
    private val parts = JSONArray()
    private var uploadedHash: String? = null
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
                val entry = read("$path/edit-recipe").optJSONObject("entry")
                if (entry != null) {
                    val id =
                        entry.optString("baseAssetId").takeUnless { it.isEmpty() || it == "null" }
                            ?: asset.id
                    val original = read("$base/assets/${NativeGalleryPolicy.identifier(id)}")
                    if (original.getInt("mediaRevision") != entry.getInt("baseMediaRevision"))
                        throw IOException("原照片已变化，无法恢复编辑参数")
                    asset = repo.parse(original, mode)
                }
                source?.close()
                source = null
                source = runBlocking {
                    repo.original(context, mode, asset, cancellation, editable = true)
                }
                JSONObject()
                    .put("asset", source().metadata)
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
            "begin" -> {
                val size = input.getLong("size")
                require(size in 1..64L * 1024 * 1024) { "编辑输出超出大小预算" }
                val nextRecipe = input.getJSONObject("recipe")
                require(nextRecipe.toString().length <= 65536)
                val nextName =
                    com.sekereagle.android.core.NativeDownloadPolicy.fileName(
                        input.getString("name")
                    )
                if (
                    expected != size ||
                        name != nextName ||
                        recipe.toString() != nextRecipe.toString()
                ) {
                    upload = null
                    while (parts.length() > 0) parts.remove(0)
                    saved = null
                }
                output?.delete()
                output = File.createTempFile("edit-", ".png", context.cacheDir)
                expected = size
                name = nextName
                recipe = nextRecipe
                JSONObject()
            }
            "chunk" -> {
                val file = output ?: throw IOException("尚未开始保存")
                require(input.getString("data").length <= 65536)
                val bytes =
                    android.util.Base64.decode(input.getString("data"), android.util.Base64.DEFAULT)
                require(
                    input.getLong("offset") == file.length() &&
                        file.length() + bytes.size <= expected
                )
                file.appendBytes(bytes)
                JSONObject()
            }
            "save" -> save()
            else -> throw IOException("不支持的编辑操作")
        }
    }

    private fun save(): JSONObject {
        val file = output ?: throw IOException("编辑结果不存在")
        require(file.length() == expected)
        file.inputStream().use {
            require(
                ByteArray(8)
                    .also { header -> java.io.DataInputStream(it).readFully(header) }
                    .contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))
            ) {
                "编辑结果格式无效"
            }
        }
        val hash =
            file.inputStream().use { stream ->
                val digest = java.security.MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(65536)
                while (true) {
                    cancellation.check()
                    val count = stream.read(buffer)
                    if (count < 0) break
                    digest.update(buffer, 0, count)
                }
                digest.digest().joinToString("") { "%02x".format(it) }
            }
        if (uploadedHash != null && uploadedHash != hash) {
            upload = null
            saved = null
            while (parts.length() > 0) parts.remove(0)
        }
        saved?.let {
            return it
        }
        uploadedHash = hash
        val api = NativeUploadApi(session, epoch, {}, {}, cancellation)
        if (upload == null)
            upload =
                api.request(
                    "POST",
                    "$base/uploads",
                    JSONObject()
                        .put("originalName", name)
                        .put("mimeType", "image/png")
                        .put("size", expected)
                        .put("duplicatePolicy", "CREATE_COPY")
                        .put("copySourceAssetId", asset.id)
                        .put("copySourceRowVersion", source().metadata.getInt("rowVersion"))
                        .put("editRecipe", recipe),
                )
        val current = upload!!
        val id = NativeGalleryPolicy.identifier(current.getString("id"))
        val uploadPath = "$base/uploads/$id"
        val status = api.request("GET", uploadPath, null)
        val assetId =
            if (status.optString("status") == "COMPLETED") status.getString("eagleAssetId")
            else {
                val partSize = current.getLong("partSize")
                require(partSize in 5_242_880..67_108_864)
                val count = ((expected + partSize - 1) / partSize).toInt()
                for (index in parts.length() until count) {
                    cancellation.check()
                    val signed = api.request("POST", "$uploadPath/parts/${index+1}", JSONObject())
                    val length = minOf(partSize, expected - index * partSize)
                    val etag =
                        file.inputStream().use { stream ->
                            var skip = index * partSize
                            while (skip > 0) {
                                val moved = stream.skip(skip)
                                if (moved <= 0) throw IOException("编辑结果读取失败")
                                skip -= moved
                            }
                            api.put(signed.getString("uploadUrl"), stream, length) {
                                cancellation.check()
                            }
                        }
                    parts.put(JSONObject().put("partNumber", index + 1).put("etag", etag))
                }
                api.request("POST", "$uploadPath/complete", JSONObject().put("parts", parts))
                    .getString("assetId")
            }
        return JSONObject().put("id", assetId).put("name", name).also { saved = it }
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
            output?.delete()
        }
    }
}
