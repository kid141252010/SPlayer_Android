package com.kid.splayer

import android.os.Bundle
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    private var mediaSession: MediaSessionCompat? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // 初始化 MediaSession
        // 第一个参数是 Context，第二个是 Tag（随便起名）
        mediaSession = MediaSessionCompat(this, "SPlayerSession").apply {
            // 激活会话
            isActive = true
            
            // 设置可用的控制按钮：播放、暂停、上一首、下一首
            val stateBuilder = PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE
                )
                // 初始状态设为正在播放，这样通知栏才会立即出现
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1.0f)
            
            setPlaybackState(stateBuilder.build())
        }
    }

    override fun onDestroy() {
        // Activity 销毁时释放资源
        mediaSession?.isActive = false
        mediaSession?.release()
        super.onDestroy()
    }
}