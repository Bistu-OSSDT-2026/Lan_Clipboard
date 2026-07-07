# Lan Clipboard — 通信协议规范

> **版本**: v1.1  
> **负责人**: A  
> **适用范围**: 服务器(A) + macOS Swift(B) + Windows Electron(C) + Web(D) + Android(E)

---

## 0. 架构说明

服务器是**独立 Node.js 进程**（`shared/server.js`），一直在局域网某台机器上运行。所有客户端都是**纯 WebSocket 客户端**，只需连到服务器即可同步。

```
服务器 (npm start)  ← 独立进程，端口 3000
    ↑       ↑       ↑       ↑
    │       │       │       │
  macOS   Windows  Web   Android
  Swift   Electron React  Kotlin
```

---

## 1. 连接方式

### 1.1 WebSocket 连接

```
ws://{服务器IP}:{端口}/{房间名}
```

| 参数 | 说明 | 示例 |
|------|------|------|
| `服务器IP` | 运行服务器那台电脑的局域网 IP | `192.168.1.5` |
| `端口` | 固定 **3000** | `3000` |
| `房间名` | 所有设备用同一个房间名 | `myroom` |

**完整示例**：`ws://192.168.1.5:3000/myroom`

### 1.2 HTTP API（仅给 Web 界面用，客户端不需要）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/text` | 存储一条文本 |
| `GET` | `/api/texts` | 获取所有历史文本 |

---

## 2. WebSocket 消息格式

所有消息都是 **JSON 字符串**，必须包含 `type` 字段。

### 2.1 文本同步消息

客户端复制文本后发送给 Host，Host 广播给房间内其他客户端。

```json
{
  "type": "text",
  "data": "用户复制或发送的文本内容",
  "timestamp": 1719900000000
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 `"text"` |
| `data` | string | ✅ | 文本内容（UTF-8） |
| `timestamp` | number | ✅ | Unix 毫秒时间戳，用于排序和去重 |

### 2.2 心跳消息（Ping/Pong）

客户端每 30 秒发送一次，保持连接活跃。

```json
{ "type": "ping" }
```

服务端收到后原样返回：

```json
{ "type": "pong" }
```

> 如果客户端 60 秒内没收到任何消息（包括 pong），应视为断线并重连。

---

## 3. HTTP API 详情

### 3.1 存储文本

```
POST /api/text
Content-Type: application/json

{
  "text": "复制的文本内容"
}
```

**响应**：
```json
{
  "success": true,
  "id": 1719900000000,
  "content": "复制的文本内容",
  "timestamp": "2024-07-02T10:00:00.000Z"
}
```

### 3.2 获取历史

```
GET /api/texts
```

**响应**：
```json
{
  "texts": [
    {
      "id": 1719900000000,
      "content": "复制的文本内容",
      "timestamp": "2024-07-02T10:00:00.000Z"
    }
  ]
}
```

按时间倒序排列（最新的在前）。

---

## 4. 服务端行为规范

### 4.1 消息路由

```
客户端A发来消息
  │
  ▼
Host 服务器
  │
  ├── 存储文本到本地 JSON 文件
  │
  └── 广播给同房间的所有其他客户端（不发给发送者自己）
        │
        ├── 客户端B 收到 → 写入剪贴板
        ├── 客户端C 收到 → 写入剪贴板
        └── ...
```

### 4.2 房间隔离

不同房间名的客户端**完全隔离**，互不干扰。`ws://ip:3000/roomA` 的消息不会发到 `ws://ip:3000/roomB`。

---

## 5. 错误处理

### 5.1 连接断开

客户端检测到 WebSocket 断开后，**5 秒后自动重连**。重连机制：
1. 第一次断开 → 等 5 秒 → 重连
2. 重连失败 → 再等 5 秒 → 重连
3. 一直循环

### 5.2 消息格式错误

如果收到无法解析的 JSON 或缺少 `type` 字段，**静默忽略**，不崩溃，不回复错误。

---

## 6. 扩展预留

后续可能增加的消息类型（**本期不做**）：

```json
{ "type": "file",  "data": { "name": "a.png", "url": "http://..." } }
{ "type": "image", "data": "base64..." }
```

`type` 字段设计为字符串就是为了方便扩展。如果收到不认识的 `type`，**静默忽略**即可。

---

## 7. 快速自测

用浏览器控制台即可测试协议：

```javascript
// 1. 连接
const ws = new WebSocket('ws://localhost:3000/testroom');

// 2. 发消息
ws.send(JSON.stringify({ type: 'text', data: 'Hello', timestamp: Date.now() }));

// 3. 收消息
ws.onmessage = (e) => console.log('收到:', JSON.parse(e.data));

// 4. 心跳
setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 30000);
```
