import Foundation
import Combine

class WebSocketManager: ObservableObject {
    private var task: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var heartbeatTimer: Timer?

    private var savedHost = ""
    private var savedPort = 3000
    private var savedRoom = ""

    @Published var isConnected = false
    var onReceive: ((String) -> Void)?

    func connect(host: String, port: Int = 3000, room: String) {
        savedHost = host
        savedPort = port
        savedRoom = room

        let url = URL(string: "ws://\(host):\(port)/\(room)")!
        task = session.webSocketTask(with: url)
        task?.resume()
        isConnected = true
        receiveMessage()
        startHeartbeat()
    }

    func send(text: String) {
        task?.send(.string(text)) { error in
            if let error = error {
                print("发送失败: \(error)")
                self.isConnected = false
                self.reconnect()
            }
        }
    }

    private func receiveMessage() {
        task?.receive { [weak self] result in
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    DispatchQueue.main.async {
                        self?.onReceive?(text)
                    }
                }
                self?.receiveMessage()
            case .failure(let error):
                print("接收失败: \(error)")
                DispatchQueue.main.async {
                    self?.isConnected = false
                }
                self?.reconnect()
            }
        }
    }

    private func startHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.send(text: #"{"type":"ping"}"#)
        }
    }

    func disconnect() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        isConnected = false
    }

    private func reconnect() {
        disconnect()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self = self else { return }
            self.connect(host: self.savedHost, port: self.savedPort, room: self.savedRoom)
        }
    }
}
