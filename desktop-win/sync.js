/**
 * Lan Clipboard — 剪贴板同步引擎（sync.js）
 *
 * 职责：
 * 1. WebSocket 连接到服务器（含自动重连）
 * 2. 心跳保活（每 30 秒 ping）
 * 3. 剪贴板轮询（每 1 秒检测变化）
 * 4. 发送文本到服务器
 * 5. 接收文本并写入剪贴板
 * 6. 防循环（收到消息后 3 秒冷却）
 */

const WebSocket = require('ws');
const { clipboard } = require('electron');

// ── 内部状态 ────────────────────────────────────────────────
let ws = null;                  // WebSocket 实例
let config = null;              // 当前配置 { server, room }
let onStatusChange = null;      // 状态回调

let lastText = '';              // 上一次剪贴板内容（用于变化检测）
let cooldownUntil = 0;          // 冷却截止时间戳（防循环）

let pollTimer = null;           // 剪贴板轮询定时器
let pingTimer = null;           // 心跳定时器
let reconnectTimer = null;      // 重连定时器

// ── 公开 API ────────────────────────────────────────────────

/**
 * 启动同步引擎
 * @param {{ server: string, room: string }} cfg
 * @param {(status: string) => void} statusCallback
 */
function startSync(cfg, statusCallback) {
    config = cfg;
    onStatusChange = statusCallback;
    connect();
    startPolling();
}

/**
 * 停止同步引擎（退出时调用）
 */
function stopSync() {
    stopPolling();
    stopPing();
    clearReconnectTimer();
    if (ws) {
        try { ws.close(); } catch (_) { /* ignore */ }
        ws = null;
    }
}

/**
 * 更新配置（设置页保存后调用，会断开重连）
 * @param {{ server?: string, room?: string }} newCfg
 */
function updateConfig(newCfg) {
    config = { ...config, ...newCfg };
    stopSync();
    startSync(config, onStatusChange);
}

// ── WebSocket 连接 ──────────────────────────────────────────

function connect() {
    if (ws) {
        try { ws.close(); } catch (_) { /* ignore */ }
        ws = null;
    }

    const url = `ws://${config.server}:3000/${config.room}`;
    emitStatus('connecting');

    try {
        ws = new WebSocket(url);
    } catch (_) {
        emitStatus('disconnected');
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
        emitStatus('connected');
        startPing();
        clearReconnectTimer();
    });

    ws.on('message', (data) => {
        handleMessage(data);
    });

    ws.on('close', () => {
        emitStatus('disconnected');
        stopPing();
        scheduleReconnect();
    });

    ws.on('error', () => {
        // close 事件会在 error 后自动触发，这里不用额外处理
    });
}

// ── 消息处理 ────────────────────────────────────────────────

function handleMessage(data) {
    try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text' && typeof msg.data === 'string' && msg.data.length > 0) {
            // 设置冷却期，防止写入剪贴板后触发本地上传
            cooldownUntil = Date.now() + 3000;
            // 写入系统剪贴板
            clipboard.writeText(msg.data);
            // 更新本地缓存，避免轮询时误判为变化
            lastText = msg.data;
        }
        // pong 消息不需要处理，收到即表示连接正常
    } catch (_) {
        // 非 JSON 或格式不符，忽略
    }
}

// ── 心跳 ────────────────────────────────────────────────────

function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
}

function stopPing() {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
    }
}

// ── 重连 ────────────────────────────────────────────────────

function scheduleReconnect() {
    if (reconnectTimer) return; // 已有重连计划
    emitStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 5000);
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// ── 剪贴板轮询 ──────────────────────────────────────────────

function startPolling() {
    stopPolling();
    // 记录当前剪贴板内容作为基线
    try {
        lastText = clipboard.readText() || '';
    } catch (_) {
        lastText = '';
    }

    pollTimer = setInterval(() => {
        try {
            const current = clipboard.readText() || '';

            // 冷却期内不触发上传（防循环）
            if (Date.now() < cooldownUntil) return;

            // 无变化，跳过
            if (current === lastText) return;

            // 忽略空文本
            if (current === '') return;

            lastText = current;

            // 通过 WebSocket 发出
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'text',
                    data: current,
                    timestamp: Date.now()
                }));
            }
        } catch (_) {
            // 剪贴板读取失败，忽略
        }
    }, 1000);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ── 内部辅助 ────────────────────────────────────────────────

function emitStatus(status) {
    if (typeof onStatusChange === 'function') {
        onStatusChange(status);
    }
}

// ── 导出 ────────────────────────────────────────────────────

module.exports = { startSync, stopSync, updateConfig };
