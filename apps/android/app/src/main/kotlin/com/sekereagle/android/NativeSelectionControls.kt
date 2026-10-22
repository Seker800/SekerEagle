package com.sekereagle.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.LabelOff
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun NativeSelectionControls(
    state: GalleryState,
    model: NativeGalleryViewModel,
    modifier: Modifier,
    backdrop: GraphicsLayer,
    offset: Offset,
) {
    var confirm by remember { mutableStateOf(false) }
    Box(modifier) {
        GlassSurface(
            Modifier.align(Alignment.TopCenter)
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .fillMaxWidth()
                .height(48.dp),
            backdrop,
            offset,
        ) {
            Row(Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ model.back() }, enabled = !state.busy) {
                    Icon(Icons.Outlined.Close, "取消选择")
                }
                Text(
                    "已选择 ${state.selected.size} 项",
                    Modifier.weight(1f).testTag("native-selection-count"),
                )
                TextButton({ model.selectLoaded() }, enabled = !state.busy) { Text("全选已加载") }
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            state.message?.let {
                Text(it, Modifier.padding(12.dp), color = NativeMuted)
                TextButton(
                    {
                        model.back()
                        model.load()
                    },
                    enabled = !state.busy,
                ) {
                    Text("刷新并退出选择")
                }
            }
            GlassSurface(Modifier.fillMaxWidth(), backdrop, offset) {
                if (state.busy)
                    Row(
                        Modifier.padding(20.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        CircularProgressIndicator(Modifier.size(20.dp))
                        Text("正在保存，请稍候…")
                    }
                else
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        if (state.trash)
                            TextButton(
                                { model.changeSelection("restore") },
                                enabled = state.selected.isNotEmpty(),
                            ) {
                                Text("恢复")
                            }
                        else {
                            SelectionAction(
                                "下载",
                                Icons.Outlined.Download,
                                state.selected.isNotEmpty(),
                                Modifier.weight(1f),
                                model::downloadSelected,
                            )
                            SelectionAction(
                                "加标签",
                                Icons.AutoMirrored.Outlined.Label,
                                state.selected.isNotEmpty(),
                                Modifier.weight(1f),
                            ) {
                                model.openFilters("添加标签")
                            }
                            SelectionAction(
                                "移除标签",
                                Icons.AutoMirrored.Outlined.LabelOff,
                                state.selected.isNotEmpty(),
                                Modifier.weight(1f),
                            ) {
                                model.openFilters("移除标签")
                            }
                            SelectionAction(
                                "评分",
                                Icons.Outlined.StarOutline,
                                state.selected.isNotEmpty(),
                                Modifier.weight(1f),
                            ) {
                                model.openFilters("评分")
                            }
                            SelectionAction(
                                "删除",
                                Icons.Outlined.DeleteOutline,
                                state.selected.isNotEmpty(),
                                Modifier.weight(1f),
                            ) {
                                confirm = true
                            }
                        }
                    }
            }
        }
    }
    if (confirm)
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("移入最近删除？") },
            text = { Text("将 ${state.selected.size} 项移入服务器回收站，可在“最近删除”中恢复。手机本地文件不会删除。") },
            confirmButton = {
                TextButton({
                    confirm = false
                    model.changeSelection("trash")
                }) {
                    Text("移入回收站")
                }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("取消") } },
        )
}

@Composable
private fun SelectionAction(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    modifier: Modifier,
    action: () -> Unit,
) {
    Column(
        modifier
            .then(Modifier.clickable(enabled = enabled, onClick = action))
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(
            icon,
            null,
            Modifier.size(21.dp),
            tint = if (enabled) androidx.compose.ui.graphics.Color.White else NativeMuted,
        )
        Text(
            label,
            fontSize = 11.sp,
            color = if (enabled) androidx.compose.ui.graphics.Color.White else NativeMuted,
        )
    }
}
