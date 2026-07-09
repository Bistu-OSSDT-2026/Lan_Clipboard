/**
 * Lan Clipboard — 渲染进程（桌面 UI 逻辑）
 *
 * 通信方式：通过 ipcRenderer 与主进程 index.js 交互
 * - 发送：ipcRenderer.send('channel', data)
 * - 接收：ipcRenderer.on('channel', callback)
 */

const { ipcRenderer } = require('electron');

// ── DOM 引用 ────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const statusBadge   = $('#statusBadge');
const statusDot     = $('#statusBadge .status-dot');
const statusLabel   = $('#statusLabel');
const inputServer   = $('#inputServer');
const inputRoom     = $('#inputRoom');
const btnConnect    = $('#btnConnect');
const btnDisconnect = $('#btnDisconnect');
const serverInfo    = $('#serverInfo');
const historyList   = $('#historyList');
const historyCount  = $('#historyCount');
const inputSend     = $('#inputSend');
const btnSend       = $('#btnSend');
const btnClearHist  = $('#btnClearHistory');
const btnMinimize   = $('#btnMinimize');
const btnClose      = $('#btnClose');
const autoSyncHint  = $('#autoSyncHint');

// ── 状态 ────────────────────────────────────────────────────

let currentStatus = 'disconnected';
let history = [];

// ── 格式化 ──────────────────────────────────────────────────

function fmtTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(text, maxLen = 80) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
}

// ── Toast ───────────────────────────────────────────────────

function showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

// ── 状态 UI ─────────────────────────────────────────────────

function updateStatusUI(status) {
    currentStatus = status;

    // 更新徽章
    statusBadge.className = `status-indicator ${status}`;
    statusDot.className = `status-dot ${status}`;

    const labels = {
        connected: '已连接',
        connecting: '连接中…',
        reconnecting: '重连中…',
        disconnected: '未连接'
    };
    statusLabel.textContent = labels[status] || '未连接';

    // 更新按钮
    if (status === 'connected') {
        btnConnect.style.display = 'none';
        btnDisconnect.style.display = '';
        inputServer.disabled = true;
        inputRoom.disabled = true;
        serverInfo.textContent = `已连接 — ws://${inputServer.value}:3000/${inputRoom.value}`;
        serverInfo.className = 'server-info show';
        autoSyncHint.style.display = 'block';
    } else if (status === 'connecting' || status === 'reconnecting') {
        btnConnect.style.display = 'none';
        btnDisconnect.style.display = '';
        inputServer.disabled = true;
        inputRoom.disabled = true;
        serverInfo.textContent = '连接中…';
        serverInfo.className = 'server-info server-info-disconnected';
        autoSyncHint.style.display = 'none';
    } else {
        btnConnect.style.display = '';
        btnDisconnect.style.display = 'none';
        inputServer.disabled = false;
        inputRoom.disabled = false;
        serverInfo.textContent = '未连接';
        serverInfo.className = 'server-info server-info-disconnected';
        autoSyncHint.style.display = 'none';
    }
}

// ── 历史记录 UI ─────────────────────────────────────────────

function renderHistory() {
    historyCount.textContent = `(${history.length})`;

    if (history.length === 0) {
        historyList.innerHTML = `
          <div class="empty-state">
            <div class="icon">📭</div>
            <p>连接服务器后，复制的内容会出现在这里</p>
          </div>`;
        return;
    }

    historyList.innerHTML = history.map(item => `
      <div class="history-item" data-id="${item.id}">
        <span class="item-tag ${item.from}">${item.from === 'local' ? '本机' : '远程'}</span>
        <span class="item-time">${fmtTime(item.timestamp)}</span>
        <span class="item-content" title="${escapeHtml(item.content)}">${escapeHtml(truncate(item.content))}</span>
        <button class="btn btn-ghost item-copy" data-copy="${escapeAttr(item.content)}">复制</button>
      </div>
    `).join('');

    // 绑定复制按钮
    historyList.querySelectorAll('.item-copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const text = btn.dataset.copy;
            ipcRenderer.send('copy-to-clipboard', text);
            showToast('✅ 已复制到剪贴板');
        });
    });

    // 点击条目也可以复制
    historyList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', () => {
            const btn = item.querySelector('.item-copy');
            if (btn) {
                const text = btn.dataset.copy;
                ipcRenderer.send('copy-to-clipboard', text);
                showToast('✅ 已复制到剪贴板');
            }
        });
    });
}

function addHistoryItem(item) {
    // 去重
    history = history.filter(h => h.content !== item.content);
    history.unshift(item);
    if (history.length > 200) history = history.slice(0, 200);
    renderHistory();
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

// ── 事件监听 ────────────────────────────────────────────────

// 连接
btnConnect.addEventListener('click', () => {
    const server = inputServer.value.trim();
    const room = inputRoom.value.trim();
    if (!server || !room) {
        showToast('⚠️ 请填写服务器 IP 和房间名');
        return;
    }
    ipcRenderer.send('connect-server', { server, room });
});

// 断开
btnDisconnect.addEventListener('click', () => {
    ipcRenderer.send('disconnect-server');
});

// 发送文本
function sendText() {
    const text = inputSend.value.trim();
    if (!text) return;
    if (currentStatus !== 'connected') {
        showToast('⚠️ 请先连接到服务器');
        return;
    }
    ipcRenderer.send('send-text', text);
    inputSend.value = '';
    inputSend.style.height = 'auto';
}

btnSend.addEventListener('click', sendText);

inputSend.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText();
    }
});

// 自动调整 textarea 高度
inputSend.addEventListener('input', () => {
    inputSend.style.height = 'auto';
    inputSend.style.height = Math.min(inputSend.scrollHeight, 100) + 'px';
});

// 清空历史
btnClearHist.addEventListener('click', () => {
    history = [];
    renderHistory();
    ipcRenderer.send('clear-history');
});

// ── IPC 接收 ────────────────────────────────────────────────

function getLocalIP() {
    try {
        const os = require('os');
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) return net.address;
            }
        }
    } catch (_) {}
    return '127.0.0.1';
}

ipcRenderer.on('init-state', (_event, data) => {
    inputServer.value = data.config.server || getLocalIP();
    inputRoom.value = data.config.room || 'office';
    history = data.history || [];
    renderHistory();
});

ipcRenderer.on('sync-status', (_event, data) => {
    updateStatusUI(data.status);
});

ipcRenderer.on('text-received', (_event, item) => {
    addHistoryItem(item);
});

ipcRenderer.on('text-sent-local', (_event, item) => {
    addHistoryItem(item);
    showToast('📤 已自动发送');
});

ipcRenderer.on('text-sent-confirm', (_event, item) => {
    addHistoryItem(item);
});

ipcRenderer.on('history-data', (_event, data) => {
    history = data || [];
    renderHistory();
});

// ── 窗口控制 ────────────────────────────────────────────────

// 最小化按钮 → 隐藏到托盘
btnMinimize.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

// 关闭按钮 → 隐藏到托盘
btnClose.addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

// ── 初始化 ──────────────────────────────────────────────────

// 请求初始状态
ipcRenderer.send('get-init-state');
