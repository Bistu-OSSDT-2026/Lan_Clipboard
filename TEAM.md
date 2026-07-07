# Lan Clipboard — 团队开发文档

> 请每个人先通读本文档，了解项目全貌和自己的分工，再开始写代码。

---

## 一、项目是什么

一个局域网内的**纯文本剪切板同步工具**。

**架构：一台电脑运行独立服务器，所有设备作为客户端连上去。**

```
你在这台电脑按 Ctrl+C → 发给服务器 → 服务器广播 → 其他设备自动粘贴
```

```
┌──────────────────────────────────────────────┐
│             shared/server.js                  │
│         独立 Node.js 服务器（端口3000）         │
│        Express(HTTP) + WebSocket              │
│        只需一台电脑运行，24小时开着即可           │
└──────┬───────┬───────┬───────┬──────────────┘
       │       │       │       │
  ┌────▼──┐ ┌─▼───┐ ┌─▼───┐ ┌─▼──────┐
  │macOS  │ │Win  │ │Web  │ │Android │
  │Swift  │ │Elect│ │React│ │Kotlin  │
  │(B)    │ │(C)  │ │(D)  │ │(E)     │
  └───────┘ └─────┘ └─────┘ └────────┘
   纯客户端   纯客户端  纯客户端   纯客户端
```

支持三个平台：**macOS / Windows / Android** + **Web 管理页面**。

---

## 二、统一接口（所有人必须遵守）

### WebSocket 消息（唯一通信方式）

所有客户端和服务器之间**只通过 WebSocket 通信**。

**客户端 → 服务器：**
```json
{ "type": "text", "data": "复制的文本内容", "timestamp": 1719900000000 }
{ "type": "ping" }
```

**服务器 → 客户端：**
```json
{ "type": "text", "data": "其他设备发来的文本", "timestamp": 1719900000000 }
{ "type": "pong" }
```

### 每个客户端必须实现的 6 条标准行为

| # | 行为 | 规范 |
|---|------|------|
| 1 | **连接** | `ws://{host}:3000/{房间名}` |
| 2 | **心跳** | 每 30 秒发 `{"type":"ping"}` |
| 3 | **发送文本** | 检测到剪贴板变化 → 立即 WebSocket 发出 |
| 4 | **接收文本** | 收到 `{"type":"text"}` → 写入系统剪贴板 |
| 5 | **防循环** | 收到消息后 3 秒内不触发上传 |
| 6 | **重连** | 断线 5 秒后自动重试 |

> 详细协议见 `shared/protocol.md`，**所有人必须先读这个文件再写代码！**

---

## 三、人员分工

| 代号 | 负责 | 技术栈 | 你的代码在哪 |
|------|------|--------|-------------|
| **A** | 独立服务器 + 协议 + CI + 联调总指挥 | Node.js (Express + ws) | `shared/` |
| **B** | macOS 原生客户端 | **Swift** (SwiftUI + Network.framework) | `desktop-mac/` |
| **C** | Windows 桌面客户端 | Electron + Node.js | `desktop-win/` |
| **D** | Web 管理界面 | React + Vite | `web-ui/` |
| **E** | Android 客户端 | Kotlin (OkHttp) | `android/` |

> ⚠️ **B 是 Swift 原生，C 是 Electron，代码完全独立，不能互相复用。**

---

## 四、仓库结构

```
lan-clipboard/
├── shared/                         ← A：服务器 + 协议
│   ├── protocol.md                 ← 通信协议（所有人必读）
│   ├── server.js                   ← 独立 Node.js 服务器（npm start 启动）
│   └── package.json                ← 服务器依赖
├── desktop-mac/                    ← B：Swift 原生 macOS 客户端
│   ├── LanClipboard.xcodeproj/
│   └── LanClipboard/
│       ├── App.swift               ← SwiftUI App 入口
│       ├── WebSocketManager.swift  ← WebSocket 连接管理
│       ├── ClipboardMonitor.swift  ← 剪贴板监听
│       ├── SyncEngine.swift        ← 同步逻辑 + 防循环
│       └── MenuBar.swift           ← 菜单栏图标
├── desktop-win/                    ← C：Electron Windows 客户端
│   ├── package.json
│   ├── index.js                    ← Electron 主进程
│   ├── sync.js                     ← 轮询 + 同步逻辑
│   └── tray.js                     ← 系统托盘
├── web-ui/                         ← D：React Web 界面
│   └── src/
│       └── App.jsx
├── android/                        ← E：Kotlin Android 客户端
│   └── app/.../MainActivity.kt ...
└── .github/workflows/              ← A：CI/CD
```

---

## 五、各角色详细任务

### A — 独立服务器 + 项目管理

**关键文件**：`shared/server.js`、`shared/protocol.md`、`shared/package.json`

**服务器如何启动**（独立进程，不属于任何客户端）：
```bash
cd shared
npm install
npm start        # 启动在 3000 端口
```

**服务器提供的能力**：
| 功能 | 实现 |
|------|------|
| WebSocket 房间管理 | `ws://ip:3000/{房间名}`，同房间互发 |
| 文本广播 | 收到一条 → 存 JSON + 广播给同房间其他人 |
| 心跳响应 | 收到 ping → 回复 pong |
| 历史查询 | `GET /api/texts`（给 Web 界面用） |
| 存文本 | `POST /api/text` |

**A 的任务清单**：
1. 建 GitHub 仓库，把 `shared/` 放进去
2. 写 `shared/package.json`（express + ws）
3. 完善 `shared/server.js`（骨架已有）
4. 自测：两个浏览器标签页互发消息
5. 配置 GitHub Actions
6. Phase 7 组织全员联调

---

### B — macOS 原生客户端（Swift）

**关键文件**：`desktop-mac/LanClipboard/` 下的 Swift 文件

**创建 Xcode 项目**：macOS → App（SwiftUI），最低系统 macOS 12

**核心模块**：

| 文件 | 做什么 |
|------|--------|
| `App.swift` | @main 入口，应用生命周期 |
| `MenuBar.swift` | 菜单栏图标（NSStatusBar） |
| `WebSocketManager.swift` | WebSocket 连接/重连/心跳 |
| `ClipboardMonitor.swift` | 剪贴板轮询（NSPasteboard） |
| `SyncEngine.swift` | 协调：检测变化→发送，收到消息→写入 |

**Swift 剪贴板读写**：
```swift
import AppKit

// 读取
let text = NSPasteboard.general.string(forType: .string)

// 写入
NSPasteboard.general.clearContents()
NSPasteboard.general.setString("内容", forType: .string)
```

**Swift WebSocket**（macOS 自带 URLSessionWebSocketTask）：
```swift
let url = URL(string: "ws://192.168.1.5:3000/myroom")!
let task = URLSession.shared.webSocketTask(with: url)
task.resume()

// 发送
let msg = "{\"type\":\"text\",\"data\":\"hello\",\"timestamp\":\(Date().timeIntervalSince1970 * 1000)}"
task.send(.string(msg)) { _ in }

// 接收（循环接收）
func receiveMessage() {
    task.receive { result in
        switch result {
        case .success(let message):
            if case .string(let text) = message {
                // 处理收到的 JSON
            }
            self.receiveMessage() // 继续接收
        case .failure(let error):
            // 处理错误
        }
    }
}
```

> 也可用 [Starscream](https://github.com/daltoniam/Starscream) 库（第三方，API 更友好）。

**B 的 7 步计划**：

| # | 做什么 |
|---|--------|
| 1 | 创建 Xcode 项目，跑起空白 SwiftUI 窗口 |
| 2 | WebSocket 连接 A 的服务器，能收发消息 |
| 3 | 剪贴板轮询：Timer 每 1 秒读 NSPasteboard |
| 4 | 检测到变化 → WebSocket 发出 |
| 5 | 收到 WebSocket 消息 → NSPasteboard 写入 |
| 6 | 防循环：收到消息后 3 秒冷却 |
| 7 | 菜单栏图标 + 状态显示 |

---

### C — Windows 桌面客户端（Electron）

**关键文件**：`desktop-win/index.js`、`desktop-win/sync.js`、`desktop-win/tray.js`

**和之前计划一样，但现在注意**：
- 你是纯客户端，**不需要嵌入服务器**
- 只需连 A 的服务器 `ws://{server_ip}:3000/{room}`
- 不需要 Host/Client 模式切换

**C 的 6 步计划**：

| # | 做什么 | 参考 |
|---|--------|------|
| 1 | `npm init` + 装 electron、ws → 空白窗口 | — |
| 2 | WebSocket 连 A 的服务器，能收发消息 | `mini_save/onCopy.js` initClientWss |
| 3 | 剪贴板轮询：每秒 `clipboard.readText()` | `mini_save/onCopy.js` while+sleep |
| 4 | 检测到变化 → WebSocket 发出 | `mini_save/onCopy.js` socket.send |
| 5 | 收到消息 → `clipboard.writeText()` | `mini_save/onCopy.js` onMessage |
| 6 | 防循环 + 托盘 + 重连 | `mini_save/onCopy.js` 全部逻辑 |

> 💡 你仍然可以参考 `mini_save` 的 `onCopy.js`，只删掉 Host 模式相关代码。

---

### D — Web 管理界面（React）

**关键文件**：`web-ui/src/App.jsx`

**你要写的是一个纯前端页面，不做 Electron，在浏览器里就能跑。**

**技术栈**：React + Vite

**D 的 5 步计划**：

| # | 做什么 | 具体内容 |
|---|--------|---------|
| 1 | 搭建项目 | `npm create vite@latest web-ui -- --template react`，跑起空白页面 |
| 2 | 连接服务器 | 页面上方一个输入框（填服务器 IP + 房间名）+ 连接按钮，建立 `new WebSocket('ws://{ip}:3000/{room}')`，连接成功后显示"已连接" |
| 3 | 历史列表 | 页面加载时 `fetch('http://{ip}:3000/api/texts')` 获取历史，显示为列表（每条显示时间 + 内容摘要）。WebSocket 收到新消息时自动刷新列表 |
| 4 | 手动发送 | 底部一个 textarea + 发送按钮。点击发送 → `POST /api/text` → 同时 WebSocket 发 `{"type":"text",...}` |
| 5 | 点击复制 | 每条历史内容旁边一个"复制"按钮，点击 → `navigator.clipboard.writeText()` 写入浏览器剪贴板 |

**页面布局参考**：

```
┌─────────────────────────────────┐
│  🔗 服务器: [192.168.1.5] 房间: [myroom] [连接]  │
│  ● 已连接                         │
├─────────────────────────────────┤
│  历史记录                         │
│  ┌─────────────────────────────┐ │
│  │ 15:30  你好，这是测试文本     [复制] │
│  │ 15:28  Hello World          [复制] │
│  │ 15:25  会议链接：https://... [复制] │
│  └─────────────────────────────┘ │
├─────────────────────────────────┤
│  [输入文本...              ] [发送] │
└─────────────────────────────────┘
```

**参考代码**：`mini_save/client/src/`（Login.jsx → 连接页、ContentSection.jsx → 列表、InputSection.jsx → 输入框、helpers.js → 复制函数）

**启动方式**：
```bash
cd web-ui
npm install
npm run dev       # Vite 开发服务器，默认 http://localhost:5173
```

**你的工作不需要等其他人的代码**。只要 A 的服务器跑起来了，你就能用 API 测试。写 UI 阶段甚至不需要服务器——先用假数据把界面写出来就行。

---

### E — Android 客户端（Kotlin）

**关键文件**：`android/app/src/main/java/com/lanclipboard/` 下的 Kotlin 文件

**你要写一个 Android 原生 App**，实现剪切板实时同步。

**技术栈**：Kotlin + Jetpack Compose + OkHttp WebSocket

**核心依赖**（`build.gradle.kts`）：
```kotlin
implementation("com.squareup.okhttp3:okhttp:4.12.0")
implementation("androidx.compose.material3:material3")  // UI
```

**AndroidManifest 必需权限**：
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

**核心模块**：

| 文件 | 做什么 |
|------|--------|
| `MainActivity.kt` | 应用入口，启动前台 Service |
| `MainScreen.kt` | Compose UI：输入服务器 IP + 连接按钮 + 状态显示 |
| `WebSocketManager.kt` | OkHttp WebSocket 连接/重连/心跳 |
| `ClipboardService.kt` | 前台 Service：后台运行 + 通知栏状态 + 剪贴板监听 |

**E 的 6 步计划**：

| # | 做什么 | 具体内容 |
|---|--------|---------|
| 1 | 创建项目 | Android Studio → New Project → Empty Activity (Compose)，跑起空白页面 |
| 2 | WebSocket 连接 | 用 OkHttp 连 `ws://{ip}:3000/{room}`，连接成功后在屏幕上显示"已连接" |
| 3 | 接收消息 → 写入剪贴板 | `ws.onMessage` 回调中解析 JSON → `ClipboardManager.setPrimaryClip()` 写入系统剪贴板 |
| 4 | 监听剪贴板 → 发送 | `ClipboardManager.OnPrimaryClipChangedListener` 监听变化 → WebSocket 发出 `{"type":"text",...}` |
| 5 | 防循环 | 收到 WebSocket 消息后记录时间戳，3 秒内 `OnPrimaryClipChangedListener` 触发时不上传 |
| 6 | 前台 Service + 通知栏 | 创建一个前台 Service（不会被系统杀掉），通知栏显示"已连接 192.168.x.x"或"已断开"。断线 5 秒后自动重连 |

**OkHttp WebSocket 关键代码**：
```kotlin
val client = OkHttpClient()
val request = Request.Builder().url("ws://192.168.1.5:3000/myroom").build()
val ws = client.newWebSocket(request, object : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) {
        // 解析 JSON: {"type":"text","data":"..."}
        // 写入剪贴板 + 设置冷却期
    }
    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        // 5秒后重连
    }
})

// 发送
ws.send("""{"type":"text","data":"hello","timestamp":${System.currentTimeMillis()}}""")
```

**剪贴板读写**：
```kotlin
val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

// 读取
val text = clipboard.primaryClip?.getItemAt(0)?.text?.toString()

// 写入
clipboard.setPrimaryClip(ClipData.newPlainText("lan-clipboard", "内容"))

// 监听
clipboard.addPrimaryClipChangedListener {
    // 检查冷却期 → WebSocket 发出
}
```

**前台 Service 要点**：
- Android 10+ 需要 `FOREGROUND_SERVICE_DATA_SYNC` 类型
- 创建通知渠道，通知内容显示连接状态
- App 启动时自动开启 Service，退出时停止

**测试方法**：
- 模拟器连电脑：用 `10.0.2.2:3000` 代替电脑 IP
- 真机连电脑：用电脑的局域网 IP（如 `192.168.1.5`）
- 先确保 A 的服务器在电脑上跑起来了

**你需要在 A 的服务器完成后才能开始核心开发**，但可以先写 UI 和 OkHttp 连接的骨架。

---

## 六、开发流程与依赖

```
Phase 1 (全员并行, 1-2天)
  └→ 各自搭建项目环境，跑起空白应用

Phase 2 (A 主攻, 2-3天) ← 关键路径！
  └→ A 交付可用的 shared/server.js
       │
       ├── B 开始 Phase 3 (macOS Swift, 5-7天)
       ├── C 开始 Phase 4 (Windows Electron, 3-4天)
       └── E 开始 Phase 5 (Android, 5-7天)

Phase 6 (D 主攻, 随时可做, 3-4天)
  └→ Web 界面

Phase 7 (全员, 2-3天)
  └→ 联调测试 + 修 bug + 文档
```

**依赖关系**：
- B、C、E 都等 A 的服务器完成（Phase 2）才能开始核心开发
- B 和 C 各自独立，互不依赖
- D 随时可以做（不需要等服务器完成就可以写 UI）

---

## 七、本地测试方法

### A 启动服务器
```bash
cd shared
npm install
npm start
# 输出: Server running on http://localhost:3000
```

### 快速验证服务器（用浏览器控制台即可）
```javascript
// 电脑A：F12 打开控制台
ws1 = new WebSocket('ws://localhost:3000/test')
ws1.onmessage = e => console.log('收到:', e.data)

// 另一台电脑B：同样开控制台，连同一台服务器
ws2 = new WebSocket('ws://192.168.1.5:3000/test')
ws2.send(JSON.stringify({type:'text', data:'你好B', timestamp:Date.now()}))
// 电脑A 控制台会打印: 收到: {"type":"text","data":"你好B",...}
```

### B 测试 Swift
启动 A 的服务器后，跑 Swift 应用，连 `ws://localhost:3000/test`。

### C 测试 Electron
```bash
cd desktop-win
npm install
npm run dev       # 需要在 package.json 配 "dev": "electron ."
```

### E 测试 Android
模拟器 → 连电脑用 `10.0.2.2:3000`；真机 → 连电脑的局域网 IP。

---

## 八、Git 协作规范

1. **每人一个分支**：`dev-mac`(B)、`dev-win`(C)、`dev-web`(D)、`dev-android`(E)
2. 提交信息用中文：`feat: 完成剪贴板读取`
3. 不要直接推 main
4. 每天至少 push 一次
5. A 负责 review 所有人 PR 并合并到 main
6. 遇到问题在 GitHub Issues 里提，标题标平台：`[Mac] xxx`、`[Win] xxx`

---

## 九、统一接口速查卡

```
┌────────────────────────────────────────────┐
│          客户端标准行为（所有端）              │
├────────────────────────────────────────────┤
│                                            │
│  1. 连接 ws://{server}:3000/{room}         │
│  2. 每30秒发 ping                          │
│  3. 剪贴板变了 → 发 {type:"text",...}       │
│  4. 收到 {type:"text"} → 写入剪贴板         │
│  5. 收到消息后 3秒冷却                      │
│  6. 断线5秒后重连                           │
│                                            │
└────────────────────────────────────────────┘
```

> 每个端只需实现这 6 条。协议细节见 `shared/protocol.md`。

---

## 十、有问题找谁

| 问题类型 | 找谁 |
|---------|------|
| 服务器连不上 / 协议不清楚 | A |
| macOS Swift / WebSocket | B |
| Windows Electron / 剪贴板 | C |
| React / Web 界面 | D |
| Android / Kotlin | E |
| Git 操作 | A |

> B 的参考：`shared/swift-guide.md`（Swift 开发指引）+ [NSURLSessionWebSocket](https://developer.apple.com/documentation/foundation/urlsessionwebsockettask)  
> C 的参考：`mini_save/onCopy.js`（只看 Client 部分）  
> E 的参考：[OkHttp WebSocket](https://square.github.io/okhttp/3.x/okhttp/okhttp3/WebSocket.html)

---

**祝顺利！🚀**
