// 网页版编码器自检：覆盖 40 个版本 × 4 个纠错等级，另加中文 / emoji / 边界用例。
// 把每个二维码渲染成 PNG，交给系统 Vision 解码，必须与原文逐字一致。
//
// 用法：node test/web/verify.mjs   （需要 macOS，且已编译 test/decode）
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const QR = createRequire(import.meta.url)(join(root, "qr.js"));

// --- 解码器：优先用已编译的，没有就现编 ---
let decoder = join(root, "test", "build", "qrdecode");
if (!existsSync(decoder)) {
  decoder = join(mkdtempSync(join(tmpdir(), "qrdec-")), "qrdecode");
  execFileSync("swiftc", ["-O", join(root, "test", "decode", "main.swift"), "-o", decoder], { stdio: "inherit" });
}

// --- 最小 PNG 写入（灰度，8 位）---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(qr, scale, quiet = 4) {
  const n = (qr.size + quiet * 2) * scale;
  const raw = Buffer.alloc(n * (n + 1), 255);
  for (let y = 0; y < n; y++) {
    raw[y * (n + 1)] = 0;
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      raw[y * (n + 1) + 1 + x] = qr.get(mx, my) ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0);
  ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 0; // 灰度
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = mkdtempSync(join(tmpdir(), "qrweb-"));
let failures = 0;
let count = 0;

function check(label, text, level) {
  const qr = QR.encode(text, level);
  const file = join(dir, `${count++}.png`);
  writeFileSync(file, png(qr, qr.size > 100 ? 5 : 8));
  const got = execFileSync(decoder, [file], { encoding: "utf8" }).replace(/\n$/, "");
  const ok = got === text;
  if (!ok) {
    failures++;
    console.log(`✗ ${label}  v${qr.version} mask${qr.mask}  期望 ${JSON.stringify(text.slice(0, 40))}  得到 ${JSON.stringify(got.slice(0, 40))}`);
  }
  return qr;
}

// 可复现的伪随机 ASCII，避免重复内容让错误被掩盖
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ascii = (n) => Array.from({ length: n }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join("");

// 1) 每个版本 × 每个等级：该版本的最小长度（上一版容量 + 1）和最大长度（本版容量）
for (const level of ["L", "M", "Q", "H"]) {
  for (let v = 1; v <= 40; v++) {
    for (const n of new Set([v === 1 ? 1 : QR.capacity(v - 1, level) + 1, QR.capacity(v, level)])) {
      const qr = check(`${level} v${v} (${n}B)`, ascii(n), level);
      if (qr.version !== v) { failures++; console.log(`✗ ${level} ${n}B 期望 v${v} 实际 v${qr.version}`); }
    }
  }
}

// 2) 容量上限本身必须能解、超过 1 字节必须报错
for (const level of ["L", "M", "Q", "H"]) {
  const max = QR.byteCapacity[level];
  check(`${level} 容量上限 ${max}B`, ascii(max), level);
  let threw = false;
  try { QR.encode(ascii(max + 1), level); } catch (e) { threw = e instanceof RangeError; }
  if (!threw) { failures++; console.log(`✗ ${level} 超出容量 1 字节应抛 RangeError`); }
}

// 3) 多字节与特殊内容
const samples = [
  "https://example.com/path?q=二维码&x=1",
  "你好，世界！这是一个二维码生成器。",
  "Emoji 😀🎉🚀 mix 中文 and English",
  "WIFI:T:WPA;S:MyNet;P:pass123;;",
  "a", "0", " ", "line1\nline2".replace("\n", " "),
  "字".repeat(300),
];
for (const level of ["L", "M", "Q", "H"]) for (const s of samples) check(`${level} ${JSON.stringify(s.slice(0, 16))}`, s, level);

// 4) 空串应该能编码（界面层负责拦截，编码器不该崩）
QR.encode("", "M");

console.log(`\n${count} 个二维码，容量表：${JSON.stringify(QR.byteCapacity)}`);
if (JSON.stringify(QR.byteCapacity) !== JSON.stringify({ L: 2953, M: 2331, Q: 1663, H: 1273 })) {
  failures++;
  console.log("✗ 容量表与 macOS 版（2953/2331/1663/1273）不一致");
}
console.log(failures === 0 ? "全部通过 ✓" : `失败 ${failures} 项`);
process.exit(failures === 0 ? 0 : 1);
