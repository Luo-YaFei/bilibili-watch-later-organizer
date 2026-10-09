import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function dashboard({ storage = new Map(), reduced = false, cards = [] } = {}) {
  const sandbox = {
    BiliWLAura: { refresh() {} },
    console,
    setTimeout: () => 1,
    clearTimeout: () => {},
    document: {
      getElementById: () => ({}),
      querySelector: (selector) => selector === ".main"
        ? { getBoundingClientRect: () => ({ top: 0, bottom: 800 }) } : null,
      querySelectorAll: () => cards
    },
    window: {
      innerHeight: 800,
      matchMedia: () => ({ matches: reduced }),
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../src/shared.js", import.meta.url), "utf8"), sandbox);
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  vm.runInContext(source.replace("  init();", `
    globalThis.subject = {
      recordOperationLog, readOperationLogs, animateCardReflow, captureCardPositions,
      removeFromWatchlater, updateState, updateStateWithSyncAnimation,
      shuffledVideos, shuffleVideos, visibleVideos, sortComboValue,
      resumeResultTransition, resultCardPlan,
      setResultTransition: (value) => { resultTransition = value; },
      setupCategoryLoop, wrapCategoryLoop, renderFeedbackNotice, updateStatusSurface, setStatus,
      captureModalDraft, renderEditor,
      openManagement: () => { managementOpen = true; manualEditorOpen = false; },
      openManual: (bvid) => { managementOpen = false; manualEditorOpen = true; selectedBvid = bvid; },
      appendCategoryLevel, renderCategoryTree, categoryAuraStyle,
      onCategoryPreview, reconcileCategoryPointer, clearCategoryPreviews,
      setCategoryFilter: (id) => { activeFilter = { categoryIds: expandCategoryIds([id]), sourceCategoryId: id }; },
      setPendingFilter: () => { activeFilter = { categoryIds: [], includeUnclassified: true }; },
      getSelection: () => selectedBvid,
      selectVideo: (bvid) => { selectedBvid = bvid; },
      getAdded: () => Array.from(syncAnimations.added),
      getLogs: () => operationLogs,
      getError: () => operationLogError,
      getState: () => state,
      setState: (next) => { state = Object.assign({}, state, next); },
      setServices: (render, request) => { renderShell = render; send = request; }
    };
  `), sandbox);
  return { ...sandbox.subject, sandbox, storage };
}

test("feedback notices retain semantic status, layered particles and message while live updates refresh colors", () => {
  const app = dashboard();
  app.sandbox.document.createElement = tag => ({
    tag, dataset: {}, children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }
  });
  for (const [message, kind] of [["正在测试 API", "running"], ["测试成功", "success"], ["测试失败", "error"]]) {
    const notice = app.renderFeedbackNotice("api-test-status", message);
    assert.equal(notice.className, "api-test-status feedback-notice status-" + kind);
    assert.equal(notice.children[1].textContent, message);
    assert.equal(notice.children[0].className, "category-aura feedback-aura");
    const depths = notice.children[0].children.slice(1).map(particle => particle.dataset.depth);
    assert.ok(depths.includes("front") && depths.includes("back"));
  }
  const surface = { className: "activity-status feedback-notice status-running" };
  const node = { textContent: "", scrollTop: 23 };
  app.sandbox.document.querySelector = selector => selector.includes("status-surface") ? surface
    : selector === '[data-role="status"]' ? node : null;
  let refreshes = 0;
  app.sandbox.BiliWLAura.refresh = () => refreshes++;
  app.updateStatusSurface();
  assert.equal(surface.className, "activity-status feedback-notice status-success");
  assert.equal(node.scrollTop, 23);
  assert.equal(refreshes, 1);
  app.updateStatusSurface();
  assert.equal(refreshes, 1);
});

test("category scrolling wraps in both directions and preserves the visible offset", () => {
  const app = dashboard();
  const nav = { dataset: { cycleHeight: "300" }, scrollTop: 298, querySelectorAll: () => [] };
  app.wrapCategoryLoop(nav);
  assert.equal(nav.scrollTop, 598);
  nav.scrollTop = 615;
  app.wrapCategoryLoop(nav);
  assert.equal(nav.scrollTop, 315);
  nav.scrollTop = 1595;
  app.wrapCategoryLoop(nav);
  assert.equal(nav.scrollTop, 395);
});

test("only the clicked category has an aura, with more particles for parents and fewer for leaves", () => {
  const app = dashboard();
  app.sandbox.document.createElement = (tag) => ({
    tag, dataset: {}, children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); }
  });
  app.setState({ categories: [
    { id: "study", name: "学习", order: 1 },
    { id: "study.code", name: "编程", parentId: "study", order: 1 }
  ] });
  const render = (id) => {
    app.setCategoryFilter(id);
    const tree = { children: [], appendChild(child) { this.children.push(child); } };
    app.appendCategoryLevel(tree, "", 0, { byCategory: new Map() });
    return [tree.children[0].children[0], tree.children[0].children[1].children[0]];
  };
  const parent = render("study");
  assert.equal(parent[0].dataset.auraSize, "large");
  assert.equal(parent[0].attributes["aria-current"], "true");
  assert.equal(parent[0].children[0].className, "category-aura");
  assert.equal(parent[0].children[0].children.filter((node) => node.className === "category-particle").length, 28);
  const depths = parent[0].children[0].children.filter((node) => node.className === "category-particle").map(node => node.dataset.depth);
  assert.ok(depths.includes("front") && depths.includes("back"));
  assert.deepEqual(render("study")[0].children[0].children.filter((node) => node.className === "category-particle").map(node => node.dataset.depth), depths);
  assert.equal(parent[1].attributes["aria-current"], "false");
  assert.equal(parent[1].children.some((node) => node.className === "category-aura"), false);
  const leaf = render("study.code");
  assert.equal(leaf[1].dataset.auraSize, "small");
  assert.equal(leaf[1].children[0].className, "category-aura");
  assert.equal(leaf[1].children[0].children.filter((node) => node.className === "category-particle").length, 16);
  assert.equal(leaf[0].attributes["aria-current"], "false");
});

test("category colors stay stable and both pinned filters have the same selected particle aura", () => {
  const app = dashboard();
  assert.equal(app.categoryAuraStyle("study"), app.categoryAuraStyle("study"));
  assert.notEqual(app.categoryAuraStyle("study"), app.categoryAuraStyle("study.code"));
  const palettes = new Set(Array.from({ length: 256 }, (_, i) => app.categoryAuraStyle("category-" + i)));
  assert.ok(palettes.size >= 230, "sequential IDs should produce many distinct harmonious gradients");
  const makeNode = () => ({
    dataset: {}, children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); }
  });
  app.sandbox.document.createElement = makeNode;
  app.sandbox.document.createDocumentFragment = makeNode;
  const pinned = () => app.renderCategoryTree().children[1].children;
  let buttons = pinned();
  assert.equal(buttons[0].children[0].className, "category-aura");
  assert.equal(buttons[0].dataset.auraSize, "large");
  assert.equal(buttons[1].children.some((node) => node.className === "category-aura"), false);
  app.setPendingFilter();
  buttons = pinned();
  assert.equal(buttons[1].children[0].className, "category-aura");
  assert.equal(buttons[1].dataset.auraSize, "large");
  assert.equal(buttons[0].children.some((node) => node.className === "category-aura"), false);
  assert.notEqual(buttons[0].attributes.style, buttons[1].attributes.style);
});

test("palette assignment spreads sibling IDs around the color wheel while keeping each gradient harmonious", () => {
  const app = dashboard();
  const sectors = new Set();
  for (let i = 0; i < 96; i++) {
    const style = app.categoryAuraStyle("study.branch." + i);
    const values = Object.fromEntries(style.split(";").map(token => token.split(":").map((v, index) => index ? Number(v) : v)));
    sectors.add(Math.floor(values["--aura-hue"] / 30));
    const shifts = ["a", "b", "c"].map(key => values["--aura-shift-" + key]);
    assert.ok(Math.max(...shifts) - Math.min(...shifts) <= 120);
    assert.ok(shifts.every(Number.isFinite));
  }
  assert.ok(sectors.size >= 10);
});

test("mouse focus does not retain an unselected aura after a held pointer leaves; keyboard focus still previews", () => {
  const app = dashboard();
  const classes = new Set(["aura-preview"]);
  let keyboard = false;
  let hovered = false;
  const row = {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    contains: node => node === row,
    matches: () => keyboard || hovered,
    closest: () => row,
    querySelector: () => ({}),
    getBoundingClientRect: () => ({}),
    isConnected: true
  };
  app.sandbox.document.querySelectorAll = () => [row];
  app.sandbox.document.elementFromPoint = () => ({});
  app.onCategoryPreview({ type: "pointerout", target: row, relatedTarget: {} });
  assert.equal(classes.has("aura-preview"), false);
  classes.add("aura-preview");
  app.reconcileCategoryPointer({ type: "pointermove", buttons: 1, clientX: 500, clientY: 500 });
  assert.equal(classes.has("aura-preview"), false);
  keyboard = true;
  app.onCategoryPreview({ type: "focusin", target: row });
  assert.equal(classes.has("aura-preview"), true);
  app.reconcileCategoryPointer({ type: "pointerup", clientX: 500, clientY: 500 });
  assert.equal(classes.has("aura-preview"), true);
  app.clearCategoryPreviews();
  assert.equal(classes.has("aura-preview"), false);
});

test("category loop fills tall viewports, survives resize, and does not repeat titles or pinned filters", () => {
  const app = dashboard();
  let resize;
  app.sandbox.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() {}
  };
  let height = 120;
  const nodes = [];
  const cycle = {
    dataset: { categoryCycle: "original" },
    getBoundingClientRect: () => ({ height }),
    cloneNode: () => ({ dataset: {}, querySelectorAll: () => [], remove() { nodes.splice(nodes.indexOf(this), 1); } })
  };
  nodes.push(cycle);
  const nav = {
    dataset: {}, clientHeight: 900, clientWidth: 230, scrollTop: 0,
    querySelector: () => cycle,
    querySelectorAll: () => nodes.filter((node) => node.dataset.categoryCycle === "copy"),
    insertBefore: (node) => nodes.unshift(node),
    appendChild: (node) => nodes.push(node),
    addEventListener: () => {}
  };
  app.setupCategoryLoop(nav);
  assert.equal(nav.scrollTop, 120);
  assert.ok(nodes.length * height - 2 * height >= nav.clientHeight);
  nav.scrollTop += 35;
  resize();
  assert.equal(nav.scrollTop, 155, "initial observer notification must not reset scrolling");
  height = 160;
  resize();
  assert.equal(nav.scrollTop, 195);
  assert.equal(nodes.filter((node) => node === cycle).length, 1);
  assert.ok(nodes.every((node) => ["original", "copy"].includes(node.dataset.categoryCycle)));
});

test("loop wrapping transfers keyboard focus to the same visible category", () => {
  const app = dashboard();
  let focused = false;
  const equivalent = { dataset: { categoryId: "study" }, focus: () => { focused = true; } };
  const cycles = [
    { querySelectorAll: () => [] },
    { querySelectorAll: () => [equivalent] },
    { querySelectorAll: () => [] }
  ];
  app.sandbox.document.activeElement = { dataset: { categoryId: "study" }, closest: () => cycles[2] };
  const nav = { dataset: { cycleHeight: "300" }, scrollTop: 625, contains: () => true, querySelectorAll: () => cycles };
  app.wrapCategoryLoop(nav);
  assert.equal(nav.scrollTop, 325);
  assert.equal(focused, true);
});

test("operation feedback survives reload, deduplicates repeats, and retains only the latest 200 entries", () => {
  const app = dashboard();
  for (let i = 0; i < 205; i++) app.recordOperationLog({ text: "操作 " + i, kind: "info" });
  app.recordOperationLog({ text: "操作 204", kind: "info" });
  const reloaded = dashboard({ storage: app.storage }).readOperationLogs();
  assert.equal(reloaded.length, 200);
  assert.equal(reloaded[0].text, "操作 5");
  assert.equal(reloaded.at(-1).text, "操作 204");
});

test("logs redact configured keys and authorization strings before persistence", () => {
  const app = dashboard();
  app.setState({ settings: { llmApiKey: "private-one", jevApiKey: "private-two" } });
  app.recordOperationLog({ text: "失败 private-one private-two Bearer token-123 sk-secret", kind: "error" });
  const stored = app.storage.get("biliwl.operationLog");
  assert.doesNotMatch(stored, /private-one|private-two|token-123|sk-secret/);
  assert.match(stored, /已隐藏密钥/);
});

test("unavailable storage keeps feedback in memory and recovers unsaved entries on the next write", () => {
  const app = dashboard();
  app.sandbox.window.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  app.recordOperationLog({ text: "首次操作", kind: "success" });
  app.recordOperationLog({ text: "再次操作", kind: "success" });
  assert.equal(app.getLogs().length, 2);
  assert.match(app.getError(), /日志保存失败/);
  app.sandbox.window.localStorage.setItem = (key, value) => app.storage.set(key, value);
  app.recordOperationLog({ text: "存储恢复", kind: "success" });
  assert.equal(JSON.parse(app.storage.get("biliwl.operationLog")).length, 3);
  assert.equal(app.getError(), "");
});

test("corrupt saved logs do not prevent recording new feedback", () => {
  const app = dashboard({ storage: new Map([["biliwl.operationLog", "invalid json"]]) });
  app.recordOperationLog({ text: "新的反馈", kind: "info" });
  assert.equal(JSON.parse(app.storage.get("biliwl.operationLog"))[0].text, "新的反馈");
});

test("card reflow follows previous positions and cleans its interruption marker", async () => {
  const calls = [];
  const card = {
    dataset: { bvid: "one" },
    getBoundingClientRect: () => ({ left: 10, top: 20, bottom: 200 }),
    animate: (frames, options) => { calls.push({ frames, options }); return { finished: Promise.resolve() }; }
  };
  const app = dashboard({ cards: [card] });
  app.animateCardReflow(new Map([["one", { left: 260, top: 250, bottom: 430 }]]));
  assert.equal(calls[0].frames[0].transform, "translate(250px, 230px)");
  assert.equal(card.dataset.reflow, "true");
  await Promise.resolve();
  assert.equal(card.dataset.reflow, undefined);
});

test("background redraw resumes result transitions without restarting and stops after expiry", () => {
  const app = dashboard();
  let animation;
  const card = { dataset: { bvid: "one" }, animate(frames, options) { animation = { frames, options }; return animation; } };
  const content = { querySelectorAll: () => [card], querySelector: () => null };
  const cards = new Map([["one", { delay: 60, duration: 400, frames: [{ opacity: 0, transform: "translateY(18px) scale(.985)" }, { opacity: 1, transform: "translateY(0) scale(1)" }] }]]);
  app.setResultTransition({ startedAt: Date.now() - 120, duration: 590, cards });
  app.resumeResultTransition(content);
  assert.ok(animation.currentTime >= 120 && animation.currentTime < 360);
  assert.equal(animation.frames[0].transform, "translateY(18px) scale(.985)");
  assert.equal(animation.options.duration, 400);
  animation = null;
  app.setResultTransition({ startedAt: Date.now() - 700, duration: 590, cards });
  app.resumeResultTransition(content);
  assert.equal(animation, null);
  const reduced = dashboard({ reduced: true });
  reduced.setResultTransition({ startedAt: Date.now(), duration: 590, cards });
  reduced.resumeResultTransition(content);
  assert.equal(animation, null);
});

test("new, distant and previously offscreen videos enter locally; nearby shared videos retain position continuity", () => {
  const app = dashboard();
  const viewport = { top: 100, bottom: 800, width: 1000, height: 700 };
  const after = { left: 40, top: 180, bottom: 430 };
  assert.equal(app.resultCardPlan(undefined, after, viewport).entering, true);
  assert.equal(app.resultCardPlan({ left: 40, top: -900, bottom: -650 }, after, viewport).entering, true);
  assert.equal(app.resultCardPlan({ left: 900, top: 180, bottom: 430 }, after, viewport).entering, true);
  const nearby = app.resultCardPlan({ left: 300, top: 150, bottom: 400 }, after, viewport);
  assert.equal(nearby.entering, false);
  assert.equal(nearby.frames[0].transform, "translate(260px, -30px)");
});

test("reflow skips reduced motion, unmoved cards, new cards, and moves outside the viewport", () => {
  let animations = 0;
  const card = {
    dataset: { bvid: "one" },
    getBoundingClientRect: () => ({ left: 10, top: 900, bottom: 1100 }),
    animate: () => { animations++; return { finished: Promise.resolve() }; }
  };
  dashboard({ cards: [card], reduced: true }).animateCardReflow(new Map([["one", { left: 20, top: 0, bottom: 200 }]]));
  const app = dashboard({ cards: [card] });
  app.animateCardReflow(new Map());
  app.animateCardReflow(new Map([["one", card.getBoundingClientRect()]]));
  app.animateCardReflow(new Map([["one", { left: 300, top: 1000, bottom: 1200 }]]));
  assert.equal(animations, 0);
});

test("failed deletion hides immediately then restores the video with animated reflow", async () => {
  const app = dashboard();
  app.setState({ videos: [{ bvid: "BV1test", title: "测试视频", presentInWatchlater: true }] });
  const renders = [];
  let rejectRequest;
  app.setServices((options) => renders.push(options), () => new Promise((_, reject) => { rejectRequest = reject; }));
  const pending = app.removeFromWatchlater("BV1test");
  assert.equal(app.getState().videos[0].presentInWatchlater, false);
  assert.equal(renders[0].animateCards, true);
  rejectRequest(new Error("B站未确认删除"));
  await pending;
  assert.equal(app.getState().videos[0].presentInWatchlater, true);
  assert.equal(renders[1].animateCards, true);
  assert.match(app.getLogs().at(-1).text, /移出失败，视频已恢复/);
});

test("successful deletion remains hidden through stale confirmation and later state snapshots", async () => {
  const app = dashboard();
  const stale = { videos: [{ bvid: "BV1test", title: "测试视频", presentInWatchlater: true }] };
  app.setState({ videos: stale.videos.map((video) => ({ ...video })) });
  app.setServices(() => {}, async () => stale);
  await app.removeFromWatchlater("BV1test");
  assert.equal(app.getState().videos[0].presentInWatchlater, false);
  app.updateState(stale);
  assert.equal(app.getState().videos[0].presentInWatchlater, false);
  assert.equal(app.getLogs().at(-1).kind, "success");
});

test("loading videos does not select one; refresh preserves only an explicit valid selection", () => {
  const app = dashboard();
  app.setServices(() => {}, async () => ({}));
  const next = { videos: [{ bvid: "one" }, { bvid: "two" }] };
  app.updateState(next);
  assert.equal(app.getSelection(), "");
  app.selectVideo("two");
  app.updateState(next);
  assert.equal(app.getSelection(), "two");
  app.updateState({ videos: [{ bvid: "one" }] });
  assert.equal(app.getSelection(), "");
});

test("sync animates new and returning videos and reflows existing cards without selecting a video", async () => {
  const app = dashboard();
  const renders = [];
  app.setServices((options) => renders.push(options), async () => ({}));
  app.setState({ videos: [{ bvid: "old" }, { bvid: "returning", presentInWatchlater: false }] });
  const next = { videos: [{ bvid: "new" }, { bvid: "old" }, { bvid: "returning" }] };
  await app.updateStateWithSyncAnimation(next, { newBvids: ["new"] });
  assert.deepEqual([...app.getAdded()], ["new", "returning"]);
  assert.equal(renders.at(-1).animateCards, true);
  assert.equal(app.getSelection(), "");
  await app.updateStateWithSyncAnimation(next, {});
  assert.equal(app.getAdded().length, 0);
  assert.equal(renders.at(-1).animateCards, false);
});

test("shuffle preserves all videos without mutating input and changes an unchanged draw", () => {
  const app = dashboard();
  const input = [{ bvid: "a" }, { bvid: "b" }, { bvid: "c" }];
  const result = app.shuffledVideos(input, () => .999);
  assert.deepEqual(input.map((item) => item.bvid), ["a", "b", "c"]);
  assert.deepEqual([...result].map((item) => item.bvid), ["b", "a", "c"]);
  assert.equal(app.shuffledVideos([]).length, 0);
  assert.equal(app.shuffledVideos([input[0]])[0], input[0]);
});

test("random order survives refresh and never selects a video", () => {
  const app = dashboard();
  const renders = [];
  app.setServices((options) => renders.push(options), async () => ({}));
  const videos = ["a", "b", "c", "d"].map((bvid, watchlaterOrder) => ({ bvid, watchlaterOrder }));
  app.setState({ videos });
  app.shuffleVideos();
  const order = [...app.visibleVideos()].map((video) => video.bvid);
  assert.notDeepEqual(order, ["a", "b", "c", "d"]);
  assert.equal(new Set(order).size, 4);
  assert.equal(renders.at(-1).animateCards, true);
  assert.equal(renders.at(-1).reflowDuration, 480);
  app.updateState({ videos: [...videos].reverse() });
  assert.deepEqual([...app.visibleVideos()].map((video) => video.bvid), order);
  assert.equal(app.getSelection(), "");
  assert.equal(app.sortComboValue(), "random");
});

test("feedback expires, stays hidden across redraws and restarts for the latest message", () => {
  const app = dashboard();
  const pending = new Map();
  let serial = 0;
  app.sandbox.setTimeout = (callback, delay) => { pending.set(++serial, { callback, delay }); return serial; };
  app.sandbox.clearTimeout = id => pending.delete(id);
  const surface = { className: "", hidden: true };
  const text = {};
  app.sandbox.document.querySelector = selector => selector.includes("status-surface") ? surface
    : selector === '[data-role="status"]' ? text : null;
  app.setStatus("已保存手动确认");
  assert.equal(surface.hidden, false);
  assert.equal([...pending.values()][0].delay, 5000);
  app.setStatus("保存失败：模拟错误");
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0].delay, 8000);
  assert.equal(text.textContent, "保存失败：模拟错误");
  [...pending.values()][0].callback();
  assert.equal(surface.hidden, true);
  app.updateStatusSurface();
  assert.equal(surface.hidden, true);
});

test("settings explain three destinations and manual drafts survive a background redraw", () => {
  const app = dashboard();
  app.sandbox.document.createElement = tag => ({
    tag, dataset: {}, children: [], attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    appendChild(child) { this.children.push(child); }
  });
  app.sandbox.document.createTextNode = textContent => ({ textContent });
  app.sandbox.document.createElementNS = (_, tag) => app.sandbox.document.createElement(tag);
  const video = app.sandbox.BiliWLCore.canonicalizeVideo({ bvid: "BV1xx411c7mD", title: "布局测试" });
  app.setState({ videos: [video], categories: [{ id: "study", name: "学习", enabled: true }, { id: "math", name: "数学", enabled: true }] });
  app.openManagement();
  const dialog = app.renderEditor().children[0];
  assert.equal(dialog.tag, "dialog");
  const nav = dialog.children[1].children[0].children[0];
  assert.deepEqual(Array.from(nav.children, node => node.dataset.page), ["classify", "directory", "preferences"]);
  app.openManual(video.bvid);
  app.sandbox.document.querySelector = selector => selector === ".management-dialog" ? {
    querySelector: () => ({}), querySelectorAll: () => [{ value: "math" }]
  } : null;
  app.captureModalDraft();
  const manual = app.renderEditor().children[0];
  const fold = manual.children[1].children[0];
  const choices = fold.children[0].children.find(node => node.className?.includes("manual-category-list"));
  const checked = choices.children.map(row => row.children[0]).filter(input => input.checked);
  assert.deepEqual(Array.from(checked, input => input.value), ["math"]);
});
