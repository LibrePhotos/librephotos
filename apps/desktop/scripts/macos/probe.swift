import AppKit
import CoreGraphics
import Foundation
import UniformTypeIdentifiers

typealias SandboxCheck = @convention(c) (pid_t, UnsafePointer<CChar>?, Int32) -> Int32

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(2)
}

func number(_ value: Any?) -> Int {
    (value as? NSNumber)?.intValue ?? 0
}

func windows(of pid: Int) {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
    for window in list where number(window[kCGWindowOwnerPID as String]) == pid && number(window[kCGWindowLayer as String]) == 0 {
        let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
        let box = ["X", "Y", "Width", "Height"].map { String(number(bounds[$0])) }.joined(separator: ",")
        let name = window[kCGWindowName as String] as? String ?? ""
        print("\(number(window[kCGWindowNumber as String]))\t\(box)\t\(name)")
    }
}

func sandboxed(_ pid: Int) {
    guard let symbol = dlsym(dlopen(nil, RTLD_NOW), "sandbox_check") else { fail("no sandbox_check") }
    let check = unsafeBitCast(symbol, to: SandboxCheck.self)
    print(check(pid_t(pid), nil, 0) != 0 ? "sandboxed" : "not sandboxed")
}

func bundleId(_ url: URL?) -> String {
    guard let url else { return "(none)" }
    return Bundle(url: url)?.bundleIdentifier ?? url.path
}

func handlers(app: String, items: [String]) {
    var missing = 0
    for item in items {
        let candidates: [URL]
        let preferred: URL?
        if FileManager.default.fileExists(atPath: item) {
            let url = URL(fileURLWithPath: item)
            candidates = NSWorkspace.shared.urlsForApplications(toOpen: url)
            preferred = NSWorkspace.shared.urlForApplication(toOpen: url)
        } else if let type = UTType(item) {
            candidates = NSWorkspace.shared.urlsForApplications(toOpen: type)
            preferred = NSWorkspace.shared.urlForApplication(toOpen: type)
        } else {
            fail("\(item) is neither a file nor a known type")
        }
        let listed = candidates.contains { bundleId($0) == app }
        if !listed { missing += 1 }
        print("\(item)\t\(listed ? "offered" : "MISSING")\tdefault=\(bundleId(preferred))")
    }
    exit(missing == 0 ? 0 : 1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("usage: probe windows PID | sandboxed PID | handlers BUNDLE_ID FILE_OR_UTI...") }
switch command {
case "windows":
    guard args.count == 2, let pid = Int(args[1]) else { fail("usage: probe windows PID") }
    windows(of: pid)
case "sandboxed":
    guard args.count == 2, let pid = Int(args[1]) else { fail("usage: probe sandboxed PID") }
    sandboxed(pid)
case "screen-access":
    print(CGPreflightScreenCaptureAccess() ? "granted" : "not granted")
case "handlers":
    guard args.count >= 3 else { fail("usage: probe handlers BUNDLE_ID FILE_OR_UTI...") }
    handlers(app: args[1], items: Array(args.dropFirst(2)))
default:
    fail("unknown command \(command)")
}
