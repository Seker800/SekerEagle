package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import java.util.concurrent.atomic.AtomicReference
import org.junit.*
import org.junit.Assert.*

class NativeFastScrollTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun draggingTheMicroThumbShowsDateAndSeeksBeyondLoadedItems() {
        val latest = NativeDay("2026-10-23", "2026-10-24T00:00:00Z", 180, 0)
        val oldest = NativeDay("2020-01-02", "2020-01-03T00:00:00Z", 20, 180)
        val selected = AtomicReference<NativeDay>()
        val ordinal = java.util.concurrent.atomic.AtomicLong(-1)
        compose.setContent {
            NativeEvidenceHost {
                val grid = rememberLazyGridState()
                val assets = remember {
                    (0..59).map {
                        NativeAsset("a$it", "Photo", latest.label, "", 10, 10, null, null, false, 1)
                    }
                }
                val state =
                    GalleryState(
                        items = assets,
                        timeline = NativeTimeline(listOf(latest, oldest), 200),
                    )
                Box(Modifier.fillMaxSize()) {
                    LazyVerticalGrid(
                        GridCells.Fixed(3),
                        state = grid,
                        modifier = Modifier.fillMaxSize().testTag("grid"),
                    ) {
                        assets.forEach { asset ->
                            item(key = "PHOTO:${asset.id}") {
                                Box(Modifier.height(150.dp).background(Color.DarkGray))
                            }
                        }
                    }
                    NativeFastScroll(
                        state,
                        grid,
                        { day, position ->
                            selected.set(day)
                            ordinal.set(position)
                        },
                        Modifier.align(Alignment.CenterEnd)
                            .fillMaxHeight()
                            .padding(top = 40.dp, bottom = 60.dp),
                    )
                }
            }
        }
        compose.onNodeWithTag("timeline-thumb").assertDoesNotExist()
        compose.onNodeWithTag("grid").performTouchInput { swipeUp() }
        compose.onNodeWithTag("timeline-thumb").assertExists()
        val bottom = compose.onRoot().fetchSemanticsNode().boundsInRoot.bottom - 80f
        val thumb = compose.onNodeWithTag("timeline-thumb").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("timeline-thumb").performTouchInput {
            down(center)
            moveBy(Offset(0f, bottom - thumb.center.y), 300)
        }
        compose.onNodeWithTag("timeline-date").assertTextEquals(oldest.label)
        captureNativeEvidence("native-fast-scroll.png")
        compose.onRoot().performTouchInput { up() }
        compose.runOnIdle {
            assertEquals(oldest, selected.get())
            assertTrue(ordinal.get() >= 180)
        }
    }
}
