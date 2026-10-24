package com.sekereagle.android

import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Only the selected original receives a temporary read grant via the system chooser. */
internal suspend fun shareNativeAsset(
    context: Context,
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    asset: NativeAsset,
    cancellation: NativeTransferCancellation,
) {
    repo.original(context, mode, asset, cancellation).use { source ->
        withContext(Dispatchers.IO) {
            val directory = File(context.cacheDir, "shared-media").apply { mkdirs() }
            directory
                .listFiles()
                ?.filter { System.currentTimeMillis() - it.lastModified() > 24 * 60 * 60 * 1000 }
                ?.forEach { it.deleteRecursively() }
            val itemDirectory =
                File(directory, java.util.UUID.randomUUID().toString()).apply { mkdirs() }
            val file =
                File(
                    itemDirectory,
                    com.sekereagle.android.core.NativeDownloadPolicy.fileName(
                        source.metadata.getString("originalName")
                    ),
                )
            if (!source.file.renameTo(file)) throw java.io.IOException("无法准备分享文件，请检查存储空间")
            cancellation.check()
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.share", file)
            withContext(Dispatchers.Main) {
                cancellation.check()
                val intent =
                    Intent(Intent.ACTION_SEND)
                        .setType(source.metadata.getString("mimeType"))
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                intent.clipData = ClipData.newRawUri(asset.name, uri)
                context.startActivity(
                    Intent.createChooser(intent, "发送")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                )
            }
        }
    }
}
