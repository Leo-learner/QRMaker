# 二维码生成器 QRMaker

一个原生 macOS 应用：输入任意文本，实时生成二维码。SwiftUI + CoreImage，零第三方依赖。

## 网页版（本分支）

`web` 分支是纯静态网页版，零依赖、无需构建，内容全程在浏览器本地处理，不会上传。

- 直接用浏览器打开 `index.html`，或在目录下起任意静态服务器（如 `python3 -m http.server`）
- 功能与 macOS 版一致：实时生成、L/M/Q/H 纠错、256–1024 px、自定义前景/背景色、对比度提示、复制到剪贴板、⌘/Ctrl+S 导出 PNG，另外多了 SVG 导出
- 编码器是自己实现的（`qr.js`，ISO/IEC 18004 byte 模式，Version 1–40），不依赖 CoreImage 或第三方库

验证：`node test/web/verify.mjs` 把 40 个版本 × 4 个纠错等级（含容量上限、中文、emoji）共 360 个二维码渲染成 PNG，交给 macOS Vision 解码，要求与原文逐字一致（需要 macOS 与 Xcode 命令行工具）。

## macOS 版使用

先按下文「从源码重新构建」生成 `QRMaker.app`，双击打开（构建时自动 ad-hoc 签名，本机可直接运行）。

- 在输入框输入或粘贴文本、网址等，二维码实时生成（支持中文、emoji、任意 UTF-8 内容）
- **纠错等级**：L / M / Q / H，等级越高，二维码越能抵抗污损
- **导出尺寸**：256–1024 px
- **前景色 / 背景色**：自定义颜色（前景应明显深于背景，否则可能扫不出）
- **复制二维码**：复制 PNG 到剪贴板，可直接粘贴到备忘录、微信等
- **导出 PNG**：保存为图片（快捷键 ⌘S）
- 也可以直接把预览图拖到桌面或聊天窗口

内容容量上限（字节，UTF-8）：L 约 2953 / M 约 2331 / Q 约 1663 / H 约 1273，超长会提示。

## 系统要求

macOS 13（Ventura）及以上，Apple Silicon 与 Intel 均可（通用二进制）。

## 从源码重新构建

```bash
./source/build.sh
```

脚本自动完成：编译 arm64 + x86_64 通用二进制 → 组装 `.app` → 生成图标 → ad-hoc 签名。

> 编译需要 Xcode 或命令行工具（`xcode-select --install`）。

## 目录结构

```
QRMaker.app/            # 构建后生成（不入库）
source/
  QRMakerApp.swift      # 界面（SwiftUI）
  QRCodeEngine.swift    # 二维码生成（CoreImage）
  Info.plist            # 应用元信息
  build.sh              # 一键构建脚本
qr.js / app.js / index.html / style.css   # 网页版
test/
  web/verify.mjs        # 网页版编码器自检
  gen/main.swift        # 生成测试图片与边界自检
  decode/main.swift     # 用 Vision 框架解码二维码
  clip/main.swift       # 读取剪贴板 PNG
  output/               # 验证产物（含 Vision 回测样例）
```

## 验证情况

- 6 组样例覆盖 L/M/Q/H、256/512/1024 px、中文/emoji/URL/长文本、自定义颜色，全部用系统 Vision 框架解码并与原文逐字一致
- 界面导出、复制到剪贴板、空内容与超长内容提示、对比度提示、⌘S 快捷键均实测通过

## 许可证

[MIT](LICENSE)
