/**
 * Lan Clipboard — Windows 桌面客户端（Electron 主进程）
 *
 * 职责：
 * 1. 创建系统托盘图标和菜单
 * 2. 管理应用生命周期（启动、退出）
 * 3. 持久化用户配置（服务器 IP + 房间名）
 * 4. 协调 sync.js 同步引擎的启停
 */

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startSync, stopSync, updateConfig } = require('./sync');
const { createTray } = require('./tray');

// ── 全局状态 ────────────────────────────────────────────────
let tray = null;
let configWindow = null;

// 配置文件路径（存到 Electron 用户数据目录）
const configPath = path.join(app.getPath('userData'), 'lan-clipboard-config.json');

// ── 配置读写 ────────────────────────────────────────────────

function loadConfig() {
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return { server: '127.0.0.1', room: 'myroom' };
    }
}

function saveConfig(cfg) {
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── 设置对话框 ──────────────────────────────────────────────

function showConfigDialog(parentWindow) {
    // 用简单的 prompt 风格收集配置
    // Electron 没有原生 prompt，用 dialog.showMessageBox 组合或创建小窗口

    if (configWindow) {
        configWindow.focus();
        return;
    }

    const cfg = loadConfig();

    configWindow = new BrowserWindow({
        width: 420,
        height: 320,
        resizable: false,
        title: 'Lan Clipboard — 设置',
        parent: parentWindow || undefined,
        modal: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // 内联 HTML 配置页
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Microsoft YaHei",sans-serif; background:#1e1e2e; color:#cdd6f4; padding:28px; }
  h2 { font-size:18px; margin-bottom:20px; color:#cba6f7; }
  .row { margin-bottom:16px; }
  label { display:block; font-size:13px; color:#a6adc8; margin-bottom:5px; }
  input { width:100%; padding:10px 12px; border:1px solid #45475a; border-radius:6px;
          background:#313244; color:#cdd6f4; font-size:14px; outline:none; }
  input:focus { border-color:#cba6f7; }
  .btns { display:flex; gap:10px; margin-top:22px; }
  button { flex:1; padding:10px; border:none; border-radius:6px; font-size:14px; cursor:pointer; }
  .btn-save { background:#cba6f7; color:#1e1e2e; font-weight:bold; }
  .btn-save:hover { background:#b4befe; }
  .btn-cancel { background:#45475a; color:#cdd6f4; }
  .btn-cancel:hover { background:#585b70; }
  .hint { font-size:11px; color:#6c7086; margin-top:4px; }
</style>
</head>
<body>
<h2>⚙️ 连接设置</h2>
<div class="row">
  <label>服务器 IP 地址</label>
  <input id="server" type="text" placeholder="例如: 192.168.1.5" value="${escapeHtml(cfg.server)}">
  <div class="hint">运行 shared/server.js 那台电脑的局域网 IP</div>
</div>
<div class="row">
  <label>房间名</label>
  <input id="room" type="text" placeholder="例如: myroom" value="${escapeHtml(cfg.room)}">
  <div class="hint">同一房间内的设备才能互相同步</div>
</div>
<div class="btns">
  <button class="btn-cancel" onclick="window.close()">取消</button>
  <button class="btn-save" onclick="save()">保存并重连</button>
</div>
<script>
  const { ipcRenderer } = require('electron');
  function save() {
    const server = document.getElementById('server').value.trim();
    const room = document.getElementById('room').value.trim();
    if (!server || !room) { alert('请填写服务器 IP 和房间名'); return; }
    ipcRenderer.send('config-saved', { server, room });
  }
</script>
</body>
</html>`;

    configWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    configWindow.on('closed', () => {
        configWindow = null;
    });
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── 应用启动 ────────────────────────────────────────────────

app.whenReady().then(() => {
    const cfg = loadConfig();

    // 设置 IPC 监听（用于配置窗口通信）
    const { ipcMain } = require('electron');
    ipcMain.on('config-saved', (_event, newCfg) => {
        saveConfig(newCfg);
        updateConfig(newCfg);
        if (configWindow) {
            configWindow.close();
        }
    });

    // 创建系统托盘
    tray = createTray(cfg, {
        onShowConfig: () => showConfigDialog(null),
        onQuit: () => {
            stopSync();
            app.quit();
        }
    });

    // 启动同步引擎
    startSync(cfg, (status) => {
        tray.updateStatus(status);
    });
});

// ── 退出处理 ────────────────────────────────────────────────

app.on('window-all-closed', () => {
    // 不退出，保持托盘运行
});

app.on('before-quit', () => {
    stopSync();
});
