import React, { useState } from 'react'

/**
 * ConnectionBar — 服务器连接栏
 *
 * 功能：
 * 1. 输入服务器 IP 地址
 * 2. 输入房间名
 * 3. 连接 / 断开按钮
 * 4. 显示连接状态（已连接/已断开）
 */
export default function ConnectionBar({ isConnected, onConnect, onDisconnect }) {
  const [host, setHost] = useState('')
  const [room, setRoom] = useState('')
  const [connecting, setConnecting] = useState(false)

  const handleConnect = async () => {
    if (!host.trim()) return
    if (!room.trim()) return
    setConnecting(true)
    try {
      await onConnect(host.trim(), room.trim())
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = () => {
    onDisconnect()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !isConnected) {
      handleConnect()
    }
  }

  return (
    <div className="connection-bar">
      <div className="connection-bar-inner">
        <div className="connection-inputs">
          <label className="input-group">
            <span className="input-label">服务器</span>
            <input
              type="text"
              className="input"
              placeholder="192.168.1.5"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isConnected || connecting}
            />
          </label>
          <label className="input-group">
            <span className="input-label">房间</span>
            <input
              type="text"
              className="input room-input"
              placeholder="myroom"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isConnected || connecting}
            />
          </label>
        </div>

        <div className="connection-actions">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            <span className="status-text">
              {isConnected ? '已连接' : connecting ? '连接中...' : '未连接'}
            </span>
          </div>

          {!isConnected ? (
            <button
              className="btn btn-connect"
              onClick={handleConnect}
              disabled={connecting || !host.trim() || !room.trim()}
            >
              {connecting ? '连接中...' : '连接'}
            </button>
          ) : (
            <button className="btn btn-disconnect" onClick={handleDisconnect}>
              断开
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
