package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.drag
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/** The thumb follows a global day aggregate, never just the currently loaded pages. */
@Composable
internal fun NativeFastScroll(
    state: GalleryState,
    grid: LazyGridState,
    jump: (NativeDay, Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    val timeline = state.timeline ?: return
    if (timeline.days.isEmpty() || timeline.total <= 1) return
    val density = LocalDensity.current
    val thumbHeight = with(density) { 40.dp.toPx() }
    var trackTop by remember { mutableFloatStateOf(0f) }
    var thumbTop by remember { mutableFloatStateOf(0f) }
    var height by remember { mutableIntStateOf(1) }
    var dragging by remember { mutableStateOf(false) }
    var visible by remember { mutableStateOf(false) }
    var fraction by remember(state.mode, state.sort) { mutableFloatStateOf(0f) }
    var target by remember { mutableStateOf<NativeDay?>(null) }
    val assetIndex by remember(grid, state.mode, state.items) {
        derivedStateOf {
            val key = grid.layoutInfo.visibleItemsInfo
                .firstOrNull { it.key.toString().startsWith("${state.mode}:") }?.key?.toString()
            state.items.indexOfFirst { "${state.mode}:${it.id}" == key }.coerceAtLeast(0)
        }
    }
    val actual = ((state.windowOffset + assetIndex).toFloat() / (timeline.total - 1)).coerceIn(0f, 1f)
    val currentDay = timeline.dayAt(state.windowOffset + assetIndex) ?: timeline.days.first()
    LaunchedEffect(grid.isScrollInProgress, dragging) {
        if (grid.isScrollInProgress || dragging) visible = true
        else {
            delay(1800)
            visible = false
        }
    }
    val currentFraction by rememberUpdatedState(actual)
    val latestDay by rememberUpdatedState(currentDay)
    val travel = (height - thumbHeight).coerceAtLeast(1f)
    Box(
        modifier
            .width(if (dragging) 180.dp else 34.dp)
            .onSizeChanged { height = it.height }
            .onGloballyPositioned { trackTop = it.positionInRoot().y }
    ) {
        if (visible || dragging) {
            if (dragging) {
                Box(
                    Modifier.align(Alignment.CenterEnd)
                        .fillMaxHeight()
                        .width(14.dp)
                        .padding(end = 3.dp)
                        .background(Color(0xBB27272A), CircleShape)
                )
                Text(
                    (target ?: currentDay).date.take(4),
                    Modifier.align(Alignment.TopEnd)
                        .padding(end = 24.dp, top = 12.dp)
                        .background(Color(0xDD3C3C40), CircleShape)
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    fontSize = 13.sp,
                )
            }
            Box(
                Modifier.align(Alignment.TopEnd)
                    .offset {
                        IntOffset(0, ((if (dragging) fraction else actual) * travel).roundToInt())
                    }
                    .width(34.dp)
                    .height(40.dp)
                    .testTag("timeline-thumb")
                    .semantics {
                        contentDescription = "按日期浏览照片"
                        stateDescription = currentDay.label
                        progressBarRangeInfo = ProgressBarRangeInfo(actual, 0f..1f)
                        setProgress { requested ->
                            if (!requested.isFinite()) false else {
                                val ordinal = (requested.coerceIn(0f, 1f) * (timeline.total - 1)).toLong()
                                timeline.dayAt(ordinal)?.let { jump(it, ordinal) }
                                true
                            }
                        }
                    }
                    .onGloballyPositioned { thumbTop = it.positionInRoot().y }
                    .pointerInput(timeline, travel) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            val grabY = down.position.y
                            dragging = true
                            fraction = currentFraction
                            target = latestDay
                            down.consume()
                            try {
                                val completed =
                                    drag(down.id) { change ->
                                        change.consume()
                                        fraction =
                                            ((change.position.y + thumbTop - trackTop - grabY) /
                                                    travel)
                                                .coerceIn(0f, 1f)
                                        val ordinal = (fraction * (timeline.total - 1)).toLong()
                                        target = timeline.dayAt(ordinal) ?: timeline.days.first()
                                    }
                                val day = target
                                if (completed && day != null)
                                    jump(day, (fraction * (timeline.total - 1)).toLong())
                            } finally {
                                dragging = false
                                target = null
                            }
                        }
                    },
                contentAlignment = Alignment.CenterEnd,
            ) {
                Box(
                    Modifier.padding(end = 4.dp)
                        .width(if (dragging) 14.dp else 4.dp)
                        .height(if (dragging) 40.dp else 30.dp)
                        .background(Color(0xDD8B8B90), CircleShape)
                )
            }
            if (dragging)
                Text(
                    (target ?: currentDay).label,
                    Modifier.align(Alignment.TopEnd)
                        .offset { IntOffset(0, (fraction * travel).roundToInt()) }
                        .padding(end = 28.dp)
                        .background(Color(0xE64A4A4D), CircleShape)
                        .padding(horizontal = 14.dp, vertical = 12.dp)
                        .testTag("timeline-date"),
                    fontSize = 15.sp,
                )
        }
    }
}
