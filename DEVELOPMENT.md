# Lan Clipboard — 开发文档

> 面向所有开发者的技术参考文档。包含环境搭建、项目启动、调试方法和常见问题。

---

## 目录

1. [项目总览](#1-项目总览)
2. [环境要求](#2-环境要求)
3. [项目结构](#3-项目结构)
4. [各模块启动指南](#4-各模块启动指南)
5. [通信协议速查](#5-通信协议速查)
6. [开发工作流](#6-开发工作流)
7. [调试技巧](#7-调试技巧)
8. [常见问题](#8-常见问题)

---

## 1. 项目总览

Lan Clipboard 是一个**局域网纯文本剪贴板同步工具**。

- **一台电脑运行独立服务器**，所有设备作为客户端连接
- 你在任意设备上 Ctrl+C 复制文本 → 服务器广播 → 同房间所有设备自动同步到剪贴板

```
┌──────────────────────────────────────────┐
│           shared/server.js                │
│       独立 Node.js 服务器（端口 3000）      │
│      Express(HTTP) + WebSocket            │
└────┬───────┬───────┬───────┬─────────────┘
     │       │       │       │
┌────▼──┐ ┌─▼───┐ ┌─▼───┐ ┌─▼──────┐
│macOS  │ │Win  │ │Web  │ │Android │
│Swift  │ │Elect│ │React│ │Kotlin  │
│(B)    │ │(C)  │ │(D)  │ │(E)     │
└───────┘ └─────┘ └─────┘ └────────┘
```

| 代号 | 负责 | 技术栈 |
|------|------|--------|
| A | 服务器 + 协议 | Node.js (Express + ws) |
| B | macOS 客户端 | Swift (SwiftUI + Network) |
| C | Windows 客户端 | Electron + ws |
| D | Web 管理界面 | React 18 + Vite 5 |
| E | Android 客户端 | Kotlin (OkHttp) |

---

## 2. 环境要求

| 模块 | 必需工具 | 版本要求 |
|------|---------|---------|
| 全部 | Git | 2.x+ |
| A / C / D | Node.js | 18+ (推荐 20 LTS) |
| A / C / D | npm | 9+ (随 Node.js 安装) |
| B | Xcode | 14+ (macOS 12+) |
| E | Android Studio | Hedgehog+ |

### 2.1 安装 Node.js

**Windows:**
```powershell
winget install OpenJS.NodeJS.LTS
```

**macOS:**
```bash
brew install node@20
```

**Linux:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2.2 克隆仓库

```bash
git clone https://github.com/Bistu-OSSDT-2026/Lan_Clipboard.git
cd Lan_Clipboard
```

---

## 3. 项目结构

```
Lan_clipboard/
├── shared/                          # A：服务器 + 协议
│   ├── protocol.md                  # 通信协议（所有人必读）
│   ├── server.js                    # 独立 Node.js 服务器
│   ├── package.json                 # 服务器依赖
│   └── swift-guide.md               # Swift 开发指南（给 B）
│
├── desktop-win/                     # C：Electron Windows 客户端
│   ├── package.json                 # 依赖: electron + ws
│   ├── index.js                     # Electron 主进程（生命周期 + 配置）
│   ├── sync.js                      # 剪贴板同步引擎（WebSocket + 轮询）
│   └── tray.js                      # 系统托盘（图标 + 菜单）
│
├── desktop-mac/                     # B：Swift 原生 macOS 客户端
│   └── ...                          # Xcode 项目文件
│
├── web-ui/                          # D：React Web 管理界面
│   ├── package.json                 # 依赖: react + vite
│   ├── vite.config.js               # Vite 构建配置
│   ├── index.html                   # HTML 入口
│   └── src/
│       ├── main.jsx                 # React 入口
│       ├── App.jsx                  # 主组件（连接/历史/发送）
│       └── index.css                # 全局样式
│
├── android/                         # E：Kotlin Android 客户端
│   └── ...                          # Gradle 项目文件
│
├── .github/workflows/               # CI/CD 配置
├── TEAM.md                          # 团队分工
└── README.md                        # 项目说明
```

---

## 4. 各模块启动指南

### 4.1 服务器（A）

**第一步：安装依赖**
```bash
cd shared
npm install
```

**第二步：启动**
```bash
npm start
# 或: node server.js
```

**预期输出：**
```
Lan Clipboard Server 已启动
HTTP API:  http://192.168.1.5:3000
WebSocket: ws://192.168.1.5:3000
数据目录:  ./data
```

**验证：** 打开浏览器访问 `http://localhost:3000/api/texts`，应返回 `{"texts":[]}`。

> ⚠️ 服务器必须在局域网内运行，且防火墙允许 3000 端口。

---

### 4.2 Windows 客户端（C）

**第一步：安装依赖**
```bash
cd desktop-win
npm install
```

**第二步：启动**
```bash
npm start
# 或: npx electron .
```

**预期行为：**
1. 系统托盘出现灰色圆点图标
2. 弹出设置窗口，输入服务器 IP 和房间名
3. 点击保存后开始连接，图标变黄色 → 绿色
4. 在任意应用复制文本，自动同步到同房间其他设备

**托盘图标含义：**
| 颜色 | 状态 |
|------|------|
| 🟢 绿色 | 已连接 |
| 🟡 黄色 | 连接中 / 重连中 |
| ⚪ 灰色 | 未连接 |

**命令行参数（可选）：**
```bash
# 开发模式（不隐藏窗口）
npm run dev
```

---

### 4.3 Web 管理界面（D）

**第一步：安装依赖**
```bash
cd web-ui
npm install
```

**第二步：启动开发服务器**
```bash
npm run dev
```

**预期输出：**
```
VITE v5.x  ready in xxx ms
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.x:5173/
```

**第三步：** 浏览器打开 `http://localhost:5173`，输入服务器 IP 和房间名，点击"连接"。

**构建生产版本：**
```bash
npm run build        # 输出到 dist/
npm run preview      # 预览构建结果
```

---

### 4.4 macOS 客户端（B）

> 需要 macOS + Xcode 14+

1. 用 Xcode 打开 `desktop-mac/LanClipboard.xcodeproj`
2. 选择 `Product → Run`（⌘R）
3. 菜单栏出现应用图标

---

### 4.5 Android 客户端（E）

> 需要 Android Studio

1. 用 Android Studio 打开 `android/` 目录
2. 等待 Gradle 同步完成
3. 连接设备或启动模拟器，点击 Run

---

## 5. 通信协议速查

### 5.1 WebSocket 连接

```
ws://{服务器IP}:3000/{房间名}
```

示例：`ws://192.168.1.5:3000/myroom`

### 5.2 消息格式

**发送文本：**
```json
{ "type": "text", "data": "复制的文本", "timestamp": 1719900000000 }
```

**心跳：**
```json
{ "type": "ping" }
```
服务器回复 `{"type":"pong"}`。

### 5.3 HTTP API

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| `GET` | `/api/texts` | 获取历史文本 | — |
| `POST` | `/api/text` | 存储文本 | `{"text":"..."}` |

### 5.4 客户端行为规范

| # | 行为 | 规范 |
|---|------|------|
| 1 | 连接 | `ws://{host}:3000/{房间名}` |
| 2 | 心跳 | 每 30 秒发送 `{"type":"ping"}` |
| 3 | 发送 | 检测剪贴板变化 → WebSocket 发出 |
| 4 | 接收 | 收到 `text` → 写入系统剪贴板 |
| 5 | 防循环 | 收到消息后 3 秒内不上传 |
| 6 | 重连 | 断线 5 秒后自动重试 |

---

## 6. 开发工作流

### 6.1 推荐开发顺序

```
Phase 1: A 先写好服务器 + 协议（shared/）
Phase 2: C/D 并行开发 Windows 客户端和 Web 界面
Phase 3: B/E 并行开发 macOS 和 Android 客户端
Phase 4: 全员联调
```

### 6.2 自测方法

**服务器自测（A）：**
```bash
# 终端 1: 启动服务器
cd shared && npm start

# 终端 2: 用 wscat 模拟客户端
npm install -g wscat
wscat -c ws://localhost:3000/testroom
# 输入: {"type":"text","data":"hello","timestamp":1719900000000}

# 终端 3: 另一个客户端验证收到消息
wscat -c ws://localhost:3000/testroom
```

**Windows 客户端自测（C）：**
1. 先确保 A 的服务器在运行
2. 启动 `desktop-win`，填入 `127.0.0.1` + `testroom`
3. 复制一段文字，观察服务器日志是否有消息转发
4. 用 wscat 向同房间发消息，观察 Windows 剪贴板是否更新

**Web 界面自测（D）：**
1. 先确保 A 的服务器在运行
2. 启动 `web-ui`（`npm run dev`）
3. 浏览器打开 `http://localhost:5173`
4. 接入服务器，测试发送/接收/历史列表

### 6.3 联调清单

- [ ] 所有客户端能连上服务器
- [ ] A 复制 → B/C/D/E 收到
- [ ] B 复制 → A/C/D/E 收到
- [ ] 任意客户端断网 → 自动重连
- [ ] 防循环：复制不会反弹
- [ ] 不同房间互不干扰

---

## 7. 调试技巧

### 7.1 查看 WebSocket 流量

**Chrome DevTools**（Web UI）：
1. F12 打开开发者工具
2. Network → WS 标签页
3. 可以看到每条收发的消息

**wscat 命令行**：
```bash
wscat -c ws://192.168.1.5:3000/myroom
```

### 7.2 Electron 调试

**打开 DevTools：**
在 `index.js` 中添加：
```js
mainWindow.webContents.openDevTools()
```

**查看主进程日志：**
Windows 上 Electron 日志在：
```
%APPDATA%/lan-clipboard-win/
```

### 7.3 常见调试场景

| 问题 | 排查步骤 |
|------|---------|
| 连不上服务器 | ① ping 服务器 IP ② 检查防火墙 ③ 确认端口 3000 |
| 收到消息但剪贴板不更新 | 检查 sync.js 中 `cooldownUntil` 逻辑 |
| 剪贴板变化不发送 | 检查轮询间隔和 `lastText` 比较 |
| 消息重复 | 检查服务端广播逻辑：不要发回发送者 |

---

## 8. 常见问题

### Q1: 服务器启动报错 `EADDRINUSE`

端口 3000 被占用。换端口或关闭占用进程：
```bash
# Windows 查看占用
netstat -ano | findstr :3000

# macOS/Linux
lsof -i :3000
```

### Q2: 客户端连不上服务器

1. 确认服务器和客户端在同一局域网
2. 检查 Windows 防火墙是否允许 Node.js
3. 尝试 `ping 服务器IP` 确认网络通

### Q3: npm install 失败

```bash
# 清除缓存重试
npm cache clean --force
npm install

# 或使用淘宝镜像
npm install --registry=https://registry.npmmirror.com
```

### Q4: Electron 启动白屏/报错

```bash
# 重新安装 electron
cd desktop-win
rm -rf node_modules package-lock.json
npm install
```

### Q5: 如何更换服务器端口

编辑 `shared/server.js` 中的 `PORT` 变量，同时更新所有客户端的连接 URL。

### Q6: 如何贡献代码

1. 从 `main` 分支创建 feature 分支
2. 修改代码，确保通过自测
3. 提交 PR，在描述中说明改动内容
4. 至少一人 Review 后合并

---

> 📋 有问题先查本文档，再查 TEAM.md，最后在群里问 A（总指挥）。
