package com.sekereagle.android

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
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import kotlinx.coroutines.delay

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
internal fun NativeVideo(asset: NativeAsset, repo: NativeGalleryRepository) {
    if (asset.playback == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            NativeImage(
                repo,
                asset.preview,
                true,
                asset.name,
                Modifier.fillMaxSize(),
                cacheVersion = asset.cacheVersion,
            )
            Text("视频播放副本尚未就绪，请稍后重试", Modifier.padding(24.dp))
        }
        return
    }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var ready by remember { mutableStateOf(false) }
    var buffering by remember { mutableStateOf(true) }
    var playing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var position by remember { mutableFloatStateOf(0f) }
    var duration by remember { mutableIntStateOf(1) }
    var seeking by remember { mutableStateOf(false) }
    val playbackResult =
        remember(repo, asset.id, asset.playback) { runCatching { repo.videoPlayback(asset) } }
    if (playbackResult.isFailure) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(playbackResult.exceptionOrNull()?.message ?: "无法加载视频", Modifier.padding(24.dp))
        }
        return
    }
    val playback = playbackResult.getOrThrow()
    var aspect by remember {
        mutableFloatStateOf(asset.width.toFloat().coerceAtLeast(1f) / asset.height.coerceAtLeast(1))
    }
    val player =
        remember(playback) {
            ExoPlayer.Builder(context)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                        .build(),
                    true,
                )
                .setLoadControl(
                    // Bound decoder memory; the player still buffers about 30 s of media.
                    DefaultLoadControl.Builder()
                        .setBufferDurationsMs(5_000, 30_000, 1_500, 3_000)
                        .setTargetBufferBytes(24 * 1024 * 1024)
                        .build()
                )
                .build()
        }

    fun updateDuration() {
        val value = player.duration
        if (value != C.TIME_UNSET && value > 0)
            duration = value.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    }

    DisposableEffect(player, lifecycle) {
        val listener =
            object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_READY -> {
                            ready = true
                            buffering = false
                            updateDuration()
                        }
                        Player.STATE_BUFFERING -> buffering = true
                        Player.STATE_ENDED -> {
                            playing = false
                            buffering = false
                            position = duration.toFloat()
                        }
                        else -> {}
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    playing = isPlaying
                }

                override fun onVideoSizeChanged(size: VideoSize) {
                    if (size.width > 0 && size.height > 0)
                        aspect = size.width.toFloat() / size.height
                }

                override fun onPlayerError(failure: PlaybackException) {
                    error = "视频暂不可播放，请稍后重试"
                    playing = false
                    buffering = false
                }
            }
        player.addListener(listener)
        player.setMediaSource(
            ProgressiveMediaSource.Factory(playback.factory)
                .createMediaSource(MediaItem.fromUri(playback.uri))
        )
        player.playWhenReady = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        player.prepare()
        val observer =
            LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_PAUSE) player.pause()
            }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            player.removeListener(listener)
            player.release()
        }
    }
    LaunchedEffect(player, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(250)
                if (ready && !seeking && error == null)
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
            val surfaceView = remember { SurfaceView(context) }
            LaunchedEffect(player, surfaceView) { player.setVideoSurfaceView(surfaceView) }
            AndroidView(
                factory = { surfaceView },
                modifier = Modifier.size(surfaceWidth, surfaceWidth / aspect),
                update = { it.keepScreenOn = playing },
            )
            if ((!ready || buffering) && error == null) CircularProgressIndicator()
            error?.let { Text(it, Modifier.padding(24.dp)) }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(
                onClick = {
                    if (playing) {
                        player.pause()
                        playing = false
                    } else {
                        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                        player.play()
                        playing = true
                    }
                },
                enabled = ready && error == null,
            ) {
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
                    player.seekTo(position.toLong())
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
