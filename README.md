# Lan Clipboard

局域网纯文本剪切板同步工具。支持 macOS / Windows / Android。

## 快速开始

### 1. 启动服务器

```bash
cd shared
npm install
npm start
```

服务器运行在 `http://localhost:3000`。

### 2. 连接客户端

各平台客户端连接 `ws://{服务器IP}:3000/{房间名}`。

| 平台 | 技术栈 | 目录 |
|------|--------|------|
| 服务器 | Node.js (Express + ws) | `shared/` |
| macOS | Swift (SwiftUI) | `desktop-mac/` |
| Windows | Electron | `desktop-win/` |
| Web 界面 | React + Vite | `web-ui/` |
| Android | Kotlin | `android/` |

## 通信协议

所有客户端通过 WebSocket 与服务器通信。消息格式：

```json
{ "type": "text", "data": "内容", "timestamp": 1719900000000 }
```

详见 `shared/protocol.md`。

## 团队文档

详见 `TEAM.md`。
