import AppKit
import Foundation
import Combine

class SyncEngine: ObservableObject {
    private let ws = WebSocketManager()
    private let monitor = ClipboardMonitor()
    private var cancellables = Set<AnyCancellable>()

    @Published var isConnected = false
    @Published var clipboardText = ""

    init() {
        ws.onReceive = { [weak self] msg in
            guard let data = msg.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String
            else { return }

            if type == "text", let text = json["data"] as? String {
                let pasteboard = NSPasteboard.general
                pasteboard.clearContents()
                pasteboard.setString(text, forType: .string)
                self?.clipboardText = text
                self?.monitor.setCooldown(seconds: 3)
            }
        }

        monitor.onTextChange = { [weak self] text in
            self?.clipboardText = text
            let timestamp = Int(Date().timeIntervalSince1970 * 1000)
            let escaped = text
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
            let msg = """
            {"type":"text","data":"\(escaped)","timestamp":\(timestamp)}
            """
            self?.ws.send(text: msg)
        }

        ws.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.isConnected = $0 }
            .store(in: &cancellables)
    }

    func connect(host: String, room: String) {
        ws.connect(host: host, room: room)
        monitor.start()
    }

    func disconnect() {
        ws.disconnect()
        monitor.stop()
    }
}
