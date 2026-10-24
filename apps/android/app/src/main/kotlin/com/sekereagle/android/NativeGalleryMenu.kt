package com.sekereagle.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties

internal enum class NativeLibraryMenu {
    VIEW,
    ACTIONS,
}

/** One shared, scrollable menu for both libraries. Entries open their actual destination. */
@Composable
internal fun NativeGalleryMenu(
    menu: NativeLibraryMenu,
    state: GalleryState,
    model: NativeGalleryViewModel,
    chooseUpload: () -> Unit,
    openNative: (String) -> Unit,
    dismiss: () -> Unit,
) {
    val density = LocalDensity.current
    val windowHeight = with(density) { LocalWindowInfo.current.containerSize.height.toDp() }
    val maxHeight = (windowHeight - 100.dp).coerceAtLeast(160.dp)
    val offset = with(LocalDensity.current) { IntOffset(-16.dp.roundToPx(), 62.dp.roundToPx()) }
    fun navigate(action: () -> Unit) {
        dismiss()
        action()
    }
    Popup(
        alignment = Alignment.TopEnd,
        offset = offset,
        onDismissRequest = dismiss,
        properties = PopupProperties(focusable = true),
    ) {
        GlassSurface(Modifier.width(248.dp).heightIn(max = maxHeight), radius = 26) {
            Column(
                Modifier.verticalScroll(rememberScrollState())
                    .padding(vertical = 8.dp)
                    .testTag(
                        if (menu == NativeLibraryMenu.VIEW) "native-view-menu"
                        else "native-actions-menu"
                    )
            ) {
                if (menu == NativeLibraryMenu.VIEW) {
                    Text("视图", Modifier.padding(20.dp, 8.dp), color = NativeMuted, fontSize = 13.sp)
                    GallerySort.entries.forEach { order ->
                        MenuRow(
                            order.title,
                            if (state.sort == order) Icons.Outlined.Check
                            else Icons.Outlined.Schedule,
                        ) {
                            navigate { model.sort(order) }
                        }
                    }
                    MenuDivider()
                    listOf(3, 4).forEach { columns ->
                        MenuRow(
                            "$columns 列网格",
                            if (state.columns == columns) Icons.Outlined.Check
                            else Icons.Outlined.GridView,
                        ) {
                            navigate { model.columns(columns) }
                        }
                    }
                } else {
                    if (!state.trash)
                        MenuRow("上传", Icons.Outlined.FileUpload) { navigate(chooseUpload) }
                    MenuRow("传输列表", Icons.Outlined.SyncAlt) { navigate(model::openTransfers) }
                    MenuRow("备份设置", Icons.Outlined.CloudUpload) {
                        navigate { openNative("backup") }
                    }
                    MenuRow("释放手机空间", Icons.Outlined.CleaningServices) {
                        navigate { openNative("cleanup") }
                    }
                    MenuDivider()
                    MenuRow(if (state.trash) "返回图库" else "最近删除", Icons.Outlined.DeleteOutline) {
                        navigate { model.openTrash(!state.trash) }
                    }
                    MenuRow("刷新", Icons.Outlined.Refresh) { navigate(model::refresh) }
                    MenuDivider()
                    MenuRow("账号与连接", Icons.Outlined.AccountCircle) { navigate(model::openAccount) }
                }
            }
        }
    }
}

@Composable
private fun MenuDivider() {
    HorizontalDivider(
        Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        color = NativeMuted.copy(alpha = 0.2f),
    )
}
