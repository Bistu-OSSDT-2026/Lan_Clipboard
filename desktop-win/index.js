/**
 * Lan Clipboard — Windows 桌面客户端（Electron 主进程）
 *
 * 职责：
 * 1. 创建主窗口（桌面 UI）
 * 2. 创建系统托盘图标和菜单（最小化到托盘）
 * 3. 管理应用生命周期
 * 4. 持久化用户配置 + 剪贴板历史
 * 5. IPC 桥接：渲染进程 ↔ sync.js 同步引擎
 */

const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { startSync, stopSync, updateConfig, sendText } = require('./sync');
const { createTray } = require('./tray');

// ── 全局状态 ────────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let history = [];           // [{ id, content, timestamp, from }]
let historyId = 0;

// 配置文件路径
const configPath = path.join(app.getPath('userData'), 'lan-clipboard-config.json');
const historyPath = path.join(app.getPath('userData'), 'lan-clipboard-history.json');

// ── 配置读写 ────────────────────────────────────────────────

function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return '127.0.0.1';
}

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
        return { server: getLocalIP(), room: 'office' };
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── 历史记录读写 ────────────────────────────────────────────

function loadHistory() {
    try {
        const raw = fs.readFileSync(historyPath, 'utf-8');
        const data = JSON.parse(raw);
        history = data.history || [];
        historyId = data.historyId || 0;
    } catch {
        history = [];
        historyId = 0;
    }
}

function saveHistory() {
    // 最多保留 500 条
    if (history.length > 500) history = history.slice(0, 500);
    fs.writeFileSync(historyPath, JSON.stringify({ history, historyId }, null, 2), 'utf-8');
}

function addHistoryItem(content, from) {
    historyId++;
    const item = { id: historyId, content, timestamp: Date.now(), from };
    history.unshift(item);
    // 去重：相同内容只保留最新一条
    const seen = new Set();
    history = history.filter(h => {
        if (seen.has(h.content)) return false;
        seen.add(h.content);
        return true;
    });
    saveHistory();
    return item;
}

// ── 创建主窗口 ──────────────────────────────────────────────

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 560,
        height: 620,
        minWidth: 420,
        minHeight: 400,
        title: 'Lan Clipboard',
        icon: nativeImage.createEmpty(),
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // 按 F12 打开调试工具
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    });

    // 关闭窗口 → 最小化到托盘（不退出）
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ── IPC 处理器 ──────────────────────────────────────────────

function setupIPC() {
    // 渲染进程请求初始状态
    ipcMain.on('get-init-state', (event) => {
        const cfg = loadConfig();
        event.reply('init-state', {
            config: cfg,
            history: history.slice(0, 100),
            status: 'disconnected'
        });
    });

    // 连接服务器
    ipcMain.on('connect-server', (_event, cfg) => {
        saveConfig(cfg);
        updateConfig(cfg);
    });

    // 断开连接
    ipcMain.on('disconnect-server', () => {
        stopSync();
    });

    // 用户手动发送文本
    ipcMain.on('send-text', (_event, text) => {
        if (!text || !text.trim()) return;
        const trimmed = text.trim();

        // 通过 sync 引擎发出
        const sent = sendText(trimmed);
        if (sent) {
            const item = addHistoryItem(trimmed, 'local');
            mainWindow.webContents.send('text-sent-confirm', item);
        }
    });

    // 请求历史记录
    ipcMain.on('get-history', (event) => {
        event.reply('history-data', history.slice(0, 100));
    });

    // 复制到剪贴板
    ipcMain.on('copy-to-clipboard', (_event, text) => {
        clipboard.writeText(text);
    });

    // 清空历史
    ipcMain.on('clear-history', () => {
        history = [];
        saveHistory();
        mainWindow.webContents.send('history-data', []);
    });

    // 最小化窗口到托盘
    ipcMain.on('minimize-window', () => {
        if (mainWindow) mainWindow.hide();
    });
}

// ── 同步引擎回调 ────────────────────────────────────────────

function onSyncStatus(status) {
    // 更新托盘
    if (tray) tray.updateStatus(status);
    // 通知渲染进程
    if (mainWindow && !mainWindow.isDestroyed()) {
        const cfg = loadConfig();
        mainWindow.webContents.send('sync-status', { status, ...cfg });
    }
}

function onTextReceived(text) {
    console.log('[Main] 收到远程文本:', text.substring(0, 50));
    const item = addHistoryItem(text, 'remote');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-received', item);
    }
}

function onTextSentLocal(text) {
    console.log('[Main] 检测到本地复制:', text.substring(0, 50));
    const item = addHistoryItem(text, 'local');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('text-sent-local', item);
    }
}

// ── 应用启动 ────────────────────────────────────────────────

// 标记是否正在退出
app.isQuitting = false;

app.whenReady().then(() => {
    loadHistory();
    setupIPC();
    createMainWindow();

    const cfg = loadConfig();

    // 创建托盘（带显示/退出）
    tray = createTray(cfg, {
        onShow: () => {
            if (mainWindow) {
                mainWindow.show();
                mainWindow.focus();
            } else {
                createMainWindow();
            }
        },
        onQuit: () => {
            app.isQuitting = true;
            stopSync();
            app.quit();
        }
    });

    // 启动同步引擎，绑定回调
    startSync(cfg, {
        onStatusChange: onSyncStatus,
        onTextReceived: onTextReceived,
        onTextSentLocal: onTextSentLocal
    });
});

// ── 退出处理 ────────────────────────────────────────────────

app.on('before-quit', () => {
    app.isQuitting = true;
    stopSync();
});

app.on('activate', () => {
    // 托盘点击时恢复窗口（macOS 行为，Windows 上也适用）
    if (mainWindow) {
        mainWindow.show();
    }
});
