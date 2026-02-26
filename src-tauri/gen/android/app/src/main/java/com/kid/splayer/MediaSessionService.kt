package com.kid.splayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.session.MediaButtonReceiver
import androidx.media.app.NotificationCompat.MediaStyle
import app.tauri.plugin.JSObject

class MediaSessionService : Service() {
    private var mediaSession: MediaSessionCompat? = null
    private val channelId = "splayer_playback"
    private val notificationId = 101

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        mediaSession = MediaSessionCompat(this, "SPlayerSession").apply {
            isActive = true
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() {
                    NativeMediaPlugin.emitEvent("play", JSObject())
                }

                override fun onPause() {
                    NativeMediaPlugin.emitEvent("pause", JSObject())
                }

                override fun onSkipToNext() {
                    NativeMediaPlugin.emitEvent("next", JSObject())
                }

                override fun onSkipToPrevious() {
                    NativeMediaPlugin.emitEvent("previous", JSObject())
                }

                override fun onSeekTo(pos: Long) {
                    val data = JSObject()
                    data.put("position", pos)
                    NativeMediaPlugin.emitEvent("seek", data)
                }
            })

            val state = PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_SEEK_TO or
                    PlaybackStateCompat.ACTION_STOP
                )
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1.0f)
                .build()
            setPlaybackState(state)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "SPlayer Playback"
            val descriptionText = "Media controls for SPlayer"
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(channelId, name, importance).apply {
                description = descriptionText
            }
            val notificationManager: NotificationManager =
                getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    companion object {
        const val ACTION_UPDATE_METADATA = "com.kid.splayer.UPDATE_METADATA"
        const val ACTION_UPDATE_STATE = "com.kid.splayer.UPDATE_STATE"
        
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val EXTRA_POSITION = "position"
        const val EXTRA_DURATION = "duration"
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 立即启动前台服务，防止系统在 5-10 秒后杀掉服务 (Android 12+ 限制)
        val initialNotification = createNotification("SPlayer", "Ready to play")
        startForeground(notificationId, initialNotification)

        if (intent == null) return START_STICKY

        when (intent.action) {
            ACTION_UPDATE_METADATA -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Unknown"
                val artist = intent.getStringExtra(EXTRA_ARTIST) ?: "Unknown"
                val album = intent.getStringExtra(EXTRA_ALBUM) ?: "Unknown"
                
                updateMetadata(title, artist, album)
                val notification = createNotification(title, artist)
                startForeground(notificationId, notification)
            }
            ACTION_UPDATE_STATE -> {
                val isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true)
                val pos = intent.getLongExtra(EXTRA_POSITION, 0)
                val dur = intent.getLongExtra(EXTRA_DURATION, 0)
                updatePlaybackState(isPlaying, pos)
                
                // 同时也更新一下通知栏按钮
                val metadata = mediaSession?.controller?.metadata
                val title = metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) ?: "SPlayer"
                val artist = metadata?.getString(MediaMetadataCompat.METADATA_KEY_ARTIST) ?: ""
                val notification = createNotification(title, artist)
                startForeground(notificationId, notification)
            }
            else -> {
                MediaButtonReceiver.handleIntent(mediaSession, intent)
            }
        }
        
        return START_STICKY
    }

    private fun updateMetadata(title: String, artist: String, album: String) {
        val metadata = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            // .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
            .build()
        mediaSession?.setMetadata(metadata)
    }

    private fun updatePlaybackState(isPlaying: Boolean, position: Long) {
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val stateBuilder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                PlaybackStateCompat.ACTION_SEEK_TO or
                PlaybackStateCompat.ACTION_STOP
            )
            .setState(state, position, 1.0f)
        mediaSession?.setPlaybackState(stateBuilder.build())
    }

    private fun createNotification(title: String, artist: String, albumArt: Bitmap? = null): Notification {
        val controller = mediaSession?.controller
        val mediaMetadata = controller?.metadata

        val builder = NotificationCompat.Builder(this, channelId)
            // 显示元数据
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.drawable.ic_launcher_foreground) // 确保资源存在
            .setLargeIcon(albumArt)
            // 媒体样式
            .setStyle(MediaStyle()
                .setMediaSession(mediaSession?.sessionToken)
                .setShowActionsInCompactView(0, 1, 2)
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // 点击通知返回 App
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE
                )
            )

        // 添加按钮: Previous, Play/Pause, Next
        builder.addAction(
            NotificationCompat.Action(
                android.R.drawable.ic_media_previous, "Previous",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
            )
        )
        
        val isPaused = mediaSession?.controller?.playbackState?.state == PlaybackStateCompat.STATE_PAUSED
        builder.addAction(
            NotificationCompat.Action(
                if (isPaused) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause,
                if (isPaused) "Play" else "Pause",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, if (isPaused) PlaybackStateCompat.ACTION_PLAY else PlaybackStateCompat.ACTION_PAUSE)
            )
        )

        builder.addAction(
            NotificationCompat.Action(
                android.R.drawable.ic_media_next, "Next",
                MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT)
            )
        )

        return builder.build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        mediaSession?.isActive = false
        mediaSession?.release()
        super.onDestroy()
    }
}
