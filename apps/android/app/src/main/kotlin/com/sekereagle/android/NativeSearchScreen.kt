package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeSearch(state: GalleryState, model: NativeGalleryViewModel) {
    val query = state.searchDraft
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    fun submit(value: String) {
        keyboard?.hide()
        focusManager.clearFocus()
        model.search(value, state.searchFilters)
    }
    Column(
        Modifier.fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = {
                        keyboard?.hide()
                        focusManager.clearFocus()
                    }
                )
            }
            .imePadding()
            .testTag("native-search")
            .padding(14.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            TextField(
                query,
                model::updateSearchDraft,
                Modifier.weight(1f).focusRequester(focus).testTag("search-input"),
                singleLine = true,
                placeholder = { Text("搜索名称或标签", color = NativeMuted) },
                leadingIcon = { Icon(Icons.Outlined.Search, null, tint = NativeMuted) },
                shape = CircleShape,
                colors =
                    TextFieldDefaults.colors(
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedContainerColor = Color(0xFF212123),
                        unfocusedContainerColor = Color(0xFF212123),
                    ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { submit(query) }),
            )
            GlassSurface(Modifier.size(48.dp)) {
                RoundAction(Icons.Outlined.Close, "关闭搜索") {
                    keyboard?.hide()
                    model.back()
                }
            }
        }
        LaunchedEffect(Unit) {
            if (state.filterPanel == null) {
                focus.requestFocus()
                keyboard?.show()
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 30.dp)) {
            Text("按条件查找", color = NativeMuted, fontSize = 13.sp)
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                (listOf("标签") +
                        (if (state.mode == GalleryMode.PHOTO) listOf("相机", "镜头") else emptyList()) +
                        listOf("时间", "格式", "更多条件"))
                    .forEach { label ->
                        SuggestionChip(
                            onClick = {
                                keyboard?.hide()
                                focusManager.clearFocus()
                                model.openFilters(if (label == "更多条件") "筛选" else label)
                            },
                            label = { Text(if (label == "时间") "导入日期" else label) },
                            shape = CircleShape,
                        )
                    }
            }
            NativeSearchConditions(state, model, showKeyword = false)
            Spacer(Modifier.height(24.dp))
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("搜索历史", Modifier.weight(1f), color = NativeMuted)
                TextButton(model::clearHistory, enabled = state.history.isNotEmpty()) { Text("清空") }
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                state.history.forEach { text ->
                    SuggestionChip(
                        onClick = { submit(text) },
                        label = { Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = CircleShape,
                    )
                }
            }
        }
        Button(
            { submit(query) },
            Modifier.fillMaxWidth().padding(top = 8.dp).testTag("search-submit"),
        ) {
            Text("查看结果")
        }
    }
}
