/**
 * Lan Clipboard — HTTP API 封装
 *
 * 提供与后端服务器 HTTP API 交互的方法。
 * 开发时通过 Vite proxy 转发到 localhost:3000。
 * 生产环境需配置服务器地址。
 */

// 生产环境 API 基地址（空字符串表示同域，通过 proxy 或 nginx 转发）
const API_BASE = ''

/**
 * 获取历史文本列表
 * GET /api/texts
 * @returns {Promise<Array>} 历史记录数组 [{id, content, timestamp}]
 */
export async function fetchTexts() {
  const res = await fetch(`${API_BASE}/api/texts`)
  if (!res.ok) throw new Error(`获取历史失败: ${res.status}`)
  const data = await res.json()
  return data.texts || []
}

/**
 * 存储一条文本
 * POST /api/text
 * @param {string} text 要存储的文本内容
 * @returns {Promise<Object>} 存储的记录 {success, id, content, timestamp}
 */
export async function postText(text) {
  const res = await fetch(`${API_BASE}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`发送文本失败: ${res.status}`)
  return res.json()
}

/**
 * 格式化时间戳为可读时间
 * @param {string|number} isoString ISO 时间字符串或时间戳
 * @returns {string} 格式化后的时间，如 "15:30" 或 "07-02 15:30"
 */
export function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  // 今天只显示时分
  if (date.toDateString() === now.toDateString()) {
    return `${hours}:${minutes}`
  }
  // 非今天显示月-日 时:分
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}
