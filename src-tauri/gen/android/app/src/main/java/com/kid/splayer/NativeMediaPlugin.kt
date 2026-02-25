package com.kid.splayer

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

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
        val title = invoke.args.getString("title") ?: ""
        val artist = invoke.args.getString("artist") ?: ""
        val album = invoke.args.getString("album") ?: ""
        
        val intent = Intent(activity, MediaSessionService::class.java).apply {
            action = MediaSessionService.ACTION_UPDATE_METADATA
            putExtra(MediaSessionService.EXTRA_TITLE, title)
            putExtra(MediaSessionService.EXTRA_ARTIST, artist)
            putExtra(MediaSessionService.EXTRA_ALBUM, album)
        }
        activity.startService(intent)
        invoke.resolve()
    }

    @Command
    fun updatePlaybackState(invoke: Invoke) {
        val isPlaying = invoke.args.getBoolean("isPlaying") ?: true
        val position = invoke.args.getLong("position") ?: 0
        val duration = invoke.args.getLong("duration") ?: 0
        
        val intent = Intent(activity, MediaSessionService::class.java).apply {
            action = MediaSessionService.ACTION_UPDATE_STATE
            putExtra(MediaSessionService.EXTRA_IS_PLAYING, isPlaying)
            putExtra(MediaSessionService.EXTRA_POSITION, position)
            putExtra(MediaSessionService.EXTRA_DURATION, duration)
        }
        activity.startService(intent)
        invoke.resolve()
    }
}
