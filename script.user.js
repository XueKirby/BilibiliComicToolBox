// ==UserScript==
// @name         B 漫工具箱
// @namespace    https://github.com/SofiaXu/BilibiliComicToolBox
// @version      2.9.0
// @description  进行一键购买和下载漫画的工具箱，将阅读页面图片替换成原图大小
// @author       Aoba Xu
// @match        https://manga.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @require      https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @license      MIT
// ==/UserScript==

(async function () {
  "use strict";

  const VERSION = "2.9.0";

  /* ================================================================ *
   * 接口
   * ================================================================ */
  const api = {
    buyEpisode: async (epId, buyMethod = 1, couponIds = undefined) => {
      const body = { buy_method: buyMethod, ep_id: epId };
      if (couponIds) body.coupon_ids = couponIds;
      const res = await fetch(
        "https://manga.bilibili.com/twirp/comic.v1.Comic/BuyEpisode?device=pc&platform=web",
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify(body),
          method: "POST",
          credentials: "include",
        }
      );
      return await res.json();
    },

    getEpisodeBuyInfo: async (epId) => {
      const res = await fetch(
        "https://manga.bilibili.com/twirp/comic.v1.Comic/GetEpisodeBuyInfo?device=pc&platform=web",
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify({ ep_id: epId }),
          method: "POST",
          credentials: "include",
        }
      );
      return await res.json();
    },

    updateAutoBuyComic: async (autoPayId, status = 1) => {
      const res = await fetch(
        "https://manga.bilibili.com/twirp/user.v1.User/UpdateAutoBuyComic?device=pc&platform=web",
        {
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify({
            id: autoPayId,
            order: [2, 3, 1],
            auto_pay_status: status,
            biz_type: 0,
          }),
          method: "POST",
          credentials: "include",
        }
      );
      return await res.json();
    },
  };

  /* ================================================================ *
   * 阅读器：从 Vue 组件内存里取带签名的原图地址
   * ================================================================ */
  const getReaderImages = async (onProgress = null, maxConcurrent = 3) => {
    const host = document.querySelector(".manga-reader");
    const vue = host && host.__vue__;
    if (!vue) throw new Error("未找到阅读器组件");

    const epId = vue.$data.episodeId;
    const all = vue.$data.allEpisodeReaderImages;
    const list = all && all[epId];
    if (!list || !list.length) throw new Error("阅读器图片数据为空");

    // 等页面自然解锁 + 主动逐张触发 loadTargetEpisodeImages（限速，模拟翻页节奏）
    const total = list.length;
    const pending = list.filter((x) => !x._completeUrl);
    if (onProgress) onProgress(total - pending.length, total);

    const loadOne = (item) => {
      try {
        const r = vue.loadTargetEpisodeImages(item, false);
        return r && typeof r.catch === "function" ? r.catch(() => {}) : Promise.resolve();
      } catch (e) {
        return Promise.resolve();
      }
    };

    const queue = pending.slice();
    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item._completeUrl) continue;
        await loadOne(item);
        // token 获取是异步的，轮询等待该图的 URL 出现
        for (let i = 0; i < 40 && !item._completeUrl; i++) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (onProgress) {
          onProgress(list.filter((x) => x._completeUrl).length, total);
        }
      }
    };
    await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));

    const images = list
      .slice()
      .sort((a, b) => a._imageIndex - b._imageIndex)
      .map((x) => ({
        idx: x._imageIndex,
        url: x._completeUrl,
        hitEncrypt: x._hitEncrpyt,
        width: x._width,
        height: x._height,
      }));
    const failed = images.filter((x) => !x.url).length;

    return {
      epId,
      title: document.title.replace(/ - 哔哩哔哩漫画.*/, "") || String(epId),
      images,
      failed,
    };
  };

  const safeFileName = (name) =>
    String(name).replace(/[\\/:*?"<>|]/g, "_").replace(/\.\.$/, "_");

  /* ================================================================ *
   * 样式
   * ================================================================ */
  const CSS = `
/* ---------- 浮层骨架与主题变量 ---------- */
.b-toolbox-popup {
  --bmt-accent: #fb7299;
  --bmt-accent-2: #00aeec;
  --bmt-bg: rgba(255, 255, 255, 0.94);
  --bmt-fg: #1f2329;
  --bmt-fg-dim: #8a919b;
  --bmt-line: rgba(15, 23, 42, 0.09);
  --bmt-field: rgba(15, 23, 42, 0.05);
  --bmt-field-hover: rgba(251, 114, 153, 0.1);
  --bmt-track: rgba(15, 23, 42, 0.12);
  --bmt-logo-bg: #ffffff;
  --bmt-notice-bg: rgba(208, 48, 80, 0.07);
  --bmt-notice-line: rgba(208, 48, 80, 0.22);
  --bmt-notice-fg: #c22a4d;
  --bmt-shadow: 0 18px 48px -16px rgba(15, 23, 42, 0.45), 0 2px 8px rgba(15, 23, 42, 0.08);
  position: fixed;
  top: 76px;
  right: 20px;
  z-index: 2147483000;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  color: var(--bmt-fg);
}

.b-toolbox-popup.b-toolbox-dark {
  --bmt-bg: rgba(24, 25, 29, 0.9);
  --bmt-fg: #eceef1;
  --bmt-fg-dim: #9aa1ab;
  --bmt-line: rgba(255, 255, 255, 0.1);
  --bmt-field: rgba(255, 255, 255, 0.07);
  --bmt-field-hover: rgba(251, 114, 153, 0.16);
  --bmt-track: rgba(255, 255, 255, 0.14);
  --bmt-logo-bg: rgba(255, 255, 255, 0.12);
  --bmt-notice-bg: rgba(255, 122, 138, 0.1);
  --bmt-notice-line: rgba(255, 122, 138, 0.26);
  --bmt-notice-fg: #ff9aa8;
  --bmt-shadow: 0 20px 56px -18px rgba(0, 0, 0, 0.8), 0 2px 12px rgba(0, 0, 0, 0.45);
  color-scheme: dark;
}

.b-toolbox-popup,
.b-toolbox-popup *,
.b-toolbox-popup *::before,
.b-toolbox-popup *::after {
  box-sizing: border-box;
}

.b-toolbox-d-flex {
  display: flex;
}

.b-toolbox-d-none {
  display: none !important;
}

.b-toolbox-flex-column {
  flex-direction: column;
}

/* ---------- 面板 ---------- */
.b-toolbox-panel {
  display: none;
  flex-direction: column;
  gap: 12px;
  width: 320px;
  max-height: min(72vh, 640px);
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--bmt-line);
  border-radius: 16px;
  background: var(--bmt-bg);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  backdrop-filter: blur(20px) saturate(180%);
  box-shadow: var(--bmt-shadow);
  color: var(--bmt-fg);
  scrollbar-width: thin;
  scrollbar-color: var(--bmt-line) transparent;
  animation: b-toolbox-pop 0.24s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.b-toolbox-panel.b-toolbox-d-flex {
  display: flex;
}

.b-toolbox-panel::-webkit-scrollbar {
  width: 6px;
}

.b-toolbox-panel::-webkit-scrollbar-thumb {
  background: var(--bmt-line);
  border-radius: 999px;
}

.b-toolbox-panel::-webkit-scrollbar-track {
  background: transparent;
}

@keyframes b-toolbox-pop {
  from {
    opacity: 0;
    transform: translate3d(0, -8px, 0) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* ---------- 标题区 ---------- */
.b-toolbox-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--bmt-line);
}

.b-toolbox-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.b-toolbox-logo {
  position: relative;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  overflow: hidden;
  border-radius: 7px;
  background-color: var(--bmt-logo-bg);
  box-shadow: inset 0 0 0 1px var(--bmt-line), 0 4px 10px -6px rgba(15, 23, 42, 0.45);
}

.b-toolbox-logo-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 2px;
  object-fit: contain;
}

.b-toolbox-logo-fallback {
  display: none;
  place-items: center;
  width: 100%;
  height: 100%;
  background-image: linear-gradient(135deg, var(--bmt-accent), var(--bmt-accent-2));
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.b-toolbox-logo.is-fallback .b-toolbox-logo-img {
  display: none;
}

.b-toolbox-logo.is-fallback .b-toolbox-logo-fallback {
  display: grid;
}

.b-toolbox-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.b-toolbox-badge {
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid var(--bmt-line);
  border-radius: 999px;
  color: var(--bmt-fg-dim);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
}

.b-toolbox-subtitle {
  color: var(--bmt-fg-dim);
  font-size: 11.5px;
}

.b-toolbox-divider {
  height: 1px;
  background: var(--bmt-line);
}

/* ---------- 表单 ---------- */
.b-toolbox-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.b-toolbox-label {
  color: var(--bmt-fg-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.b-toolbox-select,
.b-toolbox-input {
  width: 100%;
  padding: 8px 11px;
  border: 1px solid var(--bmt-line);
  border-radius: 10px;
  outline: none;
  background-color: var(--bmt-field);
  color: var(--bmt-fg);
  font: inherit;
  font-size: 12.5px;
  transition: border-color 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
}

.b-toolbox-select {
  padding-right: 30px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a919b' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px;
}

.b-toolbox-select:hover,
.b-toolbox-input:hover {
  background-color: var(--bmt-field-hover);
}

.b-toolbox-select:focus-visible,
.b-toolbox-input:focus-visible {
  border-color: var(--bmt-accent);
  box-shadow: 0 0 0 3px rgba(251, 114, 153, 0.18);
}

.b-toolbox-select:disabled,
.b-toolbox-input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.b-toolbox-select option {
  background: #fff;
  color: #1f2329;
}

.b-toolbox-dark .b-toolbox-select option {
  background: #24252a;
  color: #eceef1;
}

.b-toolbox-check {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 12.5px;
}

.b-toolbox-check input {
  position: relative;
  width: 16px;
  height: 16px;
  flex: none;
  margin: 0;
  border: 1.5px solid var(--bmt-line);
  border-radius: 5px;
  background-color: var(--bmt-field);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  transition: border-color 0.16s ease, background-color 0.16s ease;
}

.b-toolbox-check input:hover {
  border-color: var(--bmt-accent);
}

.b-toolbox-check input:checked {
  border-color: transparent;
  background-image: linear-gradient(135deg, var(--bmt-accent), #ff9db8);
}

.b-toolbox-check input:checked::after {
  content: "";
  position: absolute;
  inset: 0;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 12.5l5 5L20 6.5'/%3E%3C/svg%3E")
    no-repeat center / 10px 10px;
}

.b-toolbox-check input:focus-visible {
  outline: 2px solid var(--bmt-accent);
  outline-offset: 2px;
}

.b-toolbox-check input:disabled,
.b-toolbox-check:has(input:disabled) {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------- 按钮 ---------- */
.b-toolbox-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 11px;
  background-color: var(--bmt-field);
  color: var(--bmt-fg);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.16s ease, box-shadow 0.16s ease,
    transform 0.12s ease, opacity 0.16s ease;
}

.b-toolbox-btn:hover {
  background-color: var(--bmt-field-hover);
}

.b-toolbox-btn:active {
  transform: translateY(1px);
}

.b-toolbox-btn:focus-visible {
  outline: 2px solid var(--bmt-accent);
  outline-offset: 2px;
}

.b-toolbox-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

.b-toolbox-btn-primary {
  background-image: linear-gradient(135deg, #fb7299, #ff9db8);
  color: #fff;
  box-shadow: 0 10px 22px -12px rgba(251, 114, 153, 1);
}

.b-toolbox-btn-primary:hover {
  background-image: linear-gradient(135deg, #ff86a9, #ffb1c9);
}

.b-toolbox-btn-primary[disabled] {
  background-image: none;
  background-color: var(--bmt-accent);
}

/* ---------- 浮动开关 ---------- */
.b-toolbox-toggle-wrap {
  align-items: flex-end;
  gap: 8px;
}

.b-toolbox-toolbox-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 16px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background-image: linear-gradient(135deg, #fb7299, #ff8fb1);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 10px 24px -12px rgba(251, 114, 153, 1),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: transform 0.16s cubic-bezier(0.22, 0.61, 0.36, 1),
    box-shadow 0.16s ease, filter 0.16s ease;
}

.b-toolbox-toolbox-btn svg {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.b-toolbox-toolbox-btn span {
  line-height: 1;
}

.b-toolbox-toolbox-btn:hover {
  transform: translateY(-1px);
  filter: saturate(1.08) brightness(1.03);
  box-shadow: 0 14px 28px -12px rgba(251, 114, 153, 1),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.b-toolbox-toolbox-btn:active {
  transform: translateY(0);
}

.b-toolbox-toolbox-btn:focus-visible {
  outline: 2px solid #fb7299;
  outline-offset: 3px;
}

.b-toolbox-toolbox-btn.is-active {
  filter: saturate(0.92);
  box-shadow: 0 6px 16px -12px rgba(251, 114, 153, 1),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

/* ---------- 分段进度条 ---------- */
.b-toolbox-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.b-toolbox-progress-track {
  position: relative;
  display: flex;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bmt-track);
}

.b-toolbox-progress-bar {
  width: 0;
  height: 100%;
  transition: width 0.35s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.b-toolbox-progress-coupon {
  background-image: linear-gradient(90deg, #2f7df6, #5aa2ff);
}

.b-toolbox-progress-universal {
  background-image: linear-gradient(90deg, #e09a12, #f7c948);
}

.b-toolbox-progress.is-running .b-toolbox-progress-track::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(
    100deg,
    transparent 25%,
    rgba(255, 255, 255, 0.38) 50%,
    transparent 75%
  );
  background-size: 220% 100%;
  animation: b-toolbox-sheen 1.5s linear infinite;
  pointer-events: none;
}

@keyframes b-toolbox-sheen {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -40% 0;
  }
}

.b-toolbox-progress-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--bmt-fg-dim);
  font-size: 11.5px;
  line-height: 1;
}

.b-toolbox-legend {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.b-toolbox-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.b-toolbox-dot-coupon {
  background-image: linear-gradient(135deg, #2f7df6, #5aa2ff);
}

.b-toolbox-dot-universal {
  background-image: linear-gradient(135deg, #e09a12, #f7c948);
}

.b-toolbox-legend b,
.b-toolbox-progress-count {
  color: var(--bmt-fg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.b-toolbox-progress-count {
  margin-left: auto;
  letter-spacing: 0.02em;
}

/* ---------- 报错提示（仅出错时出现） ---------- */
.b-toolbox-notice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--bmt-notice-line);
  border-radius: 10px;
  background: var(--bmt-notice-bg);
  color: var(--bmt-notice-fg);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.b-toolbox-notice[hidden] {
  display: none;
}

/* ---------- 单行状态 ---------- */
.b-toolbox-statusline {
  color: var(--bmt-fg-dim);
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

.b-toolbox-statusline[hidden] {
  display: none;
}

.b-toolbox-hint {
  color: var(--bmt-fg-dim);
  font-size: 11.5px;
  line-height: 1.5;
}

/* ---------- 响应式 / 无障碍 ---------- */
@media (max-width: 640px) {
  .b-toolbox-popup {
    top: 56px;
    right: 8px;
    gap: 8px;
  }
  .b-toolbox-panel {
    width: min(84vw, 320px);
    max-height: 64vh;
  }
}

@media (prefers-reduced-motion: reduce) {
  .b-toolbox-panel {
    animation: none;
  }
  .b-toolbox-btn,
  .b-toolbox-toolbox-btn,
  .b-toolbox-select,
  .b-toolbox-input,
  .b-toolbox-check input,
  .b-toolbox-progress-bar {
    transition: none;
  }
  .b-toolbox-progress.is-running .b-toolbox-progress-track::after {
    animation: none;
  }
}
`;

  const createStyles = () => {
    const existed = document.getElementById("b-toolbox-style");
    if (existed) return existed;
    const style = document.createElement("style");
    style.id = "b-toolbox-style";
    style.textContent = CSS;
    (document.head || document.documentElement).append(style);
    return style;
  };

  /* ================================================================ *
   * 通用组件
   * ================================================================ */
  const h = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const createPopupPanel = (options = {}) => {
    const panel = h("div", "b-toolbox-popup" + (options.dark ? " b-toolbox-dark" : ""));
    (document.body || document.documentElement).append(panel);
    return panel;
  };

  const FAVICON_FALLBACK =
    "https://i0.hdslb.com/bfs/activity-plat/static/20250402/1e16455b3e0f77ddb2522c3ae2aba5d9/MLIQlScSGl.ico";

  // 标题图标用站点自己的 favicon，取不到就退回内置的渐变 B
  const mountFavicon = (logoEl) => {
    if (!logoEl) return;
    const img = logoEl.querySelector(".b-toolbox-logo-img");
    if (!img) return;
    const link = document.querySelector('link[rel~="icon"]');
    img.addEventListener("error", () => logoEl.classList.add("is-fallback"), { once: true });
    img.src = (link && link.href) || FAVICON_FALLBACK;
  };

  const createToolboxPanel = (parentPanel, subtitle) => {
    const panel = h("div", "b-toolbox-panel b-toolbox-d-none b-toolbox-flex-column");
    panel.innerHTML = `
      <div class="b-toolbox-header">
        <div class="b-toolbox-brand">
          <span class="b-toolbox-logo" aria-hidden="true">
            <img class="b-toolbox-logo-img" alt="" />
            <span class="b-toolbox-logo-fallback">B</span>
          </span>
          <span class="b-toolbox-title">B 漫工具箱</span>
          <span class="b-toolbox-badge">v${VERSION}</span>
        </div>
        <div class="b-toolbox-subtitle"></div>
      </div>
    `;
    panel.querySelector(".b-toolbox-subtitle").textContent = subtitle || "";
    mountFavicon(panel.querySelector(".b-toolbox-logo"));
    parentPanel.append(panel);
    return panel;
  };

  const createProgress = (parentPanel) => {
    const wrap = h("div", "b-toolbox-progress");
    const track = h("div", "b-toolbox-progress-track");
    const couponBar = h("div", "b-toolbox-progress-bar b-toolbox-progress-coupon");
    const universalBar = h("div", "b-toolbox-progress-bar b-toolbox-progress-universal");
    track.append(couponBar, universalBar);

    const legend = (dotClass, label) => {
      const item = h("span", "b-toolbox-legend");
      const count = h("b", "", "0");
      item.append(h("i", "b-toolbox-dot " + dotClass), h("span", "", label), count);
      return { item, count };
    };
    const couponLegend = legend("b-toolbox-dot-coupon", "漫读券");
    const universalLegend = legend("b-toolbox-dot-universal", "通用券");
    const counter = h("span", "b-toolbox-progress-count", "0 / 0");

    const meta = h("div", "b-toolbox-progress-meta");
    meta.append(couponLegend.item, universalLegend.item, counter);
    wrap.append(track, meta);
    parentPanel.append(wrap);

    let total = 0;
    let coupon = 0;
    let universal = 0;

    const render = () => {
      const ratio = (n) => (total > 0 ? (n / total) * 100 : 0);
      couponBar.style.width = ratio(coupon) + "%";
      universalBar.style.width = ratio(universal) + "%";
      couponLegend.count.textContent = String(coupon);
      universalLegend.count.textContent = String(universal);
      counter.textContent = coupon + universal + " / " + total;
    };
    render();

    return {
      element: wrap,
      reset: (nextTotal) => {
        total = nextTotal;
        coupon = 0;
        universal = 0;
        render();
      },
      running: (active) => {
        wrap.classList.toggle("is-running", !!active);
      },
      add: (kind) => {
        if (kind === "coupon") coupon++;
        else if (kind === "universal") universal++;
        render();
      },
    };
  };

  const createNotice = (parentPanel) => {
    const box = h("div", "b-toolbox-notice");
    box.hidden = true;
    parentPanel.append(box);
    let lines = [];
    return {
      element: box,
      clear: () => {
        lines = [];
        box.textContent = "";
        box.hidden = true;
      },
      show: (text) => {
        lines.push(String(text));
        if (lines.length > 4) lines = lines.slice(-4);
        box.textContent = "";
        for (const line of lines) box.append(h("div", "", line));
        box.hidden = false;
      },
    };
  };

  const createStatusLine = (parentPanel) => {
    const line = h("div", "b-toolbox-statusline");
    line.hidden = true;
    parentPanel.append(line);
    return {
      element: line,
      set: (text) => {
        const value = text == null ? "" : String(text);
        line.textContent = value;
        line.hidden = value === "";
      },
      clear: () => {
        line.textContent = "";
        line.hidden = true;
      },
    };
  };
  const TOOLBOX_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M3 8.5h18V20H3z"/>' +
    '<path d="M9 8.5V5.5h6v3"/>' +
    '<path d="M3 13.5h6.5v2.5h5v-2.5H21"/>' +
    "</svg>";

  const createToolboxShowBtn = (parentPanel, showablePanel) => {
    const container = h("div", "b-toolbox-d-flex b-toolbox-flex-column b-toolbox-toggle-wrap");
    parentPanel.append(container);

    const btn = h("button", "b-toolbox-toolbox-btn");
    btn.type = "button";
    btn.innerHTML = TOOLBOX_ICON + "<span>工具箱</span>";
    btn.setAttribute("aria-expanded", "false");
    container.append(btn);

    btn.onclick = () => {
      const open = showablePanel.classList.toggle("b-toolbox-d-flex");
      showablePanel.classList.toggle("b-toolbox-d-none", !open);
      btn.classList.toggle("is-active", open);
      btn.setAttribute("aria-expanded", String(open));
    };
    return btn;
  };

  /* ================================================================ *
   * 详情页：用券批量购买
   * ================================================================ */
  /* ================================================================ *
   * 详情页：用券批量购买（进度条 + 仅报错）
   * ================================================================ */
  if (location.pathname.match(/^\/detail\/mc\d+$/)) {
    createStyles();
    const popupPanel = createPopupPanel();
    const toolboxPanel = createToolboxPanel(popupPanel, "正在读取目录…");
    createToolboxShowBtn(popupPanel, toolboxPanel);

    const subtitleEl = toolboxPanel.querySelector(".b-toolbox-subtitle");
    const progress = createProgress(toolboxPanel);
    const notice = createNotice(toolboxPanel);

    let comicInfo = null;
    const owned = new Set(); // 本次会话中已解锁的章节，结束后刷新进度用

    const readSeasonData = () => {
      const el = document.querySelector(".episode-list-component");
      const vue = el && el.__vue__;
      return (vue && vue.$props && vue.$props.seasonData) || null;
    };

    const waitFor = (fn, timeout = 30000, interval = 200) =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const timer = setInterval(() => {
          try {
            const v = fn();
            if (v) {
              clearInterval(timer);
              resolve(v);
            }
          } catch (e) {
            /* 组件尚未挂载，继续轮询 */
          }
          if (Date.now() - start > timeout) {
            clearInterval(timer);
            reject(new Error("等待目录数据超时"));
          }
        }, interval);
      });

    const loadComicInfo = async () => {
      const seasonData = await waitFor(readSeasonData);
      comicInfo = {
        data: {
          title: seasonData._title,
          ep_list: seasonData.episodeList.map((e) => ({
            id: Number(e.id),
            ord: e.ord,
            title: e.title,
            is_locked: !!e.isLocked,
          })),
        },
      };
      return comicInfo;
    };

    // 先吃页面最新状态，再叠加本地已购记录，得到当前仍未购买的章节
    const pendingEps = () => {
      if (!comicInfo) return [];
      const eps = comicInfo.data.ep_list;
      const seasonData = readSeasonData();
      if (seasonData) {
        const byId = new Map(eps.map((e) => [e.id, e]));
        for (const item of seasonData.episodeList || []) {
          const ep = byId.get(Number(item.id));
          if (!ep) continue;
          ep.is_locked = !!item.isLocked;
          if (item.title) ep.title = item.title;
        }
      }
      return eps.filter((ep) => ep.is_locked && !owned.has(ep.id));
    };

    const syncPanel = () => {
      if (!comicInfo) return 0;
      const total = comicInfo.data.ep_list.length;
      const left = pendingEps().length;
      subtitleEl.textContent = left
        ? "共 " + total + " 话 · 未解锁 " + left + " 话"
        : "共 " + total + " 话 · 已全部解锁";
      return left;
    };

    const applyBuy = (buyRes, ep, kind) => {
      if (buyRes && buyRes.msg === "本话无需购买") {
        owned.add(ep.id);
        return;
      }
      const code = buyRes && buyRes.code;
      if (typeof code === "number" && code !== 0) {
        notice.show("第" + ep.ord + "话「" + ep.title + "」购买失败：" + (buyRes.msg || code));
        return;
      }
      owned.add(ep.id);
      progress.add(kind);
    };

    const createBatchAutoPayBtn = (parentPanel) => {
      const options = h("div", "b-toolbox-field");
      const checkRow = h("label", "b-toolbox-check");
      const checkBox = h("input");
      checkBox.type = "checkbox";
      checkBox.checked = false;
      checkRow.append(checkBox, h("span", "", "使用通用券"));
      options.append(checkRow);
      parentPanel.append(options);

      parentPanel.append(h("div", "b-toolbox-divider"));

      const btn = h("button", "b-toolbox-btn b-toolbox-btn-primary", "用券购买剩余项");
      btn.type = "button";
      parentPanel.append(btn);

      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const idleText = btn.textContent;
        btn.disabled = true;
        notice.clear();
        try {
          if (!comicInfo) await loadComicInfo();
          const targets = pendingEps().reverse();
          if (!targets.length) {
            syncPanel();
            return;
          }

          const useUniversal = checkBox.checked;
          progress.reset(targets.length);
          progress.running(true);
          btn.textContent = "购买中…";

          for (const ep of targets) {
            const res = await api.getEpisodeBuyInfo(ep.id);
            if (!res || res.code !== 0 || !res.data) {
              notice.show(
                "第" + ep.ord + "话「" + ep.title + "」读取失败：" +
                  ((res && (res.msg || res.code)) || "无响应")
              );
              break;
            }

            const data = res.data;
            if (data.allow_coupon && data.remain_coupon > 0) {
              applyBuy(await api.buyEpisode(ep.id, 2, data.recommend_coupon_ids), ep, "coupon");
            } else if (data.remain_silver > 0 && useUniversal) {
              applyBuy(await api.buyEpisode(ep.id, 5), ep, "universal");
            } else {
              if (!data.allow_coupon) {
                notice.show("第" + ep.ord + "话「" + ep.title + "」不可用券购买");
              }
              if (data.remain_coupon <= 0) {
                notice.show("券不足，已停止购买");
                break;
              }
              notice.show("未知错误，已停止：" + (res.msg || "无提示"));
              break;
            }
          }
        } catch (e) {
          notice.show("出错了：" + ((e && e.message) || e));
        } finally {
          progress.running(false);
          btn.textContent = idleText;
          // 结束后刷新未购买进度，下一次点击以新进度为准
          const left = syncPanel();
          btn.disabled = left === 0;
        }
      });

      return btn;
    };

    const buyBtn = createBatchAutoPayBtn(toolboxPanel);

    // 进页面先读一次目录，让默认灰色的进度条摆好基数
    (async () => {
      try {
        await loadComicInfo();
        const left = syncPanel();
        progress.reset(left);
        buyBtn.disabled = left === 0;
      } catch (e) {
        subtitleEl.textContent = "读取目录失败，点击按钮重试";
      }
    })();
  }

  /* ================================================================ *
   * 阅读页：下载 CBZ / 分辨率 / 自动翻页
   * ================================================================ */
  if (location.pathname.match(/^\/mc\d+\/\d+$/)) {
    createStyles();
    const popupPanel = createPopupPanel({ dark: true });
    const toolboxPanel = createToolboxPanel(popupPanel, "下载 · 清晰度 · 自动翻页");
    createToolboxShowBtn(popupPanel, toolboxPanel);
    const status = createStatusLine(toolboxPanel);
    const notice = createNotice(toolboxPanel);

    const createDownloadEpBtn = (parentPanel) => {
      const btn = h("button", "b-toolbox-btn b-toolbox-btn-primary", "下载本章（CBZ）");
      btn.type = "button";
      parentPanel.append(btn);

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        notice.clear();
        status.set("读取图片列表…");
        try {
          const { epId, title, images, failed } = await getReaderImages((d, t) => {
            status.set("已解锁 " + d + "/" + t);
          });
          status.set(
            "共 " + images.length + " 张" +
              (failed ? "（" + failed + " 张未获取，已跳过）" : "") + "，开始下载…"
          );

          const zip = new JSZip();
          const padding = Math.max(2, Math.ceil(Math.log10(images.length + 1)));
          let done = 0;

          for (const img of images) {
            if (!img.url) continue;
            const res = await fetch(img.url);
            if (!res.ok) {
              notice.show("第 " + (img.idx + 1) + " 张下载失败 " + res.status);
              continue;
            }
            const blob = await res.blob();
            const ext = (img.url.match(/\.(jpe?g|png|webp|avif)/i) || ["", "jpg"])[1];
            zip.file((img.idx + 1).toString().padStart(padding, "0") + "." + ext, blob);
            done++;
            if (done % 5 === 0) status.set("下载中 " + done + "/" + images.length);
          }

          status.set("打包中（" + done + " 张）…");
          const blob = await zip.generateAsync({ type: "blob" });
          const a = document.createElement("a");
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = safeFileName(title) + "_ep" + epId + ".cbz";
          a.click();
          URL.revokeObjectURL(url);
          status.set("已导出 " + done + " 张");
        } catch (e) {
          status.clear();
          notice.show("下载失败：" + ((e && e.message) || e));
        } finally {
          btn.disabled = false;
        }
      });
    };
    createDownloadEpBtn(toolboxPanel);

    toolboxPanel.append(h("div", "b-toolbox-divider"));

    /* ---- 分辨率 ---- */
    const RESOLUTION_KEY = "bToolboxResolution";
    const RESOLUTIONS = [
      ["@800w.jpg", "低清 · 800w · JPG"],
      ["@1100w.jpg", "默认 · 1100w · JPG"],
      ["@1400w.jpg", "超清 · 1400w · JPG"],
      ["", "原图 · 不缩放 · JPG"],
      ["@800w.webp", "低清 · 800w · WebP"],
      ["@1100w.webp", "高清 · 1100w · WebP"],
      ["@1400w.webp", "超清 · 1400w · WebP"],
      ["@1100w.png", "仅转码 · 不缩放 · PNG"],
    ];

    const resolutionField = h("div", "b-toolbox-field");
    resolutionField.append(h("div", "b-toolbox-label", "图片分辨率"));
    const resolutionSelect = h("select", "b-toolbox-select");
    for (const [value, text] of RESOLUTIONS) {
      const option = h("option", "", text);
      option.value = value;
      resolutionSelect.append(option);
    }
    resolutionField.append(resolutionSelect);
    toolboxPanel.append(resolutionField);

    const storedResolution = localStorage.getItem(RESOLUTION_KEY);
    resolutionSelect.value = storedResolution == null ? "" : storedResolution;
    if (storedResolution == null) localStorage.setItem(RESOLUTION_KEY, "");
    XMLHttpRequest.prototype.resolution = resolutionSelect.value;
    resolutionSelect.addEventListener("change", () => {
      localStorage.setItem(RESOLUTION_KEY, resolutionSelect.value);
      XMLHttpRequest.prototype.resolution = resolutionSelect.value;
    });

    toolboxPanel.append(h("div", "b-toolbox-divider"));

    /* ---- 自动翻页 ---- */
    const SETTINGS_KEY = "bToolboxAutoPlaySettings";
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
      interval: 5000,
      stopAtEnd: false,
    };

    const autoplayField = h("div", "b-toolbox-field");
    autoplayField.append(h("div", "b-toolbox-label", "自动翻页"));

    const intervalRow = h("div", "b-toolbox-field");
    intervalRow.append(h("div", "b-toolbox-hint", "翻页间隔（秒）"));
    const intervalInput = h("input", "b-toolbox-input");
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.step = "1";
    intervalInput.value = settings.interval / 1000;
    intervalInput.addEventListener("change", () => {
      settings.interval = parseInt(intervalInput.value, 10) * 1000;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
    intervalRow.append(intervalInput);
    autoplayField.append(intervalRow);

    const stopRow = h("label", "b-toolbox-check");
    const stopBox = h("input");
    stopBox.type = "checkbox";
    stopBox.checked = !!settings.stopAtEnd;
    stopBox.addEventListener("change", () => {
      settings.stopAtEnd = stopBox.checked;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    });
    stopRow.append(stopBox, h("span", "", "每话最后一页停止"));
    autoplayField.append(stopRow);

    const playBtn = h("button", "b-toolbox-btn", "开始自动翻页");
    playBtn.type = "button";
    autoplayField.append(playBtn);
    autoplayField.append(h("div", "b-toolbox-hint", "Ctrl + 空格键 暂停 / 继续"));
    toolboxPanel.append(autoplayField);

    let playTimer = 0;
    const stopPlay = () => {
      clearInterval(playTimer);
      playTimer = 0;
      playBtn.textContent = "开始自动翻页";
      intervalInput.disabled = false;
      stopBox.disabled = false;
    };
    const togglePlay = () => {
      if (playTimer) {
        stopPlay();
        return;
      }
      intervalInput.disabled = true;
      stopBox.disabled = true;
      playBtn.textContent = "停止自动翻页";
      playTimer = setInterval(() => {
        if (settings.stopAtEnd && document.querySelector(".app-promo")) {
          stopPlay();
          status.set("已到本话最后一页，自动翻页结束");
          return;
        }
        document.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "ArrowDown",
            code: "ArrowDown",
            bubbles: true,
          })
        );
      }, settings.interval);
    };
    playBtn.addEventListener("click", togglePlay);
    window.addEventListener("keyup", (event) => {
      if (event.key === " " && event.ctrlKey) togglePlay();
    });

    /* ---- 改写 ImageToken 请求，套用所选清晰度 ---- */
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.needModifyBody = false;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.needModifyBody =
        url === "/twirp/comic.v1.Comic/ImageToken?device=pc&platform=web" &&
        method === "POST" &&
        XMLHttpRequest.prototype.resolution !== "@1100w.jpg";
      return originalXhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (!this.needModifyBody) return originalXhrSend.apply(this, arguments);
      try {
        const json = JSON.parse(body);
        const urls = JSON.parse(json.urls);
        const next = JSON.stringify({
          urls: JSON.stringify(
            urls.map((x) => x.replace(/@1100w\.jpg$/, XMLHttpRequest.prototype.resolution))
          ),
        });
        return originalXhrSend.call(this, next);
      } catch (e) {
        return originalXhrSend.apply(this, arguments);
      }
    };
  }
})();
