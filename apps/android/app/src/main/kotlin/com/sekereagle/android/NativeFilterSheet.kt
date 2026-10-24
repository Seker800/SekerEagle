package com.sekereagle.android

import android.app.DatePickerDialog
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun NativeFilterSheet(state: GalleryState, model: NativeGalleryViewModel) {
    val panel = state.filterPanel ?: return
    var draft by
        rememberSaveable(
            panel,
            stateSaver =
                listSaver<NativeFilters, Any>(
                    save = {
                        listOf(
                            ArrayList(it.tags),
                            it.camera,
                            it.lens,
                            ArrayList(it.formats),
                            it.from,
                            it.to,
                            it.rating ?: 0,
                            it.gps,
                            it.smartFolderId,
                        )
                    },
                    restore = {
                        NativeFilters(
                            (it[0] as List<*>).filterIsInstance<String>().toSet(),
                            it[1] as String,
                            it[2] as String,
                            (it[3] as List<*>).filterIsInstance<String>().toSet(),
                            it[4] as String,
                            it[5] as String,
                            (it[6] as Int).takeIf { n -> n > 0 },
                            it[7] as String,
                            it.getOrNull(8) as? String ?: "",
                        )
                    },
                ),
        ) {
            mutableStateOf(if (state.searchOpen) state.searchFilters else state.filters)
        }
    var tags by
        rememberSaveable(
            panel,
            stateSaver =
                listSaver<Set<String>, String>(
                    save = { it.toList() },
                    restore = { it.toSet() },
                ),
        ) {
            mutableStateOf(emptySet<String>())
        }
    val editingTags = panel == "添加标签" || panel == "移除标签"
    val context = LocalContext.current
    val error = if (editingTags || panel == "评分") null else draft.validationError()
    val height =
        with(androidx.compose.ui.platform.LocalDensity.current) {
            androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.height.toDp()
        }
    ModalBottomSheet(
        onDismissRequest = model::closePanel,
        containerColor = androidx.compose.ui.graphics.Color(0xFF1C1C1E),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth()
                .heightIn(max = height * 0.85f)
                .padding(horizontal = 22.dp)
                .testTag("native-filter-sheet")
        ) {
            Row(
                Modifier.fillMaxWidth().padding(bottom = 12.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    if (panel == "筛选") "搜索条件" else panel,
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    {
                        when {
                            editingTags ->
                                model.changeSelection(
                                    if (panel == "添加标签") "tags" else "removeTags",
                                    tags,
                                )
                            panel == "评分" -> model.changeSelection("rating", rating = draft.rating)
                            else -> model.confirmFilters(draft)
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
            Column(
                Modifier.fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (panel == "智能文件夹" || panel == "筛选") {
                    NativeOptionFeedback(
                        state,
                        NativeOptionSection.SMART_FOLDERS,
                        "智能文件夹",
                        panel,
                        model,
                    )
                    NativeSingleChoicePicker(
                        "智能文件夹",
                        state.options.folders,
                        draft.smartFolderId,
                        state.optionStatus[NativeOptionSection.SMART_FOLDERS]
                            ?: NativeOptionStatus(),
                    ) {
                        draft = draft.copy(smartFolderId = it)
                    }
                }
                if (panel == "标签" || editingTags || panel == "筛选") {
                    NativeOptionFeedback(state, NativeOptionSection.TAGS, "标签", panel, model)
                    NativeTagPicker(
                        state.options.tags,
                        if (editingTags) tags else draft.tags,
                        state.optionStatus[NativeOptionSection.TAGS] ?: NativeOptionStatus(),
                        if (panel == "筛选") 240.dp else height * 0.45f,
                        !state.busy,
                    ) { selected ->
                        if (editingTags) tags = selected else draft = draft.copy(tags = selected)
                    }
                }
                if (
                    state.mode == GalleryMode.PHOTO &&
                        (panel == "相机" || panel == "镜头" || panel == "筛选")
                ) {
                    NativeOptionFeedback(
                        state,
                        NativeOptionSection.PHOTOGRAPHY,
                        "相机与镜头",
                        panel,
                        model,
                    )
                    if (panel != "镜头")
                        NativeValuePicker(
                            "相机",
                            state.options.cameras,
                            draft.camera,
                            state.optionStatus[NativeOptionSection.PHOTOGRAPHY]
                                ?: NativeOptionStatus(),
                        ) {
                            draft = draft.copy(camera = it)
                        }
                    if (panel != "相机")
                        NativeValuePicker(
                            "镜头",
                            state.options.lenses,
                            draft.lens,
                            state.optionStatus[NativeOptionSection.PHOTOGRAPHY]
                                ?: NativeOptionStatus(),
                        ) {
                            draft = draft.copy(lens = it)
                        }
                }
                if (panel == "格式" || panel == "筛选") {
                    NativeOptionFeedback(state, NativeOptionSection.FORMATS, "格式", panel, model)
                    Text("格式", color = NativeMuted)
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
                    fun pick(value: String, change: (String) -> Unit) {
                        val date =
                            runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
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
                                {
                                    Text(
                                        if (n == 0) {
                                            if (panel == "评分") "清除评分" else "不限"
                                        } else "$n ★"
                                    )
                                },
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
            }
            Row(
                Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                TextButton(model::closePanel, enabled = !state.busy) { Text("取消") }
                if (!editingTags && panel != "评分")
                    TextButton({
                        draft =
                            when (panel) {
                                "智能文件夹" -> draft.copy(smartFolderId = "")
                                "标签" -> draft.copy(tags = emptySet())
                                "相机" -> draft.copy(camera = "")
                                "镜头" -> draft.copy(lens = "")
                                "格式" -> draft.copy(formats = emptySet())
                                "时间" -> draft.copy(from = "", to = "")
                                else -> NativeFilters()
                            }
                    }) {
                        Text(if (panel == "筛选") "清空条件" else if (panel == "标签") "清空" else "不限")
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
    display: (String) -> String = { it },
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
