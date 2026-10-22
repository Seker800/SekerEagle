package com.sekereagle.android

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp

val NativeMuted = Color(0xFF98989F)

@Composable
fun NativeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme =
            darkColorScheme(
                primary = Color(0xFF91B1FF),
                background = Color.Black,
                surface = Color(0xFF1C1C1F),
                onBackground = Color.White,
                onSurface = Color.White,
            ),
        content = content,
    )
}

/** Replays only the content backdrop through blur; labels and icons remain sharp. */
@Composable
fun GlassSurface(
    modifier: Modifier = Modifier,
    layer: GraphicsLayer? = null,
    sourceOffset: Offset = Offset.Zero,
    radius: Int = 100,
    content: @Composable BoxScope.() -> Unit,
) {
    var position by remember { mutableStateOf(Offset.Zero) }
    val shape = RoundedCornerShape(radius.dp)
    Box(
        modifier
            .clip(shape)
            .onGloballyPositioned { position = it.positionInRoot() }
            .border(0.6.dp, Color.White.copy(alpha = 0.14f), shape)
    ) {
        if (layer != null)
            Spacer(
                Modifier.matchParentSize()
                    .graphicsLayer {
                        if (Build.VERSION.SDK_INT >= 31)
                            renderEffect = BlurEffect(22.dp.toPx(), 22.dp.toPx(), TileMode.Clamp)
                    }
                    .drawWithContent {
                        translate(sourceOffset.x - position.x, sourceOffset.y - position.y) {
                            drawLayer(layer)
                        }
                    }
            )
        Spacer(
            Modifier.matchParentSize()
                .background(Color(0xFF202023).copy(alpha = if (layer == null) 0.94f else 0.64f))
        )
        Box(
            Modifier.background(
                Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.06f), Color.Transparent))
            )
        ) {
            content()
        }
    }
}
