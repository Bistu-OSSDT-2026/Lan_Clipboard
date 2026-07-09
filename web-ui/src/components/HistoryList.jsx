import React, { useState } from 'react'
import { formatTime } from '../utils/api.js'

/**
 * HistoryList — 历史记录列表
 *
 * 功能：
 * 1. 显示所有历史文本记录
 * 2. 每条显示时间戳 + 内容摘要 + 复制按钮
 * 3. 点击复制按钮将文本写入浏览器剪贴板
 * 4. 当列表为空时显示提示信息
 */
export default function HistoryList({ texts = [] }) {
  const [copiedId, setCopiedId] = useState(null)

  const handleCopy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      // 2 秒后清除"已复制"状态
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      // 备用方案：使用 textarea 复制
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    }
  }

  if (texts.length === 0) {
    return (
      <div className="history-list">
        <div className="history-header">
          <h2>历史记录</h2>
        </div>
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <p className="empty-text">暂无记录</p>
          <p className="empty-hint">连接服务器后，复制的文本将显示在这里</p>
        </div>
      </div>
    )
  }

  return (
    <div className="history-list">
      <div className="history-header">
        <h2>历史记录 <span className="count-badge">{texts.length}</span></h2>
      </div>
      <div className="history-items">
        {texts.map((item) => (
          <div key={item.id} className="history-item">
            <div className="item-main">
              <div className="item-time">{formatTime(item.timestamp)}</div>
              <div className="item-content">{item.content}</div>
            </div>
            <button
              className={`btn btn-copy ${copiedId === item.id ? 'copied' : ''}`}
              onClick={() => handleCopy(item.content, item.id)}
              title="复制到剪贴板"
            >
              {copiedId === item.id ? '已复制' : '复制'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
