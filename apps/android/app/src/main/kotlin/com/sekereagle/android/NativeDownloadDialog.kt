package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
internal fun NativeDownloadDialog(state: NativeDownloadState, downloads: NativeDownloads) {
    AlertDialog(
        containerColor = androidx.compose.ui.graphics.Color(0xFF1C1C1F),
        modifier = Modifier.testTag("native-download-dialog"),
        onDismissRequest = { if (state.running) downloads.cancel() else downloads.dismiss() },
        title = { Text(if (state.running) "正在下载原件" else if (state.cancelled) "下载已取消" else "下载结果") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "已保存 ${state.completed} / ${state.total} 项",
                    Modifier.testTag("download-summary"),
                )
                if (state.running) {
                    Text(state.current, maxLines = 2)
                    if (state.size > 0) {
                        LinearProgressIndicator(
                            progress = {
                                (state.bytes.toDouble() / state.size).toFloat().coerceIn(0f, 1f)
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Text("${state.bytes / 1024} / ${state.size / 1024} KB", color = NativeMuted)
                    } else LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Text("保存到：Download/SekerEagle", color = NativeMuted)
                Text("请保持应用在前台；切到后台会停止传输，可在本次打开期间重试未完成项。关闭或重启应用后需重新选择。", color = NativeMuted)
                if (state.failures.isNotEmpty())
                    Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                        Text("${state.failures.size} 项失败", color = MaterialTheme.colorScheme.error)
                        state.failures.forEach {
                            Text("${it.asset.name}：${it.reason}", Modifier.padding(top = 8.dp))
                        }
                    }
                if (state.remaining.isNotEmpty())
                    Text("${state.remaining.size} 项未完成，可重试", color = NativeMuted)
            }
        },
        confirmButton = {
            if (state.running) TextButton(downloads::cancel) { Text("取消下载") }
            else TextButton(downloads::dismiss) { Text("完成") }
        },
        dismissButton = {
            if (!state.running && (state.failures.isNotEmpty() || state.remaining.isNotEmpty()))
                TextButton(downloads::retry) { Text("重试未完成项") }
        },
    )
}
