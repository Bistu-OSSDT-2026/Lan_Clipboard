package com.lanclipboard

import android.accessibilityservice.AccessibilityService
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat

/**
 * ClipboardAccessibilityService — 无障碍服务
 *
 * 因 Android 10+ 限制后台读取剪贴板（getPrimaryClip() 返回 null），
 * 只有 AccessibilityService 有权在后台读取剪贴板数据。
 *
 * 职责：
 * - 监听剪贴板变化（通过 OnPrimaryClipChangedListener，无障碍服务不受后台限制）
 * - 检测到变化后，通过 Broadcast 通知 ClipboardService 发送到服务器
 *
 * 用户需在 设置 → 无障碍 → Lan Clipboard 中手动开启此服务。
 */
class ClipboardAccessibilityService : AccessibilityService() {

    companion object {
        const val TAG = "LanClipboard"
        const val ACTION_CLIPBOARD_CHANGED = "com.lanclipboard.CLIPBOARD_CHANGED"
        const val EXTRA_TEXT = "text"
    }

    private var clipboardManager: ClipboardManager? = null
    private var lastContent = ""

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener {
        val clip = clipboardManager?.primaryClip ?: return@OnPrimaryClipChangedListener
        if (clip.itemCount == 0) return@OnPrimaryClipChangedListener

        val text = clip.getItemAt(0).text?.toString() ?: return@OnPrimaryClipChangedListener
        if (text.isEmpty() || text == lastContent) return@OnPrimaryClipChangedListener

        lastContent = text
        Log.i(TAG, "[A11y] 检测到剪贴板变化: ${text.take(30)}...")

        // 通过广播通知 ClipboardService
        val intent = Intent(ACTION_CLIPBOARD_CHANGED).apply {
            putExtra(EXTRA_TEXT, text)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "[A11y] 无障碍服务已启动")

        clipboardManager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        lastContent = clipboardManager?.primaryClip?.getItemAt(0)?.text?.toString() ?: ""
        clipboardManager?.addPrimaryClipChangedListener(clipListener)
        Log.i(TAG, "[A11y] 开始监听剪贴板（无障碍模式）")

        // 自动启动 ClipboardService（加载保存的配置并连接 WebSocket）
        val serviceIntent = Intent(this, ClipboardService::class.java)
        try {
            ContextCompat.startForegroundService(this, serviceIntent)
            Log.i(TAG, "[A11y] 已拉起 ClipboardService")
        } catch (e: Exception) {
            Log.e(TAG, "[A11y] 拉起 ClipboardService 失败: ${e.message}")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // 不需要处理具体事件，我们依赖 OnPrimaryClipChangedListener
    }

    override fun onInterrupt() {
        Log.d(TAG, "[A11y] 无障碍服务被中断")
    }

    override fun onDestroy() {
        clipboardManager?.removePrimaryClipChangedListener(clipListener)
        Log.d(TAG, "[A11y] 无障碍服务已停止")
        super.onDestroy()
    }
}
