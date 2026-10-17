(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    text: $("text"), count: $("count"), clear: $("clear"),
    qr: $("qr"), placeholder: $("placeholder"), placeholderText: $("placeholder-text"), warn: $("warn"),
    size: $("size"), sizeOut: $("size-out"), fg: $("fg"), bg: $("bg"), reset: $("reset"),
    copy: $("copy"), svg: $("svg"), png: $("png"), toast: $("toast"),
  };

  const QUIET_ZONE = 4; // ISO 标准建议的静区宽度（模块数）
  const PREVIEW_PX = 600; // 预览用 2.5 倍图，高分屏更锐利
  const DEFAULT_FG = "#000000";
  const DEFAULT_BG = "#ffffff";

  const level = () => document.querySelector('input[name="level"]:checked').value;
  const byteLength = (s) => new TextEncoder().encode(s).length;

  /** sRGB 感知亮度（0~1），与 macOS 版的对比提示用同一公式。 */
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  /** 尝试编码；内容为空或超长时返回 null。 */
  function currentCode() {
    const text = els.text.value;
    if (!text) return null;
    try {
      return QR.encode(text, level());
    } catch (e) {
      return null;
    }
  }

  /** 把二维码画到指定边长的 canvas。用整数边界取整，避免非整数缩放产生模糊边缘。 */
  function renderCanvas(code, px) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = els.bg.value;
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = els.fg.value;
    const unit = px / (code.size + QUIET_ZONE * 2);
    const edge = (i) => Math.round((i + QUIET_ZONE) * unit);
    for (let y = 0; y < code.size; y++) {
      for (let x = 0; x < code.size; x++) {
        if (code.get(x, y)) ctx.fillRect(edge(x), edge(y), edge(x + 1) - edge(x), edge(y + 1) - edge(y));
      }
    }
    return canvas;
  }

  /** 矢量版本：每个深色模块一个 path 片段，放大不失真。 */
  function renderSVG(code, px) {
    const total = code.size + QUIET_ZONE * 2;
    let d = "";
    for (let y = 0; y < code.size; y++) {
      for (let x = 0; x < code.size; x++) {
        if (code.get(x, y)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
      `<rect width="${total}" height="${total}" fill="${els.bg.value}"/>` +
      `<path d="${d}" fill="${els.fg.value}"/></svg>\n`
    );
  }

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

  // ---------- 界面刷新 ----------

  function refresh() {
    const text = els.text.value;
    const max = QR.byteCapacity[level()];
    const bytes = byteLength(text);
    const over = bytes > max;

    els.count.textContent = `字节数：${bytes} / 上限约 ${max}`;
    els.count.classList.toggle("over", over);
    els.clear.hidden = !text;
    els.sizeOut.textContent = `${els.size.value} px`;
    els.warn.hidden = !(luminance(els.bg.value) - luminance(els.fg.value) <= 0.25);

    const code = currentCode();
    if (code) {
      els.qr.src = renderCanvas(code, PREVIEW_PX).toDataURL("image/png");
      els.qr.hidden = false;
      els.placeholder.hidden = true;
    } else {
      els.qr.hidden = true;
      els.qr.removeAttribute("src");
      els.placeholder.hidden = false;
      els.placeholderText.textContent = over ? "内容过长，无法生成二维码" : "输入内容后在此预览";
    }
    for (const b of [els.copy, els.svg, els.png]) b.disabled = !code;
  }

  let toastTimer;
  function toast(message) {
    els.toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.textContent = ""; }, 2500);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- 操作 ----------

  async function exportPNG() {
    const code = currentCode();
    if (!code) return;
    const px = Number(els.size.value);
    download(await toBlob(renderCanvas(code, px)), "二维码.png");
    toast(`已导出 PNG（${px} × ${px}）`);
  }

  function exportSVG() {
    const code = currentCode();
    if (!code) return;
    download(new Blob([renderSVG(code, Number(els.size.value))], { type: "image/svg+xml" }), "二维码.svg");
    toast("已导出 SVG");
  }

  async function copyImage() {
    const code = currentCode();
    if (!code) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast("此浏览器不支持复制图片，请用「导出 PNG」");
      return;
    }
    try {
      // 把 Promise 直接交给 ClipboardItem：Safari 要求在用户手势内同步创建
      const px = Number(els.size.value);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(renderCanvas(code, px)) })]);
      toast("已复制二维码到剪贴板，可直接粘贴");
    } catch (e) {
      toast("复制失败，请用「导出 PNG」");
    }
  }

  // ---------- 事件 ----------

  els.text.addEventListener("input", refresh);
  els.size.addEventListener("input", refresh);
  els.fg.addEventListener("input", refresh);
  els.bg.addEventListener("input", refresh);
  document.querySelectorAll('input[name="level"]').forEach((r) => r.addEventListener("change", refresh));
  els.clear.addEventListener("click", () => { els.text.value = ""; refresh(); els.text.focus(); });
  els.reset.addEventListener("click", () => { els.fg.value = DEFAULT_FG; els.bg.value = DEFAULT_BG; refresh(); });
  els.png.addEventListener("click", exportPNG);
  els.svg.addEventListener("click", exportSVG);
  els.copy.addEventListener("click", copyImage);

  // ⌘S / Ctrl+S 导出 PNG，与 macOS 版一致
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      exportPNG();
    }
  });

  refresh();
})();
