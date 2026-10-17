//
//  test/decode/main.swift
//  用系统 Vision 框架解码 PNG 中的二维码，输出识别到的内容。
//

import AppKit
import Foundation
import Vision

let path = CommandLine.arguments[1]

guard let image = NSImage(contentsOfFile: path),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("加载失败: \(path)\n".data(using: .utf8)!)
    exit(2)
}

var decoded: String?
let request = VNDetectBarcodesRequest { request, _ in
    if let observations = request.results as? [VNBarcodeObservation] {
        decoded = observations.first?.payloadStringValue
    }
}
request.symbologies = [.qr]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("Vision 失败: \(error)\n".data(using: .utf8)!)
    exit(3)
}

print(decoded ?? "__NO_QR_DETECTED__")
