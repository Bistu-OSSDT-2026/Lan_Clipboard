import React, { useState, useRef, useCallback, useEffect } from 'react'
import ConnectionBar from './components/ConnectionBar.jsx'
import HistoryList from './components/HistoryList.jsx'
import SendBar from './components/SendBar.jsx'
import { fetchTexts, postText } from './utils/api.js'

/**
 * App — 主组件
 *
 * 管理全局状态：
 * - WebSocket 连接生命周期（连接/心跳/重连/断开）
 * - 历史文本列表（初始加载 + 实时更新）
 * - 发送文本（HTTP + WebSocket 双通道）
 *
 * 协议参考 shared/protocol.md
 */
export default function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [texts, setTexts] = useState([])
  const [serverInfo, setServerInfo] = useState({ host: '', room: '' })

  const wsRef = useRef(null)
  const heartbeatRef = useRef(null)
  const reconnectRef = useRef(null)

  // ================================================================
  // WebSocket 连接管理
  // ================================================================

  const connectWs = useCallback((host, room) => {
    // 清理旧连接
    cleanup()

    const url = `ws://${host}:3000/${room}`
    console.log(`[WS] 正在连接: ${url}`)

    const ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('[WS] 已连接')
      setIsConnected(true)
      setServerInfo({ host, room })

      // 启动心跳：每 30 秒发 ping
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000)

      // 连接成功后加载历史
      loadHistory(host)
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        console.log('[WS] 收到:', msg)

        if (msg.type === 'text') {
          // 收到新文本消息，追加到历史列表
          const newRecord = {
            id: msg.timestamp || Date.now(),
            content: msg.data,
            timestamp: new Date().toISOString(),
          }
          setTexts((prev) => {
            // 去重：避免与最后一条重复
            if (prev.length > 0 && prev[0].content === msg.data) {
              return prev
            }
            return [newRecord, ...prev].slice(0, 100)
          })
        }
        // type === 'pong' 不做特殊处理
      } catch (err) {
        console.error('[WS] 消息解析失败:', err)
      }
    }

    ws.onclose = () => {
      console.log('[WS] 已断开')
      setIsConnected(false)
      stopHeartbeat()

      // 5 秒后自动重连
      if (host && room) {
        reconnectRef.current = setTimeout(() => {
          console.log('[WS] 正在重连...')
          connectWs(host, room)
        }, 5000)
      }
    }

    ws.onerror = (err) => {
      console.error('[WS] 错误:', err)
    }

    wsRef.current = ws
  }, [])

  // ================================================================
  // HTTP 历史加载
  // ================================================================

  const loadHistory = useCallback(async (host) => {
    try {
      // 如果使用 Vite proxy，直接用相对路径
      // 如果连接的是远程服务器，使用绝对路径
      const baseUrl = (host === 'localhost' || host === '127.0.0.1')
        ? '' : `http://${host}:3000`

      const res = await fetch(`${baseUrl}/api/texts`)
      if (res.ok) {
        const data = await res.json()
        setTexts(data.texts || [])
      }
    } catch (err) {
      console.error('[HTTP] 获取历史失败:', err)
    }
  }, [])

  // ================================================================
  // 清理函数
  // ================================================================

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  const cleanup = useCallback(() => {
    stopHeartbeat()
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.onclose = null  // 阻止自动重连
      wsRef.current.close()
      wsRef.current = null
    }
  }, [stopHeartbeat])

  // ================================================================
  // 暴露给子组件的操作
  // ================================================================

  const handleConnect = useCallback(async (host, room) => {
    connectWs(host, room)
    return true
  }, [connectWs])

  const handleDisconnect = useCallback(() => {
    cleanup()
    setIsConnected(false)
    setServerInfo({ host: '', room: '' })
  }, [cleanup])

  const handleSend = useCallback(async (text) => {
    // 1. WebSocket 发送
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'text',
        data: text,
        timestamp: Date.now(),
      }))
    }

    // 2. HTTP 存储（用于历史记录持久化）
    try {
      const { host, room: _room } = serverInfo
      const baseUrl = (host === 'localhost' || host === '127.0.0.1')
        ? '' : `http://${host}:3000`

      const res = await fetch(`${baseUrl}/api/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        const result = await res.json()
        // 将新记录添加到列表顶部（去重）
        setTexts((prev) => {
          if (prev.length > 0 && prev[0].content === text) {
            return prev
          }
          return [{
            id: result.id || Date.now(),
            content: text,
            timestamp: result.timestamp || new Date().toISOString(),
          }, ...prev].slice(0, 100)
        })
      }
    } catch (err) {
      console.error('[HTTP] 存储失败:', err)
    }
  }, [serverInfo])

  // ================================================================
  // 组件卸载时清理
  // ================================================================

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  // ================================================================
  // 渲染
  // ================================================================

  return (
    <div className="app">
      <ConnectionBar
        isConnected={isConnected}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      <main className="main-content">
        <HistoryList texts={texts} />
      </main>
      <SendBar
        onSend={handleSend}
        isConnected={isConnected}
      />
    </div>
  )
}
