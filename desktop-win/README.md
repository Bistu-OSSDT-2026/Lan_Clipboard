# Lan Clipboard — Windows 客户端技术文档

> **模块代号**: C &nbsp;|&nbsp; **技术栈**: Electron 33 + ws 8 + Node.js 24 &nbsp;|&nbsp; **版本**: 1.0.0

---

## 目录

1. [架构概览](#1-架构概览)
2. [文件结构](#2-文件结构)
3. [模块详解](#3-模块详解)
   - [3.1 index.js — 主进程](#31-indexjs--主进程)
   - [3.2 sync.js — 同步引擎](#32-syncjs--同步引擎)
   - [3.3 tray.js — 系统托盘](#33-trayjs--系统托盘)
4. [数据流](#4-数据流)
5. [状态机](#5-状态机)
6. [配置持久化](#6-配置持久化)
7. [托盘 UI 规范](#7-托盘-ui-规范)
8. [构建与打包](#8-构建与打包)
9. [调试指南](#9-调试指南)
10. [API 参考](#10-api-参考)

---

## 1. 架构概览

Windows 客户端是一个 **纯 Electron 桌面应用**，不嵌入服务器，只作为 WebSocket 客户端连接到 A 的独立服务器。

```
┌──────────────────────────────────────────┐
│              index.js (主进程)             │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ 配置管理  │  │ IPC 通信  │  │生命周期 │  │
│  └─────┬────┘  └────┬─────┘  └───┬────┘  │
│        │            │            │        │
│  ┌─────▼────────────▼────────────▼─────┐  │
│  │           sync.js (同步引擎)          │  │
│  │  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │ 剪贴板轮询 │  │ WebSocket 客户端  │ │  │
│  │  │ (1s间隔)  │  │ (连接/收发/心跳)  │ │  │
│  │  └──────────┘  └──────────────────┘ │  │
│  └─────────────────┬───────────────────┘  │
│                    │ 状态回调               │
│  ┌─────────────────▼───────────────────┐  │
│  │           tray.js (系统托盘)          │  │
│  │  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │ 彩色圆点   │  │ 右键菜单 + 提示   │ │  │
│  │  └──────────┘  └──────────────────┘ │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
         │                    ▲
         │ ws://ip:3000/room  │
         ▼                    │
┌──────────────────────────────────────────┐
│          shared/server.js (A)            │
│       Express HTTP + WebSocket Server     │
└──────────────────────────────────────────┘
```

**核心设计原则：**

| 原则 | 说明 |
|------|------|
| **纯客户端** | 不内嵌服务器，不提供 Host/Client 切换 |
| **常驻托盘** | 关闭窗口不退出，通过系统托盘管理 |
| **自动重连** | 断线 5 秒后自动尝试重连，无需用户干预 |
| **防循环** | 写入剪贴板后 3 秒冷却期，避免消息回弹 |

---

## 2. 文件结构

```
desktop-win/
├── package.json       # 项目元信息 + npm scripts + 依赖声明
├── index.js           # Electron 主进程入口
├── sync.js            # 剪贴板同步引擎
├── tray.js            # 系统托盘 UI
└── node_modules/      # 依赖（npm install 后生成）
    ├── electron/      # Electron 运行时
    └── ws/            # WebSocket 客户端库
```

### 依赖关系图

```
index.js
  ├── require('electron')  → app, BrowserWindow, ipcMain
  ├── require('./sync')    → startSync, stopSync, updateConfig
  └── require('./tray')    → createTray

sync.js
  ├── require('ws')        → WebSocket
  └── require('electron')  → clipboard

tray.js
  └── require('electron')  → Tray, Menu, nativeImage
```

---

## 3. 模块详解

### 3.1 index.js — 主进程

**职责：** 应用入口，管理生命周期、配置持久化、模块编排。

#### 启动流程

```
app.whenReady()
  │
  ├─ 1. loadConfig()          从 %APPDATA%/lan-clipboard-config.json 读取配置
  │     默认值: { server: "127.0.0.1", room: "myroom" }
  │
  ├─ 2. 注册 IPC 监听器       监听 config-saved 事件（设置窗口发来）
  │     ipcMain.on('config-saved', ...)
  │
  ├─ 3. createTray(cfg, ...)  创建系统托盘
  │     返回: { updateStatus }
  │
  └─ 4. startSync(cfg, cb)    启动同步引擎
        回调: status → tray.updateStatus(status)
```

#### 配置管理

| 函数 | 功能 |
|------|------|
| `loadConfig()` | 从磁盘读取 JSON 配置，失败返回默认值 |
| `saveConfig(cfg)` | 将配置对象序列化写入磁盘 |
| `showConfigDialog()` | 弹出设置窗口（内联 HTML + IPC） |

**配置文件位置：** `%APPDATA%/<app-name>/lan-clipboard-config.json`

```json
{
  "server": "192.168.1.5",
  "room": "myroom"
}
```

#### 设置窗口

- **尺寸：** 420×320 px，不可缩放
- **实现：** `BrowserWindow` + 内联 HTML（`data:` URI）
- **通信：** 渲染进程通过 `ipcRenderer.send('config-saved', { server, room })` 通知主进程
- **样式：** Catppuccin Mocha 暗色主题，与 Web UI 一致

#### 生命周期

| 事件 | 行为 |
|------|------|
| `app.whenReady()` | 加载配置 → 创建托盘 → 启动同步 |
| `window-all-closed` | **不退出**，保持托盘运行 |
| `before-quit` | 调用 `stopSync()` 清理资源 |

---

### 3.2 sync.js — 同步引擎

**职责：** 核心同步逻辑，是客户端最重要的模块。

#### 公开 API

```js
const { startSync, stopSync, updateConfig } = require('./sync')
```

| 函数 | 参数 | 说明 |
|------|------|------|
| `startSync(cfg, cb)` | `cfg`: {server, room}<br>`cb`: (status) => void | 启动引擎：连接 WebSocket + 开始轮询 |
| `stopSync()` | — | 停止引擎：清理所有定时器和连接 |
| `updateConfig(newCfg)` | `newCfg`: {server?, room?} | 更新配置并自动重连 |

#### 内部状态

| 变量 | 类型 | 说明 |
|------|------|------|
| `ws` | `WebSocket\|null` | WebSocket 连接实例 |
| `config` | `{server, room}\|null` | 当前连接配置 |
| `lastText` | `string` | 上一次读取的剪贴板内容（变化检测基准） |
| `cooldownUntil` | `number` | 冷却截止时间戳（ms），之前不触发上传 |
| `pollTimer` | `Timer\|null` | `setInterval` 句柄 |
| `pingTimer` | `Timer\|null` | 心跳定时器句柄 |
| `reconnectTimer` | `Timer\|null` | 重连定时器句柄 |

#### WebSocket 连接流程

```
connect()
  │
  ├─ 关闭旧连接（如有）
  ├─ emitStatus('connecting')
  ├─ new WebSocket(`ws://${server}:3000/${room}`)
  │
  ├─ on('open')    → emitStatus('connected') + startPing() + 清除重连定时器
  ├─ on('message') → handleMessage(data)
  ├─ on('close')   → emitStatus('disconnected') + stopPing() + scheduleReconnect()
  └─ on('error')   → 不处理（close 会随后触发）
```

#### 消息处理 (`handleMessage`)

```
收到 WebSocket 消息
  │
  ├─ JSON.parse(data)
  │
  ├─ type === "text" && data 非空?
  │   ├─ YES → cooldownUntil = now + 3000   // 3秒冷却
  │   │        clipboard.writeText(data)     // 写入系统剪贴板
  │   │        lastText = data               // 更新缓存
  │   └─ NO  → 忽略
  │
  └─ type === "pong"? → 忽略（仅表示连接存活）
```

#### 剪贴板轮询 (`startPolling`)

```
每 1000ms 执行:
  │
  ├─ Date.now() < cooldownUntil?  → 跳过（冷却中）
  ├─ current === lastText?        → 跳过（无变化）
  ├─ current === ''?              → 跳过（空文本）
  │
  └─ 所有检查通过:
       lastText = current
       ws.send({ type: "text", data: current, timestamp: Date.now() })
```

**为什么用轮询而不是事件监听？**
Windows 没有原生的剪贴板变化事件。Electron 也不提供 `clipboard.on('change')` 这样的 API。`setInterval` 每秒读取是最可靠的跨平台方案。

#### 心跳机制

```
连接成功后:
  setInterval(() => {
    if (ws.readyState === OPEN)
      ws.send('{"type":"ping"}')
  }, 30000)
```

**超时检测：** 如果 60 秒内未收到任何消息（含 pong），`ws` 库底层会触发 TCP 超时 → `close` 事件 → 自动重连。

#### 重连策略

| 参数 | 值 |
|------|-----|
| 触发条件 | WebSocket `close` 事件 |
| 延迟 | **5 秒** |
| 防重复 | `reconnectTimer` 存在时跳过 |

---

### 3.3 tray.js — 系统托盘

**职责：** 系统托盘图标、菜单、状态可视化。

#### 公开 API

```js
const { createTray } = require('./tray')

const tray = createTray(config, {
  onShowConfig: () => { /* 打开设置窗口 */ },
  onQuit:       () => { /* 退出应用 */ }
})

// 同步引擎状态变化时调用:
tray.updateStatus('connected' | 'connecting' | 'reconnecting' | 'disconnected')
```

#### 图标生成算法 (`makeDotIcon`)

用纯像素缓冲区生成 16×16 RGBA 彩色圆点，无需外部图片资源：

```
1. 分配 16×16×4 = 1024 字节 Buffer
2. 遍历每个像素 (x, y)
3. 计算到圆心 (8, 8) 的距离
4. 距离 ≤ 6 的像素 → 填充 RGBA 颜色
5. 距离 > 6 的像素 → 保持透明 (0,0,0,0)
```

**调色板：**

| 颜色 | RGBA | 含义 |
|------|------|------|
| 绿色 | `#26a269` | 已连接 |
| 黄色 | `#e5c07b` | 连接中 / 重连中 |
| 灰色 | `#6c7086` | 未连接 |
| 红色 | `#f38ba8` | 错误（预留） |

#### 托盘菜单结构

```
┌──────────────────────┐
│ ○ 未连接       (禁用) │
│ 服务器: 192.168.1.5:3000 (禁用) │
│ 房间: myroom     (禁用) │
├──────────────────────┤
│ ⚙ 设置               │  → 打开设置窗口
├──────────────────────┤
│ 退出                  │  → 停止同步 + app.quit()
└──────────────────────┘
```

#### 交互方式

| 操作 | 行为 |
|------|------|
| 右键单击 | 弹出菜单 |
| 双击 | 打开设置窗口 |
| 悬停 | 显示 Tooltip（含连接状态和地址） |

---

## 4. 数据流

### 4.1 发送路径（本地复制 → 服务器）

```
用户在任意应用按 Ctrl+C
        │
        ▼
Windows 系统剪贴板更新
        │
        ▼  (1秒后轮询检测到)
sync.js: pollTimer 回调
  lastText !== current  →  检测到变化
        │
        ▼
检查冷却期: Date.now() >= cooldownUntil? ✓
        │
        ▼
ws.send(JSON.stringify({
  type: "text",
  data: "复制的文本",
  timestamp: 1719900000000
}))
        │
        ▼  (WebSocket)
shared/server.js: 收到消息 → 广播给同房间其他客户端
```

### 4.2 接收路径（服务器 → 本地剪贴板）

```
shared/server.js 广播消息
        │
        ▼  (WebSocket)
sync.js: ws.on('message')
        │
        ▼
JSON.parse → type === "text" ✓
        │
        ▼
cooldownUntil = Date.now() + 3000   ← 防循环关键步骤
clipboard.writeText(data)            ← 写入系统剪贴板
lastText = data                      ← 更新缓存
        │
        ▼
Windows 系统剪贴板更新（任意应用 Ctrl+V 即可粘贴）
```

### 4.3 防循环机制详解

```
场景：A 设备复制"hello"

A: 检测到剪贴板变化 → ws.send("hello")
         ↓
服务器: 广播 "hello" 给房间内所有人（不含发送者 A 自己）
         ↓
B: 收到 "hello" → cooldownUntil = now+3000 → clipboard.writeText("hello")
                                                 ↓
                                     B 的剪贴板被写入 → lastText = "hello"
                                                 ↓
                         1秒后轮询: current("hello") === lastText("hello") → 跳过 ✓

-----

假设服务器有 bug，将消息回传给了 A（发送者自己）:

A: 收到自己发的 "hello" → cooldownUntil = now+3000 → clipboard.writeText("hello")
         ↓
1秒后轮询: Date.now() < cooldownUntil → 跳过（冷却中）✓
4秒后轮询: current("hello") === lastText("hello") → 跳过（无变化）✓
```

---

## 5. 状态机

### 5.1 连接状态转换

```
                    ┌─────────────┐
                    │ disconnected │ ◄──────────┐
                    └──────┬──────┘            │
                           │                    │
                    connect() 调用               │
                           │                    │
                    ┌──────▼──────┐            │
                    │ connecting  │            │
                    └──────┬──────┘            │
                           │                    │
              ┌────────────┼────────────┐       │
              │            │            │       │
         ws.on('open')  ws.on('error')  │       │
              │            │            │       │
     ┌────────▼──┐  ┌─────▼──────┐     │       │
     │ connected │  │   (error    │     │       │
     └────┬──────┘  │   ─> close) │     │       │
          │         └─────┬──────┘     │       │
          │               │            │       │
          │         ws.on('close')     │       │
          │               │            │       │
          │         ┌─────▼──────┐     │       │
          │         │ reconnecting│    │       │
          │         └─────┬──────┘     │       │
          │               │            │       │
          │         5秒后重试          │       │
          │               │            │       │
          │         connect() ─────────┘       │
          │                                    │
          │         用户断开 / 退出              │
          │               │                    │
          └───────────────┼────────────────────┘
                          │
                    stopSync() 调用
```

### 5.2 状态回调映射

| 内部状态 | `emitStatus()` 参数 | 托盘图标颜色 | 托盘菜单文字 |
|----------|---------------------|-------------|-------------|
| WebSocket 正在连接 | `'connecting'` | 🟡 黄色 | ◌ 连接中… |
| WebSocket 已打开 | `'connected'` | 🟢 绿色 | ● 已连接 |
| 断线，等待重连 | `'reconnecting'` | 🟡 黄色 | ◌ 重连中… |
| 初始 / 完全断开 | `'disconnected'` | ⚪ 灰色 | ○ 未连接 |

---

## 6. 配置持久化

### 存储位置

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%/lan-clipboard-win/lan-clipboard-config.json` |
| 实际示例 | `C:\Users\用户名\AppData\Roaming\lan-clipboard-win\lan-clipboard-config.json` |

### 配置格式

```json
{
  "server": "192.168.1.5",
  "room": "myroom"
}
```

### 读写流程

```
读取（启动时）:
  fs.readFileSync(configPath) → JSON.parse → 返回对象
  失败 → 返回默认值 { server: "127.0.0.1", room: "myroom" }

写入（用户保存设置时）:
  ipcMain 收到 'config-saved' → saveConfig(cfg) → fs.writeFileSync
```

---

## 7. 托盘 UI 规范

### 颜色语义

| 颜色 | 色值 | 场景 |
|------|------|------|
| 🟢 绿 | `#26a269` | WebSocket 已连接，同步正常工作 |
| 🟡 黄 | `#e5c07b` | 正在建立连接 / 断线后等待重连 |
| ⚪ 灰 | `#6c7086` | 从未连接 / 手动断开 |

### Tooltip 格式

```
Lan Clipboard — 已连接
192.168.1.5:3000/myroom
```

### 菜单项规范

- **状态行** — 不可点击（`enabled: false`），实时反映连接状态
- **信息行** — 不可点击，显示当前服务器和房间
- **分隔线** — 用 `type: 'separator'`
- **操作项** — 可点击，触发对应回调

---

## 8. 构建与打包

### 开发模式

```bash
cd desktop-win
npm install        # 安装依赖
npm start          # 启动 Electron（等同于 npx electron .）
```

### 生产打包

推荐使用 [electron-builder](https://www.electron.build/)：

```bash
npm install --save-dev electron-builder
```

在 `package.json` 中添加：

```json
{
  "build": {
    "appId": "com.lanclipboard.win",
    "productName": "Lan Clipboard",
    "directories": {
      "output": "dist"
    },
    "win": {
      "target": "nsis",
      "icon": "icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  },
  "scripts": {
    "build": "electron-builder"
  }
}
```

```bash
npm run build       # 生成 dist/Lan Clipboard Setup x.x.x.exe
```

---

## 9. 调试指南

### 9.1 启用主进程日志

在 `index.js` 的 `app.whenReady()` 中添加：

```js
// 打开 Electron 内置 DevTools
mainWindow = new BrowserWindow({ ... })
mainWindow.webContents.openDevTools()
```

### 9.2 查看 WebSocket 流量

```bash
# 用 wscat 模拟服务器来调试客户端
npm install -g wscat
wscat -c ws://localhost:3000/testroom

# 发送测试消息:
{"type":"text","data":"test message","timestamp":1719900000000}
```

### 9.3 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|------|---------|---------|
| 启动无托盘图标 | Electron 未正确初始化 | 检查 `npm start` 输出是否有报错 |
| 一直显示灰色 | 服务器未启动或 IP 错误 | `ping` 服务器 IP，检查防火墙 |
| 能连接但不收发消息 | 房间名不一致 | 检查服务器日志，确认客户端的房间名 |
| 消息重复发送 | 防循环失效 | 检查 `cooldownUntil` 值是否被正确设置 |
| CPU 占用高 | 轮询间隔太短 | 确认 `setInterval` 是 1000ms |
| 剪贴板写入失败 | 权限问题 | Electron 主进程默认有剪贴板权限 |

### 9.4 查看配置文件

```powershell
# PowerShell
Get-Content $env:APPDATA\lan-clipboard-win\lan-clipboard-config.json
```

---

## 10. API 参考

### sync.js

#### `startSync(config, statusCallback)`

启动同步引擎。

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `{ server: string, room: string }` | 服务器 IP 和房间名 |
| `statusCallback` | `(status: StatusString) => void` | 状态变化回调 |

`StatusString` 取值：`'connected'` | `'connecting'` | `'reconnecting'` | `'disconnected'`

---

#### `stopSync()`

停止同步引擎。清理所有定时器、关闭 WebSocket 连接。通常在应用退出前调用。

---

#### `updateConfig(newConfig)`

更新配置并重新连接。

| 参数 | 类型 | 说明 |
|------|------|------|
| `newConfig` | `{ server?: string, room?: string }` | 部分更新，未提供的字段保持原值 |

内部流程：`stopSync()` → 合并配置 → `startSync()`

---

### tray.js

#### `createTray(config, callbacks)`

创建系统托盘。

| 参数 | 类型 | 说明 |
|------|------|------|
| `config` | `{ server: string, room: string }` | 用于显示在菜单中 |
| `callbacks.onShowConfig` | `() => void` | 点击"设置"或双击托盘时触发 |
| `callbacks.onQuit` | `() => void` | 点击"退出"时触发 |

**返回值：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `updateStatus` | `(status: StatusString) => void` | 更新托盘图标和菜单 |

---

> 📋 本文档随代码同步更新，如有改动请同时更新文档。
