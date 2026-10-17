//
//  QRMakerApp.swift
//  二维码生成器 —— 原生 macOS 单窗口应用
//

import SwiftUI
import AppKit
import UniformTypeIdentifiers

@main
struct QRMakerApp: App {
    var body: some Scene {
        WindowGroup("二维码生成器") {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var text: String = ""
    @State private var correction: String = "M"
    @State private var exportSize: Double = 512
    @State private var fgColor: Color = .black
    @State private var bgColor: Color = .white
    @State private var toast: String?

    private let levels = ["L", "M", "Q", "H"]
    private let levelLabels = ["L（低）", "M（中）", "Q（较高）", "H（高）"]
    private let previewPointSize: CGFloat = 240

    private var byteCount: Int { text.utf8.count }
    private var maxBytes: Int { QRCodeEngine.byteCapacity[correction] ?? 2331 }
    private var overCapacity: Bool { byteCount > maxBytes }

    private var contrastOK: Bool {
        let fg = QRCodeEngine.luminance(NSColor(fgColor))
        let bg = QRCodeEngine.luminance(NSColor(bgColor))
        return bg - fg > 0.25
    }

    private var previewImage: NSImage? {
        guard !text.isEmpty, !overCapacity,
              let cg = QRCodeEngine.makeCGImage(
                text: text,
                correction: correction,
                foreground: NSColor(fgColor),
                background: NSColor(bgColor),
                pixelSize: 600
              ) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: previewPointSize, height: previewPointSize))
    }

    private var pngData: Data? {
        guard !text.isEmpty, !overCapacity else { return nil }
        return QRCodeEngine.makePNG(
            text: text,
            correction: correction,
            foreground: NSColor(fgColor),
            background: NSColor(bgColor),
            pixelSize: Int(exportSize)
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("二维码生成器")
                .font(.title2.bold())

            // 输入区
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text("在此输入或粘贴文本、网址、WiFi 配置…")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .font(.system(size: 14))
                    .frame(height: 110)
                    .padding(4)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.secondary.opacity(0.35), lineWidth: 1)
                    )
            }
            .frame(height: 120)

            HStack(alignment: .center) {
                Text("字节数：\(byteCount) / 上限约 \(maxBytes)")
                    .font(.caption)
                    .foregroundColor(overCapacity ? .red : .secondary)
                Spacer()
                if !text.isEmpty {
                    Button("清空") { text = "" }
                        .font(.caption)
                }
            }

            // 预览区
            HStack {
                Spacer()
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(nsColor: .controlBackgroundColor))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
                        )
                    if let image = previewImage {
                        Image(nsImage: image)
                            .resizable()
                            .interpolation(.none)
                            .frame(width: previewPointSize, height: previewPointSize)
                            .onDrag { makeItemProvider() }
                            .help("可直接拖到桌面或聊天窗口")
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "qrcode")
                                .font(.system(size: 52))
                                .foregroundColor(.secondary.opacity(0.6))
                            Text(overCapacity ? "内容过长，无法生成二维码" : "输入内容后在此预览")
                                .font(.callout)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .frame(width: 270, height: 270)
                Spacer()
            }

            if !contrastOK {
                Label("前景色应明显深于背景色，否则可能无法扫描", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundColor(.orange)
            }

            // 纠错等级
            Picker("纠错等级", selection: $correction) {
                ForEach(Array(levels.enumerated()), id: \.element) { idx, level in
                    Text(levelLabels[idx]).tag(level)
                }
            }
            .pickerStyle(.segmented)

            // 尺寸
            HStack(spacing: 10) {
                Text("导出尺寸").frame(width: 60, alignment: .leading)
                Slider(value: $exportSize, in: 256...1024, step: 32)
                Text("\(Int(exportSize)) px")
                    .monospacedDigit()
                    .font(.callout)
                    .frame(width: 72, alignment: .trailing)
            }

            // 颜色
            HStack(spacing: 16) {
                ColorPicker("前景色", selection: $fgColor, supportsOpacity: false)
                ColorPicker("背景色", selection: $bgColor, supportsOpacity: false)
                Spacer()
                Button("恢复默认") {
                    fgColor = .black
                    bgColor = .white
                }
            }

            Divider()

            // 操作按钮
            HStack(spacing: 12) {
                Button {
                    copyImage()
                } label: {
                    Label("复制二维码", systemImage: "doc.on.doc")
                        .frame(minWidth: 110)
                }
                .disabled(pngData == nil)

                Spacer()

                Button {
                    savePNG()
                } label: {
                    Label("导出 PNG", systemImage: "square.and.arrow.down")
                        .frame(minWidth: 110)
                }
                .keyboardShortcut("s", modifiers: [.command])
                .disabled(pngData == nil)
            }

            if let toast {
                Text(toast)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(20)
        .frame(minWidth: 460, idealWidth: 470, minHeight: 720, idealHeight: 760)
    }

    // MARK: - 拖拽 / 复制 / 保存

    private func makeItemProvider() -> NSItemProvider {
        let provider = NSItemProvider()
        provider.suggestedName = "二维码"
        let data = pngData
        provider.registerDataRepresentation(
            forTypeIdentifier: UTType.png.identifier,
            visibility: .all
        ) { completion in
            completion(data, nil)
            return nil
        }
        return provider
    }

    private func copyImage() {
        guard let data = pngData else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setData(data, forType: .png)
        showToast("已复制二维码到剪贴板，可直接粘贴")
    }

    private func savePNG() {
        guard let data = pngData else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType.png]
        panel.nameFieldStringValue = "二维码.png"
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            do {
                try data.write(to: url)
                showToast("已保存：\(url.lastPathComponent)")
            } catch {
                showToast("保存失败：\(error.localizedDescription)")
            }
        }
    }

    private func showToast(_ message: String) {
        toast = message
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if toast == message { toast = nil }
        }
    }
}
