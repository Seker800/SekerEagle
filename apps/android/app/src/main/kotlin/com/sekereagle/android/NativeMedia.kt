package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

@Composable
fun NativeImage(
    repo: NativeGalleryRepository,
    path: String?,
    full: Boolean,
    name: String,
    modifier: Modifier = Modifier,
    scale: ContentScale = ContentScale.Fit,
    cacheVersion: String? = null,
) {
    val version = cacheVersion ?: repo.imageVersion(path)
    var retry by remember(path, version) { mutableIntStateOf(0) }
    var image by
        remember(repo, path, full, version) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var error by remember(repo, path, version) { mutableStateOf(false) }
    LaunchedEffect(repo, path, full, version, retry) {
        image = null
        error = false
        if (path != null)
            try {
                image = repo.image(path, full, version)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                error = true
            }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        val current = image
        if (current != null)
            Image(current.asImageBitmap(), name, Modifier.fillMaxSize(), contentScale = scale)
        else if (full && error) TextButton({ retry++ }) { Text("加载失败 · 点击重试") }
        else if (full && path != null)
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        else if (path == null || error)
            Icon(
                Icons.Outlined.ImageNotSupported,
                "预览暂不可用",
                Modifier.size(24.dp),
                tint = NativeMuted,
            )
    }
}
