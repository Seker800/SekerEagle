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
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
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
    LaunchedEffect(state.viewerId) {
        val target = state.items.indexOfFirst { it.id == state.viewerId }
        if (target >= 0 && pager.currentPage != target && !pager.isScrollInProgress)
            pager.scrollToPage(target)
    }
    var zoomed by remember { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    var deleting by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var shareBusy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val shareCancellation = remember(repo) { NativeTransferCancellation() }
    DisposableEffect(shareCancellation) { onDispose { shareCancellation.cancel() } }
    var rotation by remember(pager.currentPage) { mutableFloatStateOf(0f) }
    LaunchedEffect(pager.settledPage) {
        state.items.getOrNull(pager.settledPage)?.let { model.viewerPage(it.id) }
        zoomed = false
        if (pager.settledPage >= state.items.size - 4) model.load(true)
    }
    val backdrop = rememberGraphicsLayer()
    var sourceOffset by remember { mutableStateOf(Offset.Zero) }
    val asset = state.items.getOrNull(pager.currentPage) ?: return
    if (editing) {
        NativeEditor(
            repo,
            state.mode,
            asset,
            onOpenSaved = {
                editing = false
                model.openSavedAsset(it)
            },
        ) {
            editing = false
            model.refresh()
        }
        return
    }
    Box(Modifier.fillMaxSize().background(Color.Black).testTag("native-viewer")) {
        HorizontalPager(
            pager,
            Modifier.fillMaxSize()
                .onGloballyPositioned { sourceOffset = it.positionInRoot() }
                .drawWithContent {
                    backdrop.record { this@drawWithContent.drawContent() }
                    drawLayer(backdrop)
                },
            userScrollEnabled = !zoomed && !shareBusy,
            key = { state.items[it].id },
            beyondViewportPageCount = 1,
        ) { page ->
            val entry = state.items[page]
            key(entry.id) {
                if (entry.video && page == pager.currentPage) NativeVideo(entry, repo)
                else
                    ZoomPhoto(
                        entry,
                        repo,
                        state.mode,
                        page == pager.currentPage,
                        if (page == pager.currentPage) rotation else 0f,
                        onTap = { chrome = !chrome },
                        onZoom = { if (page == pager.currentPage) zoomed = it },
                    )
            }
        }
        if (chrome) {
            GlassSurface(
                Modifier.align(Alignment.TopCenter).padding(horizontal = 12.dp, vertical = 8.dp)
                    .fillMaxWidth().testTag("viewer-top-bar"),
                backdrop, sourceOffset, radius = 28,
            ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 66.dp).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton({ model.back() }) { Icon(Icons.Outlined.ArrowBackIosNew, "返回图库") }
                Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                    Text(
                        asset.date + (asset.city?.let { " · $it" } ?: ""),
                        fontSize = 18.sp,
                        maxLines = 2,
                    )
                    Text(asset.time, fontSize = 13.sp, color = NativeMuted)
                }
                if (!asset.video)
                    IconButton({ rotation = (rotation + 90) % 360 }) {
                        Icon(Icons.AutoMirrored.Outlined.RotateRight, "旋转照片")
                    }
            }
            }
            if (!state.trash) {
                GlassSurface(
                    Modifier.align(Alignment.BottomCenter).padding(horizontal = 24.dp, vertical = 16.dp)
                        .widthIn(max = 360.dp).fillMaxWidth().testTag("viewer-tools"),
                    backdrop, sourceOffset,
                ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    ViewerTool(Icons.Outlined.DeleteOutline, "删除", !state.busy && !shareBusy) {
                        deleting = true
                    }
                    ViewerTool(
                        if (asset.favorite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,
                        if (asset.favorite) "取消收藏" else "收藏",
                        !state.busy && !shareBusy,
                        tint = if (asset.favorite) Color(0xFFFF8AA5) else Color.White,
                        caption = if (asset.favorite) "已收藏" else "收藏",
                    ) { model.toggleFavorite(asset.id) }
                    if (!asset.video)
                        ViewerTool(Icons.Outlined.Edit, "编辑", !shareBusy) { editing = true }
                    ViewerTool(Icons.Outlined.Share, "发送", !shareBusy) {
                        shareBusy = true
                        scope.launch {
                            try {
                                shareNativeAsset(
                                    context,
                                    repo,
                                    state.mode,
                                    asset,
                                    shareCancellation,
                                )
                            } catch (reason: kotlinx.coroutines.CancellationException) {
                                throw reason
                            } catch (reason: Exception) {
                                error = reason.message ?: "发送失败，请重试"
                            } finally {
                                shareBusy = false
                            }
                        }
                    }
                }
                }
            }
        }
        if (shareBusy)
            Surface(Modifier.align(Alignment.Center), color = Color(0xEE18181A)) {
                Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(22.dp))
                    Spacer(Modifier.width(12.dp))
                    Text("正在准备发送原件…")
                }
            }
    }
    if (deleting)
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("移入回收站？") },
            text = { Text("可以在最近删除中恢复此项目。") },
            dismissButton = { TextButton({ deleting = false }) { Text("取消") } },
            confirmButton = {
                TextButton({
                    deleting = false
                    model.startSelection(asset.id)
                    model.changeSelection("trash")
                }) {
                    Text("移入回收站")
                }
            },
        )
    error?.let { message ->
        AlertDialog(
            onDismissRequest = { error = null },
            title = { Text("发送未完成") },
            text = { Text(message) },
            confirmButton = { TextButton({ error = null }) { Text("完成") } },
        )
    }
}

@Composable
private fun ViewerTool(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean,
    tint: Color = Color.White,
    caption: String = label,
    action: () -> Unit,
) {
    TextButton(onClick = action, enabled = enabled,
        colors = ButtonDefaults.textButtonColors(contentColor = tint)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, label, Modifier.size(24.dp))
            Text(caption, fontSize = 12.sp)
        }
    }
}

@Composable
internal fun ZoomPhoto(
    asset: NativeAsset,
    repo: NativeGalleryRepository,
    mode: GalleryMode,
    active: Boolean,
    rotation: Float,
    onTap: () -> Unit,
    onZoom: (Boolean) -> Unit,
) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current
    var original by remember(repo, asset.id) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var originalError by remember { mutableStateOf<String?>(null) }
    var originalLoading by remember { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    val demand = active && scale > 1.01f
    val cancellation = remember(demand, repo, asset.id, retry) { NativeTransferCancellation() }
    DisposableEffect(cancellation) { onDispose { cancellation.cancel() } }
    LaunchedEffect(demand, repo, asset.id, retry) {
        originalError = null
        if (!demand) {
            original = null
            originalLoading = false
            return@LaunchedEffect
        }
        originalLoading = true
        try {
            val bitmap =
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    repo.original(context, mode, asset, cancellation, normalize = true).use { source
                        ->
                        decodeViewerOriginal(source.file)
                    }
                }
            cancellation.check()
            original = bitmap
        } catch (reason: kotlinx.coroutines.CancellationException) {
            throw reason
        } catch (reason: Exception) {
            if (!cancellation.cancelled) originalError = reason.message ?: "原图读取失败"
        } finally {
            originalLoading = false
        }
    }
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
                    onTap = { onTap() },
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
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        val imageModifier =
            Modifier.fillMaxSize().graphicsLayer {
                val fit = rotationFit(asset.width, asset.height, size.width, size.height, rotation)
                scaleX = scale * fit
                scaleY = scale * fit
                translationX = offset.x
                translationY = offset.y
                rotationZ = rotation
            }
        val bitmap = original
        if (bitmap != null)
            androidx.compose.foundation.Image(
                bitmap.asImageBitmap(),
                asset.name,
                imageModifier,
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
            )
        else
            NativeImage(
                repo,
                asset.preview,
                true,
                asset.name,
                imageModifier,
                cacheVersion = asset.cacheVersion,
            )
        if (demand) {
            if (originalLoading)
                Text(
                    "正在加载原图…",
                    Modifier.align(Alignment.BottomCenter).padding(bottom = 96.dp),
                    color = Color.White,
                    fontSize = 12.sp,
                )
            originalError?.let { message ->
                TextButton({ retry++ }, Modifier.align(Alignment.Center)) { Text("$message · 重试") }
            }
        }
    }
}
