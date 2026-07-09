package com.lanclipboard

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS) // OkHttp 层 WebSocket ping，辅助保持连接
        .build()

    private var savedHost = ""
    private var savedRoom = ""
    private var isConnected = false

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    // 剪贴板相关
    // 反循环策略：纯内容去重（lastContent 比较），不使用时间冷却期。
    // 时间冷却期会盲阻所有发送（包括用户新复制），是反馈循环覆盖的根因。
    // 只要 writeToClipboard 先设 lastContent 再改剪贴板，lastContent 比较就足够防止回环。
    private var clipboardManager: ClipboardManager? = null
    @Volatile private var lastContent = ""
    private var pollingRunnable: Runnable? = null
    private val POLLING_INTERVAL = 500L

    // 接收无障碍服务发送的剪贴板变化广播
    private val a11yReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ClipboardAccessibilityService.ACTION_CLIPBOARD_CHANGED) return
            val text = intent.getStringExtra(ClipboardAccessibilityService.EXTRA_TEXT) ?: return
            if (text.isEmpty() || text == lastContent) return
            lastContent = text
            Log.d(TAG, "[A11y] 发送: ${text.take(30)}...")
            sendText(text)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        // 注册无障碍服务广播接收器
        registerReceiver(a11yReceiver, IntentFilter(ClipboardAccessibilityService.ACTION_CLIPBOARD_CHANGED), RECEIVER_NOT_EXPORTED)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_CONNECT -> {
                val host = intent.getStringExtra(EXTRA_HOST) ?: "localhost"
                val room = intent.getStringExtra(EXTRA_ROOM) ?: "test"
                connect(host, room = room)
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

        // 断开旧连接，防止堆积
        stopHeartbeat()
        webSocket?.close(1000, "重连")
        webSocket = null

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
                Log.d(TAG, "[WS] 正在关闭: $code $reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "[WS] 已关闭: $code $reason")
                if (isConnected) {
                    isConnected = false
                    updateNotification(getString(R.string.notification_disconnected))
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "[WS] 错误: ${t.message}")
                if (isConnected) {
                    isConnected = false
                    updateNotification(getString(R.string.notification_disconnected))
                    scheduleReconnect()
                }
            }
        })
    }

    fun disconnect() {
        isConnected = false
        stopClipboardMonitoring()
        stopHeartbeat()
        webSocket?.close(1000, "用户断开")
        webSocket = null
        mainHandler.removeCallbacksAndMessages(null)
    }

    // ================================================================
    // 消息处理（参照 macOS SyncEngine.onReceive）
    // 注意：onMessage 在 OkHttp 后台线程回调，所有剪贴板操作必须 post 到主线程
    // ================================================================

    private fun handleMessage(raw: String) {
        try {
            val json = JSONObject(raw)
            val type = json.optString("type")

            when (type) {
                "text" -> {
                    val data = json.optString("data", "")
                    if (data.isNotEmpty()) {
                        // 主线程写入剪贴板。lastContent 在 setPrimaryClip 之前更新，
                        // 确保 A11y/轮询检测到变化时内容比对会跳过，防止回环。
                        mainHandler.post {
                            writeToClipboard(data)
                            Log.d(TAG, "[Sync] 收到文本: ${data.take(30)}...")
                        }
                    }
                }
                "pong" -> { /* 心跳响应，不做处理 */ }
            }
        } catch (e: Exception) {
            Log.e(TAG, "[WS] 消息解析失败: ${e.message}")
        }
    }

    // ================================================================
    // 剪贴板轮询（Android 10+ 限制后台 OnPrimaryClipChangedListener，改用主动轮询）
    // ================================================================

    private fun startClipboardMonitoring() {
        lastContent = clipboardManager?.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
        Log.i(TAG, "[Clipboard] 开始轮询剪贴板（间隔 ${POLLING_INTERVAL}ms），初始内容: ${lastContent.take(20)}")
        pollingRunnable = object : Runnable {
            private var pollCount = 0
            override fun run() {
                if (!isConnected) {
                    mainHandler.postDelayed(this, POLLING_INTERVAL)
                    return
                }

                pollCount++
                try {
                    val clip = clipboardManager?.primaryClip
                    if (clip == null || clip.itemCount == 0) {
                        // 每 20 次（10 秒）打一次日志，确认轮询存活
                        if (pollCount % 20 == 0) {
                            Log.i(TAG, "[Poll] 轮询运行中 (#$pollCount), clip=${if (clip == null) "null" else "empty"}")
                        }
                        mainHandler.postDelayed(this, POLLING_INTERVAL)
                        return
                    }

                    val text = clip.getItemAt(0).text?.toString() ?: ""
                    if (text.isNotEmpty() && text != lastContent) {
                        Log.i(TAG, "[Poll] 检测到变化: ${text.take(30)}...")
                        lastContent = text
                        sendText(text)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "[Clipboard] 轮询异常: ${e.message}")
                }

                mainHandler.postDelayed(this, POLLING_INTERVAL)
            }
        }
        mainHandler.post(pollingRunnable!!)
    }

    private fun stopClipboardMonitoring() {
        pollingRunnable?.let { mainHandler.removeCallbacks(it) }
        pollingRunnable = null
        Log.d(TAG, "[Clipboard] 停止轮询剪贴板")
    }

    // ================================================================
    // 发送文本（参照 macOS SyncEngine.onTextChange）
    // ================================================================

    private fun sendText(text: String) {
        val ws = webSocket ?: return
        val timestamp = System.currentTimeMillis()
        val msg = JSONObject().apply {
            put("type", "text")
            put("data", text)
            put("timestamp", timestamp)
        }
        val sent = ws.send(msg.toString())
        if (sent) {
            Log.d(TAG, "[WS] 发送文本: ${text.take(30)}...")
        } else {
            Log.e(TAG, "[WS] 发送失败（队列满）")
        }
    }

    // ================================================================
    // 剪贴板写入（必须在主线程调用）
    // ================================================================

    private fun writeToClipboard(text: String) {
        // 先更新 lastContent，再写剪贴板。即使 A11y/轮询在 setPrimaryClip 后
        // 立即触发，lastContent 也已更新，内容比对会跳过。
        lastContent = text
        try {
            val clip = ClipData.newPlainText("lan-clipboard", text)
            clipboardManager?.setPrimaryClip(clip)
        } catch (e: Exception) {
            Log.e(TAG, "[Clipboard] 写入失败: ${e.message}")
        }
    }

    private fun setCooldown(seconds: Long) {
        // 已废弃：改用纯内容去重，不再使用时间冷却期
    }

    // ================================================================
    // 心跳（参照 macOS WebSocketManager.heartbeat）
    // ================================================================

    private var heartbeatRunnable: Runnable? = null

    private fun startHeartbeat(ws: WebSocket) {
        stopHeartbeat()
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

    private fun stopHeartbeat() {
        heartbeatRunnable?.let { mainHandler.removeCallbacks(it) }
        heartbeatRunnable = null
    }

    // ================================================================
    // 重连（参照 macOS WebSocketManager.reconnect）
    // ================================================================

    private var reconnectPending = false

    private fun scheduleReconnect() {
        if (savedHost.isEmpty() || reconnectPending) return
        reconnectPending = true
        mainHandler.postDelayed({
            reconnectPending = false
            Log.d(TAG, "[WS] 正在重连...")
            connect(savedHost, room = savedRoom)
        }, RECONNECT_DELAY)
    }

    // ================================================================
    // 通知栏
    // ================================================================

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
        try { unregisterReceiver(a11yReceiver) } catch (_: Exception) {}
        super.onDestroy()
    }
}
