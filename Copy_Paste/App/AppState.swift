import Foundation
import Combine

final class AppState: ObservableObject {
    @Published var clipboardText = ""
    @Published var clipboardCounter = 0
    @Published var isConnected = false

    let syncEngine = SyncEngine()

    init() {
        syncEngine.$clipboardText
            .sink { [weak self] in
                self?.clipboardText = $0
                self?.clipboardCounter += 1
            }
            .store(in: &cancellables)

        syncEngine.$isConnected
            .sink { [weak self] in self?.isConnected = $0 }
            .store(in: &cancellables)

        connect(host: "localhost", room: "test")
    }

    func connect(host: String, room: String) {
        syncEngine.connect(host: host, room: room)
    }

    func disconnect() {
        syncEngine.disconnect()
    }

    private var cancellables = Set<AnyCancellable>()
}
