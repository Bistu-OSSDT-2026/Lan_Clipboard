package com.lanclipboard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * BootReceiver — 开机自启
 *
 * 设备重启后自动启动 ClipboardService，恢复上次连接。
 * 配置已通过 SharedPreferences 持久化，ClipboardService 会自动加载。
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val TAG = "LanClipboard"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        Log.i(TAG, "[Boot] 设备启动，自动恢复服务")

        val serviceIntent = Intent(context, ClipboardService::class.java)
        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (e: Exception) {
            Log.e(TAG, "[Boot] 启动服务失败: ${e.message}")
        }
    }
}
