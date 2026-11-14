package com.sekereagle.android

import android.graphics.Bitmap
import android.net.Uri
import android.util.LruCache
import android.util.Size
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val thumbnails =
    object : LruCache<String, Bitmap>(96) {
        override fun sizeOf(key: String, value: Bitmap): Int = 1
    }

/** Local media thumbnail only; failures fall back to the placeholder, never a network request. */
@Composable
internal fun MediaThumbnail(uri: Uri, size: Int = 48) {
    val context = LocalContext.current
    val cached = thumbnails.get(uri.toString())
    val bitmap by
        produceState(cached, uri) {
            if (value != null) return@produceState
            value =
                withContext(Dispatchers.IO) {
                    runCatching {
                            context.contentResolver.loadThumbnail(
                                uri,
                                Size(size * 2, size * 2),
                                null,
                            )
                        }
                        .getOrNull()
                        ?.also { thumbnails.put(uri.toString(), it) }
                }
        }
    Box(
        Modifier.size(size.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Color(0xFF26262B))
    ) {
        bitmap?.let {
            Image(
                it.asImageBitmap(),
                null,
                Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
            )
        }
    }
}
