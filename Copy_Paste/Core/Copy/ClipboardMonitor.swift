import AppKit
import Foundation

final class ClipboardMonitor {
    private let pasteBoard = NSPasteboard.general
    private var lastChangeNum: Int
    private var timer: Timer?
    private var copyAlive = false
    var onTextChange: ((String) -> Void)?
    var onAliveChange: ((Bool) -> Void)?
    private var cooldownUntil = Date.distantPast
    
    init() {
        self.lastChangeNum = pasteBoard.changeCount
    }
    
    func start() {
        guard timer == nil else {
            return
        }
        
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true){
            [weak self] _ in
            self?.clipCheck()
            self?.clipSave()
        }
    }
    
    func stop() {
        timer?.invalidate()
        timer = nil
    }
    
    func setCooldown(seconds: Double) {
        cooldownUntil = Date().addingTimeInterval(seconds)
    }
    
    func clipCheck() {
        guard Date() > cooldownUntil else{return}
        
        let currentChangeNum = pasteBoard.changeCount
        guard currentChangeNum != lastChangeNum else{
            return
        }
        lastChangeNum = currentChangeNum
        if let text = pasteBoard.string(forType: .string){
            onTextChange?(text)
        }
    }
    
    func clipSave() {
        if pasteBoard.string(forType: .string) == nil {
            copyAlive = false
            onAliveChange?(false)
        } else {
            copyAlive = true
            onAliveChange?(true)
        }
    }
}
