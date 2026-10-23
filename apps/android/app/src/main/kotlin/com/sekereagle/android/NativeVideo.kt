package com.sekereagle.android

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay

@Composable
internal fun NativeVideo(asset: NativeAsset, repo: NativeGalleryRepository) {
    if (asset.playback == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            NativeImage(repo, asset.preview, true, asset.name, Modifier.fillMaxSize())
            Text("视频播放副本尚未就绪，请稍后重试", Modifier.padding(24.dp))
        }
        return
    }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var configured by remember { mutableStateOf(false) }
    var released by remember { mutableStateOf(false) }
    var ready by remember { mutableStateOf(false) }
    var playing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var position by remember { mutableFloatStateOf(0f) }
    var duration by remember { mutableIntStateOf(1) }
    var seeking by remember { mutableStateOf(false) }
    val sourceResult =
        remember(repo, asset.id, asset.playback) { runCatching { repo.videoSource(asset) } }
    if (sourceResult.isFailure) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(sourceResult.exceptionOrNull()?.message ?: "无法加载视频", Modifier.padding(24.dp))
        }
        return
    }
    val source = sourceResult.getOrThrow()
    var aspect by remember {
        mutableFloatStateOf(asset.width.toFloat().coerceAtLeast(1f) / asset.height.coerceAtLeast(1))
    }
    val player = remember(source) { MediaPlayer() }
    val audio = remember { context.getSystemService(AudioManager::class.java) }
    val attributes = remember {
        AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
            .build()
    }
    fun pause() {
        if (ready && !released) runCatching { player.pause() }
        playing = false
    }
    val focus =
        remember(player) {
            AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(
                    { change -> if (change <= AudioManager.AUDIOFOCUS_LOSS) pause() },
                    android.os.Handler(android.os.Looper.getMainLooper()),
                )
                .build()
        }
    fun play() {
        if (ready && audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            player.start()
            playing = true
        }
    }
    DisposableEffect(player, lifecycle) {
        player.setAudioAttributes(attributes)
        player.setOnPreparedListener {
            ready = true
            duration = it.duration.coerceAtLeast(1)
            if (it.videoWidth > 0 && it.videoHeight > 0)
                aspect = it.videoWidth.toFloat() / it.videoHeight
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) play()
        }
        player.setOnCompletionListener {
            playing = false
            position = duration.toFloat()
        }
        player.setOnErrorListener { _, _, _ ->
            error = "视频暂不可播放，请稍后重试"
            playing = false
            true
        }
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) pause()
        }
        lifecycle.addObserver(observer)
        onDispose {
            released = true
            lifecycle.removeObserver(observer)
            source.close()
            audio.abandonAudioFocusRequest(focus)
            player.release()
        }
    }
    LaunchedEffect(player, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(250)
                if (ready && !seeking)
                    position = runCatching { player.currentPosition.toFloat() }.getOrDefault(0f)
            }
        }
    }
    Column(Modifier.fillMaxSize().testTag("native-video")) {
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            val surfaceWidth = minOf(maxWidth, maxHeight * aspect)
            AndroidView(
                factory = {
                    SurfaceView(it).apply {
                        holder.addCallback(
                            object : SurfaceHolder.Callback {
                                override fun surfaceCreated(holder: SurfaceHolder) {
                                    if (released) return
                                    runCatching {
                                            player.setDisplay(holder)
                                            if (!configured) {
                                                player.setDataSource(source)
                                                player.prepareAsync()
                                                configured = true
                                            }
                                        }
                                        .onFailure { error = "无法加载视频" }
                                }

                                override fun surfaceChanged(
                                    holder: SurfaceHolder,
                                    format: Int,
                                    width: Int,
                                    height: Int,
                                ) {}

                                override fun surfaceDestroyed(holder: SurfaceHolder) {
                                    if (!released) {
                                        pause()
                                        player.setDisplay(null)
                                    }
                                }
                            }
                        )
                    }
                },
                modifier = Modifier.size(surfaceWidth, surfaceWidth / aspect),
                update = { it.keepScreenOn = playing },
            )
            if (!ready && error == null) CircularProgressIndicator()
            error?.let { Text(it, Modifier.padding(24.dp)) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ if (playing) pause() else play() }, enabled = ready && error == null) {
                Icon(
                    if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                    if (playing) "暂停视频" else "播放视频",
                )
            }
            Text(
                "${(position.toInt()/1000)/60}:${((position.toInt()/1000)%60).toString().padStart(2,'0')}"
            )
            Slider(
                value = position.coerceIn(0f, duration.toFloat()),
                onValueChange = {
                    seeking = true
                    position = it
                },
                onValueChangeFinished = {
                    player.seekTo(position.toLong(), MediaPlayer.SEEK_CLOSEST)
                    seeking = false
                },
                valueRange = 0f..duration.toFloat(),
                enabled = ready && error == null,
                modifier = Modifier.weight(1f).testTag("video-seek"),
            )
            Text("${duration/60000}:${((duration/1000)%60).toString().padStart(2,'0')}")
        }
    }
}
