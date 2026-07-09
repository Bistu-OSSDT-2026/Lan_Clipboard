package com.lanclipboard

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * ClipboardService — 前台服务
 *
 * 负责后台持续运行：
 * - WebSocket 连接管理（连接/心跳/重连）
 * - 剪贴板监听（变化检测 → WebSocket 发出）
 * - 消息接收（解析 → 写入剪贴板 + 冷却期防循环）
 *
 * 参考 macOS 端 SyncEngine + WebSocketManager + ClipboardMonitor 的统一实现
 */
class ClipboardService : Service() {

    companion object {
        const val TAG = "LanClipboard"
        const val CHANNEL_ID = "clipboard_sync"
        const val NOTIFICATION_ID = 1
        const val HEARTBEAT_INTERVAL = 30_000L
        const val RECONNECT_DELAY = 5_000L
        const val COOLDOWN_SECONDS = 3L

        // Intent extras
        const val EXTRA_HOST = "host"
        const val EXTRA_ROOM = "room"
        const val ACTION_CONNECT = "com.lanclipboard.CONNECT"
        const val ACTION_DISCONNECT = "com.lanclipboard.DISCONNECT"
    }

    private var webSocket: WebSocket? = null
    private val okHttpClient = OkHttpClient.Builder()
        .pingInterval(0, TimeUnit.SECONDS) // 我们自己管理心跳
        .build()

    private var savedHost = ""
    private var savedRoom = ""
    private var isConnected = false

    // 剪贴板相关
    private var clipboardManager: ClipboardManager? = null
    private var lastContent = ""
    private var cooldownUntil = 0L // 冷却期截止时间戳

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val host = intent.getStringExtra(EXTRA_HOST) ?: "localhost"
                val room = intent.getStringExtra(EXTRA_ROOM) ?: "test"
                connect(host, room)
            }
            ACTION_DISCONNECT -> {
                disconnect()
                stopSelf()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ================================================================
    // WebSocket 连接管理（参照 macOS WebSocketManager）
    // ================================================================

    fun connect(host: String, port: Int = 3000, room: String) {
        savedHost = host
        savedRoom = room

        val url = "ws://$host:$port/$room"
        Log.d(TAG, "[WS] 正在连接: $url")

        val request = Request.Builder().url(url).build()
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "[WS] 已连接")
                isConnected = true
                updateNotification(getString(R.string.notification_connected, savedHost))
                startHeartbeat(webSocket)
                startClipboardMonitoring()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "[WS] 收到: $text")
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "[WS] 错误: ${t.message}")
                isConnected = false
                updateNotification(getString(R.string.notification_disconnected))
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        isConnected = false
        stopClipboardMonitoring()
        webSocket?.close(1000, "用户断开")
        webSocket = null
    }

    // ================================================================
    // 消息处理（参照 macOS SyncEngine.onReceive）
    // ================================================================

    private fun handleMessage(raw: String) {
        try {
            val json = JSONObject(raw)
            val type = json.optString("type")

            when (type) {
                "text" -> {
                    val data = json.optString("data", "")
                    if (data.isNotEmpty()) {
                        // 写入系统剪贴板
                        writeToClipboard(data)
                        // 3 秒冷却，防止循环同步
                        setCooldown(COOLDOWN_SECONDS)
                        Log.d(TAG, "[Sync] 收到文本: ${data.take(30)}...")
                    }
                }
                "pong" -> { /* 心跳响应，不做处理 */ }
            }
        } catch (e: Exception) {
            Log.e(TAG, "[WS] 消息解析失败: ${e.message}")
        }
    }

    // ================================================================
    // 剪贴板监听（参照 macOS ClipboardMonitor）
    // ================================================================

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener {
        // 冷却期内跳过
        if (System.currentTimeMillis() < cooldownUntil) return@OnPrimaryClipChangedListener

        val clip = clipboardManager?.primaryClip ?: return@OnPrimaryClipChangedListener
        if (clip.itemCount == 0) return@OnPrimaryClipChangedListener

        val text = clip.getItemAt(0).text?.toString() ?: return@OnPrimaryClipChangedListener
        if (text.isEmpty() || text == lastContent) return@OnPrimaryClipChangedListener

        lastContent = text
        sendText(text)
    }

    private fun startClipboardMonitoring() {
        lastContent = clipboardManager?.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
        clipboardManager?.addPrimaryClipChangedListener(clipListener)
        Log.d(TAG, "[Clipboard] 开始监听剪贴板")
    }

    private fun stopClipboardMonitoring() {
        clipboardManager?.removePrimaryClipChangedListener(clipListener)
        Log.d(TAG, "[Clipboard] 停止监听剪贴板")
    }

    // ================================================================
    // 发送文本（参照 macOS SyncEngine.onTextChange）
    // ================================================================

    private fun sendText(text: String) {
        val timestamp = System.currentTimeMillis()
        val msg = JSONObject().apply {
            put("type", "text")
            put("data", text)
            put("timestamp", timestamp)
        }
        webSocket?.send(msg.toString())
        Log.d(TAG, "[WS] 发送文本: ${text.take(30)}...")
    }

    // ================================================================
    // 剪贴板写入
    // ================================================================

    private fun writeToClipboard(text: String) {
        val clip = ClipData.newPlainText("lan-clipboard", text)
        clipboardManager?.setPrimaryClip(clip)
        lastContent = text
    }

    private fun setCooldown(seconds: Long) {
        cooldownUntil = System.currentTimeMillis() + seconds * 1000
    }

    // ================================================================
    // 心跳（参照 macOS WebSocketManager.heartbeat）
    // ================================================================

    private var heartbeatRunnable: Runnable? = null

    private fun startHeartbeat(ws: WebSocket) {
        heartbeatRunnable = object : Runnable {
            override fun run() {
                if (isConnected) {
                    ws.send("""{"type":"ping"}""")
                    mainHandler.postDelayed(this, HEARTBEAT_INTERVAL)
                }
            }
        }
        mainHandler.postDelayed(heartbeatRunnable!!, HEARTBEAT_INTERVAL)
    }

    // ================================================================
    // 重连（参照 macOS WebSocketManager.reconnect）
    // ================================================================

    private fun scheduleReconnect() {
        if (savedHost.isEmpty()) return
        mainHandler.postDelayed({
            Log.d(TAG, "[WS] 正在重连...")
            connect(savedHost, room = savedRoom)
        }, RECONNECT_DELAY)
    }

    // ================================================================
    // 通知栏
    // ================================================================

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_desc)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun updateNotification(text: String) {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_edit) // 使用系统图标
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        disconnect()
        super.onDestroy()
    }
}
