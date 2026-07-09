/**
 * Lan Clipboard — 系统托盘（tray.js）
 *
 * 职责：
 * 1. 创建系统托盘图标（带连接状态颜色）
 * 2. 托盘菜单（显示状态、设置、退出）
 * 3. 根据同步状态动态更新图标和提示文字
 */

const { Tray, Menu, nativeImage } = require('electron');

// ── 状态常量 ────────────────────────────────────────────────

const STATUS = {
    CONNECTED:     'connected',
    CONNECTING:    'connecting',
    RECONNECTING:  'reconnecting',
    DISCONNECTED:  'disconnected'
};

// ── 托盘图标生成 ────────────────────────────────────────────

/**
 * 用像素缓冲区生成一个 16x16 的彩色圆点图标
 * @param {'green'|'yellow'|'gray'|'red'} color
 * @returns {Electron.NativeImage}
 */
function makeDotIcon(color) {
    const SIZE = 16;
    const buf = Buffer.alloc(SIZE * SIZE * 4, 0);

    const palette = {
        green:  [0x26, 0xa2, 0x69, 0xff],  // 已连接
        yellow: [0xe5, 0xc0, 0x7b, 0xff],  // 连接中
        gray:   [0x6c, 0x70, 0x86, 0xff],  // 断开
        red:    [0xf3, 0x8b, 0xa8, 0xff]   // 错误（备用）
    };

    const [r, g, b, a] = palette[color] || palette.gray;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const radius = SIZE / 2 - 2;

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            if (dx * dx + dy * dy <= radius * radius) {
                const i = (y * SIZE + x) * 4;
                buf[i]     = r;
                buf[i + 1] = g;
                buf[i + 2] = b;
                buf[i + 3] = a;
            }
        }
    }

    return nativeImage.createFromBuffer(buf, { width: SIZE, height: SIZE });
}

// ── 图标缓存 ────────────────────────────────────────────────

const icons = {
    connected:    makeDotIcon('green'),
    connecting:   makeDotIcon('yellow'),
    reconnecting: makeDotIcon('yellow'),
    disconnected: makeDotIcon('gray')
};

// ── 创建托盘 ────────────────────────────────────────────────

/**
 * 创建系统托盘
 * @param {{ server: string, room: string }} config
 * @param {{ onShow: () => void, onQuit: () => void }} callbacks
 * @returns {{ updateStatus: (status: string) => void }}
 */
function createTray(config, callbacks) {
    const tray = new Tray(icons.disconnected);
    let currentStatus = STATUS.DISCONNECTED;

    tray.setToolTip(`Lan Clipboard — 未连接\n${config.server}:3000/${config.room}`);

    function buildMenu() {
        const statusLabel = {
            [STATUS.CONNECTED]:    '● 已连接',
            [STATUS.CONNECTING]:   '◌ 连接中…',
            [STATUS.RECONNECTING]: '◌ 重连中…',
            [STATUS.DISCONNECTED]: '○ 未连接'
        }[currentStatus] || '○ 未连接';

        return Menu.buildFromTemplate([
            {
                label: statusLabel,
                enabled: false
            },
            {
                label: `服务器: ${config.server}:3000`,
                enabled: false
            },
            {
                label: `房间: ${config.room}`,
                enabled: false
            },
            { type: 'separator' },
            {
                label: '📋 显示主窗口',
                click: () => callbacks.onShow()
            },
            { type: 'separator' },
            {
                label: '退出',
                click: () => callbacks.onQuit()
            }
        ]);
    }

    tray.setContextMenu(buildMenu());

    // 双击托盘图标显示主窗口
    tray.on('double-click', () => {
        callbacks.onShow();
    });

    return {
        /**
         * 更新托盘状态
         * @param {'connected'|'connecting'|'reconnecting'|'disconnected'} status
         */
        updateStatus(status) {
            currentStatus = status;
            const icon = icons[status] || icons.disconnected;
            tray.setImage(icon);

            const tooltip = {
                [STATUS.CONNECTED]:    `Lan Clipboard — 已连接\n${config.server}:3000/${config.room}`,
                [STATUS.CONNECTING]:   `Lan Clipboard — 连接中…\n${config.server}:3000/${config.room}`,
                [STATUS.RECONNECTING]: `Lan Clipboard — 重连中…\n${config.server}:3000/${config.room}`,
                [STATUS.DISCONNECTED]: `Lan Clipboard — 未连接\n${config.server}:3000/${config.room}`
            }[status] || `Lan Clipboard`;

            tray.setToolTip(tooltip);
            tray.setContextMenu(buildMenu());
        }
    };
}

module.exports = { createTray };
