package com.sekereagle.android

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.sekereagle.android.core.NativeDownloadPolicy
import com.sekereagle.android.core.NativeGalleryPolicy
import java.io.IOException
import java.net.HttpURLConnection
import java.util.concurrent.CancellationException

/** Explicit cancellation disconnects a blocked read as well as checking between chunks. */
class NativeDownloadCancellation {
    @Volatile
    var cancelled = false
        private set

    private var connection: HttpURLConnection? = null

    @Synchronized
    fun bind(value: HttpURLConnection) {
        check()
        connection = value
    }

    @Synchronized
    fun cancel() {
        cancelled = true
        connection?.disconnect()
    }

    fun check() {
        if (cancelled || Thread.currentThread().isInterrupted) throw CancellationException()
    }

    @Synchronized
    fun <T> commit(block: () -> T): T {
        check()
        return block()
    }
}

/** Pending MediaStore rows prevent incomplete originals from appearing as completed downloads. */
class NativeDownloadStore(context: Context) {
    private val resolver = context.applicationContext.contentResolver

    fun save(
        session: NativeSession,
        mode: GalleryMode,
        asset: NativeAsset,
        cancellation: NativeDownloadCancellation,
        progress: (Long, Long) -> Unit,
    ): Uri {
        val base =
            NativeGalleryPolicy.base(mode.name) +
                "/assets/" +
                NativeGalleryPolicy.identifier(asset.id)
        cancellation.check()
        val metadata = session.json("GET", base, cancellation = cancellation)
        if (metadata.getInt("mediaRevision") != asset.revision) throw IOException("原件已更新，请刷新图库后下载")
        val size = metadata.getLong("byteSize")
        val mime = metadata.getString("mimeType")
        NativeDownloadPolicy.validate(size, mime)
        val values =
            ContentValues().apply {
                put(
                    MediaStore.MediaColumns.DISPLAY_NAME,
                    NativeDownloadPolicy.fileName(metadata.getString("originalName")),
                )
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/SekerEagle/",
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        cancellation.check()
        val uri =
            resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException("无法创建下载文件")
        try {
            progress(0, size)
            resolver.openOutputStream(uri, "w")?.use { output ->
                session.downloadOriginal("$base/original", size, mime, output, cancellation) {
                    progress(it, size)
                }
            } ?: throw IOException("无法写入下载目录")
            cancellation.check()
            val current = session.json("GET", base, cancellation = cancellation)
            if (
                current.getInt("mediaRevision") != asset.revision ||
                    current.getLong("byteSize") != size
            )
                throw IOException("下载期间原件发生变化，请刷新后重试")
            cancellation.commit {
                if (
                    resolver.update(
                        uri,
                        ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) },
                        null,
                        null,
                    ) != 1
                )
                    throw IOException("无法保存下载文件")
            }
            return uri
        } catch (reason: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw reason
        }
    }
}
