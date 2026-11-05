import Cocoa

final class Installer: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "필요한 파일과 Chrome·Edge용 도우미를 설치합니다.\n진행 중인 다운로드가 끝난 뒤 설치하세요.")
    let button = NSButton(title: "설치 시작", target: nil, action: nil)
    let progress = NSProgressIndicator()
    var busy = false
    var installed = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 430),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Rium Download 설치"
        window.center()
        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 24
        content.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 36),
            content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -36),
            content.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 32)
        ])
        let title = NSTextField(labelWithString: "Rium Download")
        title.font = .systemFont(ofSize: 34, weight: .semibold)
        content.addArrangedSubview(title)
        content.addArrangedSubview(NSTextField(labelWithString: "CONTENTRIUM · 영상과 음원을 원본 품질로"))
        status.font = .systemFont(ofSize: 15)
        content.addArrangedSubview(status)
        let note = NSTextField(wrappingLabelWithString: "브라우저 확장 추가는 별도 단계입니다. 설치 후 안내에 따라 각 브라우저에 확장 폴더를 추가하세요. 트레이·자동 실행은 추가하지 않습니다.")
        note.textColor = .secondaryLabelColor
        content.addArrangedSubview(note)
        progress.style = .bar
        progress.isIndeterminate = true
        progress.widthAnchor.constraint(equalToConstant: 560).isActive = true
        content.addArrangedSubview(progress)
        button.target = self
        button.action = #selector(start)
        button.bezelStyle = .rounded
        content.addArrangedSubview(button)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func start() {
        if installed {
            let guide = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Rium Download/설치 안내.html")
            NSWorkspace.shared.open(guide)
            return
        }
        busy = true
        window.standardWindowButton(.closeButton)?.isEnabled = false
        button.isEnabled = false
        progress.startAnimation(nil)
        status.stringValue = "도우미와 확장 파일을 설치하고 있습니다…"
        DispatchQueue.global().async {
            let task = Process()
            task.executableURL = Bundle.main.resourceURL!.appendingPathComponent("payload/native/rium-download-host")
            task.arguments = ["--install", "--no-guide"]
            task.standardOutput = FileHandle.nullDevice
            task.standardError = FileHandle.nullDevice
            var success = false
            do {
                try task.run()
                task.waitUntilExit()
                success = task.terminationStatus == 0
            } catch { success = false }
            DispatchQueue.main.async {
                self.busy = false
                self.window.standardWindowButton(.closeButton)?.isEnabled = true
                self.progress.stopAnimation(nil)
                self.button.isEnabled = true
                self.installed = success
                self.status.stringValue = success ? "파일 설치와 도우미 연결 완료\n이제 브라우저에 확장을 추가해 주세요." : "설치하지 못했습니다. 디스크 공간과 폴더 쓰기 권한을 확인한 뒤 다시 시도해 주세요."
                self.button.title = success ? "브라우저 추가 안내 열기" : "다시 시도"
            }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        return busy ? .terminateCancel : .terminateNow
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { return !busy }
}
let app = NSApplication.shared
let installer = Installer()
app.delegate = installer
app.setActivationPolicy(.regular)
app.run()
