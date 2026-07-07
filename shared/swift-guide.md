# macOS Swift 客户端 — 开发指引

> **负责人**: B  
> **技术栈**: Swift + SwiftUI + URLSessionWebSocketTask  
> **最低系统**: macOS 12 (Monterey)

---

## 一、创建项目

1. 打开 Xcode → File → New → Project
2. 选 **macOS** → **App**
3. Interface: **SwiftUI**
4. Language: **Swift**
5. 项目名: `LanClipboard`
6. 保存到仓库的 `desktop-mac/` 目录

---

## 二、你需要写的 5 个文件

```
LanClipboard/
├── App.swift               ← 应用入口，管理生命周期
├── MenuBar.swift           ← 菜单栏图标（不是 Dock 图标，是顶部菜单栏）
├── WebSocketManager.swift  ← WebSocket 连接、重连、心跳
├── ClipboardMonitor.swift  ← 剪贴板轮询
└── SyncEngine.swift        ← 协调层：监控→发送，接收→写入，防循环
```

---

## 三、核心代码参考

### 3.1 App.swift — 入口

```swift
import SwiftUI

@main
struct LanClipboardApp: App {
    @StateObject private var syncEngine = SyncEngine()

    var body: some Scene {
        MenuBarExtra("LanClipboard", systemImage: "doc.on.clipboard") {
            // 菜单栏内容
            Text("状态: \(syncEngine.isConnected ? "已连接" : "未连接")")
            Divider()
            Button("退出") { NSApplication.shared.terminate(nil) }
        }
    }
}
```

> 用 `MenuBarExtra` 可以直接做菜单栏应用（macOS 13+），低版本用 `NSStatusBar`。

### 3.2 WebSocketManager.swift — 连接管理

```swift
import Foundation

class WebSocketManager: ObservableObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    var onReceive: ((String) -> Void)?

    @Published var isConnected = false

    func connect(host: String, port: Int = 3000, room: String) {
        let url = URL(string: "ws://\(host):\(port)/\(room)")!
        task = session.webSocketTask(with: url)
        task?.resume()
        isConnected = true
        receiveMessage()
        startHeartbeat()
    }

    func send(text: String) {
        task?.send(.string(text)) { error in
            if let error = error { print("发送失败: \(error)") }
        }
    }

    private func receiveMessage() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self?.onReceive?(text)
                }
                self?.receiveMessage()  // 继续接收下一条
            case .failure(let error):
                print("接收失败: \(error)")
                self?.isConnected = false
                self?.reconnect()
            }
        }
    }

    private func startHeartbeat() {
        // 每30秒发 ping
        Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.send(text: #"{"type":"ping"}"#)
        }
    }

    private func reconnect() {
        // 5秒后重连
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            // 重新 connect...（需要保存 host/port/room）
        }
    }
}
```

### 3.3 ClipboardMonitor.swift — 剪贴板轮询

```swift
import AppKit

class ClipboardMonitor: ObservableObject {
    private var lastContent: String = ""
    private var timer: Timer?
    var onChange: ((String) -> Void)?

    // 冷却期：收到同步后 3 秒内不上传
    private var cooldownUntil: Date = .distantPast

    func start() {
        lastContent = NSPasteboard.general.string(forType: .string) ?? ""
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.check()
        }
    }

    func stop() { timer?.invalidate() }

    func setCooldown(seconds: Double) {
        cooldownUntil = Date().addingTimeInterval(seconds)
    }

    private func check() {
        // 冷却期内跳过
        guard Date() > cooldownUntil else { return }

        let current = NSPasteboard.general.string(forType: .string) ?? ""
        if current != lastContent && !current.isEmpty {
            lastContent = current
            onChange?(current)
        }
    }
}
```

### 3.4 SyncEngine.swift — 协调层

```swift
import AppKit

class SyncEngine: ObservableObject {
    private let ws = WebSocketManager()
    private let monitor = ClipboardMonitor()

    @Published var isConnected = false

    init() {
        // 收到服务器消息 → 写入剪贴板 + 启动冷却
        ws.onReceive = { [weak self] msg in
            guard let data = msg.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String
            else { return }

            if type == "text", let text = json["data"] as? String {
                // 写入系统剪贴板
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)

                // 3秒冷却，防止循环
                self?.monitor.setCooldown(seconds: 3)
            }
        }

        // 剪贴板变化 → 发给服务器
        monitor.onChange = { [weak self] text in
            let timestamp = Int(Date().timeIntervalSince1970 * 1000)
            let msg = """
            {"type":"text","data":"\(text.replacingOccurrences(of: "\"", with: "\\\""))","timestamp":\(timestamp)}
            """
            self?.ws.send(text: msg)
        }

        // 同步连接状态
        ws.$isConnected.assign(to: &$isConnected)
    }

    func connect(host: String, room: String) {
        ws.connect(host: host, room: room)
        monitor.start()
    }

    func disconnect() {
        monitor.stop()
    }
}
```

### 3.5 写入剪贴板的正确姿势

```swift
import AppKit

func writeToClipboard(_ text: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
}
```

---

## 四、开发顺序

| 步骤 | 做什么 | 验证方法 |
|------|--------|---------|
| 1 | 创建 Xcode 项目，跑起空白 SwiftUI 窗口 | 能看到窗口 |
| 2 | 写 WebSocketManager，连 A 的服务器 | 控制台打印 "已连接" |
| 3 | 写 ClipboardMonitor，每秒打印剪贴板内容 | 复制文字后控制台有输出 |
| 4 | 连起来：剪贴板变化 → WebSocket 发出 | A 的服务器日志能看到收到的消息 |
| 5 | 收到消息 → 写入剪贴板 | 另一台设备发消息，Mac 自动粘贴 |
| 6 | 加冷却期 | 不会循环同步 |
| 7 | 菜单栏图标 + 状态 | 顶部菜单栏有图标 |

---

## 五、测试方法

1. A 启动服务器：`cd shared && npm start`
2. 你跑 Xcode 项目，连接 `ws://localhost:3000/test`
3. 用浏览器控制台模拟另一台设备：`ws = new WebSocket('ws://localhost:3000/test')`
4. 浏览器发消息 → Swift 应该写入剪贴板
5. Swift 复制文本 → 浏览器应该收到消息

---

## 六、常见问题

**Q: `NSPasteboard` 读不到内容？**
A: 确保在 `Info.plist` 中没有 Sandbox 限制，或者关闭 App Sandbox。

**Q: WebSocket 连不上？**
A: 检查 App Transport Security 设置。在 `Info.plist` 中添加：
```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
</dict>
```

**Q: 菜单栏应用怎么做？**
A: macOS 13+ 用 `MenuBarExtra`；macOS 12 用 `NSStatusBar` + `NSStatusItem`。

---

**有问题随时在群里问！🚀**
