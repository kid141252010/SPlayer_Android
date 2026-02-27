package com.kid.splayer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.media.session.MediaButtonReceiver
import androidx.media.app.NotificationCompat.MediaStyle
import app.tauri.plugin.JSObject

class SPlayerMediaService : Service(), AudioManager.OnAudioFocusChangeListener {
    private var mediaSession: MediaSessionCompat? = null
    private val channelId = "splayer_playback"
    private val notificationId = 101
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var isStarted = false

    companion object {
        private const val TAG = "SPlayerMediaService"
        const val ACTION_UPDATE_METADATA = "com.kid.splayer.UPDATE_METADATA"
        const val ACTION_UPDATE_STATE = "com.kid.splayer.UPDATE_STATE"
        
        const val EXTRA_TITLE = "title"
        const val EXTRA_ARTIST = "artist"
        const val EXTRA_ALBUM = "album"
        const val EXTRA_COVER = "cover"
        const val EXTRA_IS_PLAYING = "is_playing"
        const val EXTRA_POSITION = "position"
        const val EXTRA_DURATION = "duration"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "onCreate called")
        createNotificationChannel()
        
        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        requestAudioFocus()
        
        mediaSession = MediaSessionCompat(this, "SPlayerSession").apply {
            Log.d(TAG, "Setting MediaSession active")
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

                override fun onStop() {
                    NativeMediaPlugin.emitEvent("stop", JSObject())
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
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(channelId, name, importance).apply {
                description = descriptionText
                setShowBadge(true)
            }
            val notificationManager: NotificationManager =
                getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isStarted) {
            val initialNotification = createNotification("SPlayer", "Ready to play")
            startForeground(notificationId, initialNotification)
            isStarted = true
        }

        if (intent == null) return START_STICKY

        when (intent.action) {
            ACTION_UPDATE_METADATA -> {
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Unknown"
                val artist = intent.getStringExtra(EXTRA_ARTIST) ?: "Unknown"
                val album = intent.getStringExtra(EXTRA_ALBUM) ?: "Unknown"
                val coverBytes = intent.getByteArrayExtra(EXTRA_COVER)
                val coverBitmap = coverBytes?.let { bytes ->
                    try {
                        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    } catch (e: Exception) {
                        null
                    }
                }
                
                updateMetadata(title, artist, album, coverBitmap)
                val notification = createNotification(title, artist, coverBitmap)
                val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.notify(notificationId, notification)
            }
            ACTION_UPDATE_STATE -> {
                val isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true)
                val pos = intent.getLongExtra(EXTRA_POSITION, 0)
                val dur = intent.getLongExtra(EXTRA_DURATION, 0)
                updatePlaybackState(isPlaying, pos)
                
                val metadata = mediaSession?.controller?.metadata
                val title = metadata?.getString(MediaMetadataCompat.METADATA_KEY_TITLE) ?: "SPlayer"
                val artist = metadata?.getString(MediaMetadataCompat.METADATA_KEY_ARTIST) ?: ""
                val cover = metadata?.getBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART)
                val notification = createNotification(title, artist, cover)
                val notificationManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.notify(notificationId, notification)
            }
            else -> {
                MediaButtonReceiver.handleIntent(mediaSession, intent)
            }
        }
        
        return START_STICKY
    }

    private fun updateMetadata(title: String, artist: String, album: String, cover: Bitmap? = null) {
        val metadataBuilder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
        
        // 设置封面图片
        cover?.let {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it)
        }
        
        mediaSession?.setMetadata(metadataBuilder.build())
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
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setLargeIcon(albumArt)
            .setStyle(MediaStyle()
                .setMediaSession(mediaSession?.sessionToken)
                .setShowActionsInCompactView(0, 1, 2)
            )
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this, 0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
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

    private fun requestAudioFocus() {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        audioFocusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(audioAttributes)
            .setOnAudioFocusChangeListener(this)
            .setWillPauseWhenDucked(false)
            .build()

        audioManager?.requestAudioFocus(audioFocusRequest!!)
    }

    private fun abandonAudioFocus() {
        audioFocusRequest?.let {
            audioManager?.abandonAudioFocusRequest(it)
        }
    }

    override fun onAudioFocusChange(focusChange: Int) {
        when (focusChange) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                // 获得音频焦点，可以继续播放或提高音量
                NativeMediaPlugin.emitEvent("audiofocus_gain", JSObject())
            }
            AudioManager.AUDIOFOCUS_LOSS -> {
                // 永久失去音频焦点，需要停止播放
                NativeMediaPlugin.emitEvent("audiofocus_loss", JSObject())
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                // 临时失去音频焦点（如来电），暂停播放
                NativeMediaPlugin.emitEvent("audiofocus_loss_transient", JSObject())
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                // 临时失去焦点但可以继续以较低音量播放
                NativeMediaPlugin.emitEvent("audiofocus_duck", JSObject())
            }
        }
    }

    override fun onDestroy() {
        abandonAudioFocus()
        mediaSession?.isActive = false
        mediaSession?.release()
        super.onDestroy()
    }
}
