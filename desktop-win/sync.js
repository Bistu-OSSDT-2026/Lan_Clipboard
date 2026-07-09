/**
 * Lan Clipboard — 剪贴板同步引擎（sync.js）
 * Ctrl+C 复制 → 自动检测 → WebSocket 发送 → 服务器广播
 */

const WebSocket = require('ws');
const { clipboard } = require('electron');

let ws = null, config = null, callbacks = {};
let lastText = '';
let cooldownUntil = 0;
let lastReceivedText = '';    // 去重用
let pollCount = 0;
let pollTimer = null, pingTimer = null, reconnectTimer = null;

// ── 公开 API ──

function startSync(cfg, cbs) {
    config = cfg;
    callbacks = cbs || {};
    console.log('[Sync] 启动 ->', cfg.server, '/', cfg.room);
    connect();
    startPolling();
}

function stopSync() {
    stopPolling(); stopPing(); clearReconnectTimer();
    if (ws) {
        ws.removeAllListeners('close');  // 阻止自动重连
        try { ws.close(); } catch (_) {}
        ws = null;
    }
    emitStatus('disconnected');
}

function updateConfig(newCfg) {
    config = { ...config, ...newCfg };
    stopSync();
    startSync(config, callbacks);
}

function sendText(text) {
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'text', data: text, timestamp: Date.now() }));
    return true;
}

// ── WebSocket ──

function connect() {
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    const url = `ws://${config.server}:3000/${config.room}`;
    emitStatus('connecting');
    try { ws = new WebSocket(url); } catch (_) { emitStatus('disconnected'); scheduleReconnect(); return; }

    ws.on('open', () => {
        console.log('[Sync] WebSocket 已连接');
        emitStatus('connected'); startPing(); clearReconnectTimer();
    });
    ws.on('message', d => handleMessage(d));
    ws.on('close', () => {
        console.log('[Sync] WebSocket 断开');
        emitStatus('disconnected'); stopPing(); scheduleReconnect();
    });
    ws.on('error', e => console.log('[Sync] 错误:', e.message));
}

function handleMessage(data) {
    try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text' && msg.data) {
            // 去重：重复消息不处理，避免 Mac 刷屏导致冷却永不过期
            if (msg.data === lastReceivedText) return;
            lastReceivedText = msg.data;

            console.log('[Sync] 收到远程:', msg.data.substring(0, 40));
            lastText = msg.data;
            cooldownUntil = Date.now() + 2000;
            clipboard.writeText(msg.data);
            emitTextReceived(msg.data);
        }
    } catch (_) {}
}

// ── 心跳 / 重连 ──

function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30000);
}
function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null; } }

function scheduleReconnect() {
    if (reconnectTimer) return;
    emitStatus('reconnecting');
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, 5000);
}
function clearReconnectTimer() { if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; } }

// ── 剪贴板轮询（核心！Ctrl+C 自动检测并发送）──

function startPolling() {
    stopPolling();
    try { lastText = clipboard.readText() || ''; } catch (_) { lastText = ''; }
    console.log('[Sync] 轮询启动, 当前剪贴板:', JSON.stringify(lastText));

    pollTimer = setInterval(() => {
        pollCount++;
        try {
            const now = Date.now();
            const current = clipboard.readText() || '';

            // 每 5 次轮询打印一次剪贴板状态（诊断用）
            if (pollCount % 5 === 1) {
                console.log('[Sync] 轮询#' + pollCount,
                    '剪贴板:', JSON.stringify(current.substring(0, 30)),
                    'lastText:', JSON.stringify(lastText.substring(0, 30)),
                    '冷却:', now < cooldownUntil ? '是' : '否');
            }

            // 冷却中，跳过
            if (now < cooldownUntil) return;

            // 没变化
            if (current === lastText) return;
            // 空文本
            if (current === '') return;

            // === 检测到剪贴板变化 ===
            console.log('[Sync] ⬆️ 检测到 Ctrl+C! 内容:', current.substring(0, 50));
            lastText = current;
            cooldownUntil = now + 2000;

            emitTextSentLocal(current);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'text', data: current, timestamp: now }));
                console.log('[Sync] ✅ 已发送');
            } else {
                console.log('[Sync] ❌ ws未连接');
            }
        } catch (e) {
            console.error('[Sync] 轮询崩溃:', e);
        }
    }, 500);
}

function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

// ── 内部 ──

function emitStatus(s) { if (callbacks.onStatusChange) callbacks.onStatusChange(s); }
function emitTextReceived(t) { if (callbacks.onTextReceived) callbacks.onTextReceived(t); }
function emitTextSentLocal(t) { if (callbacks.onTextSentLocal) callbacks.onTextSentLocal(t); }

module.exports = { startSync, stopSync, updateConfig, sendText };
