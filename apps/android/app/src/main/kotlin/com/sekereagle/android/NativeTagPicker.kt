package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Search and batch assignment share the same bounded, virtualized tag chooser. */
@Composable
internal fun NativeTagPicker(
    choices: List<NativeTag>,
    selected: Set<String>,
    status: NativeOptionStatus,
    maxHeight: Dp,
    enabled: Boolean,
    matchAny: Boolean,
    change: (Set<String>) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val matches by
        produceState(emptyList<NativeTag>(), choices, query) {
            value =
                withContext(Dispatchers.Default) {
                    val normalized = normalizeTagSearch(query)
                    choices.filter { it.matches(normalized) }
                }
        }
    Text(
        if (matchAny) "标签 · 任意一个即可（已选 ${selected.size}／100）" else "选择标签（已选 ${selected.size}／100）",
        color = NativeMuted,
    )
    OutlinedTextField(
        query,
        { query = it.take(200) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("tag-search"),
        label = { Text("搜索标签名称或拼音") },
    )
    if (selected.isNotEmpty())
        TextButton({ change(emptySet()) }, enabled = enabled) { Text("清除已选标签") }
    if (matches.isEmpty() && !status.loading && status.error == null)
        Text(if (choices.isEmpty()) "当前模式暂无可用标签" else "没有匹配的标签", color = NativeMuted)
    if (selected.size >= 100) Text("每次最多选择 100 个标签，请先取消部分选择", color = NativeMuted)
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = maxHeight).testTag("tag-choices")) {
        items(matches, key = { it.id }) { tag ->
            val checked = tag.id in selected
            Row(
                Modifier.fillMaxWidth()
                    .testTag("tag-choice:${tag.id}")
                    .toggleable(
                        value = checked,
                        role = Role.Checkbox,
                        enabled = enabled && (checked || selected.size < 100),
                        onValueChange = {
                            change(if (checked) selected - tag.id else selected + tag.id)
                        },
                    )
                    .padding(vertical = 4.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                Checkbox(checked, null)
                Text(tag.name, Modifier.weight(1f))
            }
        }
    }
}

@Composable
internal fun NativeOptionFeedback(
    state: GalleryState,
    section: NativeOptionSection,
    label: String,
    panel: String,
    model: NativeGalleryViewModel,
) {
    val status = state.optionStatus[section] ?: return
    if (status.loading) {
        LinearProgressIndicator(Modifier.fillMaxWidth())
        Text("正在加载$label…", color = NativeMuted)
    }
    status.error?.let {
        Text("$label：$it", color = MaterialTheme.colorScheme.error)
        TextButton({ model.openFilters(panel) }) { Text("重新加载$label") }
    }
}

@Composable
internal fun NativeValuePicker(
    label: String,
    values: List<String>,
    selected: String,
    change: (String) -> Unit,
) {
    var query by rememberSaveable(label) { mutableStateOf("") }
    val matches =
        remember(values, query) {
            values.filter { normalizeTagSearch(it).contains(normalizeTagSearch(query)) }
        }
    Text("$label · 单选", color = NativeMuted)
    OutlinedTextField(
        query,
        { query = it.take(200) },
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("option-search:$label"),
        label = { Text("搜索$label") },
    )
    FilterChip(selected.isEmpty(), { change("") }, { Text("全部") })
    LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp).testTag("option-choices:$label")) {
        items(matches, key = { it }) { value ->
            Row(
                Modifier.fillMaxWidth()
                    .toggleable(
                        value == selected,
                        role = Role.RadioButton,
                        onValueChange = { change(if (value == selected) "" else value) },
                    )
                    .padding(vertical = 4.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
            ) {
                RadioButton(value == selected, null)
                Text(value, Modifier.weight(1f))
            }
        }
    }
    if (matches.isEmpty())
        Text(if (values.isEmpty()) "暂无可用$label 信息" else "没有匹配的$label", color = NativeMuted)
}
