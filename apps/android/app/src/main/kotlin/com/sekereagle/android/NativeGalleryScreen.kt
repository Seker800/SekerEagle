package com.sekereagle.android

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged

@Composable
fun NativeGalleryApp(model: NativeGalleryViewModel, openNative: (String) -> Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val download by model.downloads.state.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val notificationPermission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val uploadPicker =
        rememberLauncherForActivityResult(
            ActivityResultContracts.OpenMultipleDocuments(),
            { selected ->
                model.acceptUploadSelection(selected)
                if (
                    selected.isNotEmpty() &&
                        android.os.Build.VERSION.SDK_INT >= 33 &&
                        context.checkSelfPermission(
                            android.Manifest.permission.POST_NOTIFICATIONS
                        ) != android.content.pm.PackageManager.PERMISSION_GRANTED &&
                        !BackupSettings(context).flag("notifications", "requested", false)
                ) {
                    BackupSettings(context).setFlag("notifications", "requested", true)
                    notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }
            },
        )
    NativeTheme {
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Box(Modifier.fillMaxSize().safeDrawingPadding()) {
                BackHandler(
                    state.cacheOpen ||
                        state.transfersOpen ||
                        state.searchOpen ||
                        state.accountOpen ||
                        state.viewerId != null ||
                        state.query.isNotEmpty() ||
                        state.selecting ||
                        state.filters.active ||
                        state.trash ||
                        state.filterPanel != null ||
                        state.busy
                ) {
                    model.back()
                }
                if (state.identity == null) {
                    if (state.restoring) NativeLibraryPlaceholder() else NativeLogin(state, model)
                } else {
                    key(state.identity!!.scope) {
                        val repo = model.repository
                        if (repo != null) {
                            NativeLibraryPager(state, model, repo, openNative) {
                                if (model.prepareUploadSelection())
                                    uploadPicker.launch(arrayOf("*/*"))
                            }
                            if (state.accountOpen) NativeAccount(state.identity!!, model)
                            if (state.searchOpen) NativeSearch(state, model)
                            if (state.viewerId != null) NativeViewer(state, repo, model)
                            if (state.filterPanel != null) NativeFilterSheet(state, model)
                        }
                    }
                }
                if (state.identity != null && download != null)
                    NativeDownloadDialog(download!!, model.downloads)
                if (state.identity != null && state.transfersOpen)
                    NativeTransferScreen(state, model, openNative)
                if (state.identity != null && state.cacheOpen)
                    NativeCacheScreen(
                        model.mediaCache,
                        { model.repository?.evictImages() },
                        { model.back() },
                    )
            }
        }
    }
}

@Composable
@OptIn(ExperimentalFoundationApi::class)
internal fun NativeLibrary(
    state: GalleryState,
    model: NativeGalleryViewModel,
    repo: NativeGalleryRepository,
    openNative: (String) -> Unit,
    chooseUpload: () -> Unit,
    active: Boolean = true,
) {
    val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
    val grid = rememberLazyGridState()
    val topInset = 70.dp
    val layout =
        remember(state.items, state.mode, state.trash, state.filters.active, state.query) {
            NativeGridLayout(
                state.items,
                state.mode == GalleryMode.PHOTO,
                (if (state.trash) 1 else 0) +
                    (if (state.filters.active || state.query.isNotEmpty()) 1 else 0),
            )
        }
    var renderedWindow by
        remember(
            state.mode,
            state.sort,
            state.query,
            state.filters,
            state.trash,
            state.scrollRequest,
        ) {
            mutableLongStateOf(state.windowOffset)
        }
    if (state.windowOffset < renderedWindow) {
        val visible = grid.layoutInfo.visibleItemsInfo
        val firstKey = visible.firstOrNull()?.key?.toString().orEmpty()
        // Stable media keys already preserve ordinary scrolling. Only a removed day header needs
        // an explicit photo anchor; leave active gestures alone in every other case.
        if (firstKey.startsWith("date:") && firstKey.removePrefix("date:") !in layout.dayStarts) {
            val anchor = visible.firstOrNull { it.key.toString().startsWith("${state.mode}:") }
            val index =
                anchor?.key?.toString()?.removePrefix("${state.mode}:")?.let(layout::indexOf)
            if (index != null && anchor != null)
                SideEffect {
                    grid.requestScrollToItem(index, -anchor.offset.y)
                }
        }
    }
    SideEffect { renderedWindow = state.windowOffset }
    val draggingGrid by grid.interactionSource.collectIsDraggedAsState()
    LaunchedEffect(
        active,
        state.windowOffset,
        state.loading,
        state.timeline,
        state.error,
        draggingGrid,
    ) {
        if (!active) return@LaunchedEffect
        snapshotFlow {
                grid.firstVisibleItemIndex < 6 &&
                    grid.lastScrolledBackward &&
                    draggingGrid &&
                    state.error == null
            }
            .distinctUntilChanged()
            .collect { if (it) model.loadPrevious() }
    }
    val backdrop = rememberGraphicsLayer()
    var sourceOffset by remember { mutableStateOf(Offset.Zero) }
    var menu by rememberSaveable { mutableStateOf<NativeLibraryMenu?>(null) }
    LaunchedEffect(
        state.mode,
        state.sort,
        state.query,
        state.filters,
        state.trash,
        state.scrollRequest,
    ) {
        grid.scrollToItem(0)
    }
    LaunchedEffect(active, grid, state.cursor, state.loading) {
        if (!active) return@LaunchedEffect
        snapshotFlow { grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .collect { last ->
                if (
                    last >= grid.layoutInfo.totalItemsCount - 12 &&
                        state.cursor != null &&
                        !state.loading
                )
                    model.load(true)
            }
    }
    Box(Modifier.fillMaxSize().testTag("native-library")) {
        Box(
            Modifier.fillMaxSize()
                .onGloballyPositioned { sourceOffset = it.positionInRoot() }
                .drawWithContent {
                    backdrop.record { this@drawWithContent.drawContent() }
                    drawLayer(backdrop)
                }
        ) {
            LazyVerticalGrid(
                GridCells.Fixed(state.columns),
                state = grid,
                modifier = Modifier.fillMaxSize().testTag("native-grid"),
                contentPadding = PaddingValues(top = topInset, bottom = 104.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                if (state.trash)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Row(
                            Modifier.padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("最近删除", Modifier.weight(1f))
                            TextButton({ model.openTrash(false) }) { Text("返回图库") }
                        }
                    }
                if (state.filters.active || state.query.isNotEmpty())
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(
                            Modifier.fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp)
                                .testTag("native-search-results")
                        ) {
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text("搜索结果", Modifier.weight(1f), fontSize = 18.sp)
                                TextButton(model::openSearch) { Text("修改条件") }
                                TextButton(model::clearSearch) { Text("清空") }
                            }
                            NativeSearchConditions(state, model)
                        }
                    }
                state.items.forEach { asset ->
                    if (asset.id in layout.dayStarts)
                        item(key = "date:${asset.id}", span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                asset.groupDate,
                                Modifier.fillMaxWidth()
                                    .then(
                                        if (state.selecting)
                                            Modifier.clickable {
                                                model.selectLoaded(
                                                    state.items
                                                        .filter { it.groupDate == asset.groupDate }
                                                        .map { it.id }
                                                        .toSet()
                                                )
                                            }
                                        else Modifier
                                    )
                                    .padding(start = 16.dp, top = 18.dp, bottom = 14.dp),
                                fontSize = 17.sp,
                            )
                        }
                    item(key = "${state.mode}:${asset.id}") {
                        Box(
                            Modifier.aspectRatio(1f)
                                .background(Color(0xFF171719))
                                .combinedClickable(
                                    onClick = { model.openAsset(asset.id) },
                                    onLongClick = {
                                        haptics.performHapticFeedback(
                                            androidx.compose.ui.hapticfeedback.HapticFeedbackType
                                                .LongPress
                                        )
                                        model.startSelection(asset.id)
                                    },
                                )
                                .testTag("asset:${asset.id}")
                        ) {
                            NativeImage(
                                repo,
                                asset.thumbnail,
                                false,
                                asset.name,
                                Modifier.fillMaxSize(),
                                ContentScale.Crop,
                                cacheVersion = asset.cacheVersion,
                            )
                            if (state.selecting) {
                                Icon(
                                    if (asset.id in state.selected) Icons.Outlined.CheckCircle
                                    else Icons.Outlined.RadioButtonUnchecked,
                                    if (asset.id in state.selected) "已选择" else "未选择",
                                    Modifier.align(Alignment.TopEnd)
                                        .padding(7.dp)
                                        .size(24.dp)
                                        .background(Color.Black.copy(alpha = 0.4f), CircleShape),
                                    tint =
                                        if (asset.id in state.selected)
                                            MaterialTheme.colorScheme.primary
                                        else Color.White,
                                )
                            }
                            if (asset.video)
                                Text(
                                    "视频",
                                    Modifier.align(Alignment.BottomStart)
                                        .padding(6.dp)
                                        .background(
                                            Color.Black.copy(alpha = 0.45f),
                                            RoundedCornerShape(6.dp),
                                        )
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                    fontSize = 11.sp,
                                )
                        }
                    }
                }
                if (state.loading && state.items.isNotEmpty())
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Box(
                            Modifier.fillMaxWidth().padding(28.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                if (state.error != null)
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        Column(
                            Modifier.fillMaxWidth().padding(24.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(state.error, color = NativeMuted)
                            TextButton({ model.load(state.items.isNotEmpty()) }) { Text("重试") }
                        }
                    }
            }
            if (state.loading && state.items.isEmpty()) NativeLibraryPlaceholder()
            if (!state.loading && state.items.isEmpty() && state.error == null)
                Column(
                    Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Outlined.PhotoLibrary,
                        null,
                        Modifier.size(34.dp),
                        tint = NativeMuted,
                    )
                    Spacer(Modifier.height(14.dp))
                    Text(
                        if (state.query.isEmpty() && !state.filters.active)
                            "这里还没有${state.mode.title}"
                        else "没有找到符合条件的内容",
                        color = NativeMuted,
                    )
                }
        }
        if (!state.selecting)
            Row(
                Modifier.align(Alignment.TopEnd).padding(top = 8.dp, end = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GlassSurface(Modifier.size(46.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.Tune, "视图选项") { menu = NativeLibraryMenu.VIEW }
                }
                GlassSurface(Modifier.size(46.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.MoreVert, "更多操作") {
                        menu = NativeLibraryMenu.ACTIONS
                    }
                }
            }
        if (!state.selecting)
            Row(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GlassSurface(Modifier.width(184.dp).height(54.dp), backdrop, sourceOffset) {
                    Row(Modifier.fillMaxSize().padding(3.dp)) {
                        GalleryMode.entries.forEach { mode ->
                            Column(
                                Modifier.weight(1f)
                                    .fillMaxHeight()
                                    .clip(CircleShape)
                                    .background(
                                        if (mode == state.mode) Color.White.copy(alpha = 0.18f)
                                        else Color.Transparent
                                    )
                                    .clickable { model.switchMode(mode) }
                                    .testTag("mode:${mode.name}"),
                                verticalArrangement = Arrangement.Center,
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Icon(
                                    if (mode == GalleryMode.PHOTO) Icons.Outlined.Image
                                    else Icons.Outlined.GridView,
                                    null,
                                    Modifier.size(21.dp),
                                    tint = if (mode == state.mode) Color.White else NativeMuted,
                                )
                                Text(
                                    mode.title,
                                    fontSize = 11.sp,
                                    color = if (mode == state.mode) Color.White else NativeMuted,
                                )
                            }
                        }
                    }
                }
                GlassSurface(Modifier.size(48.dp), backdrop, sourceOffset) {
                    RoundAction(Icons.Outlined.Search, "搜索", model::openSearch)
                }
            }
        if (state.selecting)
            NativeSelectionControls(state, model, Modifier.fillMaxSize(), backdrop, sourceOffset)
        if (!state.selecting && state.message != null)
            Surface(
                Modifier.align(Alignment.BottomCenter).padding(bottom = 82.dp).clickable {
                    model.dismissMessage()
                },
                shape = RoundedCornerShape(16.dp),
                color = Color(0xEE29292C),
            ) {
                Text(state.message, Modifier.padding(14.dp))
            }
        if (state.timeline != null && !state.searchOpen && !state.selecting)
            NativeFastScroll(
                state,
                grid,
                model::jumpToDay,
                Modifier.align(Alignment.CenterEnd)
                    .fillMaxHeight()
                    .padding(top = 90.dp, bottom = 110.dp),
            )
        menu?.let { activeMenu ->
            NativeGalleryMenu(activeMenu, state, model, chooseUpload, openNative) { menu = null }
        }
    }
}

@Composable
fun RoundAction(icon: ImageVector, label: String, action: () -> Unit) {
    IconButton(action, Modifier.fillMaxSize()) {
        Icon(icon, label, Modifier.size(23.dp), tint = Color.White)
    }
}

@Composable
fun MenuRow(text: String, icon: ImageVector, action: () -> Unit) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = action)
            .padding(horizontal = 20.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, Modifier.size(22.dp), tint = Color.White)
        Text(text, fontSize = 16.sp)
    }
}
