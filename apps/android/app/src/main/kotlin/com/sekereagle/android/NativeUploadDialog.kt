package com.sekereagle.android

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@Composable
internal fun NativeUploadDialog(state: NativeUploadState, uploads: NativeUploads) {
    val active =
        state.phase == NativeUploadPhase.RUNNING || state.phase == NativeUploadPhase.PREPARING
    AlertDialog(
        modifier = Modifier.testTag("native-upload-dialog"),
        containerColor = Color(0xFF1C1C1F),
        onDismissRequest = { if (active) uploads.cancel() else uploads.dismiss() },
        title = {
            Text(
                when (state.phase) {
                    NativeUploadPhase.PREPARING -> "读取所选文件"
                    NativeUploadPhase.READY -> "确认上传"
                    NativeUploadPhase.RUNNING -> "正在上传"
                    else -> if (state.cancelled) "上传已取消" else "上传结果"
                }
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("上传到：${state.mode.title}", Modifier.testTag("upload-target"))
                Text("请保持应用在前台；切到后台会停止传输，可在本次打开期间重试未完成项。关闭或重启应用后需重新选择文件。", color = NativeMuted)
                if (state.phase == NativeUploadPhase.READY) {
                    Text(
                        "已选 ${state.entries.size} 个文件，${state.entries.count { it.error == null }} 个可上传"
                    )
                    Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
                        state.entries.forEach { entry ->
                            Text(entry.name)
                            entry.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                    Text("重复内容会跳过，沿用服务器现有分类；私密内容不会出现在本机图库。手机原文件会保留。", color = NativeMuted)
                } else {
                    if (state.phase != NativeUploadPhase.PREPARING)
                        Text(
                            "已上传 ${state.uploaded} · 重复跳过 ${state.skipped}",
                            Modifier.testTag("upload-summary"),
                        )
                    if (state.current.isNotEmpty()) Text(state.current, maxLines = 2)
                    if (active) {
                        Text(state.stage, color = NativeMuted)
                        if (state.stage == "上传原文件" && state.size > 0)
                            LinearProgressIndicator(
                                progress = {
                                    (state.bytes.toDouble() / state.size).toFloat().coerceIn(0f, 1f)
                                },
                                modifier = Modifier.fillMaxWidth(),
                            )
                        else LinearProgressIndicator(Modifier.fillMaxWidth())
                    }
                    if (state.issues.isNotEmpty())
                        Column(
                            Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())
                        ) {
                            Text(
                                "${state.issues.size} 项失败",
                                color = MaterialTheme.colorScheme.error,
                            )
                            state.issues.forEach {
                                Text("${it.entry.name}：${it.reason}", Modifier.padding(top = 8.dp))
                            }
                        }
                    if (state.remaining.isNotEmpty())
                        Text("${state.remaining.size} 项未确认完成，重试时会先去重核对。", color = NativeMuted)
                }
            }
        },
        confirmButton = {
            when {
                active -> TextButton(uploads::cancel) { Text("取消上传") }
                state.phase == NativeUploadPhase.READY ->
                    TextButton(uploads::start, enabled = state.entries.any { it.error == null }) {
                        Text("开始上传")
                    }
                else -> TextButton(uploads::dismiss) { Text("完成") }
            }
        },
        dismissButton = {
            if (state.phase == NativeUploadPhase.READY) TextButton(uploads::dismiss) { Text("取消") }
            else if (
                state.phase == NativeUploadPhase.FINISHED &&
                    (state.issues.isNotEmpty() || state.remaining.isNotEmpty())
            )
                TextButton(uploads::retry) { Text("重试未完成项") }
        },
    )
}
