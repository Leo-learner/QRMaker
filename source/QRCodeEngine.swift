//
//  QRCodeEngine.swift
//  QRMaker
//
//  纯 CoreImage 二维码生成引擎，无第三方依赖，同时供 App 与测试 CLI 使用。
//

import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins

enum QRCodeEngine {
    /// QR 码 byte 模式（UTF-8）在 Version 40 下各纠错等级的容量上限（字节）。
    static let byteCapacity: [String: Int] = ["L": 2953, "M": 2331, "Q": 1663, "H": 1273]

    /// 生成二维码 CGImage。
    /// - Parameters:
    ///   - text: 原始内容（按 UTF-8 编码）
    ///   - correction: 纠错等级 L / M / Q / H
    ///   - foreground: 码点颜色（应为深色）
    ///   - background: 背景颜色（应为浅色）
    ///   - pixelSize: 输出正方形边长（像素）
    ///   - quietZoneModules: 四周静区位数（ISO 标准建议 4）
    static func makeCGImage(
        text: String,
        correction: String,
        foreground: NSColor,
        background: NSColor,
        pixelSize: Int,
        quietZoneModules: CGFloat = 4
    ) -> CGImage? {
        guard pixelSize > 0 else { return nil }
        guard let data = text.data(using: .utf8), !data.isEmpty else { return nil }

        // 1. 生成黑白二维码
        guard let qrFilter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        qrFilter.setValue(data, forKey: "inputMessage")
        qrFilter.setValue(correction, forKey: "inputCorrectionLevel")
        guard let qrImage = qrFilter.outputImage else { return nil }

        // 2. 前景/背景上色
        let fgColor = CIColor(color: foreground) ?? CIColor(red: 0, green: 0, blue: 0)
        let bgColor = CIColor(color: background) ?? CIColor(red: 1, green: 1, blue: 1)

        var colored = qrImage
        if let colorFilter = CIFilter(name: "CIFalseColor") {
            colorFilter.setValue(qrImage, forKey: kCIInputImageKey)
            colorFilter.setValue(fgColor, forKey: "inputColor0")
            colorFilter.setValue(bgColor, forKey: "inputColor1")
            if let recolored = colorFilter.outputImage {
                colored = recolored
            }
        }

        // 3. 缩放到目标像素，并保留静区（关闭插值，保证边缘锐利）
        let moduleCount = qrImage.extent.width
        guard moduleCount > 0 else { return nil }
        let scale = CGFloat(pixelSize) / (moduleCount + quietZoneModules * 2)
        let quietZone = quietZoneModules * scale
        let scaled = colored
            .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: quietZone, y: quietZone))

        // 4. 铺实色背景（无论 CIFalseColor 是否保留透明，这里都保证背景色正确）
        let canvas = CGRect(x: 0, y: 0, width: pixelSize, height: pixelSize)
        let backgroundImage = CIImage(color: bgColor).cropped(to: canvas)
        let combined = scaled.composited(over: backgroundImage)

        // 5. 渲染为 CGImage
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        let context = CIContext(options: [.workingColorSpace: colorSpace])
        return context.createCGImage(
            combined,
            from: canvas,
            format: .RGBA8,
            colorSpace: colorSpace
        )
    }

    /// 生成 PNG 数据。
    static func makePNG(
        text: String,
        correction: String,
        foreground: NSColor,
        background: NSColor,
        pixelSize: Int
    ) -> Data? {
        guard let cgImage = makeCGImage(
            text: text,
            correction: correction,
            foreground: foreground,
            background: background,
            pixelSize: pixelSize
        ) else { return nil }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        rep.size = NSSize(width: pixelSize, height: pixelSize)
        return rep.representation(using: .png, properties: [:])
    }

    /// sRGB 相对亮度（0~1），用于对比提示。
    static func luminance(_ color: NSColor) -> CGFloat {
        let rgb = color.usingColorSpace(.sRGB) ?? color
        let r = rgb.redComponent
        let g = rgb.greenComponent
        let b = rgb.blueComponent
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
}
