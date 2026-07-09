import { useState, useEffect, useRef, useCallback } from 'react'

const STORAGE_KEY = 'lan-clipboard-web-config'

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : { server: '127.0.0.1', room: 'office' }
  } catch {
    return { server: '127.0.0.1', room: 'office' }
  }
}

function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

function formatTime(ts) {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

export default function App() {
  const [cfg, setCfg] = useState(loadConfig)
  const [server, setServer] = useState(cfg.server)
  const [room, setRoom] = useState(cfg.room)
  const [status, setStatus] = useState('disconnected') // disconnected | connecting | connected
  const [texts, setTexts] = useState([])
  const [input, setInput] = useState('')
  const [toast, setToast] = useState('')

  const wsRef = useRef(null)
  const reconnectRef = useRef(null)

  // ── WebSocket 连接 ──
  const connect = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close() } catch (_) { /* ok */ }
    }

    const url = `ws://${server}:3000/${room}`
    setStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      // 连接成功后拉取历史
      fetchHistory()
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'text' && msg.data) {
          setTexts(prev => {
            // 去重：同 timestamp 不重复加
            const exists = prev.some(t => t.timestamp === msg.timestamp && t.content === msg.data)
            if (exists) return prev
            return [{ id: msg.timestamp, content: msg.data, timestamp: msg.timestamp }, ...prev]
          })
        }
      } catch (_) { /* ignore */ }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      // 5 秒后重连
      reconnectRef.current = setTimeout(() => connect(), 5000)
    }

    ws.onerror = () => {
      // close 会跟着触发
    }
  }, [server, room])

  // ── 心跳 ──
  useEffect(() => {
    if (status !== 'connected') return
    const timer = setInterval(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
    return () => clearInterval(timer)
  }, [status])

  // ── 拉取历史 ──
  const fetchHistory = async () => {
    try {
      const res = await fetch(`http://${server}:3000/api/texts`)
      if (res.ok) {
        const data = await res.json()
        // 期望格式: { texts: [{ id, content, timestamp }] }
        const list = (data.texts || []).reverse()
        setTexts(list.map(t => ({
          id: t.id || t.timestamp,
          content: t.content,
          timestamp: t.timestamp || Date.now()
        })))
      }
    } catch (_) { /* 服务器可能没开 HTTP */ }
  }

  // ── 连接/断开 ──
  const handleConnect = () => {
    const newCfg = { server, room }
    setCfg(newCfg)
    saveConfig(newCfg)
    connect()
  }

  const handleDisconnect = () => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current)
    if (wsRef.current) {
      try { wsRef.current.close() } catch (_) { /* ok */ }
      wsRef.current = null
    }
    setStatus('disconnected')
  }

  // ── 发送文本 ──
  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setToast('⚠️ 请先连接到服务器')
      setTimeout(() => setToast(''), 1500)
      return
    }

    const msg = { type: 'text', data: text, timestamp: Date.now() }
    wsRef.current.send(JSON.stringify(msg))

    // 同时 POST 到 HTTP API 存历史
    fetch(`http://${server}:3000/api/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    }).catch(() => {})

    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── 复制 ──
  const handleCopy = async (content) => {
    try {
      await navigator.clipboard.writeText(content)
      setToast('✅ 已复制到剪贴板')
      setTimeout(() => setToast(''), 1500)
    } catch {
      setToast('❌ 复制失败')
      setTimeout(() => setToast(''), 1500)
    }
  }

  // ── 清理 ──
  useEffect(() => {
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (wsRef.current) try { wsRef.current.close() } catch (_) { /* ok */ }
    }
  }, [])

  return (
    <>
      {/* ═══ 连接栏 ═══ */}
      <div className="connect-bar">
        <h1>
          <span className="logo">📋</span>
          Lan Clipboard
        </h1>

        <div className="connect-row">
          <input
            type="text"
            placeholder="服务器 IP"
            value={server}
            onChange={e => setServer(e.target.value)}
          />
          <span className="sep">:</span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>3000</span>
          <span className="sep">/</span>
          <input
            type="text"
            placeholder="房间名"
            value={room}
            onChange={e => setRoom(e.target.value)}
            style={{ maxWidth: 140 }}
          />

          {status === 'connected' ? (
            <button className="btn btn-danger" onClick={handleDisconnect}>
              断开
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect}>
              连接
            </button>
          )}
        </div>

        <div className="status-badge">
          <span className={`status-dot ${status}`} />
          {status === 'connected' && `已连接 — ws://${server}:3000/${room}`}
          {status === 'connecting' && '连接中…'}
          {status === 'disconnected' && '未连接'}
        </div>
      </div>

      {/* ═══ 历史记录 ═══ */}
      <div className="history-section">
        <h2>
          📜 历史记录
          <span className="count">({texts.length} 条)</span>
        </h2>

        {texts.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📭</div>
            <p>暂无记录，连接服务器后会自动同步</p>
          </div>
        ) : (
          <ul className="history-list">
            {texts.map((item, i) => (
              <li key={item.id || i} className="history-item">
                <span className="item-time">{formatTime(item.timestamp)}</span>
                <span className="item-content">{item.content}</span>
                <span className="item-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => handleCopy(item.content)}
                  >
                    复制
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ═══ 发送栏 ═══ */}
      <div className="send-section">
        <textarea
          placeholder="输入文本，Enter 发送，Shift+Enter 换行…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className="btn btn-primary" onClick={handleSend}>
          发送
        </button>
      </div>

      {/* ═══ Toast ═══ */}
      {toast && <div className="copy-toast">{toast}</div>}
    </>
  )
}
