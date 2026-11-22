import Cocoa
import Carbon

// ── Config ────────────────────────────────────────────────────────────────────
let MARVEN_URL = "http://localhost:3000"
// Cmd+Shift+M  (keyCode 46 = 'm')
let SHORTCUT_KEY_CODE: Int = 46
let SHORTCUT_MODIFIERS: UInt32 = UInt32(cmdKey | shiftKey)

// ── App delegate ─────────────────────────────────────────────────────────────
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var hotKeyRef: EventHotKeyRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide from Dock — menu bar only
        NSApp.setActivationPolicy(.accessory)

        setupMenuBar()
        registerHotKey()
    }

    // ── Menu bar icon + menu ─────────────────────────────────────────────────
    func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.title = "Marven"
            button.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Open Marven", action: #selector(openMarven), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Listen  (⌘⇧M)", action: #selector(triggerListen), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    // ── Global hotkey (Cmd+Shift+M) ──────────────────────────────────────────
    func registerHotKey() {
        var hotKeyID = EventHotKeyID()
        hotKeyID.signature = OSType(0x4D56524E) // "MVRN"
        hotKeyID.id = 1

        var eventType = EventTypeSpec()
        eventType.eventClass = OSType(kEventClassKeyboard)
        eventType.eventKind = OSType(kEventHotKeyPressed)

        // Install handler
        InstallEventHandler(
            GetApplicationEventTarget(),
            { (_, inEvent, userData) -> OSStatus in
                guard let delegate = userData.map({ Unmanaged<AppDelegate>.fromOpaque($0).takeUnretainedValue() }) else {
                    return OSStatus(eventNotHandledErr)
                }
                delegate.triggerListen()
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            nil
        )

        let status = RegisterEventHotKey(
            UInt32(SHORTCUT_KEY_CODE),
            SHORTCUT_MODIFIERS,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )

        if status != noErr {
            print("[Marven Helper] Could not register Cmd+Shift+M (code \(status)). Another app may own it.")
        } else {
            print("[Marven Helper] Cmd+Shift+M registered.")
        }
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    @objc func openMarven() {
        NSWorkspace.shared.open(URL(string: MARVEN_URL)!)
    }

    @objc func triggerListen() {
        // Open Marven in the default browser if not already open
        NSWorkspace.shared.open(URL(string: MARVEN_URL + "?listen=1")!)
    }

    @objc func quitApp() {
        if let ref = hotKeyRef { UnregisterEventHotKey(ref) }
        NSApp.terminate(nil)
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
