//
//  test/clip/main.swift
//  从系统剪贴板读取 PNG 数据并写到文件，用于验证"复制二维码"功能。
//

import AppKit
import Foundation

let out = CommandLine.arguments[1]
let pb = NSPasteboard.general
guard let data = pb.data(forType: .png) else {
    print("NO_PNG_IN_CLIPBOARD")
    exit(1)
}
try! data.write(to: URL(fileURLWithPath: out))
print("CLIPBOARD_PNG_OK bytes=\(data.count)")
