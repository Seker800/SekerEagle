package com.sekereagle.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * Search and results render the same condition summary, including accessible individual removal.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NativeSearchConditions(
    state: GalleryState,
    model: NativeGalleryViewModel,
    showKeyword: Boolean = true,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (showKeyword && state.query.isNotEmpty())
            SearchCondition("关键词：${state.query}", "query") { model.search("") }
        (if (state.searchOpen) state.searchFilters else state.filters)
            .tokens(state.options.tags)
            .forEach { token ->
                SearchCondition(token.label, token.key) { model.removeFilter(token.key) }
            }
    }
}

@Composable
private fun SearchCondition(label: String, key: String, remove: () -> Unit) {
    InputChip(
        selected = true,
        onClick = remove,
        label = { Text(label) },
        modifier = Modifier.testTag("condition:$key"),
        trailingIcon = { Icon(Icons.Outlined.Close, "移除$label", Modifier.size(16.dp)) },
        shape = CircleShape,
        colors =
            InputChipDefaults.inputChipColors(
                selectedContainerColor = Color.White.copy(alpha = 0.12f),
                selectedLabelColor = Color.White,
                selectedTrailingIconColor = Color.White,
            ),
    )
}
