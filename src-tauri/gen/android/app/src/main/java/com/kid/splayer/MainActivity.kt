package com.kid.splayer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
    companion object {
        private const val TAG = "SPlayer"
    }
    
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted: Boolean ->
        Log.d(TAG, "Notification permission result: $isGranted")
        if (isGranted) {
            startPlaybackService()
        } else {
            // 即使权限被拒绝也尝试启动服务
            startPlaybackService()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        
        // 注册插件
        Log.d(TAG, "Loading NativeMediaPlugin")
        pluginManager.load(null, "NativeMediaPlugin", NativeMediaPlugin(this), "{}")
        
        checkNotificationPermission()
    }

    private fun checkNotificationPermission() {
        Log.d(TAG, "Checking notification permission, SDK: ${Build.VERSION.SDK_INT}")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED -> {
                    Log.d(TAG, "Notification permission granted")
                    startPlaybackService()
                }
                else -> {
                    Log.d(TAG, "Requesting notification permission")
                    requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            Log.d(TAG, "SDK < 33, starting service directly")
            startPlaybackService()
        }
    }

    private fun startPlaybackService() {
        try {
            Log.d(TAG, "Starting SPlayerMediaService")
            val serviceIntent = Intent(this, SPlayerMediaService::class.java)
            ContextCompat.startForegroundService(this, serviceIntent)
            Log.d(TAG, "Service started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start service: ${e.message}")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
    }
}