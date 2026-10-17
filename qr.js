/*
 * qr.js —— 零依赖二维码编码器（ISO/IEC 18004，byte 模式，UTF-8）
 *
 * 支持 Version 1–40、纠错等级 L / M / Q / H。
 * 只做编码，不涉及任何绘制；返回布尔矩阵，由调用方决定怎么画。
 *
 *   const qr = QR.encode("你好", "M");
 *   qr.size            // 边长（模块数）
 *   qr.get(x, y)       // true = 深色模块
 *   qr.version         // 1–40
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QR = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 格式信息里的纠错等级位：L=01 M=00 Q=11 H=10
  const LEVELS = { L: 1, M: 0, Q: 3, H: 2 };
  const LEVEL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

  // 每个版本、每个纠错等级下，每块的纠错码字数（下标 0 占位）
  const ECC_CODEWORDS_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  // 每个版本、每个纠错等级下的分块数
  const NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  const MIN_VERSION = 1;
  const MAX_VERSION = 40;

  // ---------- 容量计算 ----------

  /** 该版本里能放数据的模块总数（扣除定位、对齐、时序、格式、版本信息）。 */
  function numRawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  /** 该版本、该等级下的数据码字数（不含纠错码字）。 */
  function numDataCodewords(ver, level) {
    const l = LEVEL_INDEX[level];
    return (
      Math.floor(numRawDataModules(ver) / 8) -
      ECC_CODEWORDS_PER_BLOCK[l][ver] * NUM_ERROR_CORRECTION_BLOCKS[l][ver]
    );
  }

  function charCountBits(ver) {
    return ver <= 9 ? 8 : 16; // byte 模式
  }

  /** 每个纠错等级在 Version 40 下可放的最大 UTF-8 字节数。 */
  const byteCapacity = {};
  for (const level of Object.keys(LEVELS)) {
    byteCapacity[level] = capacity(MAX_VERSION, level);
  }

  /** 指定版本、等级下最多能放多少 UTF-8 字节。 */
  function capacity(ver, level) {
    return Math.floor((numDataCodewords(ver, level) * 8 - 4 - charCountBits(ver)) / 8);
  }

  // ---------- 有限域 GF(256) 与 Reed-Solomon ----------

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
    }
    return result;
  }

  // ---------- 数据码字 ----------

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function appendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  /** 拼出完整的数据码字（模式 + 长度 + 内容 + 终止符 + 填充）。 */
  function buildDataCodewords(bytes, ver, level) {
    const capacityBits = numDataCodewords(ver, level) * 8;
    const bits = [];
    appendBits(bits, 0x4, 4); // byte 模式
    appendBits(bits, bytes.length, charCountBits(ver));
    for (const b of bytes) appendBits(bits, b, 8);

    appendBits(bits, 0, Math.min(4, capacityBits - bits.length)); // 终止符
    appendBits(bits, 0, (8 - (bits.length % 8)) % 8); // 对齐到字节

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      codewords.push(v);
    }
    for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
    return codewords;
  }

  /** 分块、计算纠错码字、按交织顺序输出。 */
  function addEccAndInterleave(data, ver, level) {
    const l = LEVEL_INDEX[level];
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[l][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[l][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, divisor);
      if (i < numShortBlocks) dat.push(0); // 占位，交织时跳过
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
      });
    }
    return result;
  }

  // ---------- 矩阵绘制 ----------

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function alignmentPositions(ver, size) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  class Matrix {
    constructor(ver, level) {
      this.ver = ver;
      this.level = level;
      this.size = ver * 4 + 17;
      const grid = () => Array.from({ length: this.size }, () => new Array(this.size).fill(false));
      this.modules = grid();
      this.isFunction = grid();
    }

    setFunction(x, y, dark) {
      this.modules[y][x] = dark;
      this.isFunction[y][x] = true;
    }

    drawFunctionPatterns() {
      const { size } = this;
      for (let i = 0; i < size; i++) {
        this.setFunction(6, i, i % 2 === 0);
        this.setFunction(i, 6, i % 2 === 0);
      }
      this.drawFinder(3, 3);
      this.drawFinder(size - 4, 3);
      this.drawFinder(3, size - 4);

      const pos = alignmentPositions(this.ver, size);
      const last = pos.length - 1;
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          // 与三个定位图案重叠的位置不画
          if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
          this.drawAlignment(pos[i], pos[j]);
        }
      }
      this.drawFormatBits(0); // 先占位，后面选定掩码再覆盖
      this.drawVersion();
    }

    drawFinder(cx, cy) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }

    drawAlignment(cx, cy) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }

    drawFormatBits(mask) {
      const { size } = this;
      const data = (LEVELS[this.level] << 3) | mask;
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;

      for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
      this.setFunction(8, 7, bit(bits, 6));
      this.setFunction(8, 8, bit(bits, 7));
      this.setFunction(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));

      for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(bits, i));
      this.setFunction(8, size - 8, true); // 固定深色模块
    }

    drawVersion() {
      if (this.ver < 7) return;
      let rem = this.ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const a = this.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.setFunction(a, b, bit(bits, i));
        this.setFunction(b, a, bit(bits, i));
      }
    }

    /** 沿「之」字形把码字写入非功能区。 */
    drawCodewords(data) {
      const { size } = this;
      let i = 0;
      for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5; // 跳过竖向时序线
        for (let vert = 0; vert < size; vert++) {
          for (let j = 0; j < 2; j++) {
            const x = right - j;
            const upward = ((right + 1) & 2) === 0;
            const y = upward ? size - 1 - vert : vert;
            if (!this.isFunction[y][x] && i < data.length * 8) {
              this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
              i++;
            }
          }
        }
      }
    }

    applyMask(mask) {
      for (let y = 0; y < this.size; y++) {
        for (let x = 0; x < this.size; x++) {
          let invert;
          switch (mask) {
            case 0: invert = (x + y) % 2 === 0; break;
            case 1: invert = y % 2 === 0; break;
            case 2: invert = x % 3 === 0; break;
            case 3: invert = (x + y) % 3 === 0; break;
            case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          }
          if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
        }
      }
    }

    /** 按规范的四条规则给当前矩阵打罚分，越低越容易扫。 */
    penaltyScore() {
      const { size, modules } = this;
      let result = 0;

      const scanLine = (line) => {
        // 规则 1：连续 5 个以上同色
        let run = 1;
        for (let i = 1; i <= size; i++) {
          if (i < size && line[i] === line[i - 1]) run++;
          else {
            if (run >= 5) result += 3 + (run - 5);
            run = 1;
          }
        }
        // 规则 3：类定位图案 1011101 前或后跟 4 个浅色（两端视为浅色静区）
        const padded = [false, false, false, false, ...line, false, false, false, false];
        for (let i = 0; i + 11 <= padded.length; i++) {
          const w = padded.slice(i, i + 11).map(Number).join("");
          if (w === "10111010000" || w === "00001011101") result += 40;
        }
      };
      for (let y = 0; y < size; y++) scanLine(modules[y]);
      for (let x = 0; x < size; x++) scanLine(modules.map((row) => row[x]));

      // 规则 2：2×2 同色块
      for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
          const c = modules[y][x];
          if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
        }
      }

      // 规则 4：深浅比例偏离 50%
      let dark = 0;
      for (const row of modules) for (const m of row) if (m) dark++;
      const total = size * size;
      const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
      result += k * 10;
      return result;
    }
  }

  // ---------- 对外接口 ----------

  /**
   * 编码文本。
   * @param {string} text 任意文本，按 UTF-8 编码
   * @param {"L"|"M"|"Q"|"H"} level 纠错等级
   * @returns {{version:number,size:number,mask:number,get:(x:number,y:number)=>boolean}}
   * @throws {RangeError} 内容超出 Version 40 容量
   */
  function encode(text, level = "M") {
    if (!(level in LEVELS)) throw new RangeError("纠错等级必须是 L / M / Q / H");
    const bytes = utf8Bytes(text);

    let ver = MIN_VERSION;
    for (;; ver++) {
      if (ver > MAX_VERSION) throw new RangeError("内容过长，无法生成二维码");
      const needBits = 4 + charCountBits(ver) + bytes.length * 8;
      if (needBits <= numDataCodewords(ver, level) * 8) break;
    }

    const data = buildDataCodewords(bytes, ver, level);
    const all = addEccAndInterleave(data, ver, level);

    const m = new Matrix(ver, level);
    m.drawFunctionPatterns();
    m.drawCodewords(all);

    let bestMask = 0;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      m.applyMask(mask);
      m.drawFormatBits(mask);
      const score = m.penaltyScore();
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
      m.applyMask(mask); // 异或两次 = 还原
    }
    m.applyMask(bestMask);
    m.drawFormatBits(bestMask);

    return {
      version: ver,
      size: m.size,
      mask: bestMask,
      get: (x, y) => x >= 0 && x < m.size && y >= 0 && y < m.size && m.modules[y][x],
    };
  }

  return { encode, capacity, byteCapacity };
});
