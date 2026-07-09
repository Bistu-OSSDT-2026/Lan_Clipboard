package com.lanclipboard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * MainScreen — 主界面（参照 macOS Copy_PasteApp + web-ui ConnectionBar）
 *
 * 布局：
 * ┌──────────────────────────────┐
 * │  Lan Clipboard               │
 * │  ● 已连接 / ○ 未连接          │
 * ├──────────────────────────────┤
 * │  服务器  [192.168.1.5    ]   │
 * │  房间    [test           ]   │
 * │         [连接] / [断开]       │
 * ├──────────────────────────────┤
 * │  剪贴板内容                    │
 * │  这是最新复制的文本...         │
 * └──────────────────────────────┘
 */
@Composable
fun MainScreen(
    state: ConnectionState,
    onConnect: (host: String, room: String) -> Unit,
    onDisconnect: () -> Unit
) {
    var host by remember { mutableStateOf("") }
    var room by remember { mutableStateOf("test") }
    var clipboardText by remember { mutableStateOf("") }
    var connecting by remember { mutableStateOf(false) }

    Scaffold(
        modifier = Modifier.fillMaxSize()
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // ============================================================
            // 标题 + 状态（参照 macOS menu bar 的圆点+状态文字）
            // ============================================================
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (state.isConnected) Color(0xFF1B5E20) else Color(0xFF1D1D1F)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Lan Clipboard",
                        color = Color.White,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(if (state.isConnected) Color(0xFF34C759) else Color(0xFF888888))
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (state.isConnected) "已连接" else if (connecting) "连接中..." else "未连接",
                            color = Color.White.copy(alpha = 0.9f),
                            fontSize = 14.sp
                        )
                    }
                }
            }

            // ============================================================
            // 服务器连接配置
            // ============================================================
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    OutlinedTextField(
                        value = host,
                        onValueChange = { host = it },
                        label = { Text("服务器地址") },
                        placeholder = { Text("192.168.1.5") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.isConnected && !connecting,
                        singleLine = true
                    )

                    OutlinedTextField(
                        value = room,
                        onValueChange = { room = it },
                        label = { Text("房间名") },
                        placeholder = { Text("test") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !state.isConnected && !connecting,
                        singleLine = true
                    )

                    if (!state.isConnected) {
                        Button(
                            onClick = {
                                if (host.isNotBlank()) {
                                    connecting = true
                                    onConnect(host.trim(), room.trim())
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = host.isNotBlank() && !connecting
                        ) {
                            Text(if (connecting) "连接中..." else "连接")
                        }
                    } else {
                        OutlinedButton(
                            onClick = onDisconnect,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = Color(0xFFFF3B30)
                            )
                        ) {
                            Text("断开连接")
                        }
                    }
                }
            }

            // ============================================================
            // 剪贴板内容预览
            // ============================================================
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "最新剪贴板内容",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    if (clipboardText.isEmpty()) {
                        Text(
                            text = "暂无内容，复制文本后将显示在这里",
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                            fontSize = 14.sp
                        )
                    } else {
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant
                        ) {
                            Text(
                                text = clipboardText,
                                modifier = Modifier.padding(12.dp),
                                fontSize = 14.sp,
                                maxLines = 5
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.weight(1f))

            // ============================================================
            // 底部提示
            // ============================================================
            Text(
                text = if (state.isConnected) "已连接 ${state.host} / ${state.room}" else "请连接服务器开始同步",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }
}
