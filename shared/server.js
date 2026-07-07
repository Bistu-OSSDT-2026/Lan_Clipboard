/**
 * Lan Clipboard — 独立服务器
 * 
 * 这是整个系统的中心节点，作为独立 Node.js 进程运行。
 * 所有客户端（macOS Swift / Windows Electron / Android / Web）都通过 WebSocket 连接。
 *
 * 启动方式：
 *   cd shared && npm start
 *   或: node server.js
 *
 * 职责：
 * 1. Express HTTP 服务器（历史记录 API + 可选静态文件托管）
 * 2. WebSocket 服务器（实时文本广播）
 * 3. 房间管理（相同房间名的客户端互相同步）
 * 4. 文本持久化（存为本地 JSON 文件）
 *
 * 参考：mini_save 项目的 server.js + main.js
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 创建服务器
 * @param {Object} options
 * @param {number} options.port - 监听端口，默认 3000
 * @param {string} options.dataDir - 数据存储目录，默认 './data'
 * @param {string} options.staticDir - 静态文件目录（Web 前端），默认 null
 * @returns {http.Server} HTTP 服务器实例
 */
function createServer(options = {}) {
    const PORT = options.port || 3000;
    const DATA_DIR = options.dataDir || path.join(__dirname, '..', 'data');
    const STATIC_DIR = options.staticDir || null;

    // ============================================================
    // 第一部分：Express HTTP 服务器
    // ============================================================

    /**
     * 获取本机局域网 IP 地址
     */
    function getIPAddress() {
        const interfaces = os.networkInterfaces();
        for (const dev of Object.values(interfaces)) {
            for (const details of dev) {
                if (details.family === 'IPv4' && !details.internal) {
                    return details.address;
                }
            }
        }
        return '127.0.0.1';
    }

    const app = express();
    app.use(express.json());

    // 可选：托管 Web 前端静态文件
    if (STATIC_DIR) {
        app.use(express.static(STATIC_DIR));
    }

    // 确保数据目录存在
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // ---------- 文本存储 ----------

    /**
     * 加载历史文本
     * 数据文件：{DATA_DIR}/texts.json
     * 格式：{ "texts": [{ "id": 123, "content": "...", "timestamp": "..." }] }
     */
    function loadTexts() {
        const filePath = path.join(DATA_DIR, 'texts.json');
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw);
        } catch {
            return { texts: [] };
        }
    }

    /**
     * 保存历史文本
     */
    function saveTexts(data) {
        const filePath = path.join(DATA_DIR, 'texts.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    // ---------- HTTP API ----------

    // POST /api/text — 存储一条文本
    app.post('/api/text', (req, res) => {
        const { text } = req.body;
        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'text 字段不能为空' });
        }

        const data = loadTexts();
        const record = {
            id: Date.now(),
            content: text,
            timestamp: new Date().toISOString()
        };

        // 去重：如果和最新一条内容相同，不重复存储
        if (data.texts.length > 0 && data.texts[0].content === text) {
            return res.json({ success: true, ...data.texts[0] });
        }

        data.texts.unshift(record);  // 最新在前

        // 最多保留 100 条
        if (data.texts.length > 100) {
            data.texts = data.texts.slice(0, 100);
        }

        saveTexts(data);
        res.json({ success: true, ...record });
    });

    // GET /api/texts — 获取所有历史文本
    app.get('/api/texts', (req, res) => {
        const data = loadTexts();
        res.json(data);
    });

    // 首页（如果托管了静态文件）
    app.get('/', (req, res) => {
        if (STATIC_DIR) {
            res.sendFile(path.join(STATIC_DIR, 'index.html'));
        } else {
            res.json({ name: 'Lan Clipboard Server', version: '1.0.0' });
        }
    });

    // ============================================================
    // 第二部分：WebSocket 服务器
    // ============================================================

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ noServer: true });

    /**
     * 房间管理
     * 结构：Map<房间名, Set<WebSocket>>
     */
    const rooms = new Map();

    wss.on('connection', (ws, req) => {
        // 从 URL 路径提取房间名：ws://host:3000/myroom → "myroom"
        const roomName = req.url.slice(1) || 'default';

        // 加入房间
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
        }
        rooms.get(roomName).add(ws);

        console.log(`[WS] 客户端连接 → 房间: ${roomName}, 当前人数: ${rooms.get(roomName).size}`);

        // ---------- 处理客户端消息 ----------
        ws.on('message', (rawMsg) => {
            let msg;
            try {
                msg = JSON.parse(rawMsg.toString());
            } catch {
                return; // 非法 JSON，静默忽略
            }

            switch (msg.type) {
                case 'text':
                    // 文本消息：存储 + 广播给房间内其他客户端
                    handleTextMessage(roomName, ws, msg);
                    break;

                case 'ping':
                    // 心跳：回复 pong
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                default:
                    // 未知类型，静默忽略（为后续扩展预留）
                    break;
            }
        });

        // ---------- 客户端断开 ----------
        ws.on('close', () => {
            const room = rooms.get(roomName);
            if (room) {
                room.delete(ws);
                console.log(`[WS] 客户端断开 → 房间: ${roomName}, 剩余: ${room.size}`);
                if (room.size === 0) {
                    rooms.delete(roomName);
                    console.log(`[WS] 房间已清空: ${roomName}`);
                }
            }
        });

        ws.on('error', (err) => {
            console.error(`[WS] 错误: ${roomName}`, err.message);
        });
    });

    /**
     * 处理文本消息：存储 + 广播
     */
    function handleTextMessage(roomName, senderWs, msg) {
        const { data: text, timestamp } = msg;

        if (!text || !text.trim()) return;

        // 1. 存储到本地 JSON
        const allData = loadTexts();
        const record = {
            id: timestamp || Date.now(),
            content: text,
            timestamp: new Date().toISOString()
        };

        // 去重
        if (allData.texts.length === 0 || allData.texts[0].content !== text) {
            allData.texts.unshift(record);
            if (allData.texts.length > 100) {
                allData.texts = allData.texts.slice(0, 100);
            }
            saveTexts(allData);
        }

        // 2. 广播给同房间其他客户端
        const broadcastMsg = JSON.stringify({
            type: 'text',
            data: text,
            timestamp: record.id
        });

        const room = rooms.get(roomName);
        if (room) {
            for (const client of room) {
                if (client !== senderWs && client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMsg);
                }
            }
        }

        console.log(`[WS] 文本同步 → 房间: ${roomName}, 内容: ${text.substring(0, 30)}...`);
    }

    // HTTP → WebSocket 升级处理
    server.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });

    // ============================================================
    // 第三部分：启动 & 导出
    // ============================================================

    /**
     * 启动服务器
     */
    function start() {
        server.listen(PORT, () => {
            const localIP = getIPAddress();
            console.log(`[Server] Lan Clipboard 已启动`);
            console.log(`[Server] 本机访问:    http://localhost:${PORT}`);
            console.log(`[Server] 局域网访问:  http://${localIP}:${PORT}`);
            console.log(`[Server] WebSocket:   ws://${localIP}:${PORT}/<房间名>`);
            console.log(`[Server] 数据目录:    ${DATA_DIR}`);
            console.log('');
        });
        return server;
    }

    // 返回接口
    return {
        app,
        server,
        wss,
        rooms,
        start,
        getPort: () => PORT,
        getDataDir: () => DATA_DIR
    };
}

module.exports = { createServer };

// ============================================================
// 如果直接运行此文件（node shared/server.js），启动独立服务器
// ============================================================
if (require.main === module) {
    const server = createServer({ port: 3000 });
    server.start();
}
