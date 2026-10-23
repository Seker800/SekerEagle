package com.sekereagle.android

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.RotateRight
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
fun NativeViewer(
    state: GalleryState,
    repo: NativeGalleryRepository,
    model: NativeGalleryViewModel,
) {
    val pager =
        rememberPagerState(
            initialPage = state.items.indexOfFirst { it.id == state.viewerId }.coerceAtLeast(0)
        ) {
            state.items.size
        }
    var zoomed by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf(false) }
    var rotation by remember(pager.currentPage) { mutableFloatStateOf(0f) }
    LaunchedEffect(pager.settledPage) {
        state.items.getOrNull(pager.settledPage)?.let { model.viewerPage(it.id) }
        zoomed = false
        if (pager.settledPage >= state.items.size - 4) model.load(true)
    }
    val asset = state.items.getOrNull(pager.currentPage) ?: return
    Column(Modifier.fillMaxSize().background(Color.Black).testTag("native-viewer")) {
        Row(
            Modifier.fillMaxWidth()
                .background(Color(0xFF18181A))
                .heightIn(min = 74.dp)
                .padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ model.back() }) { Icon(Icons.Outlined.ArrowBackIosNew, "返回图库") }
            Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                Text(asset.date, fontSize = 20.sp)
                Text(asset.time, fontSize = 13.sp, color = NativeMuted)
            }
            if (!asset.video)
                IconButton({ rotation = (rotation + 90) % 360 }) {
                    Icon(Icons.AutoMirrored.Outlined.RotateRight, "旋转照片")
                }
        }
        HorizontalPager(
            pager,
            Modifier.weight(1f).fillMaxWidth(),
            userScrollEnabled = !zoomed,
            key = { state.items[it].id },
            beyondViewportPageCount = 1,
        ) { page ->
            val entry = state.items[page]
            key(entry.id) {
                if (entry.video && page == pager.currentPage) NativeVideo(entry, repo)
                else
                    ZoomPhoto(entry, repo, if (page == pager.currentPage) rotation else 0f) {
                        if (page == pager.currentPage) zoomed = it
                    }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(vertical = 16.dp, horizontal = 28.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "${pager.currentPage+1} / ${state.items.size}",
                color = NativeMuted,
                fontSize = 13.sp,
            )
            GlassSurface(Modifier.width(if (state.trash) 48.dp else 104.dp).height(48.dp)) {
                Row(Modifier.fillMaxSize()) {
                    if (!state.trash)
                        Box(Modifier.weight(1f).fillMaxHeight()) {
                            RoundAction(Icons.Outlined.Download, "下载原件") {
                                model.downloadAssets(listOf(asset))
                            }
                        }
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        RoundAction(Icons.Outlined.MoreHoriz, if (asset.video) "视频信息" else "照片信息") {
                            info = true
                        }
                    }
                }
            }
        }
    }
    if (info)
        AlertDialog(
            onDismissRequest = { info = false },
            title = { Text(asset.name) },
            text = {
                Text(
                    if (asset.video) "视频\n${asset.date} ${asset.time}"
                    else "${asset.date} ${asset.time}"
                )
            },
            confirmButton = { TextButton({ info = false }) { Text("完成") } },
        )
}

@Composable
private fun ZoomPhoto(
    asset: NativeAsset,
    repo: NativeGalleryRepository,
    rotation: Float,
    onZoom: (Boolean) -> Unit,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val scope = rememberCoroutineScope()
    fun clamp(value: Offset, zoom: Float): Offset {
        val width = asset.width.toFloat().coerceAtLeast(1f)
        val height = asset.height.toFloat().coerceAtLeast(1f)
        val sideways = rotation % 180 != 0f
        val fit =
            minOf(
                size.width / (if (sideways) height else width),
                size.height / (if (sideways) width else height),
            )
        val limitX =
            ((if (sideways) height else width) * fit * zoom - size.width).coerceAtLeast(0f) / 2
        val limitY =
            ((if (sideways) width else height) * fit * zoom - size.height).coerceAtLeast(0f) / 2
        return Offset(value.x.coerceIn(-limitX, limitX), value.y.coerceIn(-limitY, limitY))
    }
    LaunchedEffect(rotation) {
        scale = 1f
        offset = Offset.Zero
        onZoom(false)
    }
    val transform = rememberTransformableState { zoom, pan, _ ->
        val next = (scale * zoom).coerceIn(1f, 6f)
        offset = clamp(offset * (next / scale) + pan, next)
        scale = next
        onZoom(scale > 1.01f)
    }
    Box(
        Modifier.fillMaxSize()
            .clipToBounds()
            .onSizeChanged { size = it }
            .semantics { stateDescription = "zoom:${"%.1f".format(java.util.Locale.ROOT,scale)}" }
            .testTag("viewer-photo:${asset.id}")
            .transformable(transform, canPan = { scale > 1.01f })
            .pointerInput(asset.id, rotation) {
                detectTapGestures(
                    onDoubleTap = { point ->
                        val start = scale
                        val target = if (scale > 1.01f) 1f else 2.5f
                        val delta = Offset(size.width / 2f, size.height / 2f) - point
                        scope.launch {
                            animate(start, target, animationSpec = tween(180)) { value, _ ->
                                scale = value
                                offset = clamp(delta * (value - 1), value)
                                onZoom(value > 1.01f)
                            }
                        }
                    }
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        NativeImage(
            repo,
            asset.preview,
            true,
            asset.name,
            Modifier.fillMaxSize().graphicsLayer {
                val fit = rotationFit(asset.width, asset.height, size.width, size.height, rotation)
                scaleX = scale * fit
                scaleY = scale * fit
                translationX = offset.x
                translationY = offset.y
                rotationZ = rotation
            },
        )
    }
}
