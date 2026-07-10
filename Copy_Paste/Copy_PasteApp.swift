import SwiftUI

@main
struct Copy_PasteApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        MenuBarExtra("ClipSync", systemImage: "doc.on.clipboard") {
            HStack {
                Circle()
                    .fill(appState.isConnected ? Color.green : Color.red)
                    .frame(width: 8, height: 8)
                Text(appState.isConnected ? "已连接" : "未连接")
            }
            .padding(.horizontal, 8)

            if !appState.clipboardText.isEmpty {
                Divider()
                Text(appState.clipboardText)
                    .frame(maxWidth: 200, alignment: .leading)
                    .lineLimit(5)
                    .padding(.horizontal, 8)
            }

            Divider()
            Button("退出") {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}
