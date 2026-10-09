(function attachBiliWatchLaterSyncChip() {
  "use strict";

  const core = window.BiliWLCore;
  const message = core.MESSAGE_TYPES;
  const PANEL_ID = "bili-watchlater-classifier-sync";
  const HOME_BUTTON_ID = "bili-watchlater-classifier-home-entry";
  const LIGHT_SYNC_DELAY = 1800;
  const MUTATION_SYNC_DELAY = 5000;
  const MIN_LIGHT_SYNC_INTERVAL = 15000;

  let host = null;
  let root = null;
  let state = {
    videos: [],
    classifications: [],
    classifySummary: null,
    progress: null
  };
  let mutationTimer = null;
  let lightSyncTimer = null;
  let syncInFlight = false;
  let lastDomScanHash = "";
  let lastLightSyncAt = 0;

  init();

  function init() {
    if (isBiliHomePage()) {
      createHomeEntryButton();
      return;
    }
    if (!isWatchlaterListPage()) return;
    createPanel();
    bindRuntimeMessages();
    setStatus("正在读取已同步视频…");
    send({ type: message.GET_STATE })
      .then(updateState)
      .catch((error) => setStatus("读取失败：" + error.message));
    scheduleLightSync(LIGHT_SYNC_DELAY);
    observePage();
  }

  function isBiliHomePage() {
    return location.hostname === "www.bilibili.com" && (location.pathname === "/" || location.pathname === "");
  }

  function isWatchlaterListPage() {
    return location.hostname === "www.bilibili.com" && location.pathname.includes("/watchlater/list");
  }

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((payload, sender, sendResponse) => {
      if (payload && payload.type === message.JOB_PROGRESS) {
        state.progress = payload.progress;
        renderStats();
        setStatus(payload.progress.message || "正在同步视频信息…");
        return false;
      }
      return false;
    });
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    host = document.createElement("aside");
    host.id = PANEL_ID;
    host.style.position = "fixed";
    host.style.right = "14px";
    host.style.bottom = "24px";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "auto";
    root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", {
      textContent: `
        :host { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .chip { width: 260px; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; box-shadow: 0 12px 34px rgba(15, 23, 42, .16); color: #172033; }
        .chip.collapsed { width: 42px; }
        .chip.collapsed .body { display: none; }
        .head { display: grid; grid-template-columns: 1fr 30px; gap: 8px; align-items: center; padding: 9px 10px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
        .chip.collapsed .head { grid-template-columns: 30px; padding: 6px; border-bottom: 0; }
        .chip.collapsed .title { display: none; }
        .title { min-width: 0; }
        h2 { margin: 0; font-size: 13px; line-height: 1.25; letter-spacing: 0; }
        .sub { margin-top: 2px; font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button { font: inherit; cursor: pointer; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; min-height: 30px; padding: 5px 8px; }
        button:hover { background: #eef6ff; border-color: #8eb6d9; }
        .icon { width: 30px; padding: 0; font-size: 18px; line-height: 1; }
        .body { padding: 10px; }
        .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 8px; }
        .stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 5px 6px; background: #fbfdff; }
        .stat strong { display: block; font-size: 14px; }
        .stat span { font-size: 11px; color: #64748b; }
        .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .open { grid-column: 1 / -1; background: #0f6cab; border-color: #0f6cab; color: #fff; }
        .open:hover { background: #0b5f98; }
        .status { min-height: 18px; margin-top: 8px; font-size: 12px; line-height: 1.35; color: #475569; }
      `
    }));
    root.appendChild(el("div", { className: "chip" }, [
      el("div", { className: "head" }, [
        el("div", { className: "title" }, [
          el("h2", { textContent: "稍后再看整理助手" }),
          el("div", { className: "sub", textContent: "自动归类，快速找到想看的视频" })
        ]),
        el("button", { className: "icon", title: "收起", dataset: { action: "toggle" }, textContent: "›" })
      ]),
      el("div", { className: "body" }, [
        el("div", { className: "stats", dataset: { role: "stats" } }),
        el("div", { className: "actions" }, [
          el("button", { className: "open", dataset: { action: "open-dashboard" }, textContent: "打开整理助手" }),
          el("button", { dataset: { action: "scan" }, textContent: "扫描" }),
          el("button", { dataset: { action: "details" }, textContent: "更新详情" })
        ]),
        el("div", { className: "status", dataset: { role: "status" }, textContent: "正在初始化..." })
      ])
    ]));
    document.documentElement.appendChild(host);
    root.addEventListener("click", onClick);
  }

  function createHomeEntryButton() {
    if (document.getElementById(HOME_BUTTON_ID)) return;
    host = document.createElement("aside");
    host.id = HOME_BUTTON_ID;
    host.style.position = "fixed";
    host.style.right = "18px";
    host.style.top = "20%";
    host.style.transform = "translateY(-50%)";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "auto";
    root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", {
      textContent: `
        :host { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .home-entry { width: 46px; height: 46px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: #00aeec; color: #fff; box-shadow: none; cursor: pointer; transition: background-color .16s ease, transform .16s ease; }
        .home-entry:hover { background: #00a1d6; transform: translateY(-1px); }
        .home-entry:active { transform: translateY(0) scale(.96); }
        .home-entry:focus-visible { outline: 3px solid rgba(0, 174, 236, .38); outline-offset: 3px; }
        svg { width: 25px; height: 25px; display: block; }
        @media (max-width: 720px) {
          .home-entry { width: 46px; height: 46px; }
          svg { width: 25px; height: 25px; }
        }
      `
    }));
    const button = el("button", {
      className: "home-entry",
      title: "打开稍后再看整理助手",
      "aria-label": "打开稍后再看整理助手",
      dataset: { action: "open-dashboard" }
    });
    button.appendChild(createLogoSvg());
    root.appendChild(button);
    document.documentElement.appendChild(host);
    root.addEventListener("click", onClick);
  }

  function onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "toggle") {
      const panel = root.querySelector(".chip");
      panel.classList.toggle("collapsed");
      const collapsed = panel.classList.contains("collapsed");
      target.textContent = collapsed ? "‹" : "›";
      target.title = collapsed ? "展开" : "收起";
    } else if (action === "open-dashboard") {
      send({ type: message.OPEN_DASHBOARD }).catch((error) => setStatus("打开失败：" + error.message));
    } else if (action === "scan") {
      scanAndSync({ fullScan: true });
    } else if (action === "details") {
      send({ type: message.FETCH_VIDEO_DETAILS }).then(updateState).catch((error) => setStatus(error.message));
    }
  }

  async function scanAndSync(options) {
    if (syncInFlight) {
      if (options.fullScan) {
        setStatus("已有同步正在进行，请稍后再扫描");
      }
      return;
    }
    const domItems = collectVisibleVideoItems();
    const hash = JSON.stringify(domItems.map((item) => [item.bvid, item.title]));
    if (!options.fullScan) {
      lastLightSyncAt = Date.now();
      if (hash === lastDomScanHash) return;
    }
    lastDomScanHash = hash;
    syncInFlight = true;
    try {
      setStatus(options.fullScan ? "正在扫描列表..." : "正在同步可见视频...");
      const response = await send({ type: message.SCAN_WATCHLATER, domItems });
      updateState(response);
    } finally {
      syncInFlight = false;
    }
  }

  function scheduleLightSync(delay) {
    if (lightSyncTimer) return;
    const elapsed = Date.now() - lastLightSyncAt;
    const wait = Math.max(delay || 0, MIN_LIGHT_SYNC_INTERVAL - elapsed);
    lightSyncTimer = setTimeout(() => {
      lightSyncTimer = null;
      runWhenIdle(() => {
        scanAndSync({ fullScan: false }).catch((error) => setStatus(error.message));
      });
    }, wait);
  }

  function runWhenIdle(callback) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 4000 });
      return;
    }
    setTimeout(callback, 0);
  }

  async function send(payload) {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "扩展后台无响应");
    }
    return response.data;
  }

  function updateState(nextState) {
    state = Object.assign({}, state, nextState || {});
    renderStats();
    const summary = state.classifySummary || {};
    setStatus("同步完成 · 共 " + (summary.total || 0) + " 个视频");
  }

  function renderStats() {
    const stats = root.querySelector('[data-role="stats"]');
    if (!stats) return;
    const summary = state.classifySummary || {};
    stats.replaceChildren(
      statNode(summary.total || 0, "全部视频"),
      statNode(summary.pendingFineClassification || 0, "待精细分类"),
      statNode(summary.aiClassified || 0, "AI 已分类"),
      statNode(summary.manualConfirmed || 0, "手动确认")
    );
  }

  function statNode(value, label) {
    return el("div", { className: "stat" }, [
      el("strong", { textContent: String(value) }),
      el("span", { textContent: label })
    ]);
  }

  function setStatus(textValue) {
    const status = root && root.querySelector('[data-role="status"]');
    if (status) status.textContent = textValue || "";
  }

  function observePage() {
    const observer = new MutationObserver((records) => {
      if (records.every((record) => host && host.contains(record.target))) return;
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        scheduleLightSync(MUTATION_SYNC_DELAY);
      }, 500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function collectVisibleVideoItems() {
    const itemsByBvid = new Map();
    findVideoLinks().forEach((link, index) => {
      const bvid = core.extractBvid(link.href || link.getAttribute("href") || "");
      if (!bvid || itemsByBvid.has(bvid)) return;
      const card = closestVideoCard(link);
      if (!card || card === link || !card.querySelector || !card.querySelector("img")) return;
      itemsByBvid.set(bvid, {
        bvid,
        title: findTitle(link, card) || bvid,
        pageUrl: link.href || ("https://www.bilibili.com/video/" + bvid),
        upName: findUpName(card),
        coverUrl: findCoverUrl(card),
        watchlaterOrder: index,
        presentInWatchlater: true
      });
    });
    return Array.from(itemsByBvid.values());
  }

  function findVideoLinks() {
    return Array.from(document.querySelectorAll('a[href*="/video/BV"],a[href*="bilibili.com/video/BV"],a[href*="BV"]'))
      .filter((link) => !(host && host.contains(link)) && core.extractBvid(link.href || link.getAttribute("href") || ""));
  }

  function closestVideoCard(link) {
    const selectors = [
      ".watch-later-list-item",
      ".watchlater-list-item",
      ".watchlater-card",
      ".watch-later-card",
      ".bili-video-card",
      ".video-card",
      ".av-item",
      ".small-item",
      ".list-item",
      "[class*='watch'][class*='item']",
      "[class*='video'][class*='card']",
      "[class*='video'][class*='item']",
      "li",
      "article"
    ];
    for (const selector of selectors) {
      const node = link.closest(selector);
      if (node) return node;
    }
    let node = link.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1) {
      if ((node.textContent || "").trim().length > 12) return node;
      node = node.parentElement;
    }
    return link;
  }

  function findTitle(link, card) {
    return core.normalizeText(
      link.getAttribute("title") ||
      link.getAttribute("aria-label") ||
      textFrom(card, "[title]") ||
      textFrom(card, ".title") ||
      textFrom(card, ".video-name") ||
      textFrom(card, "h3") ||
      link.textContent
    );
  }

  function findUpName(card) {
    return core.normalizeText(
      textFrom(card, ".up-name") ||
      textFrom(card, ".name") ||
      textFrom(card, '[class*="up"]') ||
      ""
    );
  }

  function findCoverUrl(card) {
    const img = card && card.querySelector && card.querySelector("img");
    return img ? (img.currentSrc || img.src || img.getAttribute("data-src") || "") : "";
  }

  function textFrom(container, selector) {
    if (!container || !container.querySelector) return "";
    const node = container.querySelector(selector);
    return node ? (node.getAttribute("title") || node.textContent || "") : "";
  }

  function el(tagName, props, children) {
    const node = document.createElement(tagName);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "textContent") node.textContent = value;
      else if (key === "dataset") Object.entries(value || {}).forEach(([dataKey, dataValue]) => { node.dataset[dataKey] = dataValue; });
      else if (key === "title") node.title = value;
      else node.setAttribute(key, value);
    });
    (children || []).forEach((child) => node.appendChild(child));
    return node;
  }

  function createLogoSvg() {
    const svg = svgEl("svg", {
      viewBox: "0 0 22 22",
      fill: "none",
      role: "img",
      "aria-hidden": "true",
      focusable: "false"
    });
    const antennaLeft = svgEl("path", {
      d: "M7.5 5.4 5.2 3.1",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round"
    });
    const antennaRight = svgEl("path", {
      d: "m14.5 5.4 2.3-2.3",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round"
    });
    const screen = svgEl("rect", {
      x: "2.5",
      y: "5.5",
      width: "17",
      height: "13.5",
      rx: "3",
      stroke: "currentColor",
      "stroke-width": "2"
    });
    const leftEye = svgEl("path", {
      d: "M7.2 10v2.3",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round"
    });
    const rightEye = svgEl("path", {
      d: "M14.8 10v2.3",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round"
    });
    const mouth = svgEl("path", {
      d: "M7.5 15.4h7",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    });
    [antennaLeft, antennaRight, screen, leftEye, rightEye, mouth].forEach((node) => svg.appendChild(node));
    return svg;
  }

  function svgEl(tagName, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }
})();
