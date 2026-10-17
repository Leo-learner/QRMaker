#!/bin/bash
# 一键构建 QRMaker.app：编译（arm64 + x86_64 通用二进制）→ 打包 → 图标 → ad-hoc 签名
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/QRMaker.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
TARGET="13.0"
SOURCES=( "$ROOT/source/QRCodeEngine.swift" "$ROOT/source/QRMakerApp.swift" )

echo "==> [1/5] 清理旧构建"
rm -rf "$APP"
mkdir -p "$MACOS" "$RESOURCES"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> [2/5] 编译 arm64"
swiftc -disable-sandbox -parse-as-library -O -target "arm64-apple-macos$TARGET" "${SOURCES[@]}" -o "$TMP_DIR/QRMaker.arm64"

echo "==> [2/5] 编译 x86_64"
if swiftc -disable-sandbox -parse-as-library -O -target "x86_64-apple-macos$TARGET" "${SOURCES[@]}" -o "$TMP_DIR/QRMaker.x86_64" 2>/dev/null; then
  lipo -create -output "$MACOS/QRMaker" "$TMP_DIR/QRMaker.arm64" "$TMP_DIR/QRMaker.x86_64"
  echo "    通用二进制（arm64 + x86_64）"
else
  cp "$TMP_DIR/QRMaker.arm64" "$MACOS/QRMaker"
  echo "    仅 arm64（本机使用无影响）"
fi

echo "==> [3/5] 写入 Info.plist"
cp "$ROOT/source/Info.plist" "$CONTENTS/Info.plist"

echo "==> [4/5] 生成应用图标"
if swiftc -disable-sandbox -O -target "$(uname -m)-apple-macos$TARGET" \
    "$ROOT/source/QRCodeEngine.swift" "$ROOT/test/gen/main.swift" \
    -o "$TMP_DIR/qrgen" 2>/dev/null \
  && "$TMP_DIR/qrgen" icon "$TMP_DIR/icon-1024.png" >/dev/null 2>&1; then
  ICONSET="$TMP_DIR/AppIcon.iconset"
  mkdir -p "$ICONSET"
  sips -z 16   16    "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_16x16.png"       >/dev/null
  sips -z 32   32    "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_16x16@2x.png"    >/dev/null
  sips -z 32   32    "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_32x32.png"       >/dev/null
  sips -z 64   64    "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_32x32@2x.png"    >/dev/null
  sips -z 128  128   "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_128x128.png"     >/dev/null
  sips -z 256  256   "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_128x128@2x.png"  >/dev/null
  sips -z 256  256   "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_256x256.png"     >/dev/null
  sips -z 512  512   "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_256x256@2x.png"  >/dev/null
  sips -z 512  512   "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_512x512.png"     >/dev/null
  sips -z 1024 1024  "$TMP_DIR/icon-1024.png" --out "$ICONSET/icon_512x512@2x.png"  >/dev/null
  if iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" 2>/dev/null; then
    echo "    图标已生成"
  else
    echo "    图标生成失败（不影响使用）"
  fi
else
  echo "    跳过图标"
fi

echo "==> [5/5] ad-hoc 签名"
codesign --force --sign - "$APP"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|Signature" | sed 's/^/    /' || true

echo ""
echo "构建完成：$APP"
