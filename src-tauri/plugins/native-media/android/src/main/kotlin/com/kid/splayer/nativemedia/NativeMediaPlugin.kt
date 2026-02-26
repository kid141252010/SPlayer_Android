package com.kid.splayer.nativemedia

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

@InvokeArg
class MetadataArgs {
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var cover: List<Int>? = null
}

@InvokeArg
class PlaybackStateArgs {
    var isPlaying: Boolean = true
    var position: Long = 0
    var duration: Long = 0
}

@TauriPlugin
class NativeMediaPlugin(private val activity: Activity) : Plugin(activity) {
    companion object {
        private var instance: NativeMediaPlugin? = null

        fun emitEvent(eventName: String, data: JSObject) {
            instance?.trigger(eventName, data)
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        instance = this
    }

    @Command
    fun updateMetadata(invoke: Invoke) {
        val args = invoke.parseArgs(MetadataArgs::class.java)
        val title = args.title ?: ""
        val artist = args.artist ?: ""
        val album = args.album ?: ""
        
        // 将封面数据转为 ByteArray
        val coverBytes = args.cover?.let { list ->
            if (list.isNotEmpty()) {
                ByteArray(list.size) { list[it].toByte() }
            } else null
        }
        
        val intent = Intent(activity, SPlayerMediaService::class.java).apply {
            action = SPlayerMediaService.ACTION_UPDATE_METADATA
            putExtra(SPlayerMediaService.EXTRA_TITLE, title)
            putExtra(SPlayerMediaService.EXTRA_ARTIST, artist)
            putExtra(SPlayerMediaService.EXTRA_ALBUM, album)
            coverBytes?.let { putExtra(SPlayerMediaService.EXTRA_COVER, it) }
        }
        activity.startService(intent)
        invoke.resolve()
    }

    @Command
    fun updatePlaybackState(invoke: Invoke) {
        val args = invoke.parseArgs(PlaybackStateArgs::class.java)
        val isPlaying = args.isPlaying
        val position = args.position
        val duration = args.duration
        
        val intent = Intent(activity, SPlayerMediaService::class.java).apply {
            action = SPlayerMediaService.ACTION_UPDATE_STATE
            putExtra(SPlayerMediaService.EXTRA_IS_PLAYING, isPlaying)
            putExtra(SPlayerMediaService.EXTRA_POSITION, position)
            putExtra(SPlayerMediaService.EXTRA_DURATION, duration)
        }
        activity.startService(intent)
        invoke.resolve()
    }
}
