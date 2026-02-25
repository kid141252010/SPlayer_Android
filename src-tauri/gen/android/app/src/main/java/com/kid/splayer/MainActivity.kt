package com.kid.splayer

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

import android.content.Intent
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NativeMediaPlugin::class.java)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        // 启动媒体会话服务
        val serviceIntent = Intent(this, MediaSessionService::class.java)
        ContextCompat.startForegroundService(this, serviceIntent)
    }

    override fun onDestroy() {
        // 停止服务 (如果需要随 App 关闭)
        // val serviceIntent = Intent(this, MediaSessionService::class.java)
        // stopService(serviceIntent)
        super.onDestroy()
    }
}