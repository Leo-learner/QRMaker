//
//  test/gen/main.swift
//  用 QRCodeEngine 生成测试 PNG 及应用图标，并自检边界场景。
//

import AppKit
import Foundation

struct TestCase {
    let name: String
    let text: String
    let correction: String
    let size: Int
    let fg: NSColor
    let bg: NSColor
}

let cli = CommandLine.arguments

// 图标模式：qrgen icon <output-1024.png>
if cli.count == 3 && cli[1] == "icon" {
    guard let cg = QRCodeEngine.makeCGImage(
        text: "QRMaker", correction: "H",
        foreground: .black, background: .white, pixelSize: 1024
    ) else { fatalError("图标生成失败") }
    let rep = NSBitmapImageRep(cgImage: cg)
    guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("PNG 编码失败") }
    try! png.write(to: URL(fileURLWithPath: cli[2]))
    print("icon ok")
    exit(0)
}

// 测试模式：qrgen <outDir>
let outDir = cli[1]
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

let cases: [TestCase] = [
    TestCase(name: "01-url-L-256",
             text: "https://dkz12345.com",
             correction: "L", size: 256, fg: .black, bg: .white),
    TestCase(name: "02-chinese-M-512",
             text: "你好，长沙理工大学！",
             correction: "M", size: 512, fg: .black, bg: .white),
    TestCase(name: "03-emoji-Q-color",
             text: "二维码测试 🚀🎉",
             correction: "Q", size: 512,
             fg: NSColor(srgbRed: 0.10, green: 0.20, blue: 0.60, alpha: 1),
             bg: NSColor(srgbRed: 1.0, green: 0.98, blue: 0.80, alpha: 1)),
    TestCase(name: "04-green-M-256",
             text: "Mixed 文本 ABC 123",
             correction: "M", size: 256,
             fg: NSColor(srgbRed: 0.12, green: 0.45, blue: 0.18, alpha: 1),
             bg: .white),
    TestCase(name: "05-long-H-1024",
             text: String(repeating: "长", count: 300) + "END",
             correction: "H", size: 1024, fg: .black, bg: .white),
    TestCase(name: "06-url-H-1024",
             text: "https://example.com/path?a=1&b=2&c=你好",
             correction: "H", size: 1024, fg: .black, bg: .white),
]

var failures = 0
for c in cases {
    guard let png = QRCodeEngine.makePNG(
        text: c.text, correction: c.correction,
        foreground: c.fg, background: c.bg, pixelSize: c.size
    ) else {
        print("FAIL 生成 \(c.name)")
        failures += 1
        continue
    }
    let base = URL(fileURLWithPath: outDir).appendingPathComponent(c.name)
    try! png.write(to: base.appendingPathExtension("png"))
    try! c.text.write(to: base.appendingPathExtension("txt"), atomically: true, encoding: .utf8)
    print("ok   \(c.name)  utf8字节=\(c.text.utf8.count) png字节=\(png.count)")
}

// 边界：超容量应返回 nil
let overCapacity = QRCodeEngine.makePNG(
    text: String(repeating: "字", count: 3000),
    correction: "H", foreground: .black, background: .white, pixelSize: 512
)
if overCapacity == nil {
    print("ok   超容量正确返回 nil")
} else {
    print("FAIL 超容量应返回 nil")
    failures += 1
}

// 边界：空字符串应返回 nil
let empty = QRCodeEngine.makePNG(
    text: "", correction: "M", foreground: .black, background: .white, pixelSize: 512
)
if empty == nil {
    print("ok   空字符串正确返回 nil")
} else {
    print("FAIL 空字符串应返回 nil")
    failures += 1
}

print(failures == 0 ? "ALL_GEN_OK" : "GEN_HAS_FAILURES")
exit(failures == 0 ? 0 : 1)
