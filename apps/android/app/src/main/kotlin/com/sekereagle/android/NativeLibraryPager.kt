package com.sekereagle.android

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop

/** Two retained instances of the same library, with independent saveable grid positions. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun NativeLibraryPager(
    state: GalleryState,
    model: NativeGalleryViewModel,
    repo: NativeGalleryRepository,
    openNative: (String) -> Unit,
    chooseUpload: () -> Unit,
) {
    val retained by model.retainedLibraries.collectAsState()
    val pager = rememberPagerState(initialPage = state.mode.ordinal) { GalleryMode.entries.size }
    LaunchedEffect(state.mode) {
        if (pager.settledPage != state.mode.ordinal) pager.animateScrollToPage(state.mode.ordinal)
    }
    LaunchedEffect(pager) {
        snapshotFlow { pager.settledPage }
            .distinctUntilChanged()
            .drop(1)
            .collect { model.switchMode(GalleryMode.entries[it]) }
    }
    NativeLibrary(state, model, openNative, chooseUpload) {
        HorizontalPager(
            state = pager,
            modifier = Modifier.fillMaxSize(),
            key = { GalleryMode.entries[it].name },
            beyondViewportPageCount = 1,
            userScrollEnabled =
                !state.busy &&
                    !state.selecting &&
                    state.viewerId == null &&
                    !state.searchOpen &&
                    !state.accountOpen &&
                    !state.cacheOpen &&
                    !state.transfersOpen &&
                    state.filterPanel == null,
        ) { page ->
            val mode = GalleryMode.entries[page]
            val active = state.mode == mode
            val library =
                if (active) state
                else
                    retained[mode]
                        ?: GalleryState(
                            identity = state.identity,
                            restoring = false,
                            mode = mode,
                            loading = true,
                            sort = GallerySort.default(mode),
                        )
            // Offscreen pages remain composed, but do not expose duplicate accessibility actions.
            Box(
                if (active) Modifier
                else
                    Modifier.clearAndSetSemantics {}
                        .pointerInput(Unit) {
                            // During animation, outgoing controls must not dispatch into the new
                            // mode.
                            awaitEachGesture {
                                awaitFirstDown(
                                        requireUnconsumed = false,
                                        pass = PointerEventPass.Initial,
                                    )
                                    .consume()
                                do {
                                    val event = awaitPointerEvent(PointerEventPass.Initial)
                                    event.changes.forEach { it.consume() }
                                } while (event.changes.any { it.pressed })
                            }
                        }
            ) {
                NativeLibraryPage(library, model, repo, active)
            }
        }
    }
}

/** Stable first-paint geometry while authentication or the first network page is pending. */
@Composable
internal fun NativeLibraryPlaceholder(modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxSize().padding(top = 70.dp, bottom = 104.dp)) {
        val gap = 2.dp.toPx()
        val side = (size.width - 2 * gap) / 3
        for (row in 0..(size.height / (side + gap)).toInt()) {
            for (column in 0..2) {
                drawRect(
                    Color(0xFF171719),
                    Offset(column * (side + gap), row * (side + gap)),
                    Size(side, side),
                )
            }
        }
    }
}
