package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.*
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
    var query by rememberSaveable { mutableStateOf(state.query) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    fun submit(value: String) {
        keyboard?.hide()
        focusManager.clearFocus()
        model.search(value)
    }
    Column(
        Modifier.fillMaxSize()
            .background(Color.Black)
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
                { query = it.take(200) },
                Modifier.weight(1f).focusRequester(focus).testTag("search-input"),
                singleLine = true,
                placeholder = { Text("搜索名称或描述", color = NativeMuted) },
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
            focus.requestFocus()
            keyboard?.show()
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(top = 30.dp)) {
            Text("试试搜索", color = NativeMuted, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("旅行", "风景", "猫", "RAW").forEach { word ->
                    SuggestionChip(
                        onClick = { submit(word) },
                        label = { Text(word) },
                        shape = CircleShape,
                    )
                }
            }
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
            if (state.history.isEmpty())
                Text(
                    "搜索后会在这里保留最近的关键词",
                    Modifier.padding(top = 16.dp),
                    color = NativeMuted,
                    fontSize = 13.sp,
                )
        }
    }
}
