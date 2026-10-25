package com.sekereagle.android

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

@Composable
internal fun NativeCacheScreen(cache: NativeMediaCache, evictMemory: () -> Unit, back: () -> Unit) {
    val statistics by cache.statistics.collectAsState()
    var usage by remember { mutableStateOf<NativeCacheUsage?>(null) }
    var value by rememberSaveable { mutableStateOf(cache.limitMb.toString()) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    val focus = androidx.compose.ui.platform.LocalFocusManager.current
    val amount = value.toIntOrNull()?.takeIf { it in 0..NativeMediaCache.MAX_MB }
    suspend fun updateUsage() {
        usage = cache.usage()
    }
    LaunchedEffect(cache) {
        try {
            updateUsage()
        } catch (_: Exception) {
            message = "缓存暂不可用，图片仍可正常加载"
        }
    }
    fun operate(clear: Boolean) {
        if (busy) return
        keyboard?.hide()
        focus.clearFocus()
        busy = true
        message = null
        cache.invalidate()
        evictMemory()
        scope.launch {
            try {
                if (clear) cache.clear() else cache.resize(amount ?: return@launch)
                updateUsage()
                message = if (clear) "缓存已清空" else "缓存上限已保存"
            } catch (reason: kotlinx.coroutines.CancellationException) {
                throw reason
            } catch (_: Exception) {
                message = "操作未完成，请检查手机存储空间后重试"
            } finally {
                busy = false
            }
        }
    }
    Column(
        Modifier.fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) { detectTapGestures(onTap = {}) }
            .testTag("native-cache")
    ) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "返回图库") }
            Text("缓存设置", fontSize = 20.sp)
        }
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text("图片缓存", fontSize = 24.sp)
            Text("已下载的缩略图和预览优先从手机读取，重启、覆盖升级后仍可复用。达到上限时自动清理最久未使用的缓存。", color = NativeMuted)
            usage?.let { item ->
                Text(
                    "已使用 ${"%.1f".format(java.util.Locale.ROOT, item.bytes / NativeMediaCache.MIB.toDouble())} MB",
                    Modifier.testTag("cache-usage"),
                )
                Text(
                    if (item.limitMb == 0) "持久缓存已关闭" else "当前上限 ${item.limitMb} MB",
                    Modifier.testTag("cache-limit"),
                    color = NativeMuted,
                )
            }
                ?: if (message == null) CircularProgressIndicator(Modifier.size(24.dp))
                else Text("缓存占用暂不可读取", color = NativeMuted)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    if (statistics.requests == 0L) "缓存命中率 · 暂无记录"
                    else "缓存命中率 ${"%.1f".format(java.util.Locale.ROOT, statistics.hitRate * 100)}%",
                    Modifier.testTag("cache-hit-rate"),
                )
                Text("本次启动 · 内存 ${statistics.memoryHits} 次 · 磁盘 ${statistics.diskHits} 次 · 下载 ${statistics.downloads} 次", color = NativeMuted)
            }
            OutlinedTextField(
                value,
                { if (it.length <= 5 && it.all(Char::isDigit)) value = it },
                label = { Text("缓存上限（MB）") },
                supportingText = { Text("0 表示关闭，最多 16384 MB") },
                singleLine = true,
                isError = amount == null,
                enabled = !busy,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth().testTag("cache-size"),
            )
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (mb in listOf(128, 512, 1024, 2048)) FilterChip(
                    selected = amount == mb,
                    onClick = { value = mb.toString() },
                    label = { Text(if (mb < 1024) "$mb MB" else "${mb/1024} GB") },
                    enabled = !busy,
                )
            }
            Button(
                { operate(false) },
                Modifier.fillMaxWidth().heightIn(min = 48.dp),
                enabled = !busy && amount != null && amount != usage?.limitMb,
            ) {
                Text(if (busy) "正在处理…" else "保存上限")
            }
            OutlinedButton(
                { confirm = true },
                Modifier.fillMaxWidth().heightIn(min = 48.dp),
                enabled = !busy,
            ) {
                Text("清空缓存")
            }
            message?.let { Text(it, Modifier.testTag("cache-message"), color = NativeMuted) }
            Text("仅管理手机上的缩略图和预览缓存，不删除原图、下载文件或上传任务；放大查看的原图和视频不计入此上限。", color = NativeMuted)
        }
    }
    if (confirm)
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("清空缓存？") },
            text = { Text("清空后，再次查看未缓存的图片时会重新下载。图库原图和手机文件不会删除。") },
            dismissButton = { TextButton({ confirm = false }) { Text("取消") } },
            confirmButton = {
                TextButton({
                    confirm = false
                    operate(true)
                }) {
                    Text("清空")
                }
            },
        )
}
