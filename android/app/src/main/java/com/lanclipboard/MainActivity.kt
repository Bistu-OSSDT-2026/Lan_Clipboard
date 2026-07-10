package com.lanclipboard

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.core.content.ContextCompat

/**
 * MainActivity — 应用入口（参照 macOS Copy_PasteApp）
 *
 * 职责：
 * - 请求通知权限（Android 13+）
 * - 检测无障碍服务状态
 * - 管理前台 ClipboardService 的启停
 * - 渲染 Compose UI
 */
class MainActivity : ComponentActivity() {

    companion object {
        const val EXTRA_HOST = "host"
        const val EXTRA_ROOM = "room"
        const val PREFS_NAME = "lan_clipboard_prefs"
        const val PREF_HOST = "host"
        const val PREF_ROOM = "room"
    }

    private var hasNotificationPermission = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasNotificationPermission = granted
        if (!granted) {
            Toast.makeText(this, "通知权限被拒绝，后台服务可能受限", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 请求通知权限（Android 13+）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasNotificationPermission = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!hasNotificationPermission) {
                permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        } else {
            hasNotificationPermission = true
        }

        // 加载保存的配置
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedHost = prefs.getString(PREF_HOST, "") ?: ""
        val savedRoom = prefs.getString(PREF_ROOM, "test") ?: "test"

        // 检查无障碍服务是否开启
        val a11yEnabled = isAccessibilityServiceEnabled()

        setContent {
            Material3Theme {
                var connectionState by remember { mutableStateOf(ConnectionState(host = savedHost, room = savedRoom)) }

                MainScreen(
                    state = connectionState,
                    a11yEnabled = a11yEnabled,
                    onConnect = { host, room ->
                        // 持久化配置
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                            .putString(PREF_HOST, host)
                            .putString(PREF_ROOM, room)
                            .apply()
                        connect(host, room)
                    },
                    onDisconnect = { disconnect() },
                    onOpenAccessibility = {
                        startActivity(android.content.Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                )
            }
        }
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val am = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
        val enabledServices = am.getEnabledAccessibilityServiceList(
            AccessibilityServiceInfo.FEEDBACK_ALL_MASK
        )
        return enabledServices.any {
            it.resolveInfo.serviceInfo.packageName == packageName &&
            it.resolveInfo.serviceInfo.name == ClipboardAccessibilityService::class.java.name
        }
    }

    private fun connect(host: String, room: String) {
        val intent = android.content.Intent(this, ClipboardService::class.java).apply {
            action = ClipboardService.ACTION_CONNECT
            putExtra(ClipboardService.EXTRA_HOST, host)
            putExtra(ClipboardService.EXTRA_ROOM, room)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun disconnect() {
        val intent = android.content.Intent(this, ClipboardService::class.java).apply {
            action = ClipboardService.ACTION_DISCONNECT
        }
        startService(intent)
    }
}

/**
 * 连接状态数据类
 */
data class ConnectionState(
    val host: String = "",
    val room: String = "test",
    val isConnected: Boolean = false
)

/**
 * Material3 主题包装（简化版）
 */
@Composable
fun Material3Theme(content: @Composable () -> Unit) {
    androidx.compose.material3.MaterialTheme(
        colorScheme = androidx.compose.material3.lightColorScheme(),
        content = content
    )
}
