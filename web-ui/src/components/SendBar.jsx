import React, { useState } from 'react'

/**
 * SendBar — 底部发送栏
 *
 * 功能：
 * 1. textarea 输入文本
 * 2. 发送按钮 → POST /api/text + WebSocket 发送
 * 3. Ctrl+Enter 快捷发送
 * 4. 发送后清空输入框
 * 5. 未连接时禁用发送
 */
export default function SendBar({ onSend, isConnected }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    const content = text.trim()
    if (!content || !isConnected || sending) return

    setSending(true)
    try {
      await onSend(content)
      setText('')
    } catch (err) {
      console.error('发送失败:', err)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    // Ctrl+Enter 发送
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="send-bar">
      <div className="send-bar-inner">
        <textarea
          className="send-textarea"
          placeholder={isConnected ? '输入文本，Ctrl+Enter 发送...' : '请先连接服务器...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          rows={3}
        />
        <button
          className="btn btn-send"
          onClick={handleSend}
          disabled={!isConnected || !text.trim() || sending}
        >
          {sending ? '发送中...' : '发送'}
        </button>
      </div>
      {isConnected && (
        <p className="send-hint">按 Ctrl+Enter 快捷发送</p>
      )}
    </div>
  )
}
