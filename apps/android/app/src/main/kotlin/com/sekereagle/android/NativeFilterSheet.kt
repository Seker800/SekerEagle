package com.sekereagle.android

import android.app.DatePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NativeFilterSheet(state: GalleryState, model: NativeGalleryViewModel) {
    val panel = state.filterPanel ?: return
    var draft by remember(panel) { mutableStateOf(state.filters) }
    var tags by remember(panel) { mutableStateOf(emptySet<String>()) }
    val editingTags = panel == "添加标签" || panel == "移除标签"
    val context = LocalContext.current
    val error = draft.validationError()
    ModalBottomSheet(
        onDismissRequest = model::closePanel,
        containerColor = androidx.compose.ui.graphics.Color(0xFF1C1C1E),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp)
                .padding(bottom = 28.dp)
                .testTag("native-filter-sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(if (panel == "筛选") "搜索条件" else panel, style = MaterialTheme.typography.titleLarge)
            if (state.optionsLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
            state.optionsError?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
                TextButton({ model.openFilters(panel) }) { Text("重新加载选项") }
            }
            if (panel == "标签" || editingTags || panel == "筛选") {
                Text(if (editingTags) "选择要${panel}的标签" else "标签 · 任意一个即可", color = NativeMuted)
                if (state.options.tags.isEmpty() && !state.optionsLoading)
                    Text("当前模式暂无可用标签", color = NativeMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    state.options.tags.forEach { tag ->
                        val selected = if (editingTags) tag.id in tags else tag.id in draft.tags
                        NativeChoiceChip(
                            selected,
                            {
                                if (editingTags)
                                    tags = if (selected) tags - tag.id else tags + tag.id
                                else
                                    draft =
                                        draft.copy(
                                            tags =
                                                if (selected) draft.tags - tag.id
                                                else (draft.tags + tag.id).take(100).toSet()
                                        )
                            },
                            { Text(tag.name) },
                        )
                    }
                }
            }
            if (
                state.mode == GalleryMode.PHOTO && (panel == "相机" || panel == "镜头" || panel == "筛选")
            ) {
                if (panel != "镜头")
                    ChoiceList("相机", state.options.cameras, draft.camera) {
                        draft = draft.copy(camera = it)
                    }
                if (panel != "相机")
                    ChoiceList("镜头", state.options.lenses, draft.lens) {
                        draft = draft.copy(lens = it)
                    }
            }
            if (panel == "格式" || panel == "筛选") {
                Text("格式 · 任意一种即可", color = NativeMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NativeChoiceChip(
                        draft.formats.isEmpty(),
                        { draft = draft.copy(formats = emptySet()) },
                        { Text("不限") },
                    )
                    state.options.formats.forEach { format ->
                        val selected = format in draft.formats
                        NativeChoiceChip(
                            selected,
                            {
                                draft =
                                    draft.copy(
                                        formats =
                                            if (selected) draft.formats - format
                                            else draft.formats + format
                                    )
                            },
                            { Text(format.uppercase(java.util.Locale.ROOT)) },
                        )
                    }
                }
            }
            if (panel == "时间" || panel == "筛选") {
                Text("导入时间", style = MaterialTheme.typography.titleMedium)
                Text("按手机所在时区筛选导入日期；照片首页仍按拍摄时间排列。", color = NativeMuted)
                fun pick(value: String, change: (String) -> Unit) {
                    val date = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
                    DatePickerDialog(
                            context,
                            { _, y, m, d -> change(LocalDate.of(y, m + 1, d).toString()) },
                            date.year,
                            date.monthValue - 1,
                            date.dayOfMonth,
                        )
                        .show()
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        { pick(draft.from) { draft = draft.copy(from = it) } },
                        Modifier.weight(1f),
                    ) {
                        Text(draft.from.ifEmpty { "开始日期" })
                    }
                    OutlinedButton(
                        { pick(draft.to) { draft = draft.copy(to = it) } },
                        Modifier.weight(1f),
                    ) {
                        Text(draft.to.ifEmpty { "结束日期" })
                    }
                }
                TextButton({ draft = draft.copy(from = "", to = "") }) { Text("清除日期") }
            }
            if (panel == "筛选" || panel == "评分") {
                Text(if (panel == "评分") "批量设置评分" else "最低评分", color = NativeMuted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (0..5).forEach { n ->
                        NativeChoiceChip(
                            (draft.rating ?: 0) == n,
                            { draft = draft.copy(rating = n.takeIf { it > 0 }) },
                            { Text(if (n == 0) "无" else "$n ★") },
                        )
                    }
                }
                if (panel == "筛选" && state.mode == GalleryMode.PHOTO)
                    ChoiceList(
                        "位置信息",
                        listOf("WITH", "WITHOUT"),
                        draft.gps,
                        { if (it == "WITH") "有 GPS" else "无 GPS" },
                    ) {
                        draft = draft.copy(gps = it)
                    }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it, color = NativeMuted) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(model::closePanel, enabled = !state.busy) { Text("取消") }
                if (!editingTags && panel != "评分")
                    TextButton({
                        draft =
                            when (panel) {
                                "标签" -> draft.copy(tags = emptySet())
                                "相机" -> draft.copy(camera = "")
                                "镜头" -> draft.copy(lens = "")
                                "格式" -> draft.copy(formats = emptySet())
                                "时间" -> draft.copy(from = "", to = "")
                                else -> NativeFilters()
                            }
                    }) {
                        Text(if (panel == "筛选") "清空条件" else "不限")
                    }
                Spacer(Modifier.weight(1f))
                Button(
                    {
                        when {
                            editingTags ->
                                model.changeSelection(
                                    if (panel == "添加标签") "tags" else "removeTags",
                                    tags,
                                )
                            panel == "评分" -> model.changeSelection("rating", rating = draft.rating)
                            else ->
                                if (state.searchOpen) model.search(state.searchDraft, draft)
                                else model.applyFilters(draft)
                        }
                    },
                    modifier = Modifier.testTag("filter-submit"),
                    enabled = !state.busy && error == null && (!editingTags || tags.isNotEmpty()),
                ) {
                    Text(
                        if (state.busy) "正在保存…"
                        else if (state.searchOpen && !editingTags && panel != "评分") "查看结果" else "应用"
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChoiceList(
    label: String,
    values: List<String>,
    selected: String,
    display: (String) -> String = { it.uppercase() },
    change: (String) -> Unit,
) {
    Text(if (label == "相机" || label == "镜头") "$label · 单选" else label, color = NativeMuted)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        NativeChoiceChip(selected.isEmpty(), { change("") }, { Text("全部") })
        values.forEach { value ->
            NativeChoiceChip(selected == value, { change(value) }, { Text(display(value)) })
        }
    }
    if (values.isEmpty()) Text("暂无可用$label 信息", color = NativeMuted)
}

@Composable
private fun NativeChoiceChip(
    selected: Boolean,
    onClick: () -> Unit,
    label: @Composable () -> Unit,
) {
    FilterChip(
        selected,
        onClick,
        label,
        shape = androidx.compose.foundation.shape.CircleShape,
        colors =
            FilterChipDefaults.filterChipColors(
                containerColor = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.06f),
                labelColor = androidx.compose.ui.graphics.Color.White,
                selectedContainerColor =
                    androidx.compose.ui.graphics.Color.White.copy(alpha = 0.18f),
                selectedLabelColor = androidx.compose.ui.graphics.Color.White,
            ),
        border =
            androidx.compose.foundation.BorderStroke(
                0.6.dp,
                androidx.compose.ui.graphics.Color.White.copy(
                    alpha = if (selected) 0.25f else 0.08f
                ),
            ),
    )
}
