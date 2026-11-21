(function attachDashboard() {
  "use strict";

  const core = globalThis.BiliWLCore;
  const message = core.MESSAGE_TYPES;
  const app = document.getElementById("app");

  let state = {
    videos: [],
    classifications: [],
    categories: [],
    settings: Object.assign({}, core.DEFAULT_SETTINGS),
    classifySummary: null,
    progress: null
  };
  let activeFilter = categoryFilter();
  let categoryChosen = false;
  let videoFilter = null;
  let searchText = "";
  let resultLimit = core.DEFAULT_SETTINGS.resultBatchSize;
  let resultScope = "";
  let resultVideos = [];
  let randomOrder = null;
  let currentSort = null;
  let browsingSettingsSave = Promise.resolve();
  const browsingSettingsDraft = new Map();
  let searchTimer = 0;
  let searchComposing = false;
  let sortRequest = 0;
  let resultTransition = null;
  let resultExitLayer = null;
  const resultAnimations = new WeakMap();
  const reflowAnimations = new WeakMap();
  const auraCleanup = new WeakMap();
  let selectedBvid = "";
  let settingsPage = "classify";
  let aiMethod = "api";
  let directoryMode = "edit";
  let categoryAddOpen = false;
  let noticeLayoutObserver = null;
  let noticePositionFrame = 0;
  let apiPage = "video";
  let settingsScrollTops = new Map();
  let llmFormDraft = {};
  let newCategoryDraft = { name: "", parent: "" };
  let categoryDraft = null;
  let categoryDraftDirty = false;
  let directoryDraggedId = "";
  let directoryDragTargets = null;
  let directoryDragNodes = null;
  let directoryDropActive = null;
  let directoryDropPlan = null;
  let directoryDragGeometry = null;
  let categoryPanelObserver = null;
  let categoryPanelFrame = 0;
  let exchange = { visible: false, title: "", text: "", append: false, mode: "import" };
  let savedCategoryScrollTop = 0;
  let categoryLoopObserver = null;
  let batchMode = false;
  let batchCategoriesOpen = true;
  let selectedBvids = new Set();
  let pendingRemovalBvids = new Set();
  const trackedWatchlaterMembership = new Map();
  let batchCategoryIds = new Set();
  let selectionBox = null;
  let selectionFrame = 0;
  let classificationIndexSource = null;
  let classificationIndex = new Map();
  let categoryIndexSource = null;
  let categoryIndex = new Map();
  const searchIndex = new WeakMap();
  const videoCardCache = new Map();
  let cardCategoriesSource = null;
  let cardCategoriesKey = "";
  let cardCategoriesRevision = 0;
  let renderedSidebarKey = "";
  let renderedCategories = "";
  let suppressNextCardClick = false;
  let llmRun = { running: false, stopRequested: false, done: false, imported: 0, skipped: 0, processed: 0, total: 0, message: "" };
  let manualEditorOpen = false;
  let managementOpen = false;
  let managementOpener = "open-management";
  let manualCategoryDraft = null;
  let manualOpeningCleanup = null;
  let settingsOpeningCleanup = null;
  let manualSourceCleanup = null;
  let noticeExpiresAt = 0;
  let noticeTimer = 0;
  let operationLogs = [];
  let operationLogError = "";
  const OPERATION_LOG_KEY = "biliwl.operationLog";
  const OPERATION_LOG_LIMIT = 200;
  const LAST_OPENED_VIDEO_KEY = "biliwl.lastOpenedVideo";
  let lastOpenedBvid = "";
  let videoListLoaded = false;
  let apiSettingsDraft = null;
  let autoApiSettingsDraft = null;
  const apiConnections = { openai: "OpenAI-compatible", jev: "Jev" };
  const apiTestStates = {};
  let apiSaving = false;
  let categoryGeneration = { mode: "", running: false, loading: false, prompt: "", importText: "", message: "" };
  let syncAnimations = { added: new Set(), changed: new Set() };
  let syncAnimationTimer = 0;
  let syncAnimationStartedAt = 0;
  let idleDetailTimer = 0;
  let manualLlmRetryAt = 0;
  const recentDetailUpdates = new Map();
  let onboardingCheckingLogin = false;
  let onboardingLoginStatus = "unknown";
  let onboardingPanelDismissed = false;
  let onboardingPromptText = "";
  let onboardingPromptLoading = false;
  let onboardingCategoryRunning = false;
  let onboardingCategoryMessage = "";
  let savedMainScrollTop = 0;
  let savedEditorScrollTop = 0;
  let statusNotice = { text: "", kind: "info" };
  const IDLE_DETAIL_DELAY_MS = 12000;

  init();

  function init() {
    operationLogs = readOperationLogs();
    try { lastOpenedBvid = core.normalizeBvid(localStorage.getItem(LAST_OPENED_VIDEO_KEY)); } catch {}
    window.addEventListener("storage", (event) => {
      if (event.key === LAST_OPENED_VIDEO_KEY || event.key === null) {
        lastOpenedBvid = core.normalizeBvid(event.newValue);
      }
      if (event.key !== OPERATION_LOG_KEY && event.key !== null) return;
      operationLogs = readOperationLogs();
      updateOperationLogSurface();
    });
    app.addEventListener("click", onClick);
    app.addEventListener("auxclick", (event) => {
      if (event.button !== 1 || event.defaultPrevented) return;
      const link = event.target.closest("a[data-open-video]");
      if (batchMode && link?.classList.contains("cover-link")) event.preventDefault();
      else if (link) rememberOpenedVideo(link);
    });
    app.addEventListener("keydown", onModalKeyDown);
    app.addEventListener("dragstart", startDirectoryDrag);
    app.addEventListener("dragover", overDirectoryDrop);
    app.addEventListener("dragleave", leaveDirectoryDrop);
    app.addEventListener("drop", finishDirectoryDrop);
    app.addEventListener("dragend", clearDirectoryDrag);
    app.addEventListener("cancel", (event) => {
      if (!event.target.matches(".management-dialog")) return;
      event.preventDefault();
      closeModal();
    }, true);
    app.addEventListener("pointerover", onCategoryPreview);
    app.addEventListener("pointerout", onCategoryPreview);
    app.addEventListener("focusin", onCategoryPreview);
    app.addEventListener("focusout", onCategoryPreview);
    document.addEventListener("pointermove", reconcileCategoryPointer);
    document.addEventListener("pointerup", reconcileCategoryPointer);
    document.addEventListener("pointercancel", clearCategoryPreviews);
    window.addEventListener("blur", clearCategoryPreviews);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearCategoryPreviews(); });
    app.addEventListener("compositionstart", (event) => {
      if (event.target.dataset.role === "search") { searchComposing = true; clearTimeout(searchTimer); }
    });
    app.addEventListener("compositionend", (event) => {
      if (event.target.dataset.role === "search") { searchComposing = false; onInput(event); }
    });
    app.addEventListener("input", onInput);
    app.addEventListener("change", onChange);
    app.addEventListener("pointerdown", onPointerDown);
    app.addEventListener("pointermove", onPointerMove);
    app.addEventListener("pointerup", onPointerUp);
    app.addEventListener("pointercancel", onPointerUp);
    app.addEventListener("scroll", onSelectionScroll, true);
    app.addEventListener("scroll", onResultScroll, { capture: true, passive: true });
    app.addEventListener("scroll", scheduleStatusPosition, true);
    window.addEventListener("resize", scheduleStatusPosition);
    app.addEventListener("wheel", onWheel, { passive: true });
    chrome.runtime.onMessage.addListener((payload) => {
      if (payload && payload.type === message.JOB_PROGRESS) {
        state.progress = payload.progress;
        setStatus(payload.progress.message || "正在同步视频信息…");
      } else if (payload?.type === message.DETAILS_SAVED) {
        applySavedDetails(payload.videos);
      }
    });
    renderShell();
    bootstrap();
  }

  async function bootstrap() {
    onboardingCheckingLogin = true;
    await refreshState("正在读取已同步视频…");
    if (onboardingActive()) {
      await checkOnboardingLoginAndSync();
    } else {
      onboardingCheckingLogin = false;
      await syncOnOpen();
    }
  }

  async function checkOnboardingLoginAndSync() {
    onboardingCheckingLogin = true;
    onboardingLoginStatus = "unknown";
    renderShell();
    try {
      const result = await send({ type: message.CHECK_BILI_LOGIN });
      onboardingLoginStatus = result.loginStatus || "unknown";
      if (onboardingLoginStatus === "logged_out") {
        onboardingCheckingLogin = false;
        onboardingPanelDismissed = false;
        if (onboardingStage() !== "login") {
          await updateOnboardingSettings({ onboardingStage: "login" });
        } else {
          renderShell();
        }
        setStatus("检测到当前浏览器尚未登录 B站");
        return;
      }
      await syncOnOpen();
      if (onboardingStage() === "setup-prompt" && !onboardingPromptText) {
        await loadOnboardingPrompt();
      }
    } catch (error) {
      onboardingCheckingLogin = false;
      onboardingLoginStatus = "unknown";
      renderShell();
      setStatus("登录状态检测失败：" + error.message);
    }
  }

  async function refreshState(statusText) {
    if (statusText) setStatus(statusText);
    try {
      updateState(await send({ type: message.GET_STATE }));
      setStatus("已显示已同步视频");
    } catch (error) {
      setStatus("读取失败：" + error.message);
    }
  }

  async function syncOnOpen() {
    if (onboardingActive()) {
      onboardingCheckingLogin = true;
      renderShell();
    }
    setStatus(presentVideos().length ? "正在后台同步稍后再看..." : "正在打开时同步稍后再看...");
    try {
      const result = await send({ type: message.SYNC_ON_OPEN, skipAutoClassify: onboardingActive() });
      const output = result.openSyncResult || {};
      const scan = output.scanResult || {};
      const auto = output.autoClassifyResult || {};
      onboardingLoginStatus = output.loginStatus || "unknown";
      onboardingCheckingLogin = false;
      await updateStateWithSyncAnimation(result, scan);
      setStatus(output.apiError ? "同步 B站列表失败，已保留本地列表：" + output.apiError
        : "已同步 " + (scan.scannedCount || 0) + " 个视频" + (auto.skipped ? "；分类目录确定前暂不分类视频" : "；完成初步分类 " + (auto.classified || 0) + " 个"));
      if (onboardingActive() && onboardingLoginStatus === "logged_out" && onboardingStage() !== "login") {
        onboardingPanelDismissed = false;
        await updateOnboardingSettings({ onboardingStage: "login" });
      } else if (onboardingActive() && onboardingLoginStatus === "logged_in" && onboardingStage() === "login") {
        onboardingPanelDismissed = false;
        await updateOnboardingSettings({ onboardingStage: "setup" });
      }
      if (!output.apiError && !output.initialLibraryStarted) scheduleIdleDetailRefresh();
    } catch (error) {
      onboardingCheckingLogin = false;
      onboardingLoginStatus = "unknown";
      setStatus("打开时同步失败：" + error.message + "。正在显示已同步视频…");
      await refreshState();
      scheduleIdleDetailRefresh();
    }
  }

  async function send(payload) {
    const response = await chrome.runtime.sendMessage(payload);
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "扩展后台无响应");
    }
    return response.data;
  }

  function updateState(nextState, renderOptions) {
    if (nextState && nextState.categories && !categoryDraftDirty) categoryDraft = null;
    const mergedState = Object.assign({}, state, nextState || {});
    if (nextState?.videos && recentDetailUpdates.size) {
      mergedState.videos = nextState.videos.map(latestDetails);
    }
    if (trackedWatchlaterMembership.size && Array.isArray(nextState?.videos)) {
      mergedState.videos = mergedState.videos.map(video => applyWatchlaterMembership(video, true));
    }
    state = mergedState;
    let appliedOpeningCategory = false;
    if (Array.isArray(nextState?.videos) && !videoListLoaded) {
      videoListLoaded = true;
      const openingCategory = defaultOpeningCategory();
      if (!categoryChosen && openingCategory) {
        activeFilter = openingCategory === "pending"
          ? categoryFilter("", true)
          : categoryFilter(openingCategory.slice("category:".length));
        appliedOpeningCategory = true;
      }
      videoFilter ??= defaultVideoFilter();
      resultLimit = resultBatchSize();
      if (state.settings.shuffleOnOpen === true && !currentSort && !randomOrder) randomOrder = new Map();
    }
    if (selectedBvid && !presentVideos().some((video) => video.bvid === selectedBvid)) {
      selectedBvid = "";
    }
    renderShell(Object.assign({ preserveUnchanged: !appliedOpeningCategory }, renderOptions));
    if (appliedOpeningCategory && activeFilter.sourceCategoryId) revealOpeningCategory();
  }

  function applySavedDetails(videos) {
    if (!Array.isArray(videos) || !videos.length) return;
    for (const video of videos) {
      if ((recentDetailUpdates.get(video.bvid)?.lastSeenAt || 0) <= (video.lastSeenAt || 0)) {
        recentDetailUpdates.set(video.bvid, video);
      }
    }
    if (state.videos.some(video => latestDetails(video) !== video)) updateState({ videos: state.videos });
  }

  function latestDetails(video) {
    const saved = recentDetailUpdates.get(video.bvid);
    if (!saved) return video;
    if ((saved.watchlaterMembershipRevision || 0) < (video.watchlaterMembershipRevision || 0) ||
        (saved.lastSeenAt || 0) < (video.lastSeenAt || 0)) {
      recentDetailUpdates.delete(video.bvid);
      return video;
    }
    return saved;
  }

  function onboardingActive() {
    const settings = state.settings || {};
    return settings.onboardingEligible === true && settings.onboardingCompleted !== true;
  }

  function onboardingStage() {
    return core.normalizeText(state.settings && state.settings.onboardingStage) || "login";
  }

  async function updateOnboardingSettings(patch) {
    updateState(await send({
      type: message.UPDATE_SETTINGS,
      settings: Object.assign({ onboardingVersion: 1 }, patch || {})
    }));
  }

  async function updateStateWithSyncAnimation(nextState, scanResult) {
    const delta = syncDelta(scanResult);
    const previousIds = new Set(presentVideos().map((video) => video.bvid));
    const incoming = (nextState?.videos || []).map(video => applyWatchlaterMembership(video))
      .filter(video => video.presentInWatchlater !== false);
    const incomingIds = new Set(incoming.map(video => video.bvid));
    delta.removed = delta.removed.filter(bvid => !incomingIds.has(bvid));
    delta.added = [...new Set(delta.added.concat(incoming.filter((video) => !previousIds.has(video.bvid)).map((video) => video.bvid)))];
    delta.added = delta.added.filter(bvid => incomingIds.has(bvid));
    if (delta.removed.length) {
      delta.removed.forEach((bvid) => {
        const card = videoCardByBvid(bvid);
        if (card) card.classList.add("sync-removing");
      });
      await sleep(180);
    }
    syncAnimations = {
      added: new Set(delta.added),
      changed: new Set(delta.changed.filter((bvid) => !delta.added.includes(bvid)))
    };
    syncAnimationStartedAt = Date.now();
    updateState(nextState, { animateCards: delta.removed.length > 0 || delta.added.length > 0 });
    scheduleClearSyncAnimations();
  }

  function applyWatchlaterMembership(video, remember = false) {
    const tracked = trackedWatchlaterMembership.get(video.bvid);
    if (!tracked) return video;
    const revision = video.watchlaterMembershipRevision || 0;
    const current = revision > tracked.revision ? {
      revision, present: video.presentInWatchlater !== false
    } : tracked;
    if (remember && current !== tracked) trackedWatchlaterMembership.set(video.bvid, current);
    const present = current.present && !pendingRemovalBvids.has(video.bvid);
    if (video.presentInWatchlater === present && revision === current.revision) return video;
    return { ...video, presentInWatchlater: present, watchlaterMembershipRevision: current.revision };
  }

  function syncDelta(scanResult) {
    const result = scanResult || {};
    return {
      added: Array.isArray(result.newBvids) ? result.newBvids : [],
      changed: Array.isArray(result.changedBvids) ? result.changedBvids : [],
      removed: Array.isArray(result.removedBvids) ? result.removedBvids : []
    };
  }

  function scheduleClearSyncAnimations() {
    if (syncAnimationTimer) clearTimeout(syncAnimationTimer);
    syncAnimationTimer = setTimeout(() => {
      syncAnimations = { added: new Set(), changed: new Set() };
      document.querySelectorAll(".sync-added,.sync-updated").forEach((node) => {
        node.classList.remove("sync-added", "sync-updated");
      });
    }, 900);
  }

  function videoCardByBvid(bvid) {
    const cached = videoCardCache.get(bvid)?.card;
    if (cached?.isConnected) return cached;
    if (videoCardCache.size) return null;
    return Array.from(document.querySelectorAll(".video-card[data-bvid]"))
      .find((card) => card.dataset.bvid === bvid);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderShell({ animateCards = false, reflowDuration = 280, animateResults = false, preserveUnchanged = false } = {}) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) animateResults = animateCards = false;
    const content = app.querySelector('[data-role="content"]');
    const visible = updateResultVideos();
    const presentIds = new Set(presentVideos().map(video => video.bvid));
    const counts = categoryCounts();
    const categoryKey = JSON.stringify(state.categories);
    const sidebarKey = JSON.stringify([categoryKey, presentIds.size, counts.unclassified,
      state.categories.map(category => counts.byCategory.get(category.id) || 0)]);
    for (const id of videoCardCache.keys()) {
      if (!presentIds.has(id) && !pendingRemovalBvids.has(id)) videoCardCache.delete(id);
    }
    if (preserveUnchanged && !animateResults && content && (!batchMode || categoryKey === renderedCategories) && !onboardingActive()
      && !app.querySelector(".onboarding-banner, .onboarding-overlay")) {
      refreshDashboard(content, visible, sidebarKey, counts, animateCards, reflowDuration);
      if (manualEditorOpen || managementOpen) renderEditorOnly();
      return;
    }
    manualOpeningCleanup?.();
    settingsOpeningCleanup?.();
    manualSourceCleanup?.();
    // Preserve the currently visible position even if another deletion interrupts a reflow.
    const previousCards = animateResults || animateCards || document.querySelector(".video-card[data-reflow]")
      ? captureCardPositions() : null;
    const resultSnapshots = animateResults ? captureResultSnapshots(previousCards) : null;
    if (animateCards || animateResults) cancelCardPositionAnimations();
    const modalFocus = captureModalFocus();
    captureModalDraft();
    rememberSettingsScroll();
    rememberScrollPositions();
    const children = [el("div", { className: "app" + (batchMode ? " batch-mode" : "") }, [
      renderSidebar(counts),
      renderMain(visible)
    ])];
    children.push(renderEditor(), renderStatusNotice());
    const banner = renderOnboardingBanner();
    const overlay = renderOnboardingOverlay();
    if (banner) children.push(banner);
    if (overlay) children.push(overlay);
    app.replaceChildren(...children);
    renderedSidebarKey = sidebarKey;
    renderedCategories = categoryKey;
    restoreScrollPositions();
    globalThis.BiliWLCovers?.refresh();
    observeStatusPosition();
    showModal();
    setupCategoryPanels();
    restoreModalFocus(modalFocus);
    updateStatusSurface();
    ensureCategoryGlass();
    updateFilterAuras();
    globalThis.BiliWLAura.refresh();
    const nextContent = document.querySelector('[data-role="content"]');
    if (animateResults) {
      startResultTransition(nextContent, previousCards, resultSnapshots);
    } else {
      if (animateCards) resultTransition = null;
      if (previousCards && !resultTransition) animateCardReflow(previousCards, reflowDuration);
      resumeResultTransition(nextContent);
    }
  }

  function refreshDashboard(content, visible, sidebarKey, counts, animateCards, reflowDuration) {
    if (sidebarKey !== renderedSidebarKey) {
      const previous = app.querySelector(".sidebar");
      const nav = previous.querySelector(".cat-nav");
      const height = Number(nav.dataset.cycleHeight);
      savedCategoryScrollTop = height ? categoryLoopOffset(nav.scrollTop, height) : nav.scrollTop;
      const sidebar = renderSidebar(counts);
      previous.replaceWith(sidebar);
      setupCategoryLoop(sidebar.querySelector(".cat-nav"));
      ensureCategoryGlass();
      globalThis.BiliWLAura.refresh();
      renderedSidebarKey = sidebarKey;
    }

    const main = content.closest(".main");
    const scrollTop = main.scrollTop;
    const cards = visible.slice(0, resultLimit).map(renderVideoCard);
    const grid = content.querySelector(".grid");
    const unchanged = grid
      ? cards.length === grid.childElementCount && cards.every((card, index) => grid.children[index] === card)
      : cards.length === 0;
    if (!unchanged) {
      const previous = animateCards ? captureCardPositions() : null;
      if (animateCards) {
        cancelCardPositionAnimations();
        resultTransition = null;
      }
      updateResultGrid(content, grid, cards);
      if (main.scrollTop !== scrollTop) main.scrollTop = scrollTop;
      globalThis.BiliWLCovers?.refresh();
      if (previous) animateCardReflow(previous, reflowDuration);
      else resumeResultTransition(content);
    }
    updateResultHeading(content, visible.length);
    if (updateBrowsingToolbar(visible)) updateFilterAuras();
    updateStatusSurface();
  }

  function updateResultGrid(content, grid, cards) {
    if (!cards.length || !grid) {
      const results = grid || content.querySelector(".empty");
      if (cards.length || grid) results.replaceWith(renderCardGrid(cards));
      return;
    }
    const nextCards = new Set(cards);
    for (const card of Array.from(grid.children)) {
      if (!nextCards.has(card)) card.remove();
    }
    cards.forEach((card, index) => {
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    });
  }

  function updateResultHeading(content, length) {
    const title = content.querySelector(".content-title");
    const nextTitle = activeFilterLabel();
    if (title.textContent !== nextTitle) title.textContent = nextTitle;
    content.querySelector('[data-action="quick-llm-run"]').hidden = !activeFilter.includeUnclassified;
    const count = content.querySelector('[data-role="result-count"]');
    const nextCount = resultCountText(length);
    if (count.textContent !== nextCount) count.textContent = nextCount;
    content.querySelector(".load-more-results").hidden = length <= resultLimit;
  }

  function cardsBetween(top, bottom, root = document) {
    const grid = root.querySelector?.(".grid");
    if (!grid?.childElementCount) return root.querySelectorAll(".video-card[data-bvid]");
    const cards = grid.children;
    const offset = grid.getBoundingClientRect().top + grid.clientTop;
    let first = 0, end = cards.length;
    while (first < end) {
      const middle = (first + end) >>> 1;
      const card = cards[middle];
      if (offset + card.offsetTop + card.offsetHeight < top) first = middle + 1;
      else end = middle;
    }
    const nearby = [];
    for (let index = first; index < cards.length && offset + cards[index].offsetTop <= bottom; index++) {
      nearby.push(cards[index]);
    }
    return nearby;
  }

  function captureCardPositions() {
    const viewport = document.querySelector(".main")?.getBoundingClientRect();
    const buffer = viewport ? viewport.bottom - viewport.top : 0;
    const cards = viewport ? cardsBetween(viewport.top - buffer, viewport.bottom + buffer) : document.querySelectorAll(".video-card[data-bvid]");
    return new Map(Array.from(cards, (card) => [
      card.dataset.bvid, card.getBoundingClientRect()
    ]));
  }

  function cancelCardPositionAnimations() {
    document.querySelectorAll(".video-card[data-reflow], .video-card[data-result-motion]").forEach(card => {
      reflowAnimations.get(card)?.cancel();
      resultAnimations.get(card)?.cancel();
      reflowAnimations.delete(card);
      resultAnimations.delete(card);
      delete card.dataset.reflow;
      delete card.dataset.resultMotion;
    });
  }

  function animateCardReflow(previousCards, duration = 280) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const main = document.querySelector(".main");
    if (!main) return;
    const viewport = main.getBoundingClientRect();
    const moves = Array.from(previousCards, ([bvid, before]) => {
      const card = videoCardByBvid(bvid);
      return card ? { card, before, after: card.getBoundingClientRect() } : null;
    }).filter(Boolean);
    moves.forEach(({ card, before, after }) => {
      if (!before) return;
      const top = Math.max(0, viewport.top);
      const bottom = Math.min(window.innerHeight, viewport.bottom);
      if ((before.bottom < top || before.top > bottom) && (after.bottom < top || after.top > bottom)) return;
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
      card.dataset.reflow = "true";
      const animation = card.animate([
        { transform: "translate(" + dx + "px, " + dy + "px)" },
        { transform: "translate(0, 0)" }
      ], { duration, easing: "cubic-bezier(.2, .75, .25, 1)" });
      reflowAnimations.set(card, animation);
      const cleanup = () => {
        if (reflowAnimations.get(card) !== animation) return;
        reflowAnimations.delete(card);
        delete card.dataset.reflow;
      };
      animation.finished.then(cleanup, cleanup);
    });
  }

  function renderOnboardingOverlay() {
    if (!onboardingActive() || onboardingPanelDismissed) return null;
    const stage = onboardingStage();
    let content;
    if (stage === "login") {
      const loggedOut = onboardingLoginStatus === "logged_out";
      const unknown = !onboardingCheckingLogin && onboardingLoginStatus === "unknown";
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 1 / 3" }),
        el("h2", { textContent: onboardingCheckingLogin ? "正在检查 B站登录状态" : loggedOut ? "请先登录 B站" : unknown ? "暂时无法确认登录状态" : "正在准备整理助手" }),
        el("p", { textContent: onboardingCheckingLogin
          ? "插件正在读取你的稍后再看列表，通常只需要几秒。"
          : loggedOut
            ? "稍后再看列表需要使用你当前浏览器中的 B站登录状态。登录成功后回到这里重新检测。"
            : "网络或 B站接口暂时不可用。可以先打开 B站确认登录，再重新检测。" }),
        el("div", { className: "onboarding-actions" }, [
          el("a", { className: "onboarding-link primary", href: "https://www.bilibili.com/", target: "_blank", textContent: "打开 B站并登录" }),
          el("button", { className: "ghost", dataset: { action: "retry-onboarding-login" }, textContent: "我已登录，重新检测" })
        ])
      ];
    } else if (stage === "setup") {
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 2 / 3" }),
        el("h2", { textContent: "先设置你的分类目录" }),
        el("p", { textContent: "这里调整的是所有视频共用的分类目录，不是在给视频分配类别。默认目录不一定适合你，可以手动修改，也可以让 AI 根据现有视频重新生成。" }),
        renderOnboardingCategoryPreview("当前分类目录"),
        el("div", { className: "onboarding-options" }, [
          onboardingOption("categories", "1", "我要手动设置我的分类", "收起引导卡片并展开设置弹窗中的编辑分类目录，直接修改可选分类。"),
          onboardingOption("api", "2", "我有 API，让 AI 帮我调整分类", "填写 API 后，AI 会根据现有视频自动生成并替换分类目录。"),
          onboardingOption("prompt", "3", "我没有 API，手动复制 Prompt 来生成分类目录", "复制分类目录 Prompt 给 AI，再把 categories JSON 导回插件。")
        ]),
        el("div", { className: "onboarding-note", textContent: "完成这一阶段后，第三步才会开始给每一个视频分配类别。" })
      ];
    } else if (stage === "setup-api") {
      const settings = state.settings || {};
      const configured = categoryApiSettingsReady(settings);
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 2 / 3 · API" }),
        el("h2", { textContent: "让 AI 生成分类目录" }),
        el("p", { textContent: "使用 OpenAI-compatible API 生成分类目录。" }),
        el("div", { className: "onboarding-api-state " + (configured ? "ready" : "missing"), textContent: configured ? "API 已设置，可以先测试，或直接生成分类目录。" : "API 尚未设置完整，请先到顶部设置弹窗中填写并测试。" }),
        onboardingCategoryMessage ? renderFeedbackNotice("onboarding-run-status", onboardingCategoryMessage) : null,
        el("div", { className: "onboarding-actions" }, [
          el("button", { className: "ghost", dataset: { action: "back-onboarding-setup" }, textContent: "← 返回上一步" }),
          el("button", { dataset: { action: "open-onboarding-api-settings" }, textContent: "配置 OpenAI-compatible" }),
          configured ? el("button", { className: "primary", dataset: { action: "save-onboarding-api" }, textContent: onboardingCategoryRunning ? "AI 正在生成分类目录…" : "让 AI 生成分类目录" }) : null
        ])
      ].filter(Boolean);
    } else if (stage === "setup-prompt") {
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 2 / 3 · Prompt" }),
        el("h2", { textContent: "手动让 AI 生成分类目录" }),
        el("p", { textContent: "Prompt 会随机抽取现有视频标题，请 AI 设计一棵新的分类目录；生成目录本身不会给每个视频分类。" }),
        el("label", { className: "field onboarding-prompt-field" }, [
          el("span", { textContent: onboardingPromptLoading ? "正在生成分类目录 Prompt…" : "复制给 ChatGPT / Gemini" }),
          el("textarea", { readonly: "", dataset: { role: "onboarding-prompt-text" }, value: onboardingPromptText, placeholder: "正在生成精简 Prompt..." })
        ]),
        el("div", { className: "onboarding-inline-actions" }, [
          el("button", { dataset: { action: "copy-onboarding-prompt" }, textContent: "复制 Prompt" }),
          el("button", { className: "ghost", dataset: { action: "regenerate-onboarding-prompt" }, textContent: "重新随机生成" })
        ]),
        el("label", { className: "field onboarding-prompt-field" }, [
          el("span", { textContent: "粘贴 AI 返回的 categories JSON" }),
          el("textarea", { dataset: { role: "onboarding-prompt-import" }, placeholder: "{\"categories\":[{\"id\":\"study\",\"name\":\"学习\",...}]}" })
        ]),
        el("div", { className: "onboarding-actions" }, [
          el("button", { className: "ghost", dataset: { action: "back-onboarding-setup" }, textContent: "← 返回上一步" }),
          el("button", { className: "primary", dataset: { action: "import-onboarding-json" }, textContent: "导入并替换分类目录" })
        ])
      ];
    } else if (stage === "setup-result") {
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 2 / 3 · 已更新" }),
        el("h2", { textContent: "新的分类目录已生成" }),
        el("p", { textContent: "下面是 AI 根据现有视频生成的新分类目录。它已经取代默认目录，并附带 keywords 供后续初步分类使用。还需要手动调整吗？" }),
        renderOnboardingCategoryPreview("新的分类目录"),
        el("div", { className: "onboarding-actions" }, [
          el("button", { className: "ghost", dataset: { action: "back-onboarding-method" }, textContent: "← 返回上一步" }),
          el("button", { dataset: { action: "adjust-onboarding-result" }, textContent: "需要，编辑分类目录" }),
          el("button", { className: "primary", dataset: { action: "show-onboarding-guide" }, textContent: "不需要，继续" })
        ])
      ];
    } else if (stage === "setup-categories") {
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 2 / 3 · 手动" }),
        el("h2", { textContent: "编辑分类目录" }),
        el("p", { textContent: "编辑分类目录会在设置弹窗中展开。你可以增删、改名或调整父级，点击“确定保存”后再继续。" }),
        el("div", { className: "onboarding-actions" }, [
          el("button", { className: "ghost", dataset: { action: "back-onboarding-setup" }, textContent: "← 返回上一步" }),
          el("button", { dataset: { action: "reopen-onboarding-categories" }, textContent: "展开编辑分类目录" }),
          el("button", { className: "primary", dataset: { action: "show-onboarding-guide" }, textContent: "分类目录已调整，继续" })
        ])
      ];
    } else {
      content = [
        el("div", { className: "onboarding-kicker", textContent: "首次使用 · 3 / 3" }),
        el("h2", { textContent: "分类目录已确定，接下来给视频分类" }),
        el("p", { textContent: "下面才是把每个视频分配到刚才目录中的步骤。优先级从高到低如下；任选一种方式完成一次视频分类，引导就会结束。" }),
        el("div", { className: "onboarding-levels" }, [
          onboardingLevel("manual", "细分类 · 最高", "手动确认", "你亲自确认的分类具有最高优先级，不会被自动修改。"),
          onboardingLevel("llm", "细分类", "AI 分类", "使用 AI 进一步判断视频内容；结果过旧或不确定时可重新分类。"),
          onboardingLevel("keyword", "粗分类", "初步分类", "插件会先自动整理，速度快，但可能不够准确，仍会进入待精细分类。")
        ]),
        el("div", { className: "onboarding-actions onboarding-actions-wide" }, [
          el("button", { className: "primary", dataset: { action: "start-onboarding-classify", mode: "manual" }, textContent: "手动调整一个视频分类" }),
          el("button", { dataset: { action: "start-onboarding-classify", mode: "prompt" }, textContent: "启动 AI (手动导入/导出) 批量视频分类" }),
          el("button", { dataset: { action: "start-onboarding-classify", mode: "api" }, textContent: "启动 AI (API) 批量视频分类" })
        ]),
        el("button", { className: "onboarding-back", dataset: { action: "back-onboarding-setup" }, textContent: "← 返回上一步" }),
        el("button", { className: "onboarding-skip", dataset: { action: "complete-onboarding" }, textContent: "稍后再分类，结束引导" })
      ];
    }
    return el("div", { className: "onboarding-overlay" }, [
      el("section", { className: "onboarding-card", role: "dialog", "aria-modal": "true" }, content)
    ]);
  }

  function onboardingOption(method, number, titleValue, description) {
    return el("button", {
      className: "onboarding-option",
      dataset: { action: "choose-onboarding-method", method }
    }, [
      el("span", { className: "onboarding-number", textContent: number }),
      el("span", {}, [
        el("strong", { textContent: titleValue }),
        el("small", { textContent: description })
      ])
    ]);
  }

  function onboardingLevel(source, rank, titleValue, description) {
    return el("div", { className: "onboarding-level onboarding-level-" + source }, [
      el("span", { className: "onboarding-rank", textContent: rank }),
      el("div", {}, [el("strong", { textContent: titleValue }), el("small", { textContent: description })])
    ]);
  }

  function renderOnboardingCategoryPreview(titleValue) {
    const rows = flattenCategoriesInTree();
    return el("div", { className: "onboarding-category-preview" }, [
      el("strong", { textContent: titleValue + " · " + rows.length + " 项" }),
      el("div", {}, rows.map(({ category, level }) => el("span", {
        className: "onboarding-category-level-" + Math.min(level, 2),
        textContent: categoryTreeLabel(category, level)
      })))
    ]);
  }

  function renderOnboardingBanner() {
    if (!onboardingActive() || !onboardingPanelDismissed) return null;
    const stage = onboardingStage();
    let titleValue = "完成首次设置";
    let description = "调整完成后，继续了解分类等级。";
    if (stage === "setup-categories") {
      titleValue = "正在编辑分类目录";
      description = "在设置弹窗的编辑分类目录中调整草稿，并点击“确定保存”。";
    } else if (stage === "setup-api") {
      titleValue = "正在设置 API";
      description = "在设置弹窗中保存并测试 API，然后返回首次引导。";
    } else if (stage === "classify") {
      titleValue = "完成一次首次分类";
      description = "保存手动确认、导入 JSON 或完成 AI 视频分类后，引导会自动结束。";
    }
    return el("div", { className: "onboarding-banner" }, [
      el("div", {}, [el("strong", { textContent: titleValue }), el("span", { textContent: description })]),
      el("div", { className: "onboarding-banner-actions" }, stage === "setup-categories" ? [
        el("button", { className: "ghost", dataset: { action: "back-onboarding-setup" }, textContent: "返回上一步" }),
        el("button", { className: "primary", dataset: { action: "show-onboarding-guide" }, textContent: "调整好了，继续" })
      ] : stage === "setup-api" ? [
        el("button", { className: "primary", dataset: { action: "resume-onboarding-api" }, textContent: "返回首次引导" })
      ] : [
        el("button", { className: "ghost", dataset: { action: "back-onboarding-guide" }, textContent: "返回上一步" }),
        el("button", { className: "ghost", dataset: { action: "complete-onboarding" }, textContent: "稍后处理" })
      ])
    ]);
  }

  function renderSidebar(counts) {
    return el("aside", { className: "sidebar" }, [
      renderCategoryTree(counts)
    ]);
  }

  function renderStatusNotice() {
    const textValue = statusText();
    const kind = statusNotice.text ? statusNotice.kind : statusKind(textValue);
    return el("section", {
      className: "activity-status feedback-notice status-" + kind,
      dataset: { role: "status-surface" },
      hidden: Date.now() >= noticeExpiresAt,
      popover: "manual",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true"
    }, [
      renderFeedbackAura("operation-feedback"),
      el("span", { className: "activity-status-icon", dataset: { role: "status-icon" } }, [statusIcon(kind)]),
      el("div", { className: "activity-status-copy" }, [
        el("strong", { textContent: "操作反馈" }),
        el("span", { dataset: { role: "status" }, textContent: textValue })
      ])
    ]);
  }

  function renderCategoryTree(counts = categoryCounts()) {
    const allActive = !activeFilter.categoryIds.length && !activeFilter.includeUnclassified;
    const fragment = document.createDocumentFragment();
    const header = el("div", { className: "sidebar-sticky" }, [
      el("div", { className: "side-head" }, [
        el("h1", { textContent: "稍后再看整理助手" }),
        el("div", { className: "sub", textContent: "自动归类，快速找到想看的视频" })
      ])
    ]);
    const pinned = el("div", { className: "sidebar-filters", "aria-label": "视频范围" });
    pinned.appendChild(el("button", {
      className: "cat-row category-root" + (allActive ? " active" : ""),
      "aria-current": allActive ? "true" : "false",
      style: "--aura-hue:205",
      dataset: { action: "filter-all", auraSize: "large" }
    }, [
      allActive ? renderCategoryAura() : null,
      el("span", { className: "cat-name", textContent: "全部视频" }),
      el("span", { className: "cat-count", textContent: String(presentVideos().length) })
    ]));
    pinned.appendChild(el("button", {
      className: "cat-row category-root" + (activeFilter.includeUnclassified ? " active" : ""),
      "aria-current": activeFilter.includeUnclassified ? "true" : "false",
      style: "--aura-hue:35",
      title: "需要进一步确认的视频：只有初步分类、结果过旧或不确定；也可能已有内容类别。",
      dataset: { action: "filter-unclassified", auraSize: "large" }
    }, [
      activeFilter.includeUnclassified ? renderCategoryAura("large", "pending") : null,
      el("span", { className: "cat-name", textContent: "待精细分类" }),
      el("span", { className: "cat-count", textContent: String(counts.unclassified) })
    ]));
    const cycle = el("div", { className: "category-cycle", dataset: { categoryCycle: "original" } });
    appendCategoryLevel(cycle, "", 0, counts);
    fragment.appendChild(cycle);
    return el("div", { className: "category-browser" }, [header, pinned, el("nav", { className: "cat-nav", "aria-label": "内容分类" }, [fragment])]);
  }

  function setupCategoryLoop(nav) {
    if (categoryLoopObserver) categoryLoopObserver.disconnect();
    const cycle = nav.querySelector('[data-category-cycle="original"]');
    if (!cycle) return;
    let layout = "";
    const rebuild = () => {
      const height = cycle.getBoundingClientRect().height;
      const nextLayout = [nav.clientWidth, nav.clientHeight, height].join(":");
      if (layout === nextLayout) return;
      layout = nextLayout;
      const previousHeight = Number(nav.dataset.cycleHeight) || 0;
      const offset = previousHeight ? categoryLoopOffset(nav.scrollTop, previousHeight) : savedCategoryScrollTop;
      const focused = document.activeElement;
      const focusId = focused && nav.contains(focused) ? focused.dataset.categoryId : "";
      const focusTop = focusId ? focused.getBoundingClientRect().top : 0;
      nav.querySelectorAll('[data-category-cycle="copy"]').forEach((node) => node.remove());
      nav.dataset.cycleHeight = String(height);
      if (!height) return;
      // Enough repeated content to fill even a tall viewport with a short directory.
      const copies = Math.ceil(nav.clientHeight / height) + 2;
      for (let i = 0; i < copies; i++) {
        const copy = cycle.cloneNode(true);
        copy.dataset.categoryCycle = "copy";
        copy.querySelectorAll(".category-glass").forEach(node => node.remove());
        copy.querySelectorAll(".aura-preview").forEach(row => {
          row.classList.remove("aura-preview");
          if (!row.classList.contains("active")) row.querySelector(".category-aura")?.remove();
        });
        if (i === 0) nav.insertBefore(copy, cycle);
        else nav.appendChild(copy);
      }
      nav.scrollTop = height + categoryLoopOffset(offset, height);
      if (focusId) {
        const equivalent = Array.from(nav.querySelectorAll('[data-action="filter-category"]'))
          .filter(row => row.dataset.categoryId === focusId)
          .sort((a, b) => Math.abs(a.getBoundingClientRect().top - focusTop) - Math.abs(b.getBoundingClientRect().top - focusTop))[0];
        if (equivalent) equivalent.focus({ preventScroll: true });
      }
      globalThis.BiliWLAura.refresh();
      ensureCategoryGlass();
    };
    rebuild();
    nav.addEventListener("scroll", () => { wrapCategoryLoop(nav); ensureCategoryGlass(); }, { passive: true });
    categoryLoopObserver = new ResizeObserver(rebuild);
    categoryLoopObserver.observe(nav);
    categoryLoopObserver.observe(cycle);
  }

  function categoryLoopOffset(scrollTop, height) {
    return ((scrollTop % height) + height) % height;
  }

  function revealOpeningCategory() {
    const nav = document.querySelector(".cat-nav");
    const row = nav?.querySelector('[data-category-cycle="original"] .cat-row.active');
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const viewport = nav.getBoundingClientRect();
    if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) return;
    nav.scrollTop += (rect.top + rect.bottom - viewport.top - viewport.bottom) / 2;
    wrapCategoryLoop(nav);
    ensureCategoryGlass();
  }

  function wrapCategoryLoop(nav) {
    const height = Number(nav.dataset.cycleHeight);
    if (!height) return;
    if (nav.scrollTop >= height && nav.scrollTop < height * 2) return;
    const next = height + categoryLoopOffset(nav.scrollTop, height);
    const focused = document.activeElement;
    const cycles = Array.from(nav.querySelectorAll(".category-cycle"));
    const focusedCycle = focused && focused.closest(".category-cycle");
    if (focusedCycle && nav.contains(focused)) {
      const index = cycles.indexOf(focusedCycle) + Math.round((next - nav.scrollTop) / height);
      const equivalent = cycles[index] && Array.from(cycles[index].querySelectorAll('[data-action="filter-category"]'))
        .find((button) => button.dataset.categoryId === focused.dataset.categoryId);
      if (equivalent) equivalent.focus({ preventScroll: true });
    }
    nav.scrollTop = next;
  }

  function appendCategoryLevel(fragment, parentId, level, counts) {
    core.childrenOf(state.categories, parentId).forEach((category) => {
      const active = activeFilter.sourceCategoryId === category.id;
      const large = level === 0 || core.childrenOf(state.categories, category.id).length > 0;
      const group = el("div", {
        className: "category-tree-group",
        dataset: { categoryGroup: category.id }
      }, [
        el("button", {
          className: "cat-row indent-" + Math.min(level, 3) + (level === 0 ? " category-root" : "") + (active ? " active" : ""),
          "aria-current": active ? "true" : "false",
          style: categoryAuraStyle(category.id),
          title: category.id === "other.todo" ? "暂时找不到合适类别的视频。是否还需处理，请看“待精细分类”。" : category.name,
          dataset: { action: "filter-category", categoryId: category.id, auraSize: large ? "large" : "small" }
        }, [
          active ? renderCategoryAura(large ? "large" : "small", category.id) : null,
          el("span", { className: "cat-name", textContent: category.name }),
          el("span", { className: "cat-count", textContent: String(counts.byCategory.get(category.id) || 0) })
        ])
      ]);
      appendCategoryLevel(group, category.id, level + 1, counts);
      fragment.appendChild(group);
    });
  }

  function categoryAuraStyle(id) {
    // Avalanche the ID hash so siblings and sequential IDs do not cluster in one hue.
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
    hash = (hash ^ (hash >>> 16)) >>> 0;
    const palettes = [
      [145, 175, 210], // mint / lagoon / sky
      [185, 215, 250], // ice / blue / periwinkle
      [220, 255, 292], // cornflower / lavender / orchid
      [260, 292, 326], // lilac / mauve / rose
      [310, 340, 375], // berry / blush / coral
      [345, 378, 408], // rose / peach / honey
      [15, 40, 68], // apricot / amber / butter
      [48, 80, 114], // gold / lime / sage
      [78, 116, 156], // citrus / fern / jade
      [118, 151, 186], // leaf / seafoam / aqua
      [165, 205, 260], // turquoise / azure / iris
      [205, 252, 312], // blue / violet / pink
      [270, 312, 350], // wisteria / peony / watermelon
      [320, 360, 402], // pink / coral / champagne
      [28, -8, -52], // peach / rose / lavender
      [64, 26, -12], // vanilla / apricot / pink
      [110, 70, 28], // pistachio / butter / peach
      [182, 145, 95], // aqua / mint / chartreuse
      [242, 202, 160], // periwinkle / sky / seafoam
      [290, 247, 204], // orchid / iris / ice
      [340, 288, 235], // rose / lilac / blue
      [35, -20, -65], // sunrise / blush / iris
      [155, 198, 238], // jade / ocean / cornflower
      [230, 275, 325] // twilight / violet / pink
    ];
    const [a, b, c] = palettes[hash % palettes.length];
    const variation = ((hash >>> 8) % 141 - 70) / 10;
    return "--aura-hue:" + ((b + variation + 360) % 360).toFixed(1) +
      ";--aura-shift-a:" + (a - b) + ";--aura-shift-b:0;--aura-shift-c:" + (c - b);
  }

  function renderCategoryAura(size = "large", seed = "all") {
    let random = 0;
    for (const char of seed) random = (Math.imul(random, 31) + char.charCodeAt(0)) >>> 0;
    const particles = Array.from({ length: size === "large" ? 28 : 16 }, (_, index) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return el("span", {
        className: "category-particle",
        dataset: { depth: random / 4294967296 < .4 ? "front" : "back" },
        style: "--particle-x:" + (12 + (index * 29 % 50)) + "%;--particle-y:" + (15 + index * 37 % 70) +
          "%;--particle-size:" + (index % 6 === 0 ? 1.6 : index % 3 === 0 ? 1.2 : .9) + "px;--particle-delay:" + (-index * .71) +
          "s;--particle-duration:" + (4.8 + index % 5 * .4) + "s;--particle-travel:" + (48 + index * 17 % 60) +
          "px;--particle-tail:" + (index % 5 === 0 ? .18 : 0)
      });
    });
    return el("span", { className: "category-aura", "aria-hidden": "true" }, [
      el("span", { className: "category-aura-backdrop" }, [
        el("canvas", { className: "category-aura-flow" }),
        el("span", { className: "category-aura-grain" })
      ]),
      ...particles
    ]);
  }

  function renderCategoryAdmin() {
    const draft = ensureCategoryDraft();
    const categoryRows = flattenCategoriesInTree(draft);
    const parentOptions = [el("option", { value: "", textContent: "无上级（一级分类）", selected: !newCategoryDraft.parent })]
      .concat(categoryRows.filter(row => row.level < 2).map(({ category, level }) => el("option", {
        value: category.id,
        selected: category.id === newCategoryDraft.parent,
        textContent: categoryTreeLabel(category, level)
      })));
    return el("section", { className: "settings-page", hidden: settingsPage !== "directory", dataset: { settingsPage: "directory", fold: "category-admin" } }, [
      settingsSectionHeader("编辑分类目录", "这里决定有哪些类别及其层级，不是在给视频分类。修改草稿后需确定保存。", "directory", directoryMode,
        [["edit", "手动编辑"], ["generate", "让 AI 生成目录"]]),
      el("div", { className: "settings-page-body" }, [
      el("div", { className: "directory-edit", hidden: directoryMode !== "edit", dataset: { settingsGroup: "directory", settingsValue: "edit" } }, [
        el("div", { className: "category-admin-summary" }, [
          el("span", { className: "sub", textContent: categoryRows.filter((row) => row.level === 0).length + " 个一级分类 · " + categoryRows.length + " 个类别" }),
          directoryDropZone("", "", "＋ 一级分类", 0, "promote"),
          el("div", { className: "directory-drop-zone directory-drop-promote", title: "拖到这里提升一个层级", textContent: "↑ 上一级", dataset: { directoryDrop: "true", promoteLevel: "true" } }),
          el("button", { className: "ghost", dataset: { action: "toggle-category-add" }, "aria-expanded": String(categoryAddOpen), textContent: categoryAddOpen ? "收起添加" : "添加类别" })
        ]),
        el("div", { className: "category-form", hidden: !categoryAddOpen, dataset: { role: "category-add-form" } }, [
          el("label", { className: "field" }, [
            el("span", { textContent: "分类名称" }),
            el("input", { type: "text", value: newCategoryDraft.name, placeholder: "输入新分类名", dataset: { role: "new-category-name" } })
          ]),
          el("label", { className: "field" }, [
            el("span", { textContent: "上级分类" }),
            el("select", { value: newCategoryDraft.parent, dataset: { role: "new-category-parent" } }, parentOptions)
          ]),
          el("button", { dataset: { action: "add-category" }, textContent: "添加分类" })
        ]),
        el("div", { className: "category-admin-list settings-scroll", "aria-label": "分类目录草稿", dataset: { scrollKey: "directory-edit" } }, [
          el("div", { className: "category-panel-grid directory-panels" }, [
            ...categoryPanelGroups(draft).map(rows => el("section", { className: "category-panel", "aria-label": rows[0].category.name }, [
              ...rows.map(({ category, level }) => renderCategoryAdminRow(category, level, draft))
            ])),
          ])
        ]),
      ]),
      el("div", { className: "settings-scroll directory-generate", hidden: directoryMode !== "generate", dataset: { settingsGroup: "directory", settingsValue: "generate", scrollKey: "directory-generate" } }, [renderCategoryGenerationTools()])
      ]),
      el("div", { className: "category-save-actions", hidden: directoryMode !== "edit", dataset: { settingsGroup: "directory", settingsValue: "edit" } }, [
          el("span", {
            className: "category-draft-status" + (categoryDraftDirty ? " is-dirty" : ""),
            dataset: { role: "category-draft-status" }, textContent: categoryDraftDirty ? "有未保存修改" : "与已保存目录一致"
          }),
          el("button", { className: "primary", dataset: { action: "save-category-draft" }, textContent: "确定保存" }),
          el("button", { className: "ghost", dataset: { action: "discard-category-draft" }, textContent: "放弃未保存修改" })
        ])

    ]);
  }

  function renderCategoryGenerationTools() {
    return el("div", { className: "category-generation" }, [
      el("div", { className: "category-generation-heading" }, [
        el("h3", { textContent: "让 AI 生成分类目录" }),
        el("p", { textContent: "AI 会根据现有视频设计并替换可选分类目录，不会给已有视频重新分类，也不会覆盖手动确认。" })
      ]),
      el("div", { className: "category-generation-actions" }, [
        el("button", {
          className: "primary",
          dataset: { action: "generate-categories-api" },
          textContent: categoryGeneration.running ? "AI 正在生成…" : "使用 API 生成"
        }),
        el("button", {
          dataset: { action: "toggle-category-prompt" },
          textContent: categoryGeneration.mode === "prompt" ? "收起手动复制" : "手动复制 Prompt"
        }),
        el("button", { className: "ghost", dataset: { action: "open-api-settings", provider: "openai" }, textContent: "配置 OpenAI-compatible" })
      ]),
      categoryGeneration.message ? renderFeedbackNotice("category-generation-status", categoryGeneration.message) : null,
      categoryGeneration.mode === "prompt" ? renderCategoryPromptEditor() : null
    ].filter(Boolean));
  }

  function renderCategoryPromptEditor() {
    return el("div", { className: "category-prompt-editor" }, [
      el("label", { className: "field" }, [
        el("span", { textContent: categoryGeneration.loading ? "正在生成分类目录 Prompt…" : "复制给 ChatGPT / Gemini" }),
        el("textarea", { readonly: "", dataset: { role: "category-prompt-text" }, value: categoryGeneration.prompt, placeholder: "点击下方按钮生成 Prompt" })
      ]),
      el("div", { className: "category-generation-actions" }, [
        el("button", { dataset: { action: "load-category-prompt" }, textContent: categoryGeneration.prompt ? "重新生成 Prompt" : "生成 Prompt" }),
        el("button", { className: "ghost", dataset: { action: "copy-category-prompt" }, textContent: "复制 Prompt" })
      ]),
      el("label", { className: "field" }, [
        el("span", { textContent: "粘贴 AI 返回的 categories JSON" }),
        el("textarea", { dataset: { role: "category-prompt-import" }, value: categoryGeneration.importText, placeholder: "{\"categories\":[{\"id\":\"study\",\"name\":\"学习\",...}]}" })
      ]),
      el("button", { className: "primary category-import-button", dataset: { action: "import-category-prompt" }, textContent: "导入并替换分类目录" })
    ]);
  }

  function renderMain(visible) {
    return el("main", { className: "main" }, [
      el("div", { className: "topbar liquid-glass liquid-glass--simple glass-panel" }, [
        el("div", { className: "toolbar liquid-glass__content" }, [
          el("div", { className: "toolbar-find", role: "group", "aria-label": "查找视频" }, [
            el("label", { className: "glass-search liquid-glass liquid-glass--simple glass-control", dataset: { filterAura: "search" } }, [
              iconNode("search"),
              el("input", { className: "search-input", type: "search", value: searchText, "aria-label": "搜索视频", title: "搜索标题、UP主、分区、标签、BV号", placeholder: "搜索视频、UP主…", "aria-describedby": "search-scope-hint", dataset: { role: "search" } })
            ]),
            el("span", { className: "toolbar-filter", dataset: { filterAura: "duration" } }, [
              el("select", { className: "liquid-glass liquid-glass--simple glass-control glass-select", title: "筛选视频", "aria-label": "筛选视频", dataset: { role: "video-filter" } }, videoFilterOptions())
            ]),
            el("select", { className: "liquid-glass liquid-glass--simple glass-control glass-select", title: "排序", "aria-label": "排序", dataset: { role: "sort-combo" } }, sortOptions()),
            renderShuffleControl(visible)
          ]),
          el("span", { className: "toolbar-divider", "aria-hidden": "true" }),
            el("div", { className: "toolbar-maintenance", role: "group", "aria-label": "更新与管理" }, [
              el("button", { className: "sync-button liquid-glass liquid-glass--simple glass-control glass-tinted", title: "同步并更新：先同步列表，再排队更新缺失详情", "aria-label": "同步并更新", dataset: { action: "sync-refresh" } }, [iconNode("sync"), el("span", { textContent: "同步并更新" })]),
              el("button", { className: "batch-button liquid-glass liquid-glass--simple glass-control", title: batchMode ? "退出批量" : "批量管理", "aria-label": batchMode ? "退出批量" : "批量管理", "aria-pressed": String(batchMode), dataset: { action: "toggle-batch" } }, [iconNode("batch"), el("span", { textContent: batchMode ? "退出批量" : "批量管理" })]),
              el("button", { className: "settings-button liquid-glass liquid-glass--simple glass-control", title: "设置", "aria-label": "设置", dataset: { action: "open-management" }, "aria-haspopup": "dialog" }, [
                iconNode("settings"), el("span", { textContent: "设置" })
              ]),
            ]),
            el("span", { className: "toolbar-divider", "aria-hidden": "true" }),
            el("nav", { className: "toolbar-navigation", "aria-label": "B站导航" }, [
              toolbarIconButton("open-bili-home", "B站主页", "bilibili"),
              toolbarIconButton("open-watchlater", "稍后再看", "watchlater"),
              toolbarIconButton("open-bili-dynamic", "B站动态", "dynamic")
            ])
        ]),
        batchMode ? renderBatchPanel() : null
      ]),
      renderContent(visible),
      el("div", { className: "scroll-controls", role: "group", "aria-label": "列表位置" }, [
        scrollIconButton("scroll-top", "回到最顶部", "arrow-up"),
        scrollIconButton("scroll-last-video", "回到上一次打开的视频位置", "history")
      ])
    ]);
  }

  function renderShuffleControl(visible) {
    const button = (action, label) => el("button", {
      className: "liquid-glass liquid-glass--simple glass-control" + (!randomOrder ? " shuffle-button" : ""),
      title: label, "aria-label": label, disabled: action === "shuffle-videos" && visible.length < 2,
      dataset: { action }
    }, [iconNode(randomOrder ? (action === "shuffle-videos" ? "sync" : "close") : "shuffle")]);
    return el("span", { className: "shuffle-control" + (randomOrder ? " shuffle-active" : ""), dataset: { filterAura: "shuffle" }, role: "group", "aria-label": "乱序" },
      randomOrder ? [button("shuffle-videos", "刷新乱序"), button("exit-shuffle", "退出乱序")] : [button("shuffle-videos", "乱序")]);
  }

  function renderContent(visible) {
    return el("div", { className: "content", dataset: { role: "content" } }, [
      renderBatchSelectionBox(),
      el("div", { className: "list-head" }, [
        el("div", { className: "list-heading" }, [
          el("h2", { className: "content-title", textContent: activeFilterLabel() }),
          el("button", {
            className: "quick-classify-button liquid-glass liquid-glass--simple glass-control glass-tinted",
            hidden: !activeFilter.includeUnclassified,
            title: "使用已保存的 API 处理全部待精细分类视频",
            dataset: { action: "quick-llm-run" }, textContent: "一键 AI 分类"
          })
        ]),
        el("span", { id: "search-scope-hint", className: "search-scope-hint", hidden: !searchText.trim(), role: "status", textContent: "关键词筛选中", title: "当前分类中仅显示匹配关键词的视频；清空搜索可查看全部结果。" }),
        el("span", { dataset: { role: "result-count" }, textContent: resultCountText(visible.length) })
      ]),
      renderCardGrid(visible.slice(0, resultLimit).map(renderVideoCard)),
      el("div", { className: "load-more-results", hidden: visible.length <= resultLimit }, [
        el("button", {
          className: "liquid-glass liquid-glass--simple glass-control",
          dataset: { action: "load-more-results" }, textContent: "加载更多视频"
        })
      ])
    ]);
  }

  function resultCountText(count) {
    const shown = count > resultLimit ? " · 已显示 " + resultLimit + " 个" : "";
    return count + " 个视频" + shown + (searchText.trim() ? " · 仅显示搜索匹配" : "");
  }

  function renderCardGrid(cards) {
    return cards.length
      ? el("div", { className: "grid" }, cards)
      : el("div", { className: "empty", textContent: "没有匹配的视频。可以清除筛选或先在 B站页面扫描同步。" });
  }

  function videoCardSignature(video, classification) {
    if (cardCategoriesSource !== state.categories) {
      cardCategoriesSource = state.categories;
      const key = JSON.stringify(state.categories);
      if (key !== cardCategoriesKey) { cardCategoriesKey = key; cardCategoriesRevision++; }
    }
    // Only displayed fields invalidate a card; a scan's timestamps/order do not.
    return JSON.stringify([
      video.bvid, video.title, video.upName, video.tname, video.pubdate, video.watchlaterAddedAt,
      video.duration, video.watchProgress, video.isWatched, video.viewCount, video.coverUrl,
      video.aid, video.oid, core.classifyStatus(video, classification),
      core.classificationSourceType(classification), classification?.categoryIds, cardCategoriesRevision
    ]);
  }

  function renderVideoCard(video) {
    const classification = classificationMap().get(video.bvid);
    const signature = videoCardSignature(video, classification);
    const cached = videoCardCache.get(video.bvid);
    if (cached?.signature === signature) {
      const { card } = cached;
      card.classList.toggle("selected", !batchMode && video.bvid === selectedBvid);
      const mark = card.querySelector(".select-mark");
      if (mark.hidden === batchMode) mark.hidden = !batchMode;
      card.classList.toggle("batch-pickable", batchMode);
      updateBatchCardSelection(card);
      return card;
    }
    const card = buildVideoCard(video, classification);
    // Metadata/category changes keep the decoded image and its in-flight request.
    const previousCover = cached?.card.querySelector("img[data-cover-original]");
    const nextCover = card.querySelector("img[data-cover-original]");
    if (previousCover && nextCover && previousCover.dataset.coverOriginal === nextCover.dataset.coverOriginal) {
      const previousState = previousCover.parentElement.querySelector(".cover-state");
      nextCover.replaceWith(previousCover);
      card.querySelector(".cover-state").replaceWith(previousState);
    }
    videoCardCache.set(video.bvid, { signature, card });
    return card;
  }

  function buildVideoCard(video, classification) {
    const status = core.classifyStatus(video, classification);
    const sourceType = core.classificationSourceType(classification);
    const badges = categoryBadgeNodes(classification);
    return el("article", {
      className: "video-card" +
        (video.bvid === selectedBvid && !batchMode ? " selected" : "") +
        (batchMode ? " batch-pickable" : "") +
        (selectedBvids.has(video.bvid) ? " batch-selected" : "") +
        (syncAnimations.added.has(video.bvid) ? " sync-added" : "") +
        (syncAnimations.changed.has(video.bvid) ? " sync-updated" : ""),
      dataset: { action: "select-video", bvid: video.bvid },
      tabindex: "0",
      "aria-label": "手动调整视频分类：" + (video.title || video.bvid),
      // Detail refreshes rebuild cards; resume the same animation instead of replaying it.
      style: syncAnimations.added.has(video.bvid) || syncAnimations.changed.has(video.bvid)
        ? "animation-delay:-" + Math.max(0, Date.now() - syncAnimationStartedAt) + "ms;" : ""
    }, [
      el("div", { className: "select-mark", hidden: !batchMode }, selectedBvids.has(video.bvid) ? [iconNode("check")] : []),
      el("a", {
        className: "cover-link",
        href: core.standardVideoUrl(video),
        target: "_blank",
        rel: "noopener noreferrer",
        dataset: { openVideo: video.bvid },
        title: "打开普通 B站视频页",
        "aria-label": "打开视频：" + (video.title || video.bvid)
      }, [renderCover(video)]),
      el("div", { className: "card-body" }, [
        el("div", { className: "title", title: video.title || video.bvid, textContent: video.title || video.bvid }),
        el("div", { className: "meta", textContent: [video.upName, video.tname].filter(Boolean).join(" · ") || video.bvid }),
        el("div", { className: "meta", textContent: [formatDate(video.pubdate), formatWatchlaterDate(video.watchlaterAddedAt)].filter(Boolean).join(" · ") }),
        el("div", { className: "badges" }, [
          ...(sourceType && badges.length ? [el("span", { className: "badge source source-" + sourceType, textContent: sourceLabel(sourceType) })] : []),
          ...(["unclassified", "stale", "low_confidence"].includes(status) ? [el("span", { className: "badge warn status-" + status, textContent: statusLabel(status) })] : []),
          ...(badges.length ? badges : [el("span", { className: "badge warn status-unclassified", textContent: "分类异常" })]).slice(0, 4)
        ]),
        el("div", { className: "card-actions" }, [
          el("a", { href: core.watchlaterPlaybackUrl(video), target: "_blank", rel: "noopener noreferrer", dataset: { openVideo: video.bvid }, textContent: "稍后合集中打开" }),
          el("button", {
            className: "danger remove-icon",
            type: "button",
            title: "移出稍后再看",
            "aria-label": "移出稍后再看",
            dataset: { action: "remove-watchlater", bvid: video.bvid }
          }, [iconNode("trash")])
        ])
      ])
    ].filter(Boolean));
  }

  function renderBatchPanel() {
    if (!batchMode) return el("div", { className: "batch-panel hidden" });
    return el("section", { className: "batch-panel" }, [
      el("div", { className: "batch-panel-summary" }, [
        el("div", {}, [
          el("h3", { textContent: "批量管理" }),
          el("div", {
            className: "batch-count",
            dataset: { role: "batch-panel-count" },
            textContent: batchPanelCountText()
          })
        ]),
        el("div", { className: "batch-actions" }, [
          el("button", { dataset: { action: "toggle-batch-categories" }, "aria-expanded": String(batchCategoriesOpen), textContent: batchCategoriesOpen ? "收起分类" : "选择分类（" + batchCategoryIds.size + "）" }),
          el("button", { dataset: { action: "batch-select-all" }, textContent: "全选当前结果" }),
          el("button", { className: "ghost", dataset: { action: "batch-clear-selection" }, textContent: "清空选择" })
        ])
      ]),
      el("div", { className: "batch-form" }, [
        el("div", { className: "batch-category-scroll", hidden: !batchCategoriesOpen }, [renderCategoryChoices(batchCategoryIds, "batch-category")]),
        el("div", { className: "batch-actions" }, [
          el("button", { className: "primary", dataset: { action: "batch-add-category" }, textContent: "添加所选分类到视频" }),
          el("button", { className: "danger", dataset: { action: "batch-clear-categories" }, textContent: "清除选中视频中所有现有分类" })
        ])
      ])
    ]);
  }

  function renderBatchSelectionBox() {
    if (!selectionBox) return el("div", { className: "selection-box hidden" });
    const left = Math.min(selectionBox.startX, selectionBox.currentX);
    const top = Math.min(selectionBox.startY, selectionBox.currentY);
    const width = Math.abs(selectionBox.currentX - selectionBox.startX);
    const height = Math.abs(selectionBox.currentY - selectionBox.startY);
    return el("div", {
      className: "selection-box",
      style: "left:" + left + "px;top:" + top + "px;width:" + width + "px;height:" + height + "px;"
    });
  }

  function captureModalDraft() {
    const dialog = document.querySelector(".management-dialog");
    if (!dialog) return;
    if (manualEditorOpen && dialog.querySelector('[data-role="manual-category"]')) {
      manualCategoryDraft = {
        bvid: selectedBvid,
        ids: Array.from(dialog.querySelectorAll('[data-role="manual-category"]:checked'), node => node.value)
      };
    }
    if (managementOpen) harvestCategoryDraft();
  }

  function settingsSectionHeader(title, description, group, current, options) {
    return el("div", { className: "settings-section-header" }, [
      el("h3", { textContent: title }),
      description ? el("p", { textContent: description }) : null,
      options ? el("nav", { className: "settings-tabs", "aria-label": title + "选项" }, options.map(([value, label]) => el("button", {
        type: "button", "aria-pressed": String(current === value),
        dataset: { action: "select-settings-tab", group, value }, textContent: label
      }))) : null
    ].filter(Boolean));
  }

  function renderSettingsWorkspace() {
    return el("div", { className: "settings-workspace" }, [
      el("nav", { className: "settings-nav", "aria-label": "设置导航" }, [
        ["classify", "AI 批量视频分类"],
        ["directory", "编辑分类目录"],
        ["preferences", "AI 服务"],
        ["general", "浏览设置"],
        ["tools", "小工具"],
        ["logs", "操作日志"]
      ].map(([page, title]) => el("button", {
        type: "button", "aria-current": settingsPage === page ? "page" : "false",
        dataset: { action: "select-settings-page", page }, textContent: title
      }))),
      el("div", { className: "settings-pages" }, [
        renderLlmAutomation(), renderCategoryAdmin(), renderApiSettings(),
        renderStandaloneSettings("general", "浏览设置", renderGeneralSettings()),
        renderStandaloneSettings("tools", "小工具", renderToolsSettings()),
        renderStandaloneSettings("logs", "操作日志", renderOperationLogSection())
      ])
    ]);
  }

  function rememberSettingsScroll() {
    document.querySelectorAll(".settings-scroll").forEach(node => {
      if (node.offsetParent) settingsScrollTops.set(node.dataset.scrollKey, node.scrollTop);
    });
  }

  function restoreSettingsScroll() {
    document.querySelectorAll(".settings-scroll").forEach(node => {
      if (node.offsetParent) node.scrollTop = settingsScrollTops.get(node.dataset.scrollKey) || 0;
    });
  }

  function updateSettingsNavigation() {
    document.querySelectorAll("[data-settings-page]").forEach(node => {
      node.hidden = node.dataset.settingsPage !== settingsPage;
    });
    document.querySelectorAll('[data-action="select-settings-page"]').forEach(node => {
      node.setAttribute("aria-current", settingsPage === node.dataset.page ? "page" : "false");
    });
    const selections = { ai: aiMethod, directory: directoryMode, api: apiPage };
    document.querySelectorAll("[data-settings-group]").forEach(node => {
      node.hidden = selections[node.dataset.settingsGroup] !== node.dataset.settingsValue;
    });
    document.querySelectorAll('[data-action="select-settings-tab"]').forEach(node => {
      node.setAttribute("aria-pressed", String(selections[node.dataset.group] === node.dataset.value));
    });
    restoreSettingsScroll();
    setupCategoryPanels();
    globalThis.BiliWLAura.refresh();
  }

  function selectSettingsPage(page, subpage) {
    rememberSettingsScroll();
    settingsPage = page;
    if (page === "classify" && subpage) aiMethod = subpage;
    if (page === "directory" && subpage) directoryMode = subpage;
    if (page === "preferences" && subpage) apiPage = subpage;
    updateSettingsNavigation();
  }

  function renderEditor() {
    const host = el("div", { className: "modal-host" });
    const video = presentVideos().find(item => item.bvid === selectedBvid);
    if (!managementOpen && !(manualEditorOpen && video)) return host;
    const manual = !managementOpen && manualEditorOpen && video;
    const classification = video ? classificationMap().get(video.bvid) : null;
    const selectedIds = new Set(manualCategoryDraft?.bvid === selectedBvid
      ? manualCategoryDraft.ids : classification?.categoryIds || []);
    host.appendChild(el("dialog", {
      className: "management-dialog editor" + (manual ? " manual-dialog" : " settings-dialog"),
      "aria-labelledby": "management-title"
    }, [
      el("div", { className: "modal-header" }, [
        el("h2", { id: "management-title", textContent: manual ? "手动调整视频分类" : "设置" }),
        el("button", { className: "modal-close", type: "button", dataset: { action: "close-modal" }, "aria-label": "关闭面板" }, [iconNode("close")])
      ]),
      el("div", { className: "editor-body" }, manual
        ? [renderManualEditor(video, selectedIds)]
        : [renderSettingsWorkspace()]),
      ...(manual ? [el("div", { className: "editor-actions" }, [
        el("button", { className: "primary", dataset: { action: "save-manual", bvid: video.bvid }, textContent: "保存为手动确认" }),
        el("button", { className: "ghost", dataset: { action: "filter-unclassified" }, textContent: "查看待精细分类" }),
        el("button", { className: "ghost", dataset: { action: "toggle-batch" }, textContent: batchMode ? "退出批量" : "批量管理" })
      ])] : [])
    ]));
    return host;
  }

  function captureModalFocus() {
    const field = document.activeElement;
    if (!field?.closest(".management-dialog") || !field.dataset.role) return null;
    return { role: field.dataset.role, categoryId: field.dataset.categoryId,
      value: field.type === "checkbox" ? field.value : null,
      start: field.selectionStart, end: field.selectionEnd };
  }

  function restoreModalFocus(focus) {
    if (!focus) return;
    const field = Array.from(document.querySelectorAll(".management-dialog [data-role]"))
      .find(node => node.dataset.role === focus.role && node.dataset.categoryId === focus.categoryId
        && (focus.value == null || node.value === focus.value));
    field?.focus({ preventScroll: true });
    if (field?.setSelectionRange && focus.start != null) field.setSelectionRange(focus.start, focus.end);
  }

  function showModal() {
    const dialog = document.querySelector(".management-dialog");
    if (dialog && !dialog.open) showModalWithNotice(dialog);
    restoreSettingsScroll();
  }

  function showModalWithNotice(dialog) {
    // Opening a dialog adds it to the top layer. Put any visible notice above it.
    const notice = document.querySelector('[data-role="status-surface"]:popover-open');
    notice?.hidePopover();
    dialog.showModal();
    notice?.showPopover();
  }

  function animateManualOpening(card) {
    const dialog = document.querySelector(".manual-dialog");
    if (!card || !dialog || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const sourceCover = card.querySelector(".cover-wrap");
    const targetCover = dialog.querySelector(".manual-preview .cover-wrap");
    if (!sourceCover || !targetCover) return;
    const sourceBounds = card.getBoundingClientRect();
    const sourceCoverBounds = sourceCover.getBoundingClientRect();
    const targetCoverBounds = targetCover.getBoundingClientRect();
    if (!sourceCoverBounds.width || !targetCoverBounds.width) return;
    // A separate top-layer surface keeps the moving content above the backdrop
    // and outside the dialog's blur and scrolling/clipping boundary.
    const layer = el("div", { className: "manual-opening-layer", popover: "manual", "aria-hidden": "true", inert: true });
    document.body.appendChild(layer);
    layer.showPopover();
    const animations = [];
    const hidden = [];
    const duration = 320;
    const expandDelay = duration / 2;
    const expandDuration = 280;
    const easing = "cubic-bezier(.4, 0, .2, 1)";
    dialog.classList.add("manual-opening");
    dialog.style.setProperty("--manual-expand-delay", expandDelay + "ms");
    dialog.style.setProperty("--manual-expand-duration", expandDuration + "ms");
    const snapshot = node => {
      const clone = node.cloneNode(true);
      const originals = [node, ...node.querySelectorAll("*")];
      [clone, ...clone.querySelectorAll("*")].forEach((copy, index) => {
        const style = getComputedStyle(originals[index]);
        for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
        copy.removeAttribute("id");
      });
      Object.assign(clone.style, { position: "absolute", margin: "0", transform: "none", transition: "none", animation: "none", transformOrigin: "top left" });
      return clone;
    };
    // Carry one intact card. Its cover's local offset anchors the entire card
    // so the scaled image lands exactly on the final cover, including mobile.
    const scale = targetCoverBounds.width / sourceCoverBounds.width;
    const arrivedLeft = targetCoverBounds.left - (sourceCoverBounds.left - sourceBounds.left) * scale;
    const arrivedTop = targetCoverBounds.top - (sourceCoverBounds.top - sourceBounds.top) * scale;
    const arrivedWidth = sourceBounds.width * scale;
    const arrivedHeight = sourceBounds.height * scale;
    const ghost = snapshot(card);
    Object.assign(ghost.style, { left: sourceBounds.left + "px", top: sourceBounds.top + "px", width: sourceBounds.width + "px", height: sourceBounds.height + "px" });
    layer.appendChild(ghost);
    animations.push(ghost.animate([
      { transform: "translate(0px, 0px) scale(1)" },
      { transform: `translate(${arrivedLeft - sourceBounds.left}px, ${arrivedTop - sourceBounds.top}px) scale(${scale})` }
    ], { duration, easing, fill: "both" }));
    const movingCover = ghost.querySelector(".cover-wrap");
    const sourceCoverStyle = getComputedStyle(sourceCover);
    const targetCoverStyle = getComputedStyle(targetCover);
    const corners = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"];
    animations.push(movingCover.animate([
      Object.fromEntries(corners.map(corner => [corner, sourceCoverStyle[corner]])),
      Object.fromEntries(corners.map(corner => [corner, parseFloat(targetCoverStyle[corner]) / scale + "px"]))
    ], { duration, easing, fill: "both" }));
    animations.push(ghost.animate([
      { borderRadius: getComputedStyle(card).borderRadius },
      { borderRadius: parseFloat(targetCoverStyle.borderTopLeftRadius) / scale + "px" }
    ], { duration, easing, fill: "both" }));
    // Blend into the expanding panel during the latter half of the movement.
    // Keep one visible cover until it lands and hands off to the final image.
    animations.push(ghost.animate([
      { backgroundColor: getComputedStyle(card).backgroundColor, backgroundImage: getComputedStyle(card).backgroundImage, boxShadow: getComputedStyle(card).boxShadow },
      { backgroundColor: "transparent", backgroundImage: "none", boxShadow: "none" }
    ], { duration: expandDuration, delay: expandDelay, easing, fill: "both" }));
    const body = ghost.querySelector(".card-body");
    if (body) animations.push(body.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: expandDelay, fill: "both" }));
    const summary = dialog.querySelector(".manual-video-summary");
    if (summary) animations.push(summary.animate([{ opacity: 0 }, { opacity: 1 }], { duration: expandDuration - 120, delay: expandDelay + 120, easing, fill: "both" }));
    const sourceVisibility = card.style.visibility;
    card.style.visibility = "hidden";
    hidden.push([targetCover, targetCover.style.visibility]);
    targetCover.style.visibility = "hidden";
    manualSourceCleanup = () => {
      card.style.visibility = sourceVisibility;
      manualSourceCleanup = null;
    };
    // The panel unfolds while the card is still travelling. Its hidden cover
    // avoids showing a second image at the destination before the card lands.
    const bounds = dialog.getBoundingClientRect();
    const top = Math.max(0, arrivedTop - bounds.top);
    const right = Math.max(0, bounds.right - arrivedLeft - arrivedWidth);
    const bottom = Math.max(0, bounds.bottom - arrivedTop - arrivedHeight);
    const left = Math.max(0, arrivedLeft - bounds.left);
    animations.push(dialog.animate([
      { opacity: 0, clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round 16px)` },
      { opacity: 1, clipPath: "inset(0px 0px 0px 0px round 24px)" }
    ], { duration: expandDuration, delay: expandDelay, easing, fill: "both" }));
    const cleanup = () => {
      animations.forEach(animation => animation.cancel());
      hidden.forEach(([node, visibility]) => { node.style.visibility = visibility; });
      dialog.classList.remove("manual-opening");
      dialog.style.removeProperty("--manual-expand-delay");
      dialog.style.removeProperty("--manual-expand-duration");
      layer.remove();
      window.removeEventListener("resize", cleanup);
      document.removeEventListener("scroll", cleanup, true);
      if (manualOpeningCleanup === cleanup) manualOpeningCleanup = null;
    };
    manualOpeningCleanup = cleanup;
    window.addEventListener("resize", cleanup, { once: true });
    document.addEventListener("scroll", cleanup, { capture: true, once: true });
    Promise.all(animations.map(animation => animation.finished)).then(cleanup, cleanup);
  }

  function closeModal() {
    manualSourceCleanup?.();
    captureModalDraft();
    const wasManagement = managementOpen;
    managementOpen = false;
    manualEditorOpen = false;
    manualCategoryDraft = null;
    document.querySelector(".management-dialog")?.close();
    renderEditorOnly();
    if (!wasManagement) updateSelectedVideoUi();
    const opener = document.querySelector('[data-action="' + managementOpener + '"]:not([hidden])');
    managementOpener = "open-management";
    const target = wasManagement ? opener || document.querySelector('[data-action="open-management"]') : videoCardByBvid(selectedBvid);
    target?.focus({ preventScroll: true });
  }

  function animateSettingsOpening(origin) {
    const dialog = document.querySelector(".settings-dialog");
    if (!dialog || !origin.width || !origin.height || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = dialog.getBoundingClientRect();
    const scaleX = origin.width / bounds.width;
    const scaleY = origin.height / bounds.height;
    const transformOrigin = dialog.style.transformOrigin;
    dialog.style.transformOrigin = "top left";
    dialog.classList.add("settings-opening");
    const easing = "cubic-bezier(.4, 0, .2, 1)";
    const animations = [dialog.animate([
      { transform: `translate(${origin.left - bounds.left}px, ${origin.top - bounds.top}px) scale(${scaleX}, ${scaleY})` },
      { transform: "translate(0px, 0px) scale(1, 1)" }
    ], { duration: 420, easing, fill: "both" }), dialog.animate([
      { borderRadius: `${12 / scaleX}px / ${12 / scaleY}px` },
      { borderRadius: "24px" }
    ], { duration: 120, easing, fill: "both" })];
    dialog.querySelectorAll(":scope > .modal-header, :scope > .editor-body").forEach(node => {
      animations.push(node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120, easing, fill: "both" }));
    });
    const cleanup = () => {
      animations.forEach(animation => animation.cancel());
      dialog.style.transformOrigin = transformOrigin;
      dialog.classList.remove("settings-opening");
      window.removeEventListener("resize", cleanup);
      if (settingsOpeningCleanup === cleanup) settingsOpeningCleanup = null;
    };
    settingsOpeningCleanup = cleanup;
    window.addEventListener("resize", cleanup, { once: true });
    Promise.all(animations.map(animation => animation.finished)).then(cleanup, cleanup);
  }

  function onModalKeyDown(event) {
    if (event.isComposing || event.target.closest(".management-dialog")) return;
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".video-card")) {
      event.preventDefault();
      event.target.click();
    }
  }

  function renderCategoryChoices(selectedIds, role) {
    const categoriesById = core.categoryById(state.categories);
    const renderRow = ({ category, level }) => el("label", {
        className: "manual-cat-row" + (level === 0 ? " manual-cat-root" : ""),
        style: "--category-level:" + Math.min(level, 4) + ";",
        dataset: { level: String(level) },
        title: core.categoryPath(category, categoriesById) || category.name
      }, [
        el("input", { type: "checkbox", value: category.id, checked: selectedIds.has(category.id), dataset: { role } }),
        el("span", { className: "manual-cat-copy" }, [
          el("span", { className: "manual-cat-heading" }, [
            el("span", { className: "manual-cat-name", textContent: category.name })
          ])
        ])
      ]);
    return el("div", { className: "check-list manual-category-list category-panel-grid", "aria-label": "选择视频分类（可多选）" }, categoryPanelGroups(state.categories).map(rows => {
      const wide = role === "batch-category" && rows.length >= 9;
      return el("section", { className: "category-panel" + (wide ? " category-panel-wide" : ""), "aria-label": rows[0].category.name }, wide ? [
        renderRow(rows[0]),
        el("div", { className: "category-panel-branches" }, categoryBranchColumns(rows).map(branches => el("div", { className: "category-panel-column" }, branches.map(branch => el("div", { className: "category-branch", dataset: { branchId: branch[0].category.id } }, branch.map(renderRow))))))
      ] : rows.map(renderRow));
    }));
  }

  function categoryBranchColumns(rows) {
    const branches = [];
    rows.slice(1).forEach(row => {
      if (row.level === 1) branches.push([]);
      branches[branches.length - 1].push(row);
    });
    const columns = [[], []];
    const heights = [0, 0];
    branches.forEach(branch => {
      const column = heights[0] <= heights[1] ? 0 : 1;
      columns[column].push(branch);
      heights[column] += branch.length;
    });
    return columns;
  }

  function renderManualEditor(video, selectedIds) {
    return el("section", { className: "fold", dataset: { fold: "manual-editor" } }, [
      el("div", { className: "fold-body manual-editor-layout" }, video ? [
        el("div", { className: "sub section-note", textContent: "手动确认具有最高优先级，不会被初步分类或 AI 分类覆盖" }),
        renderManualVideoInfo(video),
        renderCategoryChoices(selectedIds, "manual-category")
      ] : presentVideos().length ? [
        el("div", { className: "manual-editor-default" }, [
          el("div", { className: "manual-editor-default-icon" }, [iconNode("check")]),
          el("h3", { textContent: "选择一种调整方式" }),
          el("p", { textContent: "点击中间的视频卡片可单独调整分类，或进入批量管理一次处理多个视频。" }),
          el("button", { className: "primary", dataset: { action: "toggle-batch" }, textContent: "批量管理" })
        ])
      ] : [
        el("div", { className: "empty", textContent: "还没有已同步视频。请先点击“同步并更新”。" })
      ])
    ]);
  }

  function renderManualVideoInfo(video) {
    const classification = state.classifications.find(item => item.bvid === video.bvid);
    const badges = categoryBadgeNodes(classification);
    const source = core.classificationSourceType(classification);
    const status = core.classifyStatus(video, classification);
    const facts = [
      ["UP 主", video.upName || "暂无信息"], ["B站分区", video.tname || "暂无信息"],
      ["时长", video.duration > 0 ? formatDuration(video.duration) : "暂无信息"],
      ["播放量", video.viewCount != null ? formatViewCount(video.viewCount) : "暂无信息"],
      ["观看进度", video.isWatched ? "已看完" : video.watchProgress > 0 ? formatDuration(video.watchProgress) + (video.duration > 0 ? " / " + formatDuration(video.duration) : "") : video.watchProgress != null ? "尚未观看" : "暂无信息"],
      ["发布时间", video.pubdate ? formatSettingsTime(video.pubdate < 1e12 ? video.pubdate * 1000 : video.pubdate) : "暂无信息"],
      ...(video.watchlaterAddedAt ? [["加入稍后再看", formatSettingsTime(video.watchlaterAddedAt < 1e12 ? video.watchlaterAddedAt * 1000 : video.watchlaterAddedAt)]] : []),
      ["视频编号", video.bvid],
      ...(video.upMid ? [["UP 主 UID", String(video.upMid)]] : []),
      ...(video.aid ? [["AV 号", "av" + video.aid]] : [])
    ];
    return el("section", { className: "manual-video-info", "aria-label": "视频信息" }, [
      el("div", { className: "preview manual-preview" }, [
        renderCover(video),
        el("div", { className: "manual-video-summary" }, [
          el("h3", { className: "preview-title", textContent: video.title || video.bvid }),
          el("div", { className: "badges manual-current-badges", "aria-label": "当前分类" }, [
            ...(source && badges.length ? [el("span", { className: "badge source source-" + source, textContent: sourceLabel(source) })] : []),
            ...(["unclassified", "stale", "low_confidence"].includes(status) ? [el("span", { className: "badge warn status-" + status, textContent: statusLabel(status) })] : []),
            ...(badges.length ? badges : [el("span", { className: "badge warn status-unclassified", textContent: "分类异常" })])
          ]),
          el("dl", { className: "manual-video-facts" }, facts.flatMap(([label, value]) => [el("dt", { textContent: label }), el("dd", { textContent: value })]))
        ])
      ]),
      el("div", { className: "manual-video-tags" }, [
        el("strong", { textContent: "B站标签" }),
        ...(video.tags?.length ? video.tags.map(tag => el("span", { className: "manual-info-tag", textContent: tag })) : [el("span", { className: "sub", textContent: "暂无标签信息" })])
      ]),
      el("div", { className: "manual-video-description" }, [el("strong", { textContent: "视频简介" }), el("p", { textContent: video.desc || "暂无简介信息" })]),
      video.pageParts?.length ? el("div", { className: "manual-video-parts" }, [el("strong", { textContent: "分 P 标题（" + video.pageParts.length + "）" }), el("ol", {}, video.pageParts.map(part => el("li", { textContent: part })))]) : null,
      classification?.reason ? el("div", { className: "manual-video-classification manual-classification-reason" }, [
        el("p", { textContent: "分类依据：" + classification.reason })
      ]) : null
    ]);
  }

  function renderLlmAutomation() {
    const settings = Object.assign({}, state.settings || {}, llmFormDraft);
    const runningQuick = llmRun.running && llmRun.quick;
    return el("section", { className: "settings-page", hidden: settingsPage !== "classify", dataset: { settingsPage: "classify", fold: "llm-panel" } }, [
      settingsSectionHeader("AI 批量视频分类", "按现有目录分类视频，保留手动确认的结果。", "ai", aiMethod,
        [["api", "使用 API 自动分类"], ["manual", "手动复制 Prompt"], ["auto", "自动触发"]]),
      el("div", { className: "settings-page-body" }, [
        el("section", { className: "ai-method settings-scroll", hidden: aiMethod !== "api", dataset: { settingsGroup: "ai", settingsValue: "api", scrollKey: "classify-api" } }, [
          el("div", { className: "ai-method-heading" }, [
            el("p", { textContent: apiSettingsReady(settings)
              ? "当前使用 " + apiConnections[settings.classificationProvider || "openai"] + "。"
              : "请先在「AI 服务」中配置视频分类使用的 API。" })
          ]),
        el("div", { className: "llm-grid" }, [
          labeledInput("每批处理视频数", "llm-batch-size", runningQuick ? llmRun.batchSize : llmBatchSize(settings), "50", "number", {
            min: 1, max: settings.classificationProvider === "jev" ? 5 : 100, disabled: llmRun.running
          }),
          labeledInput("本次数量（0 表示全部）", "llm-limit", runningQuick ? llmRun.total : llmRunLimit(settings), "0 表示全部", "number", {
            min: 0, max: 10000, disabled: llmRun.running
          })
        ]),
        el("label", { className: "inline-check" }, [
          el("input", { type: "checkbox", checked: !runningQuick && settings.llmIncludeAll === true, disabled: llmRun.running, dataset: { role: "llm-include-all" } }),
          text("重新处理已有 AI 分类")
        ]),
        el("div", { className: "llm-actions" }, [
          el("button", { dataset: { action: "open-api-settings" }, textContent: "配置视频分类 API" }),
          llmRun.running
            ? el("button", { className: "danger", dataset: { action: "stop-llm-run" }, textContent: "停止" })
            : el("button", { className: "primary", dataset: { action: "start-llm-run" }, textContent: "使用 API 开始分类" })
        ]),
        llmRun.running || llmRun.done || llmRun.message ? el("div", { className: "llm-progress" }, [
          el("div", { textContent: llmRun.message || "未运行" }),
          el("div", { textContent: "处理 " + (llmRun.processed || 0) + " / " + (llmRun.total || 0) + "，导入 " + (llmRun.imported || 0) + "，跳过 " + (llmRun.skipped || 0) + "，失败批次 " + failedBatchCount() }),
          llmRun.warnings && llmRun.warnings.length ? el("div", { textContent: "最近：" + llmRun.warnings[llmRun.warnings.length - 1] }) : null
        ].filter(Boolean)) : null
        ].filter(Boolean)),
        el("section", { className: "ai-method manual-ai-method settings-scroll", hidden: aiMethod !== "manual", dataset: { settingsGroup: "ai", settingsValue: "manual", scrollKey: "classify-manual" } }, [
          el("div", { className: "ai-method-heading" }, [
            el("p", { textContent: "复制 Prompt 给 ChatGPT、Gemini 或 DeepSeek，再把返回的 JSON 导入。" })
          ]),
          renderExchange()
        ]),
        el("div", { className: "settings-scroll", hidden: aiMethod !== "auto", dataset: { settingsGroup: "ai", settingsValue: "auto", scrollKey: "classify-auto" } }, [
          renderAutoLlmSettingsSection()
        ])
      ])
    ]);
  }

  function failedBatchCount() {
    return (llmRun.batches || []).filter((batch) => batch.status === "failed").length;
  }

  function labeledInput(label, role, value, placeholder, type, attributes) {
    return el("label", { className: "field" }, [
      el("span", { textContent: label }),
      el("input", {
        type: type || "text",
        value,
        placeholder,
        dataset: { role },
        ...attributes
      })
    ]);
  }

  function renderExchange() {
    const settings = state.settings || {};
    const exportLimit = settings.manualExportLimit == null ? settings.batchSize || 80 : settings.manualExportLimit;
    return el("div", { className: "exchange-panel" }, [
        el("div", { className: "exchange-help" }, [
          el("div", { textContent: "导出只选择待精细分类的视频；手动确认结果始终跳过。" }),
          el("div", { textContent: "把 Prompt 复制给 ChatGPT/Gemini/Deepseek，再把返回的严格 JSON 粘贴回来导入。" }),
          el("div", { textContent: "默认导入会替换非手动确认结果；勾选追加时只追加命中的分类。" })
        ]),
        el("label", { className: "field" }, [
          el("span", { textContent: "1. 选择视频数量并生成 Prompt" }),
          el("input", {
            type: "number",
            min: "0",
            max: "500",
            step: "1",
            value: exportLimit,
            placeholder: "80，0 表示全部",
            dataset: { role: "manual-export-limit" }
          })
        ]),
        el("div", { className: "exchange-actions" }, [
          el("button", { dataset: { action: "export" }, textContent: "生成 Prompt" }),
          el("button", { dataset: { action: "copy-exchange" }, textContent: "复制 Prompt" })
        ]),
        el("h3", { className: "exchange-step", textContent: "2. 将 Prompt 交给 AI，再粘贴返回的 JSON" }),
        exchange.title ? el("div", { className: "exchange-title", textContent: exchange.title }) : null,
        el("textarea", { dataset: { role: "exchange-text" }, value: exchange.text, placeholder: "这里会显示导出的 Prompt；也可以粘贴 AI 返回的 JSON。" }),
        el("label", { className: "inline-check" }, [
          el("input", { type: "checkbox", checked: exchange.append, dataset: { role: "import-append" } }),
          text("导入时追加分类；结果记为 AI 分类")
        ]),
        el("div", { className: "exchange-actions" }, [
          el("button", { className: "ghost", dataset: { action: "prepare-import" }, textContent: "粘贴 JSON" }),
          el("button", { className: "primary", dataset: { action: "import-json" }, textContent: "3. 导入视频分类结果" }),
          el("button", { className: "ghost", dataset: { action: "hide-exchange" }, textContent: "清空" })
        ])
      ].filter(Boolean));
  }

  function renderApiSettings() {
    const settings = Object.assign({}, state.settings, apiSettingsDraft);
    const tabs = [["video", "视频分类 API"], ...Object.entries(apiConnections)];
    return el("section", { className: "settings-page", hidden: settingsPage !== "preferences", dataset: { settingsPage: "preferences" } }, [
      settingsSectionHeader("AI 服务", "分类目录使用 OpenAI-compatible。视频分类可使用 OpenAI-compatible 或 Jev。", "api", apiPage, tabs),
      el("div", { className: "settings-page-body" }, tabs.map(([value]) => el("div", {
        className: "settings-scroll", hidden: apiPage !== value,
        dataset: { settingsGroup: "api", settingsValue: value, scrollKey: "api-" + value }
      }, [value === "video" ? renderVideoApiSettings(settings) : renderApiConnection(settings, value)])))
    ]);
  }

  function renderStandaloneSettings(page, title, body) {
    return el("section", { className: "settings-page", hidden: settingsPage !== page, dataset: { settingsPage: page } }, [
      settingsSectionHeader(title),
      el("div", { className: "settings-scroll", dataset: { scrollKey: page } }, [body])
    ]);
  }

  function renderGeneralSettings() {
    const settings = Object.assign({}, state.settings, ...browsingSettingsDraft.values());
    return el("section", { className: "settings-form browsing-settings" }, [
      el("p", { className: "settings-help", textContent: "修改后自动保存。默认分类、筛选和乱序在下次打开页面时生效。" }),
      el("div", { className: "llm-grid" }, [
        el("label", { className: "field opening-category-field" }, [
          el("span", { textContent: "默认打开的分类" }),
          el("select", { dataset: { role: "default-opening-category" }, disabled: browsingSettingsDraft.has("default-opening-category") },
            openingCategoryOptions(defaultOpeningCategory(settings)))
        ]),
        el("label", { className: "field" }, [
          el("span", { textContent: "默认视频筛选" }),
          el("select", { dataset: { role: "default-video-filter" }, disabled: browsingSettingsDraft.has("default-video-filter") }, videoFilterOptions(defaultVideoFilter(settings)))
        ]),
        el("label", { className: "field" }, [
          el("span", { textContent: "默认排序方法" }),
          el("select", { dataset: { role: "default-sort" }, disabled: browsingSettingsDraft.has("default-sort") }, sortOptions(defaultSortValue(settings), false))
        ])
      ]),
      el("label", { className: "inline-check" }, [
        el("input", { type: "checkbox", checked: settings.shuffleOnOpen === true, disabled: browsingSettingsDraft.has("shuffle-on-open"), dataset: { role: "shuffle-on-open" } }),
        text("打开时随机排序")
      ]),
      labeledInput("每批加载视频数", "result-batch-size", resultBatchSize(settings), "200", "number", {
        ...core.RESULT_BATCH_SIZE_RANGE, disabled: browsingSettingsDraft.has("result-batch-size"),
        "aria-describedby": "result-batch-size-help"
      }),
      el("p", { className: "settings-help", id: "result-batch-size-help", textContent: "控制首次显示和加载更多时的数量。默认 200，可填写 1–1000。" })
    ]);
  }

  function renderToolsSettings() {
    return el("section", { className: "settings-subfold" }, [
      el("label", { className: "inline-check" }, [
        el("input", { type: "checkbox", checked: state.settings.showCommentLocation === true, dataset: { role: "show-comment-location" }, "aria-describedby": "comment-location-help" }),
        text("显示评论 IP 属地")
      ]),
      el("p", { id: "comment-location-help", className: "sub", textContent: "在 B 站视频页的评论时间旁显示 B 站提供的 IP 属地。选择后自动保存。" })
    ]);
  }

  function renderVideoApiSettings(settings) {
    return el("section", { className: "settings-form" }, [
      el("label", { className: "field" }, [
        el("span", { textContent: "视频分类使用的 API" }),
        el("select", { dataset: { role: "classification-provider" } }, [
          option("openai", "OpenAI-compatible", settings.classificationProvider || "openai"),
          option("jev", "Jev（TypeSafe）", settings.classificationProvider || "openai")
        ])
      ]),
      el("p", { className: "settings-help", textContent: "此选择用于手动启动和自动触发的视频分类。先在对应服务页保存连接，再保存这里的选择。" }),
      el("div", { className: "llm-actions" }, [
        el("button", { className: "primary", disabled: apiSaving, dataset: { action: "save-llm-settings", provider: "video" }, textContent: "保存视频分类设置" })
      ])
    ]);
  }

  function renderApiConnection(settings, provider) {
    const useJev = provider === "jev";
    const test = apiTestStates[provider] || {};
    const fields = useJev ? [
      labeledInput("TypeSafe API Key", "jev-api-key", settings.jevApiKey || "", "填写 TypeSafe 密钥", "password"),
      labeledInput("模型", "jev-model", settings.jevModel || "jev-latest", "jev-latest")
    ] : [
      labeledInput("API 地址", "llm-base-url", settings.llmBaseUrl || "", "https://openrouter.ai/api/v1", "url"),
      labeledInput("模型", "llm-model", settings.llmModel || "", "服务商提供的模型名称"),
      labeledInput("API Key", "llm-api-key", settings.llmApiKey || "", "填写服务商密钥", "password")
    ];
    return el("section", { className: "settings-form", dataset: { apiProvider: provider } }, [
      el("p", { className: "settings-help", textContent: useJev
        ? "从现有目录中为每个视频选一个类别，每批最多 5 个。"
        : "支持生成分类目录，以及给视频分配一个或多个类别。" }),
      el("div", { className: "llm-grid" }, fields),
      useJev ? null : el("details", { className: "api-advanced" }, [
        el("summary", { textContent: "高级选项（通常无需修改）" }),
        labeledInput("温度", "llm-temperature", settings.llmTemperature ?? 0.1, "0.1", "number"),
        el("label", { className: "inline-check" }, [
          el("input", { type: "checkbox", checked: settings.llmUseResponseFormat === true, dataset: { role: "llm-use-response-format" } }),
          text("要求模型返回 JSON")
        ]),
      ]),
      el("div", { className: "llm-actions" }, [
        el("button", { className: "primary", disabled: apiSaving || test.running, dataset: { action: "save-llm-settings", provider }, textContent: "保存连接" }),
        el("button", { disabled: apiSaving || test.running, dataset: { action: "test-llm-api", provider }, textContent: test.running ? "正在测试…" : "测试连接" })
      ]),
      test.message ? renderFeedbackNotice("api-test-status", test.message) : null
    ].filter(Boolean));
  }

  function renderAutoLlmSettingsSection() {
    const settings = Object.assign({}, state.settings || {}, autoApiSettingsDraft || {});
    const mode = settings.llmAutoClassifyMode || "off";
    return el("section", { className: "settings-subfold", dataset: { fold: "auto-api-settings" } }, [
      el("div", { className: "settings-subbody" }, [
        el("p", { className: "settings-help", textContent: "自动处理待精细分类的视频，手动确认始终跳过。浏览器需保持运行，实际触发时间可能稍有延迟。" }),
        el("label", { className: "field" }, [
          el("span", { textContent: "自动分类条件" }),
          el("select", { dataset: { role: "llm-auto-classify-mode" } }, [
            option("off", "关闭", mode),
            option("daily", "每天", mode),
            option("weekly", "每周", mode),
            option("threshold", "待精细分类达到指定数量", mode)
          ])
        ]),
        el("div", { hidden: mode !== "threshold", dataset: { role: "auto-threshold-field" } }, [
          labeledInput("待精细分类达到多少个时运行", "llm-auto-classify-threshold", settings.llmAutoClassifyThreshold || 50, "50", "number")
        ]),
        el("div", { className: "auto-api-status" }, [
          el("div", { textContent: "上次运行：" + formatSettingsTime(settings.llmAutoClassifyLastRunAt) }),
          el("div", { textContent: settings.llmAutoClassifyLastStatus || "尚未自动运行" })
        ]),
        el("div", { className: "llm-actions" }, [
          el("button", { className: "primary", dataset: { action: "save-auto-llm-settings" }, textContent: "保存自动分类设置" })
        ])
      ])
    ]);
  }

  function onClick(event) {
    const categoryRow = event.target.closest(".cat-row");
    if (categoryRow && event.detail > 0 && !categoryRow.contains(document.elementFromPoint(event.clientX, event.clientY))) {
      // Pointer capture can emit a click on the pressed row even after release elsewhere.
      event.preventDefault();
      return;
    }
    const dialog = event.target.closest(".management-dialog");
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        closeModal();
        return;
      }
    }
    const link = event.target.closest("a");
    if (link) {
      if (batchMode && link.classList.contains("cover-link")) event.preventDefault();
      else {
        if (link.dataset.openVideo && !event.defaultPrevented) rememberOpenedVideo(link);
        return;
      }
    }
    const target = event.target.closest("[data-action]");
    if (!target) {
      const grid = event.target.closest(".grid");
      if (!batchMode && grid && event.target === grid && selectedBvid) {
        selectedBvid = "";
        updateSelectedVideoUi();
        renderEditorOnly();
      }
      return;
    }
    const action = target.dataset.action;
    if (action === "toggle-batch-categories") {
      batchCategoriesOpen = !batchCategoriesOpen;
      const picker = document.querySelector(".batch-category-scroll");
      if (picker) picker.hidden = !batchCategoriesOpen;
      target.setAttribute("aria-expanded", String(batchCategoriesOpen));
      target.textContent = batchCategoriesOpen ? "收起分类" : "选择分类（" + batchCategoryIds.size + "）";
      setupCategoryPanels();
    } else if (action === "open-management") {
      const origin = target.getBoundingClientRect();
      manualEditorOpen = false;
      managementOpener = "open-management";
      managementOpen = true;
      renderEditorOnly();
      animateSettingsOpening(origin);
    } else if (action === "select-settings-page") {
      selectSettingsPage(target.dataset.page);
    } else if (action === "select-settings-tab") {
      rememberSettingsScroll();
      if (target.dataset.group === "ai") aiMethod = target.dataset.value;
      if (target.dataset.group === "directory") directoryMode = target.dataset.value;
      if (target.dataset.group === "api") apiPage = target.dataset.value;
      updateSettingsNavigation();
    } else if (action === "close-modal") {
      closeModal();
    } else if (action === "retry-onboarding-login") {
      checkOnboardingLoginAndSync();
    } else if (action === "choose-onboarding-method") {
      chooseOnboardingMethod(target.dataset.method);
    } else if (action === "back-onboarding-setup") {
      backToOnboardingSetup();
    } else if (action === "back-onboarding-guide") {
      backToOnboardingGuide();
    } else if (action === "back-onboarding-method") {
      backToOnboardingMethod();
    } else if (action === "save-onboarding-api") {
      saveOnboardingApi();
    } else if (action === "open-onboarding-api-settings") {
      openOnboardingApiSettings();
    } else if (action === "resume-onboarding-api") {
      onboardingPanelDismissed = false;
      renderShell();
    } else if (action === "copy-onboarding-prompt") {
      copyOnboardingPrompt();
    } else if (action === "regenerate-onboarding-prompt") {
      loadOnboardingPrompt();
    } else if (action === "import-onboarding-json") {
      importOnboardingJson();
    } else if (action === "reopen-onboarding-categories") {
      reopenOnboardingCategories();
    } else if (action === "adjust-onboarding-result") {
      adjustOnboardingCategoryResult();
    } else if (action === "show-onboarding-guide") {
      showOnboardingGuide();
    } else if (action === "start-onboarding-classify") {
      startOnboardingClassification(target.dataset.mode);
    } else if (action === "complete-onboarding") {
      completeOnboarding("首次引导已完成，所有分类方式仍可随时使用");
    } else if (["filter-all", "filter-unclassified", "filter-category"].includes(action)) {
      const pending = action === "filter-unclassified";
      if (pending && manualEditorOpen) closeModal();
      const categoryId = action === "filter-category" && target.dataset.categoryId !== activeFilter.sourceCategoryId
        ? target.dataset.categoryId : "";
      activeFilter = categoryFilter(categoryId, pending);
      categoryChosen = true;
      updateCategorySelection(target);
      renderVideoResults("category");
    } else if (action === "select-video") {
      if (suppressNextCardClick) {
        suppressNextCardClick = false;
        return;
      }
      if (hasActiveTextSelection(target)) return;
      if (batchMode) {
        toggleSelectedBvid(target.dataset.bvid);
        updateSelectionUi();
        renderEditorOnly();
      } else {
        selectedBvid = target.dataset.bvid;
        manualCategoryDraft = null;
        managementOpen = false;
        manualEditorOpen = true;
        renderEditorOnly();
        animateManualOpening(target.closest(".video-card"));
      }
    } else if (action === "toggle-batch") {
      managementOpen = false;
      manualEditorOpen = false;
      manualCategoryDraft = null;
      batchMode = !batchMode;
      suppressNextCardClick = false;
      if (batchMode) batchCategoriesOpen = true;
      if (!batchMode) selectedBvids = new Set();
      updateBatchModeSurface();
    } else if (action === "batch-select-all") {
      selectedBvids = new Set(visibleVideos().map((video) => video.bvid));
      updateSelectionUi();
    } else if (action === "batch-clear-selection") {
      selectedBvids = new Set();
      updateSelectionUi();
    } else if (action === "batch-add-category") {
      bulkAddCategory();
    } else if (action === "batch-clear-categories") {
      bulkClearCategories();
    } else if (action === "save-llm-settings") {
      saveLlmSettings(target.dataset.provider);
    } else if (action === "save-auto-llm-settings") {
      saveAutoLlmSettings();
    } else if (action === "test-llm-api") {
      testLlmApi(target.dataset.provider);
    } else if (action === "open-api-settings") {
      openApiSettings(target.dataset.provider);
    } else if (action === "start-llm-run") {
      startLlmRun();
    } else if (action === "quick-llm-run") {
      startLlmRun({ quick: true, origin: target.getBoundingClientRect() });
    } else if (action === "load-more-results") {
      const first = appendResultVideos(resultLimit + resultBatchSize());
      if (event.detail === 0) first?.focus();
    } else if (action === "stop-llm-run") {
      stopLlmRun();
    } else if (action === "shuffle-videos") {
      shuffleVideos();
    } else if (action === "exit-shuffle") {
      sortRequest++;
      randomOrder = null;
      currentSort = null;
      renderVideoResults("sort");
      setStatus("已退出乱序，恢复默认排序");
    } else if (action === "scroll-top") {
      target.closest(".main").scrollTo({ top: 0, behavior: navigationScrollBehavior() });
    } else if (action === "scroll-last-video") {
      returnToOpenedVideo();
    } else if (action === "sync-refresh") {
      syncAndRefresh();
    } else if (action === "scan") {
      scan();
    } else if (action === "details") {
      runDetails();
    } else if (action === "auto-classify") {
      autoClassify();
    } else if (action === "export") {
      exportBatch();
    } else if (action === "show-import") {
      showImportBox();
    } else if (action === "prepare-import") {
      showImportBox();
    } else if (action === "copy-exchange") {
      copyExchangeText();
    } else if (action === "import-json") {
      importJson();
    } else if (action === "hide-exchange") {
      exchange = { visible: false, title: "", text: "", append: exchange.append, mode: "import" };
      renderEditorOnly();
    } else if (action === "toggle-category-add") {
      categoryAddOpen = !categoryAddOpen;
      const form = document.querySelector('[data-role="category-add-form"]');
      if (form) form.hidden = !categoryAddOpen;
      target.setAttribute("aria-expanded", String(categoryAddOpen));
      target.textContent = categoryAddOpen ? "收起添加" : "添加类别";
    } else if (action === "add-category") {
      addCategory();
    } else if (action === "delete-category") {
      deleteCategory(target.dataset.categoryId);
    } else if (action === "save-category-draft") {
      saveCategoryDraft();
    } else if (action === "discard-category-draft") {
      discardCategoryDraft();
    } else if (action === "generate-categories-api") {
      generateCategoriesWithApi();
    } else if (action === "toggle-category-prompt") {
      toggleCategoryPrompt();
    } else if (action === "load-category-prompt") {
      loadCategoryPrompt();
    } else if (action === "copy-category-prompt") {
      copyCategoryPrompt();
    } else if (action === "import-category-prompt") {
      importCategoryPrompt();
    } else if (action === "save-manual") {
      saveManualClassification(target.dataset.bvid);
    } else if (action === "remove-watchlater") {
      removeFromWatchlater(target.dataset.bvid);
    } else if (action === "open-watchlater") {
      window.open("https://www.bilibili.com/watchlater/list#/list", "_blank", "noopener");
    } else if (action === "open-bili-home") {
      window.open("https://www.bilibili.com/", "_blank", "noopener");
    } else if (action === "open-bili-dynamic") {
      window.open("https://t.bilibili.com/", "_blank", "noopener");
    }
  }

  function rememberOpenedVideo(link) {
    lastOpenedBvid = link.dataset.openVideo;
    try { localStorage.setItem(LAST_OPENED_VIDEO_KEY, lastOpenedBvid); } catch {}
  }

  function navigationScrollBehavior() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  }

  function returnToOpenedVideo() {
    if (!lastOpenedBvid) {
      setStatus("还没有打开视频的记录。打开一个视频后，就可以从这里返回。");
      return;
    }
    if (pendingRemovalBvids.has(lastOpenedBvid)) {
      setStatus("正在确认是否已移出上一次打开的视频");
      return;
    }
    if (!presentVideos().some(video => video.bvid === lastOpenedBvid)) {
      setStatus(videoListLoaded ? "上一次打开的视频已从稍后再看删除" : "视频列表尚未加载，请稍后再试");
      return;
    }
    // Apply any search that is still waiting for its input debounce.
    if (searchTimer) renderVideoResults("navigation", lastOpenedBvid);
    let card = videoCardByBvid(lastOpenedBvid);
    const index = resultVideos.findIndex(video => video.bvid === lastOpenedBvid);
    if (!card?.isConnected && index >= 0) {
      appendResultVideos(resultLimitForIndex(index));
      card = videoCardByBvid(lastOpenedBvid);
    }
    const filtersCleared = !card?.isConnected;
    if (filtersCleared) {
      searchText = "";
      videoFilter = "";
      app.querySelector('[data-role="search"]').value = "";
      app.querySelector('[data-role="video-filter"]').value = "";
      activeFilter = { categoryIds: [], includeUnclassified: false, includeRemoved: false, sourceCategoryId: "" };
      updateCategorySelection(app.querySelector('[data-action="filter-all"]'));
      renderVideoResults("navigation", lastOpenedBvid);
      card = videoCardByBvid(lastOpenedBvid);
    }
    const main = card?.closest(".main");
    if (!card?.isConnected || !main) {
      setStatus("无法定位上一次打开的视频，请重新同步列表后再试。");
      return;
    }
    cancelCardPositionAnimations();
    resultTransition = null;
    const top = main.scrollTop + card.getBoundingClientRect().top - resultViewport(main).top - 10;
    const targetTop = Math.max(0, Math.min(top, main.scrollHeight - main.clientHeight));
    const alreadyThere = Math.abs(main.scrollTop - targetTop) < 2;
    main.scrollTo({ top: targetTop, behavior: navigationScrollBehavior() });
    if (navigationScrollBehavior() === "smooth") {
      card.animate([{ boxShadow: "inset 0 0 0 3px #7596ac" }, { boxShadow: "inset 0 0 0 3px transparent" }],
        { duration: 750, delay: alreadyThere ? 0 : 280 });
    }
    setStatus(filtersCleared ? "已清除筛选并定位到上一次打开的视频" :
      alreadyThere ? "上一次打开的视频已在当前位置" : "已定位到上一次打开的视频");
  }

  async function chooseOnboardingMethod(methodValue) {
    const methodName = ["categories", "api", "prompt"].includes(methodValue) ? methodValue : "categories";
    onboardingPanelDismissed = methodName === "categories";
    if (methodName === "categories") { settingsPage = "directory";
    directoryMode = "edit"; managementOpen = true; }
    try {
      await updateOnboardingSettings({ onboardingStage: "setup-" + methodName, onboardingMethod: methodName });
      if (methodName === "categories") revealOnboardingPanel(methodName);
      if (methodName === "prompt") await loadOnboardingPrompt();
    } catch (error) {
      onboardingPanelDismissed = false;
      setStatus("保存首次设置失败：" + error.message);
      renderShell();
    }
  }

  async function backToOnboardingSetup() {
    if (onboardingCategoryRunning) {
      setStatus("分类目录正在生成，请等待当前请求完成");
      return;
    }
    onboardingPanelDismissed = false;
    onboardingCategoryMessage = "";
    try {
      await updateOnboardingSettings({ onboardingStage: "setup", onboardingMethod: "" });
    } catch (error) {
      setStatus("返回首次设置失败：" + error.message);
    }
  }

  async function backToOnboardingGuide() {
    managementOpen = false;
    manualEditorOpen = false;
    onboardingPanelDismissed = false;
    try {
      await updateOnboardingSettings({ onboardingStage: "guide" });
    } catch (error) {
      setStatus("返回分类说明失败：" + error.message);
    }
  }

  async function backToOnboardingMethod() {
    if (onboardingCategoryRunning) {
      setStatus("分类目录正在生成，请等待当前请求完成");
      return;
    }
    const methodName = core.normalizeText(state.settings && state.settings.onboardingMethod);
    const stage = methodName === "api" ? "setup-api" : methodName === "prompt" ? "setup-prompt" : "setup";
    onboardingPanelDismissed = false;
    try {
      await updateOnboardingSettings({ onboardingStage: stage });
      if (stage === "setup-prompt" && !onboardingPromptText) await loadOnboardingPrompt();
    } catch (error) {
      setStatus("返回分类目录设置步骤失败：" + error.message);
    }
  }

  async function saveOnboardingApi() {
    if (onboardingCategoryRunning) return;
    const config = Object.assign({}, state.settings || {});
    if (!categoryApiSettingsReady(config)) {
      openOnboardingApiSettings();
      setStatus("生成分类目录需要 OpenAI-compatible API，请先填写并保存地址、模型和密钥");
      return;
    }
    setStatus("正在让 AI 生成新的分类目录…");
    try {
      onboardingCategoryRunning = true;
      onboardingCategoryMessage = "正在读取现有视频标题并请求 AI…";
      renderShell();
      const exported = await send({ type: message.EXPORT_CATEGORY_PROPOSAL, limit: 60 });
      onboardingCategoryMessage = "已抽取 " + (exported.sampleCount || 0) + " 个标题，正在生成分类目录...";
      renderShell();
      const payload = await callCategoryLlm(config, exported.prompt || "");
      onboardingCategoryRunning = false;
      onboardingCategoryMessage = "";
      await confirmAndImportCategories(payload, "api", "API");
    } catch (error) {
      onboardingCategoryRunning = false;
      onboardingCategoryMessage = "更新失败：" + error.message;
      openOnboardingApiSettings();
      setStatus("AI 生成分类目录失败：" + error.message + "；请先在“设置”中检查并测试 API");
    }
  }

  function openOnboardingApiSettings() {
    managementOpen = true;
    manualEditorOpen = false;
    onboardingPanelDismissed = true;
    settingsPage = "preferences";
    apiPage = "openai";
    renderShell();
  }

  async function loadOnboardingPrompt() {
    if (onboardingPromptLoading) return;
    onboardingPromptLoading = true;
    renderShell();
    try {
      const result = await send({
        type: message.EXPORT_CATEGORY_PROPOSAL,
        limit: 60
      });
      onboardingPromptText = result.prompt || "";
      setStatus("已根据 " + (result.sampleCount || 0) + " 个视频标题生成分类目录 Prompt");
    } catch (error) {
      onboardingPromptText = "";
      setStatus("生成首次 Prompt 失败：" + error.message);
    } finally {
      onboardingPromptLoading = false;
      renderShell();
    }
  }

  async function copyOnboardingPrompt() {
    if (!onboardingPromptText) {
      setStatus("Prompt 还没有生成完成");
      return;
    }
    try {
      await navigator.clipboard.writeText(onboardingPromptText);
      setStatus("首次 Prompt 已复制到剪贴板");
    } catch (error) {
      setStatus("复制 Prompt 失败：" + error.message);
    }
  }

  async function importOnboardingJson() {
    const textarea = document.querySelector('[data-role="onboarding-prompt-import"]');
    const payload = textarea ? textarea.value : "";
    if (!core.normalizeText(payload)) {
      setStatus("请先粘贴 AI 返回的 JSON");
      return;
    }
    setStatus("正在导入新的分类目录 JSON…");
    try {
      await confirmAndImportCategories(core.parseAiJson(payload), "prompt", "手动 Prompt");
    } catch (error) {
      setStatus("导入分类目录失败：" + error.message);
    }
  }

  async function handleOnboardingCategoryImport(result, sourceLabel) {
    updateState(result);
    onboardingPanelDismissed = false;
    await updateOnboardingSettings({ onboardingStage: "setup-result" });
    const imported = result.categoryImportResult || {};
    setStatus(sourceLabel + " 已生成新的分类目录：" + (imported.imported || state.categories.length) + " 项");
  }

  function reopenOnboardingCategories() {
    onboardingPanelDismissed = true;
    settingsPage = "directory";
    directoryMode = "edit";
    managementOpen = true;
    renderShell();
    revealOnboardingPanel("categories");
  }

  async function adjustOnboardingCategoryResult() {
    onboardingPanelDismissed = true;
    settingsPage = "directory";
    directoryMode = "edit";
    managementOpen = true;
    try {
      await updateOnboardingSettings({ onboardingStage: "setup-categories" });
      revealOnboardingPanel("categories");
    } catch (error) {
      onboardingPanelDismissed = false;
      setStatus("打开编辑分类目录失败：" + error.message);
    }
  }

  function revealOnboardingPanel(methodName) {
    if (methodName !== "manual") selectSettingsPage(methodName === "categories" ? "directory" : "classify",
      methodName === "categories" ? "edit" : methodName === "prompt" ? "manual" : "api");
  }

  async function showOnboardingGuide() {
    onboardingPanelDismissed = false;
    try {
      await updateOnboardingSettings({ onboardingStage: "guide" });
    } catch (error) {
      setStatus("打开分类说明失败：" + error.message);
    }
  }

  async function startOnboardingClassification(modeValue) {
    const modeName = ["manual", "prompt", "api"].includes(modeValue) ? modeValue : "manual";
    onboardingPanelDismissed = true;
    managementOpen = modeName !== "manual";
    if (modeName === "manual") {
      manualEditorOpen = true;
      selectedBvid = presentVideos()[0]?.bvid || "";
    }
    if (modeName === "prompt" || modeName === "api") { settingsPage = "classify"; aiMethod = modeName === "prompt" ? "manual" : "api"; }
    if (modeName === "api" && !apiSettingsReady(state.settings || {})) {
      settingsPage = "preferences";
      apiPage = "video";
    }
    try {
      await updateOnboardingSettings({ onboardingStage: "classify" });
      if (modeName === "prompt") await exportInitialPrompt();
      if (modeName === "api" && !apiSettingsReady(state.settings || {})) {
        setStatus("API 尚未设置完整，请先在“设置”中填写并测试 API");
      }
      if (modeName !== "api" || apiSettingsReady(state.settings)) revealOnboardingPanel(modeName);
    } catch (error) {
      onboardingPanelDismissed = false;
      setStatus("启动首次分类失败：" + error.message);
      renderShell();
    }
  }

  async function exportInitialPrompt() {
    setStatus("正在生成精简首次分类 Prompt...");
    const result = await send({
      type: message.EXPORT_CLASSIFY_BATCH,
      limit: Math.min(40, Math.max(1, presentVideos().length)),
      randomize: true,
      titleOnly: true,
      compact: true
    });
    exchange = {
      visible: true,
      title: "首次分类 Prompt：随机抽样，仅包含 BV 号和标题",
      text: result.prompt || "",
      append: false,
      mode: "export"
    };
    renderEditorOnly();
    setStatus("已生成 " + (result.batchSize || 0) + " 个视频的精简 Prompt；复制给 AI 后，把 JSON 粘贴回来导入");
  }

  async function completeOnboarding(statusMessage) {
    onboardingPanelDismissed = false;
    try {
      await updateOnboardingSettings({
        onboardingEligible: false,
        onboardingCompleted: true,
        onboardingStage: "complete"
      });
      if (statusMessage) setStatus(statusMessage);
    } catch (error) {
      setStatus("结束首次引导失败：" + error.message);
    }
  }

  function onInput(event) {
    const inputRole = event.target.dataset.role;
    if (inputRole === "new-category-name") newCategoryDraft.name = event.target.value;
    if (["llm-batch-size", "llm-limit", "llm-include-all"].includes(inputRole)) {
      if (inputRole === "llm-limit") {
        llmFormDraft.llmLimit = core.finiteNumberOrNull(event.target.value) ?? undefined;
      } else {
        if (inputRole === "llm-batch-size") {
          llmFormDraft.llmBatchSize = numberByRole("llm-batch-size", state.settings.llmBatchSize);
        } else {
          llmFormDraft.llmIncludeAll = event.target.checked;
        }
        nodeByRole("llm-limit").value = llmRunLimit({ ...state.settings, ...llmFormDraft });
      }
    }
    if (event.target.dataset.role === "search") {
      if (searchComposing || event.isComposing) { clearTimeout(searchTimer); return; }
      searchText = event.target.value;
      updateSearchSurface();
      clearTimeout(searchTimer);
      if (!searchComposing && !event.isComposing) {
        searchTimer = setTimeout(() => renderVideoResults("search"), 100);
      }
    } else if (event.target.dataset.role === "exchange-text") {
      exchange.text = event.target.value;
    } else if (event.target.dataset.role === "category-prompt-import") {
      categoryGeneration.importText = event.target.value;
    } else if (["jev-model", "jev-api-key", "llm-base-url", "llm-model", "llm-api-key", "llm-temperature", "llm-use-response-format"].includes(inputRole)) {
      const provider = inputRole.startsWith("jev-") ? "jev" : "openai";
      apiSettingsDraft = { ...apiSettingsDraft, ...collectApiSettings(provider) };
      const test = apiTestStates[provider];
      if (test?.running) test.changed = true;
      else if (test) {
        delete apiTestStates[provider];
        event.target.closest("[data-api-provider]")?.querySelector(".api-test-status")?.remove();
      }
    } else if (event.target.dataset.role === "llm-auto-classify-threshold") {
      autoApiSettingsDraft = collectAutoLlmSettings();
    } else if (event.target.dataset.role === "category-name") {
      const category = ensureCategoryDraft().find((item) => item.id === event.target.dataset.categoryId);
      if (category) category.name = event.target.value;
      categoryDraftDirty = true;
      const draftStatus = document.querySelector('[data-role="category-draft-status"]');
      if (draftStatus) {
        draftStatus.textContent = "有未保存修改";
        draftStatus.classList.add("is-dirty");
      }
    }
  }

  function onPointerDown(event) {
    if (!batchMode || event.button !== 0) return;
    if (event.target.closest("button,a,input,select,textarea")) return;
    const content = event.target.closest(".content");
    const inGrid = Boolean(event.target.closest(".grid"));
    if (!content || (!inGrid && event.target !== content)) return;
    const scrollNode = event.target.closest(".main") || document.scrollingElement || document.documentElement;
    const start = pointInScrollNode(event, scrollNode);
    const startCard = event.target.closest(".video-card[data-bvid]");
    if (app.setPointerCapture) {
      try {
        app.setPointerCapture(event.pointerId);
      } catch (error) {}
    }
    selectionBox = {
      scrollNode,
      startX: start.x,
      startY: start.y,
      currentX: start.x,
      currentY: start.y,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      baseSelection: new Set(selectedBvids),
      hasMoved: false,
      startedOnCard: Boolean(startCard),
      startBvid: startCard ? startCard.dataset.bvid : ""
    };
  }

  function onPointerMove(event) {
    if (!selectionBox) return;
    updateSelectionPoint(event.clientX, event.clientY);
    if (!selectionBox.hasMoved) return;
    event.preventDefault();
    scheduleSelectionScrollUpdate();
  }

  function onPointerUp(event) {
    if (!selectionBox) return;
    cancelAnimationFrame(selectionFrame);
    selectionFrame = 0;
    const cancelled = event && event.type === "pointercancel";
    if (!cancelled) updateSelectionPoint(event.clientX, event.clientY);
    const moved = selectionBox.hasMoved;
    let changed;
    if (!cancelled && moved) {
      changed = updateSelectionFromBox();
      suppressNextCardClick = selectionBox.startedOnCard;
      if (suppressNextCardClick) {
        setTimeout(() => {
          suppressNextCardClick = false;
        }, 120);
      }
    } else if (!cancelled && selectionBox.startedOnCard && selectionBox.startBvid) {
      toggleSelectedBvid(selectionBox.startBvid);
      suppressNextCardClick = true;
      setTimeout(() => {
        suppressNextCardClick = false;
      }, 120);
    }
    selectionBox = null;
    if (event && app.releasePointerCapture) {
      try {
        app.releasePointerCapture(event.pointerId);
      } catch (error) {}
    }
    hideSelectionBox();
    if (!cancelled && (moved || suppressNextCardClick)) updateSelectionUi(changed);
    if (!cancelled && (moved || suppressNextCardClick)) renderEditorOnly();
  }

  function onWheel(event) {
    if (!selectionBox || !selectionBox.hasMoved) return;
    scheduleSelectionScrollUpdate();
  }

  function onSelectionScroll() {
    if (!selectionBox) return;
    scheduleSelectionScrollUpdate();
  }

  function scheduleSelectionScrollUpdate() {
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      if (!selectionBox) return;
      updateSelectionPoint(selectionBox.lastClientX, selectionBox.lastClientY);
      if (!selectionBox.hasMoved) return;
      updateSelectionUi(updateSelectionFromBox());
    });
  }

  function updateSelectionFromBox() {
    if (!selectionBox) return;
    const box = normalizeBox(selectionBox);
    const next = new Set(selectionBox.baseSelection);
    const scrollRect = selectionBox.scrollNode.getBoundingClientRect();
    const yOffset = scrollRect.top - selectionBox.scrollNode.scrollTop;
    const candidateCards = cardsBetween(box.top + yOffset, box.bottom + yOffset, selectionBox.scrollNode);
    candidateCards.forEach((card) => {
      const rect = rectInScrollNode(card, selectionBox.scrollNode, scrollRect);
      const cardBox = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
      if (intersects(box, cardBox)) next.add(card.dataset.bvid);
    });
    const changed = new Set();
    for (const bvid of selectedBvids) if (!next.has(bvid)) changed.add(bvid);
    for (const bvid of next) if (!selectedBvids.has(bvid)) changed.add(bvid);
    selectedBvids = next;
    return changed;
  }

  function updateSelectionUi(changed) {
    const boxNode = document.querySelector(".selection-box");
    if (boxNode && selectionBox && selectionBox.hasMoved) {
      const box = normalizeBox(selectionBox);
      const viewportBox = boxToViewport(box, selectionBox.scrollNode);
      boxNode.classList.remove("hidden");
      boxNode.style.left = viewportBox.left + "px";
      boxNode.style.top = viewportBox.top + "px";
      boxNode.style.width = (viewportBox.right - viewportBox.left) + "px";
      boxNode.style.height = (viewportBox.bottom - viewportBox.top) + "px";
    }
    if (changed) {
      for (const bvid of changed) {
        const card = videoCardCache.get(bvid)?.card;
        if (card?.isConnected) updateBatchCardSelection(card);
      }
    } else {
      document.querySelectorAll(".video-card[data-bvid]").forEach(updateBatchCardSelection);
    }
    updateBatchCounts();
  }

  function updateBatchCardSelection(card) {
    const selected = selectedBvids.has(card.dataset.bvid);
    if (card.classList.contains("batch-selected") === selected) return;
    card.classList.toggle("batch-selected", selected);
    const mark = card.querySelector(".select-mark");
    if (mark) mark.replaceChildren(...(selected ? [iconNode("check")] : []));
  }

  function updateSelectedVideoUi() {
    document.querySelectorAll(".video-card[data-bvid]").forEach((card) => {
      card.classList.toggle("selected", !batchMode && card.dataset.bvid === selectedBvid);
    });
  }

  function updateBatchModeSurface() {
    document.querySelector(".app")?.classList.toggle("batch-mode", batchMode);
    const toggle = document.querySelector('.toolbar [data-action="toggle-batch"]');
    if (toggle) {
      const label = batchMode ? "退出批量" : "批量管理";
      toggle.title = label;
      toggle.setAttribute("aria-label", label);
      toggle.querySelector("span").textContent = label;
    }
    const topbar = document.querySelector(".topbar");
    const panel = topbar.querySelector(".batch-panel");
    if (batchMode && !panel) topbar.appendChild(renderBatchPanel());
    if (!batchMode) panel?.remove();
    document.querySelectorAll(".video-card[data-bvid]").forEach(card => {
      card.classList.toggle("batch-pickable", batchMode);
      card.querySelector(".select-mark").hidden = !batchMode;
    });
    updateSelectedVideoUi();
    updateSelectionUi();
    renderEditorOnly();
  }

  function hideSelectionBox() {
    const boxNode = document.querySelector(".selection-box");
    if (!boxNode) return;
    boxNode.classList.add("hidden");
    boxNode.style.left = "";
    boxNode.style.top = "";
    boxNode.style.width = "";
    boxNode.style.height = "";
  }

  function updateBatchCounts() {
    const panelCount = document.querySelector('[data-role="batch-panel-count"]');
    if (panelCount) panelCount.textContent = batchPanelCountText();
    const editorCount = document.querySelector('[data-role="batch-editor-count"]');
    if (editorCount) editorCount.textContent = batchEditorCountText();
  }

  function batchPanelCountText() {
    return "已选择 " + selectedBvids.size + " 个视频。可点击卡片、框选，或全选当前结果。";
  }

  function batchEditorCountText() {
    return "已选择 " + selectedBvids.size + " 个视频";
  }

  function updateSelectionPoint(clientX, clientY) {
    if (!selectionBox) return;
    selectionBox.lastClientX = clientX;
    selectionBox.lastClientY = clientY;
    const point = pointInScrollNode({ clientX, clientY }, selectionBox.scrollNode);
    selectionBox.currentX = point.x;
    selectionBox.currentY = point.y;
    if (Math.abs(selectionBox.currentX - selectionBox.startX) > 4 || Math.abs(selectionBox.currentY - selectionBox.startY) > 4) {
      selectionBox.hasMoved = true;
    }
  }

  function pointInScrollNode(event, scrollNode) {
    const rect = scrollNode.getBoundingClientRect ? scrollNode.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      x: event.clientX - rect.left + (scrollNode.scrollLeft || 0),
      y: event.clientY - rect.top + (scrollNode.scrollTop || 0)
    };
  }

  function rectInScrollNode(node, scrollNode, scrollRect = scrollNode.getBoundingClientRect ? scrollNode.getBoundingClientRect() : { left: 0, top: 0 }) {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left - scrollRect.left + (scrollNode.scrollLeft || 0),
      top: rect.top - scrollRect.top + (scrollNode.scrollTop || 0),
      right: rect.right - scrollRect.left + (scrollNode.scrollLeft || 0),
      bottom: rect.bottom - scrollRect.top + (scrollNode.scrollTop || 0)
    };
  }

  function boxToViewport(box, scrollNode) {
    const scrollRect = scrollNode.getBoundingClientRect ? scrollNode.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      left: scrollRect.left + box.left - (scrollNode.scrollLeft || 0),
      top: scrollRect.top + box.top - (scrollNode.scrollTop || 0),
      right: scrollRect.left + box.right - (scrollNode.scrollLeft || 0),
      bottom: scrollRect.top + box.bottom - (scrollNode.scrollTop || 0)
    };
  }

  function hasActiveTextSelection(container) {
    const selection = window.getSelection && window.getSelection();
    if (!selection || selection.isCollapsed || !String(selection).trim()) return false;
    const anchorNode = selection.anchorNode && (selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement);
    const focusNode = selection.focusNode && (selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement);
    return Boolean((anchorNode && container.contains(anchorNode)) || (focusNode && container.contains(focusNode)));
  }

  function normalizeBox(box) {
    return {
      left: Math.min(box.startX, box.currentX),
      top: Math.min(box.startY, box.currentY),
      right: Math.max(box.startX, box.currentX),
      bottom: Math.max(box.startY, box.currentY)
    };
  }

  function intersects(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function onChange(event) {
    const role = event.target.dataset.role;
    if (role === "new-category-parent") newCategoryDraft.parent = event.target.value;
    if (role === "classification-provider") {
      apiSettingsDraft = { ...apiSettingsDraft, classificationProvider: event.target.value };
    } else if (role === "video-filter") {
      videoFilter = event.target.value;
      renderVideoResults("filter");
    } else if (role === "sort-combo") {
      if (event.target.value === "random") {
        shuffleVideos();
        return;
      }
      sortRequest++;
      currentSort = parseSortCombo(event.target.value);
      randomOrder = null;
      renderVideoResults("sort");
    } else if (role === "default-sort") {
      saveBrowsingSetting(event.target, parseSortCombo(event.target.value));
    } else if (role === "default-opening-category") {
      saveBrowsingSetting(event.target, { defaultOpeningCategory: event.target.value });
    } else if (role === "default-video-filter") {
      saveBrowsingSetting(event.target, { defaultVideoFilter: event.target.value });
    } else if (role === "shuffle-on-open") {
      saveBrowsingSetting(event.target, { shuffleOnOpen: event.target.checked });
    } else if (role === "result-batch-size") {
      const value = core.finiteNumberOrNull(event.target.value);
      event.target.value = value === null ? resultBatchSize() : core.normalizeResultBatchSize(value);
      if (value !== null) saveBrowsingSetting(event.target, { resultBatchSize: Number(event.target.value) });
    } else if (role === "show-comment-location") {
      const checkbox = event.target;
      checkbox.disabled = true;
      send({ type: message.UPDATE_SETTINGS, settings: { showCommentLocation: checkbox.checked } })
        .then((nextState) => { updateState(nextState); setStatus("评论 IP 属地设置已保存"); })
        .catch((error) => { checkbox.checked = state.settings.showCommentLocation === true; setStatus(error.message); })
        .finally(() => { checkbox.disabled = false; });
    } else if (role === "sort-mode") {
      send({ type: message.UPDATE_SETTINGS, settings: { sortMode: event.target.value } })
        .then((nextState) => { randomOrder = null; updateState(nextState, { animateResults: true }); })
        .catch((error) => setStatus(error.message));
    } else if (role === "sort-direction") {
      send({ type: message.UPDATE_SETTINGS, settings: { sortDirection: event.target.value } })
        .then((nextState) => { randomOrder = null; updateState(nextState, { animateResults: true }); })
        .catch((error) => setStatus(error.message));
    } else if (role === "import-append") {
      exchange.append = event.target.checked;
    } else if (role === "manual-export-limit") {
      send({ type: message.UPDATE_SETTINGS, settings: { manualExportLimit: manualExportLimit() } })
        .then(updateState)
        .catch((error) => setStatus(error.message));
    } else if (role === "llm-auto-classify-mode") {
      autoApiSettingsDraft = collectAutoLlmSettings();
      const threshold = document.querySelector('[data-role="auto-threshold-field"]');
      if (threshold) threshold.hidden = event.target.value !== "threshold";
    } else if (role === "batch-category") {
      if (event.target.checked) batchCategoryIds.add(event.target.value);
      else batchCategoryIds.delete(event.target.value);
    } else if (role === "category-name") {
      refreshDirectoryNames();
    } else if (role === "category-parent") {
      harvestCategoryDraft();
      if (!moveDirectoryCategory(ensureCategoryDraft(), event.target.dataset.categoryId, event.target.value)) return;
      categoryDraftDirty = true;
      renderEditorOnly();
    }
  }

  function saveBrowsingSetting(input, patch) {
    const role = input.dataset.role;
    browsingSettingsDraft.set(role, patch);
    input.disabled = true;
    browsingSettingsSave = browsingSettingsSave.then(async () => {
      try {
        const { settings } = await send({ type: message.UPDATE_SETTINGS, settings: patch });
        for (const key of Object.keys(patch)) state.settings[key] = settings[key];
        if (role === "default-sort" && !randomOrder) {
          currentSort = null;
          renderVideoResults("sort");
        }
        setStatus("已保存浏览设置");
      } catch (error) {
        setStatus("保存浏览设置失败：" + error.message);
      } finally {
        browsingSettingsDraft.delete(role);
        const control = nodeByRole(role);
        if (control) {
          if (role === "shuffle-on-open") {
            control.checked = state.settings.shuffleOnOpen === true;
          } else {
            const values = {
              "default-sort": defaultSortValue(),
              "default-opening-category": defaultOpeningCategory(),
              "default-video-filter": defaultVideoFilter(),
              "result-batch-size": resultBatchSize()
            };
            control.value = values[role];
          }
          control.disabled = false;
        }
      }
    });
  }

  function resultBatchSize(settings = state.settings) {
    return core.normalizeResultBatchSize(settings.resultBatchSize);
  }

  function updateResultVideos() {
    const scope = JSON.stringify([
      activeFilter.sourceCategoryId, activeFilter.includeUnclassified, videoFilter,
      core.normalizeText(searchText).toLowerCase()
    ]);
    if (scope !== resultScope) {
      resultScope = scope;
      resultLimit = resultBatchSize();
    }
    if (randomOrder?.size === 0) {
      for (const [index, video] of shuffledVideos(presentVideos().sort(compareWatchlaterOrder)).entries()) {
        randomOrder.set(video.bvid, index);
      }
    }
    resultVideos = visibleVideos();
    return resultVideos;
  }

  function resultLimitForIndex(index) {
    const size = resultBatchSize();
    return Math.ceil((index + 1) / size) * size;
  }

  function onResultScroll(event) {
    const main = event.target;
    if (!main.matches?.(".main") || resultLimit >= resultVideos.length || main.scrollTop <= 0) return;
    if (main.scrollHeight - main.clientHeight - main.scrollTop <= 2) {
      appendResultVideos(resultLimit + resultBatchSize());
    }
  }

  function appendResultVideos(limit) {
    const content = app.querySelector('[data-role="content"]');
    const grid = content?.querySelector(".grid");
    if (!grid || limit <= resultLimit) return;
    const next = resultVideos.slice(grid.childElementCount, limit);
    if (!next.length) return;
    resultLimit = limit;
    const cards = next.map(renderVideoCard);
    grid.append(...cards);
    updateResultHeading(content, resultVideos.length);
    globalThis.BiliWLCovers?.refresh();
    return cards[0];
  }

  function renderVideoResults(reason = "filter", revealBvid = "") {
    clearTimeout(searchTimer);
    searchTimer = 0;
    const content = document.querySelector('[data-role="content"]');
    if (!content) return;
    const animate = reason !== "navigation" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previous = animate ? captureCardPositions() : null;
    const snapshots = animate ? captureResultSnapshots(previous) : null;
    cancelCardPositionAnimations();
    const main = document.querySelector(".main");
    const scrollTop = main.scrollTop;
    const previousScope = resultScope;
    const visible = updateResultVideos();
    if (revealBvid) {
      resultLimit = Math.max(resultLimit, resultLimitForIndex(visible.findIndex(video => video.bvid === revealBvid)));
    }
    updateResultGrid(content, content.querySelector(".grid"), visible.slice(0, resultLimit).map(renderVideoCard));
    updateResultHeading(content, visible.length);
    // Preserve the previous offset within the new batch and leave room to scroll into the next one.
    const nextTop = previousScope !== resultScope && resultLimit < visible.length && scrollTop
      ? Math.min(scrollTop, Math.max(0, main.scrollHeight - main.clientHeight - 8))
      : scrollTop;
    if (main.scrollTop !== nextTop) main.scrollTop = nextTop;
    globalThis.BiliWLCovers?.refresh();
    updateBrowsingToolbar(visible);
    updateSearchSurface();
    if (!animate) {
      resultTransition = null;
      resultExitLayer?.remove();
      resultExitLayer = null;
    } else {
      startResultTransition(content, previous, snapshots);
    }
    updateStatusSurface();
  }

  function updateBrowsingToolbar(visible) {
    const control = document.querySelector(".shuffle-control");
    const shuffleChanged = control && control.classList.contains("shuffle-active") !== Boolean(randomOrder);
    if (shuffleChanged) {
      control.replaceWith(renderShuffleControl(visible));
    }
    const shuffle = document.querySelector('[data-action="shuffle-videos"]');
    if (shuffle) shuffle.disabled = visible.length < 2;
    const selector = document.querySelector('[data-role="sort-combo"]');
    if (selector && (selector.value !== sortComboValue() || Boolean(selector.querySelector('[value="random"]')) !== Boolean(randomOrder))) {
      selector.replaceChildren(...sortOptions());
      selector.value = sortComboValue();
    }
    const filter = document.querySelector('[data-role="video-filter"]');
    const filterValue = videoFilter ?? "";
    const filterChanged = filter && filter.value !== filterValue;
    if (filterChanged) filter.value = filterValue;
    return shuffleChanged || filterChanged;
  }

  function startResultTransition(content, previous, snapshots) {
    resultExitLayer?.remove();
    resultExitLayer = null;
    content.querySelectorAll(".video-card[data-result-motion]").forEach(card => {
      resultAnimations.get(card)?.cancel();
      resultAnimations.delete(card);
      delete card.dataset.resultMotion;
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resultTransition = null;
      return;
    }
    const viewport = resultViewport(document.querySelector(".main"));
    const cards = new Map();
    const retained = new Set();
    const opacityById = new Map(snapshots.map(snapshot => [snapshot.bvid, snapshot.opacity]));
    cardsBetween(viewport.top, viewport.bottom, content).forEach(card => {
      const after = card.getBoundingClientRect();
      if (after.bottom < viewport.top || after.top > viewport.bottom) return;
      const id = card.dataset.bvid;
      const plan = resultCardPlan(previous.get(id), after, viewport);
      if (!plan.entering) {
        retained.add(id);
        plan.frames[0].opacity = opacityById.get(id) ?? 1;
      }
      cards.set(id, plan);
    });
    const stagger = Math.min(24, 168 / Math.max(1, cards.size - 1));
    Array.from(cards.values()).forEach((plan, index) => { plan.delay = index * stagger; });
    showResultExit(snapshots.filter(snapshot => !retained.has(snapshot.bvid)), viewport);
    resultTransition = { startedAt: Date.now(), duration: 588, cards };
    resumeResultTransition(content);
  }

  function captureResultSnapshots(previous) {
    const viewport = resultViewport(document.querySelector(".main"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return [];
    return Array.from(previous || captureCardPositions()).flatMap(([bvid, rect]) => {
      if (rect.bottom < viewport.top || rect.top > viewport.bottom) return [];
      const card = videoCardByBvid(bvid);
      return card ? [{ bvid, rect, opacity: Number(getComputedStyle(card).opacity), node: card.cloneNode(true) }] : [];
    });
  }

  function showResultExit(snapshots, viewport) {
    if (!snapshots.length) return;
    const layer = el("div", { className: "result-exit-layer", "aria-hidden": "true", inert: "",
      style: `left:${viewport.left}px;top:${viewport.top}px;width:${viewport.width}px;height:${viewport.height}px` });
    const animations = [];
    const stagger = Math.min(24, 168 / Math.max(1, snapshots.length - 1));
    snapshots.forEach(({ rect, opacity, node }, index) => {
      node.removeAttribute("data-bvid");
      node.removeAttribute("data-action");
      node.style.cssText = `position:absolute;left:${rect.left - viewport.left}px;top:${rect.top - viewport.top}px;width:${rect.width}px;height:${rect.height}px;margin:0;animation:none;opacity:${opacity}`;
      layer.appendChild(node);
      const edge = nearestResultEdge(rect, viewport);
      animations.push(node.animate([{ transform: "translate(0,0)", opacity },
        { transform: `translate(${edge.x * .18}px, ${edge.y * .18}px)`, opacity: 0 }],
        { duration: 180, delay: index * stagger, fill: "forwards", easing: "ease-in" }));
    });
    app.appendChild(layer);
    resultExitLayer = layer;
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => layer.remove());
  }

  function nearestResultEdge(rect, viewport) {
    const centerX = (rect.left + rect.right) / 2;
    const centerY = (rect.top + rect.bottom) / 2;
    const edges = [
      { distance: centerX - viewport.left, x: viewport.left - rect.right - 12, y: 0 },
      { distance: viewport.right - centerX, x: viewport.right - rect.left + 12, y: 0 },
      { distance: centerY - viewport.top, x: 0, y: viewport.top - rect.bottom - 12 },
      { distance: viewport.bottom - centerY, x: 0, y: viewport.bottom - rect.top + 12 }
    ];
    return edges.reduce((closest, edge) => edge.distance < closest.distance ? edge : closest);
  }

  function resultCardPlan(before, after, viewport) {
    const nearby = before && before.bottom >= viewport.top && before.top <= viewport.bottom
      && Math.abs(before.left - after.left) <= viewport.width * .6
      && Math.abs(before.top - after.top) <= viewport.height * .6;
    const offset = nearby ? { x: before.left - after.left, y: before.top - after.top } : nearestResultEdge(after, viewport);
    return { entering: !nearby, duration: 420, frames: [
      { opacity: 1, transform: `translate(${offset.x}px, ${offset.y}px)` },
      { opacity: 1, transform: "translate(0,0)" }
    ] };
  }

  function resultViewport(main) {
    const rect = main.getBoundingClientRect();
    const bar = main.querySelector(".topbar")?.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width,
      top: Math.max(rect.top, bar?.bottom || rect.top), bottom: Math.min(rect.bottom, window.innerHeight),
      height: Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, bar?.bottom || rect.top)) };
  }

  function resumeResultTransition(content) {
    if (!resultTransition || !content) return;
    const elapsed = Date.now() - resultTransition.startedAt;
    if (elapsed >= resultTransition.duration || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resultTransition = null;
      return;
    }
    content.querySelectorAll(".video-card[data-bvid]").forEach(card => {
      resultAnimations.get(card)?.cancel();
      const plan = resultTransition.cards.get(card.dataset.bvid);
      if (!plan || elapsed >= plan.duration + plan.delay) return;
      const animation = card.animate(plan.frames, { duration: plan.duration, delay: plan.delay,
        fill: "backwards", easing: "cubic-bezier(.2,.75,.25,1)" });
      card.dataset.resultMotion = plan.entering ? "edge" : "move";
      resultAnimations.set(card, animation);
      animation.currentTime = elapsed;
      const cleanup = () => {
        if (resultAnimations.get(card) !== animation) return;
        resultAnimations.delete(card);
        delete card.dataset.resultMotion;
      };
      animation.finished.then(cleanup, cleanup);
    });
    const empty = content.querySelector(".empty");
    if (empty && elapsed < 240) {
      const animation = empty.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 240, easing: "ease-out" });
      animation.currentTime = elapsed;
    }
  }

  function updateSearchSurface() {
    const active = Boolean(searchText.trim());
    const input = document.querySelector('[data-role="search"]');
    if (!input) return;
    const hint = document.getElementById("search-scope-hint");
    if (hint) hint.hidden = !active;
    updateFilterAuras();
  }

  function updateFilterAuras() {
    const active = { search: Boolean(searchText.trim()), duration: Boolean(videoFilter), shuffle: Boolean(randomOrder) };
    const palettes = {
      search: "--aura-hue:190;--aura-shift-a:-40;--aura-shift-b:0;--aura-shift-c:55",
      duration: "--aura-hue:35;--aura-shift-a:-45;--aura-shift-b:0;--aura-shift-c:20",
      shuffle: "--aura-hue:270;--aura-shift-a:-45;--aura-shift-b:0;--aura-shift-c:55"
    };
    document.querySelectorAll("[data-filter-aura]").forEach(node => {
      const key = node.dataset.filterAura;
      const aura = node.querySelector(".filter-aura");
      node.classList.toggle("filter-active", active[key]);
      if (active[key] && !aura) {
        node.style.cssText = palettes[key];
        const surface = renderCategoryAura("small", "filter-" + key);
        surface.classList.add("filter-aura");
        surface.querySelector(".category-aura-backdrop").remove();
        const particles = el("span", { className: "filter-particles" }, Array.from(surface.children));
        surface.appendChild(particles);
        surface.prepend(el("span", { className: "filter-gradient" }));
        node.appendChild(surface);
      } else if (!active[key] && aura) { aura.remove(); }
    });
  }

  function ensureRowAura(row) {
    clearTimeout(auraCleanup.get(row));
    if (!row.querySelector(".category-aura")) {
      row.prepend(renderCategoryAura(row.dataset.auraSize, row.dataset.categoryId || (row.dataset.action === "filter-all" ? "all" : "pending")));
      globalThis.BiliWLAura.refresh();
    }
  }

  function releaseRowAura(row) {
    clearTimeout(auraCleanup.get(row));
    auraCleanup.set(row, setTimeout(() => {
      if (!row.isConnected || row.classList.contains("active") || row.classList.contains("aura-preview")) return;
      row.querySelector(".category-aura")?.remove();
      globalThis.BiliWLAura.refresh();
    }, 450));
  }

  function onCategoryPreview(event) {
    const row = event.target.closest(".cat-row");
    if (!row || (event.relatedTarget && row.contains(event.relatedTarget))) return;
    const preview = event.type === "pointerover" || row.matches(":hover, :focus-visible");
    if (preview) {
      ensureRowAura(row);
      // Draw the initial transparent state before beginning the fade.
      row.getBoundingClientRect();
      row.classList.add("aura-preview");
    } else {
      row.classList.remove("aura-preview");
      releaseRowAura(row);
    }
    globalThis.BiliWLAura.refresh();
  }

  function reconcileCategoryPointer(event) {
    if (event.type === "pointermove" && !event.buttons) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    document.querySelectorAll(".cat-row.aura-preview").forEach(row => {
      // A pointer press leaves DOM focus behind; only visible keyboard focus counts.
      if ((hit && row.contains(hit)) || row.matches(":focus-visible")) return;
      row.classList.remove("aura-preview");
      releaseRowAura(row);
    });
  }

  function clearCategoryPreviews() {
    document.querySelectorAll(".cat-row.aura-preview").forEach(row => {
      row.classList.remove("aura-preview");
      releaseRowAura(row);
    });
  }

  function ensureCategoryGlass() {
    moveCategoryGlass();
  }

  function moveCategoryGlass(target = null, animate = false) {
    const rows = Array.from(document.querySelectorAll(".cat-row.active"));
    let glass = document.querySelector(".category-glass");
    const before = glass?.getBoundingClientRect();
    const nav = document.querySelector(".cat-nav");
    const viewport = nav?.getBoundingClientRect();
    const visible = rows.filter(row => {
      if (!row.closest(".cat-nav")) return true;
      const rect = row.getBoundingClientRect();
      return viewport && rect.bottom > viewport.top && rect.top < viewport.bottom;
    });
    const anchor = target?.getBoundingClientRect().top ?? before?.top ?? viewport?.top ?? 0;
    const destination = visible.includes(target) ? target
      : visible.includes(glass?.parentElement) ? glass.parentElement
      : visible.sort((a, b) => Math.abs(a.getBoundingClientRect().top - anchor) - Math.abs(b.getBoundingClientRect().top - anchor))[0];
    if (!destination) {
      if (glass) glass.hidden = true;
      return;
    }
    if (glass?.parentElement === destination && !glass.hidden) return;
    if (!glass) glass = el("span", { className: "category-glass", "aria-hidden": "true" });
    const wasHidden = glass.hidden;
    glass.getAnimations().forEach(animation => animation.cancel());
    glass.hidden = false;
    destination.appendChild(glass);
    const after = destination.getBoundingClientRect();
    if (!animate || !before || wasHidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    glass.animate([
      { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)`, width: before.width + "px", height: before.height + "px" },
      { transform: "translate(0,0)", width: after.width + "px", height: after.height + "px" }
    ], { duration: 560, easing: "cubic-bezier(.25,.65,.25,1)" });
  }

  function updateCategorySelection(target) {
    document.querySelectorAll(".cat-row").forEach(row => {
      const active = activeFilter.sourceCategoryId ? row.dataset.categoryId === activeFilter.sourceCategoryId
        : activeFilter.includeUnclassified ? row.dataset.action === "filter-unclassified" : row.dataset.action === "filter-all";
      row.classList.toggle("active", active);
      row.setAttribute("aria-current", String(active));
      if (active) ensureRowAura(row);
      else releaseRowAura(row);
    });
    moveCategoryGlass(target.closest(".cat-row"), true);
    globalThis.BiliWLAura.refresh();
  }

  function renderEditorOnly() {
    manualOpeningCleanup?.();
    settingsOpeningCleanup?.();
    if (!manualEditorOpen || managementOpen) manualSourceCleanup?.();
    const host = document.querySelector(".modal-host");
    if (!host) return;
    captureModalDraft();
    rememberSettingsScroll();
    const editor = host.querySelector(".editor");
    const scrollTop = editor?.scrollTop || 0;
    const directoryScrollTop = editor?.querySelector(".category-admin-list")?.scrollTop || 0;
    const modalFocus = captureModalFocus();
    host.replaceWith(renderEditor());
    showModal();
    globalThis.BiliWLCovers?.refresh();
    setupCategoryPanels();
    const nextEditor = document.querySelector(".editor");
    if (nextEditor) nextEditor.scrollTop = scrollTop;
    const nextDirectory = nextEditor?.querySelector(".category-admin-list");
    if (nextDirectory) nextDirectory.scrollTop = directoryScrollTop;
    restoreModalFocus(modalFocus);
    updateStatusSurface();
    globalThis.BiliWLAura.refresh();
  }

  function toggleSelectedBvid(bvid) {
    const next = new Set(selectedBvids);
    if (next.has(bvid)) next.delete(bvid);
    else next.add(bvid);
    selectedBvids = next;
  }

  async function bulkAddCategory() {
    const validIds = new Set(state.categories.filter(category => category.enabled !== false).map(category => category.id));
    const categoryIds = Array.from(batchCategoryIds).filter(id => validIds.has(id));
    if (!categoryIds.length) {
      setStatus("请先勾选要添加的分类");
      return;
    }
    await bulkUpdate({ action: "add", categoryIds });
  }

  async function bulkClearCategories() {
    if (!selectedBvids.size) {
      setStatus("请先选择视频");
      return;
    }
    if (!confirm("清除 " + selectedBvids.size + " 个选中视频的所有分类？")) return;
    await bulkUpdate({ action: "clear" });
  }

  async function bulkUpdate(payload) {
    if (!selectedBvids.size) {
      setStatus("请先选择视频");
      return;
    }
    setStatus("正在批量调整视频分类…");
    try {
      const result = await send(Object.assign({
        type: message.BULK_UPDATE_CLASSIFICATIONS,
        bvids: Array.from(selectedBvids)
      }, payload));
      updateState(result);
      const output = result.bulkUpdateResult || {};
      setStatus("批量更新完成：" + (output.updated || 0) + " 个视频");
      if (output.updated && output.action !== "clear") await finishClassification("批量手动确认已保存");
    } catch (error) {
      setStatus("批量更新失败：" + error.message);
    }
  }

  async function syncAndRefresh() {
    const synced = await scan();
    if (!synced) return;
    setStatus(scanStatusText(synced.scanResult, synced.autoClassifyResult) + "；正在更新详情...");
    await runDetails();
  }

  async function finishClassification(reason) {
    if (onboardingActive() && onboardingStage() === "classify") {
      await completeOnboarding("首次视频分类已完成；以后仍可随时手动调整或重新运行 AI 分类");
    } else {
      setStatus(reason);
    }
  }

  async function scan(options) {
    const settings = options || {};
    setStatus("正在同步 B站稍后再看列表...");
    try {
      const result = await send({
        type: message.SCAN_WATCHLATER,
        domItems: [],
        skipAutoClassify: Boolean(settings.skipAutoClassify)
      });
      const scanResult = result.scanResult || {};
      const autoResult = result.autoClassifyResult || {};
      await updateStateWithSyncAnimation(result, scanResult);
      if (result.apiError) {
        setStatus("同步 B站列表失败，已保留本地列表：" + result.apiError);
        return null;
      }
      setStatus(scanStatusText(scanResult, autoResult));
      return { scanResult, autoClassifyResult: autoResult };
    } catch (error) {
      setStatus("同步失败：" + error.message + "。可打开 B站稍后再看页面后用右下角入口扫描。");
      return null;
    }
  }

  function scanStatusText(scanResult, autoResult) {
    return "同步完成 · 共 " + (scanResult.scannedCount || 0) + " 个视频，新增 " + (scanResult.newCount || 0) + " 个，变化 " + (scanResult.changedCount || 0) + " 个，移除 " + (scanResult.removedCount || 0) + " 个" + (autoResult.skipped ? "；暂不分类视频" : "；完成初步分类 " + (autoResult.classified || 0) + " 个");
  }

  async function runDetails() {
    clearTimeout(idleDetailTimer);
    idleDetailTimer = 0;
    setStatus("正在检查待补充的视频详情...");
    try {
      const result = await send({ type: message.FETCH_VIDEO_DETAILS });
      updateState(result);
      const output = result.detailQueueResult || {};
      if (output.disabled) {
        setStatus("详情更新已关闭");
      } else if (output.pausedUntil) {
        setStatus("详情更新已暂停：" + output.error + "。预计 " + formatSettingsTime(output.pausedUntil) + " 后继续。");
      } else if (output.pending) {
        setStatus("待补充 " + output.pending + " 个视频详情，将分批处理。");
      } else {
        setStatus("没有缺失详情的视频");
      }
      return result;
    } catch (error) {
      setStatus("详情更新失败：" + error.message);
      return null;
    }
  }

  function scheduleIdleDetailRefresh() {
    if (idleDetailTimer) clearTimeout(idleDetailTimer);
    idleDetailTimer = setTimeout(() => {
      idleDetailTimer = 0;
      runIdleDetailRefresh();
    }, IDLE_DETAIL_DELAY_MS);
  }

  async function runIdleDetailRefresh() {
    if (llmRun.running || state.progress && state.progress.status === "running") {
      scheduleIdleDetailRefresh();
      return;
    }
    await runDetails();
  }

  async function autoClassify(options) {
    const settings = options || {};
    if (!settings.silent) setStatus("正在进行初步分类…");
    try {
      const result = await send({
        type: message.AUTO_CLASSIFY,
        options: { silent: Boolean(settings.silent) }
      });
      updateState(result);
      const output = result.autoClassifyResult || {};
      if (!settings.silent) setStatus(keywordStatusText(output));
      return output;
    } catch (error) {
      if (!settings.silent) setStatus("初步分类失败：" + error.message);
      return null;
    }
  }

  function keywordStatusText(output) {
    if (output && output.skipped) return "首次引导中暂不分类视频";
    return "初步分类完成：写入 " + (output.classified || 0) + " 个，跳过手动确认 " + (output.skippedManual || 0) + " 个，保留已有 " + (output.unchanged || 0) + " 个";
  }

  async function exportBatch() {
    setStatus("正在生成待精细分类视频的提示词…");
    try {
      const limit = manualExportLimit();
      updateState(await send({ type: message.UPDATE_SETTINGS, settings: { manualExportLimit: limit } }));
      const result = await send({ type: message.EXPORT_CLASSIFY_BATCH, limit: limit > 0 ? limit : "all" });
      exchange = {
        visible: true,
        title: "复制到 ChatGPT/Gemini：待精细分类视频",
        text: result.prompt || "",
        append: result.mergeMode === "append",
        mode: "export"
      };
      settingsPage = "classify";
    aiMethod = "manual";
      renderEditorOnly();
      setStatus("已生成 " + (result.batchSize || 0) + " 个待精细分类视频的提示词，候选共 " + (result.totalCandidates || 0) + " 个");
    } catch (error) {
      setStatus("导出失败：" + error.message);
    }
  }

  function showImportBox() {
    exchange = {
      visible: true,
      title: "粘贴 AI 返回的 JSON",
      text: "",
      append: false,
      mode: "import"
    };
    settingsPage = "classify";
    aiMethod = "manual";
    renderEditorOnly();
  }

  async function copyExchangeText() {
    try {
      await navigator.clipboard.writeText(exchange.text || "");
      setStatus("已复制到剪贴板");
    } catch (error) {
      setStatus("复制失败：" + error.message);
    }
  }

  async function importJson() {
    const textarea = document.querySelector('[data-role="exchange-text"]');
    const append = Boolean(document.querySelector('[data-role="import-append"]') && document.querySelector('[data-role="import-append"]').checked);
    setStatus("正在导入分类 JSON...");
    try {
      const result = await send({
        type: message.IMPORT_CLASSIFICATIONS,
        payload: textarea ? textarea.value : exchange.text,
        options: { mergeMode: append ? "append" : "replace" }
      });
      exchange.visible = false;
      updateState(result);
      const imported = result.importResult || {};
      setStatus("导入 " + (imported.imported || 0) + " 项，跳过 " + (imported.skipped || 0) + " 项" + (imported.warnings && imported.warnings.length ? "；有警告" : ""));
      if (imported.imported) await finishClassification("AI 分类已导入");
    } catch (error) {
      setStatus("导入失败：" + error.message);
    }
  }

  function collectApiSettings(provider) {
    if (provider === "video") return { classificationProvider: valueByRole("classification-provider") || "openai" };
    if (provider === "jev") return { jevModel: valueByRole("jev-model"), jevApiKey: valueByRole("jev-api-key") };
    return {
      llmBaseUrl: valueByRole("llm-base-url"),
      llmModel: valueByRole("llm-model"),
      llmApiKey: valueByRole("llm-api-key"),
      llmTemperature: numberByRole("llm-temperature", 0.1),
      llmUseResponseFormat: checkedByRole("llm-use-response-format")
    };
  }

  function collectLlmRunSettings() {
    const config = { ...state.settings, llmBatchSize: numberByRole("llm-batch-size", state.settings.llmBatchSize) };
    return {
      llmBatchSize: llmBatchSize(config),
      llmIncludeAll: checkedByRole("llm-include-all")
    };
  }

  function llmBatchSize(config) {
    const size = core.finiteNumberOrNull(config.llmBatchSize) ?? core.DEFAULT_SETTINGS.llmBatchSize;
    return Math.min(config.classificationProvider === "jev" ? 5 : 100, Math.max(1, Math.floor(size)));
  }

  function countLlmCandidates(includeAll) {
    if (!includeAll) return countNeedsClassification();
    const classifications = classificationMap();
    return presentVideos().filter(video => !core.isManualClassification(classifications.get(video.bvid))).length;
  }

  function llmRunLimit(settings, candidates = countLlmCandidates(settings.llmIncludeAll)) {
    const entered = llmFormDraft.llmLimit;
    if (candidates < llmBatchSize(settings)) {
      return entered > 0 ? Math.min(entered, candidates) : candidates;
    }
    return entered ?? settings.llmLimit ?? state.settings.llmLimit ?? 0;
  }

  function collectAutoLlmSettings() {
    return {
      llmAutoClassifyMode: valueByRole("llm-auto-classify-mode") || "off",
      llmAutoClassifyThreshold: Math.min(10000, Math.max(1, Math.floor(numberByRole("llm-auto-classify-threshold", 50))))
    };
  }

  function apiSettingsReady(config) {
    return core.classificationApiReady(config);
  }

  function categoryApiSettingsReady(config) {
    return apiSettingsReady({ ...config, classificationProvider: "openai" });
  }

  function openApiSettings(provider = "video", statusMessage) {
    managementOpen = true;
    manualEditorOpen = false;
    settingsPage = "preferences";
    apiPage = provider;
    renderEditorOnly();
    if (statusMessage) setStatus(statusMessage);
  }

  async function saveLlmSettings(provider) {
    if (apiSaving || apiTestStates[provider]?.running) return;
    const patch = collectApiSettings(provider);
    const selected = provider === "video" ? patch.classificationProvider : provider;
    const config = { ...state.settings, ...patch, classificationProvider: selected };
    if (!apiSettingsReady(config)) {
      if (provider === "video") {
        openApiSettings(selected, "请先填写并保存 " + apiConnections[selected] + " 的连接。");
      } else {
        setStatus("请填写完整的连接信息后再保存。");
      }
      return;
    }
    apiSaving = true;
    renderEditorOnly();
    setStatus("正在保存 AI 服务设置…");
    try {
      const nextState = await send({ type: message.UPDATE_SETTINGS, settings: patch });
      for (const [key, value] of Object.entries(patch)) {
        if (apiSettingsDraft?.[key] === value) delete apiSettingsDraft[key];
      }
      apiSaving = false;
      updateState(nextState);
      setStatus(provider === "video" ? "已保存，视频分类将使用 " + apiConnections[selected] : "已保存 " + apiConnections[selected] + " 连接");
    } catch (error) {
      apiSaving = false;
      renderEditorOnly();
      setStatus("保存 AI API 配置失败：" + error.message);
    }
  }

  async function saveAutoLlmSettings() {
    const nextSettings = collectAutoLlmSettings();
    if (nextSettings.llmAutoClassifyMode !== "off" && !apiSettingsReady(state.settings || {})) {
      openApiSettings("video", "启用自动触发前，请先配置视频分类使用的 API。");
      return;
    }
    setStatus("正在保存自动 API 视频分类设置…");
    try {
      const nextState = await send({ type: message.UPDATE_SETTINGS, settings: nextSettings });
      autoApiSettingsDraft = null;
      updateState(nextState);
      const labels = { off: "关闭", daily: "每天", weekly: "每周", threshold: "按待精细分类数量" };
      setStatus("已保存自动 API 视频分类设置：" + (labels[nextSettings.llmAutoClassifyMode] || "关闭"));
    } catch (error) {
      setStatus("保存自动 API 视频分类设置失败：" + error.message);
    }
  }

  async function testLlmApi(provider) {
    if (apiTestStates[provider]?.running || apiSaving) return;
    const config = { ...collectApiSettings(provider), classificationProvider: provider };
    const name = apiConnections[provider];
    if (!apiSettingsReady(config)) {
      setStatus("请填写完整的连接信息后再测试。");
      return;
    }
    const test = { running: true, message: "正在测试 " + name + " 连接…" };
    apiTestStates[provider] = test;
    renderEditorOnly();
    try {
      if (provider === "jev") {
        await core.classifyWithJev(config, [{ bvid: "test", title: "数学入门课程" }], [
          { id: "study", name: "学习", enabled: true }, { id: "other.todo", name: "暂未归类", enabled: true }
        ], fetchWithTimeout);
      } else {
        const response = await sendLlmRequest(config, "请只回复一个简短的 JSON 对象：{\"ok\":true}", false, 30000);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        if (!core.normalizeText(data?.choices?.[0]?.message?.content)) throw new Error("响应缺少消息内容");
      }
      apiTestStates[provider] = { message: name + " 连接测试成功。" };
    } catch (error) {
      const secret = config.jevApiKey || config.llmApiKey;
      const detail = secret ? error.message.split(secret).join("[已隐藏密钥]") : error.message;
      apiTestStates[provider] = { message: name + " 连接测试失败：" + detail };
    } finally {
      if (test.changed) apiTestStates[provider] = { message: "连接配置已修改，请重新测试。" };
      renderEditorOnly();
      setStatus(apiTestStates[provider].message);
    }
  }

  function stopLlmRun() {
    if (!llmRun.running) return;
    llmRun.stopRequested = true;
    llmRun.message = "正在停止，当前批次完成后退出";
    renderEditorOnly();
  }

  async function startLlmRun({ quick = false, origin } = {}) {
    if (llmRun.running) {
      setStatus("AI 正在分类，可在「使用 API 自动分类」查看进度。");
      if (quick) {
        managementOpener = "quick-llm-run";
        managementOpen = true;
        settingsPage = "classify";
        aiMethod = "api";
        renderEditorOnly();
      }
      return;
    }
    if (Date.now() < manualLlmRetryAt) {
      setStatus("API 请求已限流，请在 " + formatSettingsTime(manualLlmRetryAt) + " 后重试");
      return;
    }
    const runSettings = quick ? { llmIncludeAll: false } : collectLlmRunSettings();
    const config = { ...state.settings, ...runSettings };
    const candidates = countLlmCandidates(config.llmIncludeAll);
    if (!candidates) {
      setStatus(!videoListLoaded ? "视频列表尚未加载，请稍后再试。" :
        config.llmIncludeAll ? "没有可重新处理的视频。" : "没有待精细分类的视频。");
      return;
    }
    if (quick) managementOpener = "quick-llm-run";
    if (!apiSettingsReady(config)) {
      openApiSettings("video", "请先配置视频分类使用的 API，然后再开始分类。");
      return;
    }
    config.llmLimit = quick ? 0 : Math.min(10000, Math.max(0, Math.floor(llmRunLimit(config, candidates))));

    llmRun = {
      running: true,
      quick,
      batchSize: llmBatchSize(config),
      stopRequested: false,
      done: false,
      imported: 0,
      skipped: 0,
      processed: 0,
      total: quick ? candidates : 0,
      message: "正在准备分类…",
      batches: [],
      warnings: []
    };
    managementOpen = true;
    settingsPage = "classify";
    aiMethod = "api";
    renderEditorOnly();
    if (origin) animateSettingsOpening(origin);

    try {
      if (!quick) {
        if (llmFormDraft.llmLimit !== undefined) runSettings.llmLimit = llmFormDraft.llmLimit;
        updateState(await send({ type: message.UPDATE_SETTINGS, settings: runSettings }));
      }
      await runLlmBatches(config);
      llmRun.done = true;
      const failed = failedBatchCount();
      llmRun.message = llmRun.stopReason || (llmRun.stopRequested ? "已停止" : failed ? "API 分类有 " + failed + " 个批次失败" :
        llmRun.processed ? "AI (API) 批量视频分类完成" : "没有可处理的视频");
      updateState(await send({ type: message.GET_STATE }));
      if (llmRun.imported) await finishClassification("AI (API) 批量视频分类已更新");
      if (failed) {
        setStatus(llmRun.message + "：导入 " + llmRun.imported + " 项；请先在“设置”中检查并测试 API");
      } else {
        setStatus(llmRun.message + "：导入 " + llmRun.imported + " 项，跳过 " + llmRun.skipped + " 项");
      }
    } catch (error) {
      llmRun.message = "AI (API) 批量视频分类失败：" + error.message;
      setStatus(llmRun.message + "；请先在“设置”中检查并测试 API");
    } finally {
      llmRun.running = false;
      renderEditorOnly();
    }
  }

  async function runLlmBatches(config) {
    const batchSize = llmBatchSize(config);
    const limit = Math.max(0, Number(config.llmLimit) || 0);
    const includeAll = Boolean(config.llmIncludeAll);
    let consecutiveFailures = 0;
    const excludedBvids = [];
    while (!llmRun.stopRequested) {
      const remaining = limit ? Math.max(0, limit - llmRun.processed) : batchSize;
      if (limit && remaining <= 0) break;
      const requested = limit ? Math.min(batchSize, remaining) : batchSize;
      llmRun.message = "正在导出第 " + (llmRun.batches.length + 1) + " 批...";
      renderEditorOnly();
      const exported = await send({
        type: message.EXPORT_CLASSIFY_BATCH,
        includeAll,
        limit: requested,
        excludedBvids
      });
      if (!exported.batchSize) break;
      llmRun.total = limit ? Math.min(limit, llmRun.processed + (exported.totalCandidates || 0)) : llmRun.processed + (exported.totalCandidates || 0);
      const batch = {
        index: llmRun.batches.length + 1,
        size: exported.batchSize,
        status: "calling"
      };
      llmRun.batches.push(batch);
      llmRun.message = "正在调用 AI：第 " + batch.index + " 批，" + batch.size + " 个视频";
      renderEditorOnly();

      try {
        const payload = config.classificationProvider === "jev"
          ? await core.classifyWithJev(config, exported.batchVideos, exported.categories, fetchWithTimeout)
          : core.normalizeLlmPayload(await callLlm(config, exported.prompt || ""));
        batch.llmItems = payload.items.length;
        if (payload.items.length < batch.size) {
          const warning = "第 " + batch.index + " 批 AI 返回 " + payload.items.length + " 项，少于导出 " + batch.size + " 个视频";
          llmRun.warnings.push(warning);
          batch.warning = warning;
        }
        batch.status = "importing";
        llmRun.message = "正在导入第 " + batch.index + " 批...";
        renderEditorOnly();
        const importedState = await send({
          type: message.IMPORT_CLASSIFICATIONS,
          payload: JSON.stringify(payload),
          options: { mergeMode: "replace" }
        });
        const importResult = importedState.importResult || {};
        batch.status = "done";
        batch.imported = importResult.imported || 0;
        batch.skipped = importResult.skipped || 0;
        batch.warnings = importResult.warnings || [];
        updateState(importedState);
        llmRun.imported += batch.imported;
        llmRun.skipped += batch.skipped;
        llmRun.warnings.push(...batch.warnings);
        llmRun.message = "已完成第 " + batch.index + " 批";
        consecutiveFailures = 0;
      } catch (error) {
        batch.status = "failed";
        batch.error = error.message;
        llmRun.warnings.push("第 " + batch.index + " 批失败：" + error.message);
        llmRun.message = "第 " + batch.index + " 批失败，已跳过继续";
        consecutiveFailures++;
        if ([429, 529].includes(error.status)) {
          manualLlmRetryAt = Math.max(error.retryAt || 0, Date.now() + 60000);
          llmRun.stopReason = "API 分类已暂停，请在 " + formatSettingsTime(manualLlmRetryAt) + " 后重试";
        } else if (error.fatal || consecutiveFailures >= 3) {
          llmRun.stopReason = "API 分类已停止：" + (error.fatal ? error.message : "连续 3 批失败");
        }
        if (llmRun.stopReason) break;
      }
      excludedBvids.push(...exported.batchVideos.map((video) => video.bvid));
      llmRun.processed += exported.batchSize || 0;
      renderEditorOnly();
    }
  }

  async function callLlm(config, prompt) {
    const requestPrompt = [
      prompt,
      "",
      "重要：必须为本批待分类视频中的每一个 bvid 返回一项。不要漏掉视频；信息不足时用 other.todo。",
      "返回必须是严格 JSON 对象：所有属性名和字符串都必须使用双引号，顶层必须是 {\"items\":[...]}。"
    ].join("\n");
    const useResponseFormat = config.llmUseResponseFormat === true;
    let response = await sendLlmRequest(config, requestPrompt, useResponseFormat);
    let textValue = await response.text();
    if (!response.ok && [400, 422].includes(response.status) && useResponseFormat && /response[_ ]format|json_object/i.test(textValue)) {
      llmRun.warnings.push("当前模型不支持 json_object response_format，已自动重试普通 JSON 提示模式");
      response = await sendLlmRequest(config, requestPrompt, false);
      textValue = await response.text();
    }
    if (!response.ok) {
      throw core.classificationApiError(response, "AI API HTTP " + response.status + ": " + textValue.slice(0, 300));
    }
    const data = core.parseAiJson(textValue);
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    if (!content) throw new Error("AI 响应缺少 choices[0].message.content");
    return core.parseAiJson(content);
  }

  async function callCategoryLlm(config, prompt) {
    const requestPrompt = [
      prompt,
      "",
      "再次确认：本次只生成分类目录，不要返回任何 bvid 的视频分类结果。",
      "顶层必须是 {\"categories\":[...]}，每项必须包含 id、name、parentId、order、keywords。"
    ].join("\n");
    const useResponseFormat = config.llmUseResponseFormat === true;
    let response = await sendLlmRequest(config, requestPrompt, useResponseFormat);
    let textValue = await response.text();
    if (!response.ok && useResponseFormat && /response[_ ]format|json_object/i.test(textValue)) {
      if (onboardingCategoryRunning) onboardingCategoryMessage = "模型不支持 json_object，正在用普通 JSON 模式重试…";
      if (categoryGeneration.running) categoryGeneration.message = "模型不支持 json_object，正在用普通 JSON 模式重试…";
      renderShell();
      response = await sendLlmRequest(config, requestPrompt, false);
      textValue = await response.text();
    }
    if (!response.ok) {
      throw new Error("AI API HTTP " + response.status + ": " + textValue.slice(0, 300));
    }
    const data = core.parseAiJson(textValue);
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    if (!content) throw new Error("AI 响应缺少 choices[0].message.content");
    const payload = core.parseAiJson(content);
    if (!Array.isArray(payload && payload.categories) || !payload.categories.length) {
      throw new Error("AI 返回中没有 categories 数组");
    }
    return payload;
  }

  async function sendLlmRequest(config, requestPrompt, useResponseFormat, timeoutMs) {
    const body = {
      model: config.llmModel,
      temperature: Number(config.llmTemperature) || 0,
      messages: [
        { role: "system", content: "你只返回严格 JSON。不要 Markdown，不要解释。" },
        { role: "user", content: requestPrompt }
      ]
    };
    if (useResponseFormat) {
      body.response_format = { type: "json_object" };
    }
    return fetchWithTimeout(chatCompletionsUrl(config.llmBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + config.llmApiKey,
        "x-title": "Bili Watchlater Classifier"
      },
      body: JSON.stringify(body)
    }, timeoutMs || 120000);
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  function chatCompletionsUrl(value) {
    const url = core.normalizeText(value).replace(/\/+$/g, "");
    if (!url) return "";
    return /\/chat\/completions$/i.test(url) ? url : url + "/chat/completions";
  }

  function toggleCategoryPrompt() {
    categoryGeneration.mode = categoryGeneration.mode === "prompt" ? "" : "prompt";
    renderEditorOnly();
    if (categoryGeneration.mode === "prompt" && !categoryGeneration.prompt) loadCategoryPrompt();
  }

  async function loadCategoryPrompt() {
    if (categoryGeneration.loading) return;
    categoryGeneration.mode = "prompt";
    categoryGeneration.loading = true;
    categoryGeneration.message = "正在根据现有视频生成分类目录 Prompt…";
    renderEditorOnly();
    try {
      const result = await send({ type: message.EXPORT_CATEGORY_PROPOSAL, limit: 60 });
      categoryGeneration.prompt = result.prompt || "";
      categoryGeneration.message = "已根据 " + (result.sampleCount || 0) + " 个视频标题生成 Prompt。";
      setStatus(categoryGeneration.message);
    } catch (error) {
      categoryGeneration.prompt = "";
      categoryGeneration.message = "生成 Prompt 失败：" + error.message;
      setStatus(categoryGeneration.message);
    } finally {
      categoryGeneration.loading = false;
      renderEditorOnly();
    }
  }

  async function copyCategoryPrompt() {
    if (!categoryGeneration.prompt) {
      setStatus("请先生成分类目录 Prompt");
      return;
    }
    try {
      await navigator.clipboard.writeText(categoryGeneration.prompt);
      setStatus("分类目录 Prompt 已复制到剪贴板");
    } catch (error) {
      setStatus("复制分类目录 Prompt 失败：" + error.message);
    }
  }

  async function importCategoryPrompt() {
    const raw = valueByRole("category-prompt-import") || categoryGeneration.importText;
    if (!core.normalizeText(raw)) {
      setStatus("请先粘贴 AI 返回的 categories JSON");
      return;
    }
    categoryGeneration.importText = raw;
    try {
      await confirmAndImportCategories(core.parseAiJson(raw), "prompt", "手动 Prompt");
    } catch (error) {
      categoryGeneration.message = "导入分类目录失败：" + error.message;
      setStatus(categoryGeneration.message);
      renderEditorOnly();
    }
  }

  async function generateCategoriesWithApi() {
    if (categoryGeneration.running) return;
    const config = Object.assign({}, state.settings || {});
    if (!categoryApiSettingsReady(config)) {
      openApiSettings("openai", "生成分类目录需要 OpenAI-compatible API，请先填写并保存连接。");
      return;
    }
    categoryGeneration.running = true;
    categoryGeneration.message = "正在读取现有视频标题…";
    renderEditorOnly();
    try {
      const exported = await send({ type: message.EXPORT_CATEGORY_PROPOSAL, limit: 60 });
      categoryGeneration.message = "已抽取 " + (exported.sampleCount || 0) + " 个标题，正在请求 AI 生成分类目录…";
      renderEditorOnly();
      const payload = await callCategoryLlm(config, exported.prompt || "");
      categoryGeneration.running = false;
      await confirmAndImportCategories(payload, "api", "API");
    } catch (error) {
      categoryGeneration.running = false;
      categoryGeneration.message = "API 生成分类目录失败：" + error.message;
      setStatus(categoryGeneration.message + "；请先在“设置”中检查并测试 API");
      renderEditorOnly();
    }
  }

  async function confirmAndImportCategories(payload, source, sourceLabel) {
    const count = Array.isArray(payload && payload.categories) ? payload.categories.length : 0;
    if (!count) throw new Error("AI 返回中没有 categories 数组");
    const confirmed = await confirmAction({
      title: "替换分类目录？",
      message: "将使用 AI 生成的 " + count + " 项分类替换当前分类目录。这不是在给已有视频重新分类，手动确认的视频分类不会被覆盖。",
      confirmLabel: "确认替换"
    });
    if (!confirmed) {
      categoryGeneration.message = "已取消替换分类目录。";
      setStatus(categoryGeneration.message);
      renderEditorOnly();
      return false;
    }
    setStatus("正在导入并替换分类目录…");
    const result = await send({
      type: message.IMPORT_CATEGORIES,
      payload,
      source,
      skipAutoClassify: onboardingActive()
    });
    categoryDraft = null;
    categoryDraftDirty = false;
    categoryGeneration.importText = "";
    categoryGeneration.message = sourceLabel + " 已生成新的分类目录。";
    if (onboardingActive()) {
      await handleOnboardingCategoryImport(result, sourceLabel);
    } else {
      updateState(result);
      const imported = result.categoryImportResult || {};
      setStatus(sourceLabel + " 已替换分类目录：" + (imported.imported || state.categories.length) + " 项；手动确认的视频分类未改变");
    }
    return true;
  }

  function addCategory() {
    harvestCategoryDraft();
    const parent = document.querySelector('[data-role="new-category-parent"]');
    const input = document.querySelector('[data-role="new-category-name"]');
    const name = core.normalizeText(input ? input.value : "");
    if (!core.normalizeText(name)) {
      setStatus("请输入新分类名称");
      return;
    }
    const draft = ensureCategoryDraft();
    const parentId = parent ? parent.value : "";
    const id = core.categoryIdFromName(parentId, name, draft);
    const siblings = draft.filter((category) => (category.parentId || "") === parentId);
    const order = siblings.reduce((max, category) => Math.max(max, Number(category.order) || 0), 0) + 10;
    draft.push({ id, name, parentId: parentId || undefined, order, keywords: [], enabled: true });
    categoryDraftDirty = true;
    newCategoryDraft = { name: "", parent: parentId };
    setStatus("已加入分类草稿：" + name + "；点击“确定保存”后生效");
    renderEditorOnly();
  }

  async function deleteCategory(categoryId) {
    harvestCategoryDraft();
    const draft = ensureCategoryDraft();
    const category = draft.find((item) => item.id === categoryId);
    const label = category ? categoryLabel(category) : categoryId;
    const confirmed = await confirmAction({
      title: "删除分类？",
      message: "将从草稿中删除「" + label + "」及其子分类，保存分类目录后才会生效。",
      confirmLabel: "删除"
    });
    if (!confirmed) return;
    const removeIds = new Set(core.descendantsOf(categoryId, draft));
    categoryDraft = draft.filter((item) => !removeIds.has(item.id));
    categoryDraftDirty = true;
    setStatus("已从草稿删除分类：" + label + "；尚未保存");
    renderEditorOnly();
  }

  async function saveCategoryDraft() {
    harvestCategoryDraft();
    const categories = ensureCategoryDraft();
    if (!categories.length) {
      setStatus("至少保留一个分类");
      return;
    }
    setStatus("正在保存分类并判定新增分类...");
    try {
      const result = await send({
        type: message.SAVE_CATEGORIES,
        categories,
        skipAutoClassify: onboardingActive() && onboardingStage() === "setup-categories"
      });
      const saved = result.categorySaveResult || {};
      const keyword = saved.keywordResult || {};
      if (activeFilter.categoryIds.some((id) => (saved.removedCategoryIds || []).includes(id))) {
        activeFilter = { categoryIds: [], includeUnclassified: false, includeRemoved: false, sourceCategoryId: "" };
      }
      categoryDraft = null;
      categoryDraftDirty = false;
      updateState(result);
      const keywordText = keyword.skipped
        ? "首次引导阶段暂不判定视频"
        : "已对全部 " + (keyword.checked || 0) + " 个视频进行新增目录的初步分类（包括手动确认和 AI 分类），命中 " + (keyword.matchedVideos || 0) + " 个视频";
      setStatus("分类目录已保存；" + keywordText + "。如需对视频进行细分类，可使用 AI (API) 或 AI (手动导入/导出) 批量视频分类。" );
    } catch (error) {
      setStatus("分类保存失败：" + error.message);
    }
  }

  function discardCategoryDraft() {
    categoryDraft = null;
    categoryDraftDirty = false;
    setStatus("已放弃未保存的分类修改");
    renderEditorOnly();
  }

  function ensureCategoryDraft() {
    if (!categoryDraft) {
      categoryDraft = state.categories
        .filter((category) => category.enabled !== false)
        .map((category) => Object.assign({}, category, { keywords: core.uniqueStrings(category.keywords) }));
      // Older deep branches are lifted in the draft, preserving IDs and video assignments.
      const rows = flattenCategoriesInTree(categoryDraft);
      const levelTwo = new Map();
      rows.forEach(({ category, level }) => {
        if (level === 1) levelTwo.set(category.id, category.id);
        else if (level > 1) {
          const parentId = levelTwo.get(category.parentId);
          if (parentId) {
            levelTwo.set(category.id, parentId);
            if (level > 2) { category.parentId = parentId; categoryDraftDirty = true; }
          }
        }
      });
    }
    return categoryDraft;
  }

  function harvestCategoryDraft() {
    if (!categoryDraft) return;
    categoryDraft.forEach((category) => {
      const nameInput = findByRoleAndCategory("category-name", category.id);
      if (nameInput) category.name = nameInput.value;
    });
  }

  async function removeFromWatchlater(bvid) {
    if (pendingRemovalBvids.has(bvid)) return;
    const videoIndex = state.videos.findIndex((item) => item.bvid === bvid);
    const video = state.videos[videoIndex];
    if (!video) return;
    const previousVideo = Object.assign({}, video);
    const priorMembership = trackedWatchlaterMembership.get(bvid);
    const previousRevision = video.watchlaterMembershipRevision || 0;
    trackedWatchlaterMembership.set(bvid, { revision: previousRevision, present: true });
    pendingRemovalBvids.add(bvid);
    video.presentInWatchlater = false;
    selectedBvids.delete(bvid);
    if (selectedBvid === bvid) {
      selectedBvid = "";
    }
    renderShell({ animateCards: true });
    setStatus("已从列表移除，正在向 B站确认：" + core.truncateText(video.title || bvid, 30));
    try {
      const result = await send({
        type: message.REMOVE_FROM_WATCHLATER,
        bvid
      });
      pendingRemovalBvids.delete(bvid);
      const revision = result.removeResult?.watchlaterMembershipRevision ?? previousRevision + 1;
      if (revision >= trackedWatchlaterMembership.get(bvid).revision) {
        trackedWatchlaterMembership.set(bvid, { revision, present: false });
      }
      updateState(result);
      setStatus("B站已确认移出：" + core.truncateText(video.title || bvid, 30));
    } catch (error) {
      pendingRemovalBvids.delete(bvid);
      const current = state.videos.find((item) => item.bvid === bvid);
      const membership = trackedWatchlaterMembership.get(bvid);
      const present = membership.present;
      if (!priorMembership && membership.revision === previousRevision) trackedWatchlaterMembership.delete(bvid);
      if (current) {
        current.presentInWatchlater = present;
      } else {
        state.videos.splice(Math.max(0, videoIndex), 0, previousVideo);
      }
      renderShell({ animateCards: true });
      setStatus((present ? "移出失败，视频已恢复：" : "移出结果需要重新同步确认：") + error.message);
    }
  }

  async function saveManualClassification(bvid) {
    const categoryIds = Array.from(document.querySelectorAll('[data-role="manual-category"]:checked')).map((item) => item.value);
    setStatus("正在保存手动确认…");
    try {
      updateState(await send({
        type: message.SAVE_MANUAL_CLASSIFICATION,
        bvid,
        categoryIds
      }));
      closeModal();
      setStatus("已保存手动确认：" + bvid);
      await finishClassification("手动确认已保存");
    } catch (error) {
      setStatus("保存失败：" + error.message);
    }
  }

  function visibleVideos() {
    const classifications = classificationMap();
    const query = core.normalizeText(searchText).toLowerCase();
    const filter = Object.assign({}, activeFilter, { videoFilter });
    return presentVideos()
      .filter((video) => core.matchesFilter(
        video,
        classifications.get(video.bvid),
        filter
      ))
      .filter((video) => {
        if (!query) return true;
        let haystack = searchIndex.get(video);
        if (haystack === undefined) {
          haystack = [
            video.bvid,
            video.title,
            video.upName,
            video.tname,
            (video.tags || []).join(" "),
            video.desc
          ].join(" ").toLowerCase();
          searchIndex.set(video, haystack);
        }
        return haystack.includes(query);
      })
      .sort(compareVideos);
  }

  function compareVideos(a, b) {
    if (randomOrder) {
      const rankDifference = (randomOrder.get(a.bvid) ?? Number.MAX_SAFE_INTEGER) - (randomOrder.get(b.bvid) ?? Number.MAX_SAFE_INTEGER);
      return rankDifference || compareWatchlaterOrder(a, b);
    }
    const sorting = currentSort || state.settings;
    const mode = sorting.sortMode || "watchlater";
    const desc = (sorting.sortDirection || "desc") === "desc";
    if (mode === "pubdate") {
      return compareNumber(a.pubdate, b.pubdate, desc) || compareWatchlaterOrder(a, b);
    }
    if (mode === "duration") {
      return compareNumber(a.duration, b.duration, desc) || compareWatchlaterOrder(a, b);
    }
    return compareWatchlaterOrder(a, b, desc);
  }

  function compareWatchlaterOrder(a, b, desc) {
    const newestFirst = desc !== false;
    const aOrder = Number.isFinite(Number(a.watchlaterOrder)) ? Number(a.watchlaterOrder) : Number.POSITIVE_INFINITY;
    const bOrder = Number.isFinite(Number(b.watchlaterOrder)) ? Number(b.watchlaterOrder) : Number.POSITIVE_INFINITY;
    return (newestFirst ? aOrder - bOrder : bOrder - aOrder) ||
      compareNumber(a.watchlaterAddedAt, b.watchlaterAddedAt, newestFirst) ||
      compareNumber(a.firstSeenAt, b.firstSeenAt, newestFirst) ||
      compareNumber(a.lastSeenAt, b.lastSeenAt, newestFirst) ||
      (a.title || "").localeCompare(b.title || "");
  }

  function shuffledVideos(videos, random = Math.random) {
    const shuffled = videos.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // A click should visibly change the order when there are at least two videos.
    if (shuffled.length > 1 && shuffled.every((video, index) => video.bvid === videos[index].bvid)) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    return shuffled;
  }

  function shuffleVideos() {
    sortRequest++;
    const visible = visibleVideos();
    if (visible.length < 2) {
      setStatus("至少需要两个视频才能乱序");
      return;
    }
    const shuffled = shuffledVideos(visible);
    const visibleIds = new Set(visible.map((video) => video.bvid));
    const remaining = presentVideos().filter((video) => !visibleIds.has(video.bvid)).sort(compareVideos);
    randomOrder = new Map(shuffled.concat(remaining).map((video, index) => [video.bvid, index]));
    renderVideoResults("sort");
    setStatus("已随机排列 " + visible.length + " 个视频；可刷新乱序或退出并恢复默认排序");
  }

  function compareNumber(a, b, desc) {
    const left = Number(a) || 0;
    const right = Number(b) || 0;
    return desc ? right - left : left - right;
  }

  function presentVideos() {
    return (state.videos || []).filter((video) => video.presentInWatchlater !== false);
  }

  function classificationMap() {
    if (classificationIndexSource !== state.classifications) {
      classificationIndexSource = state.classifications;
      classificationIndex = new Map((state.classifications || []).map(item => [item.bvid, item]));
    }
    return classificationIndex;
  }

  function categoryMap() {
    if (categoryIndexSource !== state.categories) {
      categoryIndexSource = state.categories;
      categoryIndex = core.categoryById(state.categories);
    }
    return categoryIndex;
  }

  function categoryCounts() {
    const byCategory = new Map();
    const categories = categoryMap();
    const classifications = classificationMap();
    let unclassified = 0;
    presentVideos().forEach((video) => {
      const classification = classifications.get(video.bvid);
      if (core.needsLlmExport(video, classification)) {
        unclassified += 1;
      }
      const seen = new Set();
      (classification && classification.categoryIds || []).forEach((categoryId) => {
        let current = categories.get(categoryId);
        while (current && !seen.has(current.id)) {
          seen.add(current.id);
          current = current.parentId ? categories.get(current.parentId) : null;
        }
      });
      for (const id of seen) byCategory.set(id, (byCategory.get(id) || 0) + 1);
    });
    return { byCategory, unclassified };
  }

  function countNeedsClassification() {
    const classifications = classificationMap();
    return presentVideos().filter((video) => core.needsLlmExport(video, classifications.get(video.bvid))).length;
  }

  function categoryFilter(categoryId = "", pending = false) {
    return {
      categoryIds: categoryId ? expandCategoryIds([categoryId]) : [],
      includeUnclassified: pending,
      includeRemoved: false,
      sourceCategoryId: categoryId
    };
  }

  function expandCategoryIds(categoryIds) {
    const expanded = new Set();
    (categoryIds || []).forEach((categoryId) => {
      core.descendantsOf(categoryId, state.categories).forEach((id) => expanded.add(id));
    });
    return Array.from(expanded);
  }

  function categoryLabel(category) {
    return core.categoryPath(category, categoryMap()) || category.name || category.id;
  }

  function flattenCategoriesInTree(categories) {
    const rows = [];
    appendCategoryRows(rows, "", 0, categories || state.categories);
    return rows;
  }

  function categoryPanelGroups(categories) {
    const groups = [];
    flattenCategoriesInTree(categories).forEach(row => {
      if (row.level === 0) groups.push([]);
      groups[groups.length - 1].push(row);
    });
    return groups;
  }

  function setupCategoryPanels() {
    if (typeof ResizeObserver === "undefined") return;
    categoryPanelObserver?.disconnect();
    cancelAnimationFrame(categoryPanelFrame);
    const grids = Array.from(document.querySelectorAll(".category-panel-grid"));
    const layout = () => {
      categoryPanelFrame = 0;
      const measurements = [];
      grids.forEach(grid => {
        if (!grid.clientWidth) return;
        const style = getComputedStyle(grid);
        const step = parseFloat(style.gridAutoRows) + parseFloat(style.rowGap);
        Array.from(grid.children).forEach(panel => {
          const span = Math.ceil((panel.offsetHeight + parseFloat(style.rowGap)) / step);
          if (span > 0) measurements.push([panel, "span " + span]);
        });
      });
      measurements.forEach(([panel, value]) => {
        if (panel.style.gridRowEnd !== value) panel.style.gridRowEnd = value;
      });
    };
    categoryPanelObserver = new ResizeObserver(() => {
      if (!categoryPanelFrame) categoryPanelFrame = requestAnimationFrame(layout);
    });
    grids.forEach(grid => {
      categoryPanelObserver.observe(grid);
      Array.from(grid.children).forEach(panel => categoryPanelObserver.observe(panel));
    });
    layout();
  }

  function refreshDirectoryNames() {
    const rows = flattenCategoriesInTree(ensureCategoryDraft());
    const byId = new Map(rows.map(row => [row.category.id, row]));
    document.querySelectorAll('[data-role="category-parent"], [data-role="new-category-parent"]').forEach(select => {
      Array.from(select.options).forEach(option => {
        const row = byId.get(option.value);
        if (row) option.textContent = categoryTreeLabel(row.category, row.level);
      });
    });
    document.querySelectorAll('[data-directory-category]').forEach(node => {
      const category = byId.get(node.dataset.directoryCategory)?.category;
      if (!category) return;
      node.querySelector('[data-role="category-name"]').setAttribute("aria-label", "分类名称：" + category.name);
      node.querySelector('[data-role="category-parent"]').setAttribute("aria-label", "上级分类：" + category.name);
      node.querySelector('[data-directory-drag]').title = "拖动“" + category.name + "”调整顺序或层级";
      const remove = node.querySelector('[data-action="delete-category"]');
      remove.title = "从草稿删除“" + category.name + "”及其子分类";
      remove.setAttribute("aria-label", "删除分类“" + category.name + "”");
      if (!category.parentId) node.closest(".category-panel").setAttribute("aria-label", category.name);
    });
    document.querySelectorAll('.category-admin-row[data-directory-drop]').forEach(zone => {
      const row = byId.get(zone.dataset.directoryCategory);
      if (!row) return;
      zone.title = row.level === 2
        ? "拖到上半行或下半行，放到“" + row.category.name + "”之前或之后"
        : "拖到中部放入“" + row.category.name + "”；拖到上沿或下沿调整顺序";
    });
  }

  function directoryDropZone(parentId, beforeId, label, level, kind = "insert") {
    return el("div", {
      className: "directory-drop-zone directory-drop-" + kind,
      title: label, textContent: label,
      style: "--category-level:" + Math.min(level, 4) + ";",
      dataset: { directoryDrop: "true", parentId, beforeId }
    });
  }

  // Move the whole subtree; sibling order is explicit and saved with the draft.
  function directoryMoveTargets(categories, id) {
    const rows = flattenCategoriesInTree(categories);
    const byId = new Map(rows.map(row => [row.category.id, row]));
    const source = byId.get(id);
    if (!source) return new Map();
    const descendants = new Set(core.descendantsOf(id, categories));
    const subtreeHeight = Math.max(...rows.filter(row => descendants.has(row.category.id)).map(row => row.level - source.level));
    const targets = new Map([["", ""]]);
    rows.forEach(({ category, level }) => {
      if (descendants.has(category.id)) return;
      let parent = category;
      let parentLevel = level;
      while (parent && parentLevel + 1 + subtreeHeight > 2) {
        parent = byId.get(parent.parentId)?.category;
        parentLevel--;
      }
      if (!parent || !descendants.has(parent.id)) targets.set(category.id, parent?.id || "");
    });
    return targets;
  }

  function moveDirectoryCategory(categories, id, parentId = "", beforeId = "") {
    const category = categories.find(item => item.id === id);
    const descendants = new Set(core.descendantsOf(id, categories));
    if (!category || parentId === id || descendants.has(parentId) || beforeId === id) return false;
    if (parentId && !categories.some(item => item.id === parentId)) return false;
    const resolvedParent = directoryMoveTargets(categories, id).get(parentId);
    if (resolvedParent === undefined) return false;
    if (resolvedParent !== parentId) { parentId = resolvedParent; beforeId = ""; }
    const siblings = core.childrenOf(categories, parentId).filter(item => item.id !== id);
    const index = beforeId ? siblings.findIndex(item => item.id === beforeId) : siblings.length;
    if (index < 0) return false;
    const oldParent = category.parentId || "";
    category.parentId = parentId || undefined;
    siblings.splice(index, 0, category);
    siblings.forEach((item, position) => { item.order = (position + 1) * 10; });
    if (oldParent !== parentId) core.childrenOf(categories, oldParent).forEach((item, position) => { item.order = (position + 1) * 10; });
    return true;
  }

  function startDirectoryDrag(event) {
    const handle = event.target.closest("[data-directory-drag]");
    if (!handle) return;
    harvestCategoryDraft();
    directoryDraggedId = handle.dataset.categoryId;
    directoryDragTargets = directoryMoveTargets(ensureCategoryDraft(), directoryDraggedId);
    directoryDragNodes = new Map(Array.from(app.querySelectorAll('[data-directory-category]'), node => [node.dataset.directoryCategory, node]));
    directoryDragNodes.set("", app.querySelector('.directory-drop-promote[data-parent-id=""]'));
    const rows = flattenCategoriesInTree(ensureCategoryDraft());
    const byId = new Map(rows.map(row => [row.category.id, row]));
    const siblingLists = new Map();
    rows.forEach(({ category }) => {
      const parentId = category.parentId || "";
      if (!siblingLists.has(parentId)) siblingLists.set(parentId, []);
      if (category.id !== directoryDraggedId) siblingLists.get(parentId).push(category.id);
    });
    const panels = new Map();
    const infos = new Map();
    directoryDragNodes.forEach((node, id) => {
      if (!id || !node) return;
      const { category, level } = byId.get(id);
      const siblings = siblingLists.get(category.parentId || "");
      const info = { id, level, parentId: category.parentId || "", nextId: siblings[siblings.indexOf(id) + 1] || "", node };
      infos.set(node, info);
      const panel = node.closest(".category-panel");
      if (!panels.has(panel)) panels.set(panel, []);
      const rect = node.getBoundingClientRect();
      info.top = rect.top;
      info.bottom = rect.bottom;
      panels.get(panel).push({ info, top: rect.top, bottom: rect.bottom });
    });
    const scroll = app.querySelector(".category-admin-list");
    directoryDragGeometry = { panels, infos, scroll, scrollTop: scroll.scrollTop };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", directoryDraggedId);
    const row = handle.closest(".category-admin-row");
    event.dataTransfer.setDragImage(row, 20, 16);
    row.classList.add("directory-drag-source");
    app.classList.add("directory-dragging");
  }

  function directoryRowPlan(info, fraction, targets, previousMode) {
    let mode;
    if (info.level < 2 && fraction >= (previousMode === "inside" ? .18 : .25) && fraction <= (previousMode === "inside" ? .82 : .75)) mode = "inside";
    else mode = fraction < (previousMode === "before" ? .55 : previousMode === "after" ? .45 : .5) ? "before" : "after";
    let parentId = mode === "inside" ? info.id : info.parentId;
    let beforeId = mode === "before" ? info.id : mode === "after" ? info.nextId : "";
    if (!targets.has(parentId)) return null;
    const resolved = targets.get(parentId);
    if (resolved !== parentId) { parentId = resolved; beforeId = ""; mode = "inside"; }
    return { node: info.node, parentId, beforeId, mode };
  }

  function validDirectoryDrop(event) {
    if (!directoryDraggedId) return null;
    const zone = event.target.closest("[data-directory-drop]");
    if (zone?.dataset.promoteLevel) return { node: zone, mode: "inside", promote: true };
    let info = directoryDragGeometry?.infos.get(zone);
    let fraction = .5;
    if (info) {
      const y = event.clientY + directoryDragGeometry.scroll.scrollTop - directoryDragGeometry.scrollTop;
      fraction = (y - info.top) / (info.bottom - info.top);
    } else {
      const panel = event.target.closest(".directory-panels .category-panel");
      const rows = directoryDragGeometry?.panels.get(panel);
      if (rows?.length) {
        const y = event.clientY + directoryDragGeometry.scroll.scrollTop - directoryDragGeometry.scrollTop;
        // Hit the nearest full row, including the gaps around it.
        let low = 0, high = rows.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (y < (rows[mid].bottom + rows[mid + 1].top) / 2) high = mid;
          else low = mid + 1;
        }
        const row = rows[low];
        info = row.info;
        fraction = (y - row.top) / (row.bottom - row.top);
      }
    }
    if (info) {
      if (info.id === directoryDraggedId) return null;
      const plan = directoryRowPlan(info, fraction, directoryDragTargets, directoryDropPlan?.node === info.node ? directoryDropPlan.mode : null);
      if (plan?.beforeId === directoryDraggedId) return null;
      return plan;
    }
    if (!zone || !directoryDragTargets.has(zone.dataset.parentId || "")) return null;
    return { node: zone, mode: "inside", parentId: zone.dataset.parentId || "", beforeId: zone.dataset.beforeId || "" };
  }

  function clearDirectoryHighlight() {
    directoryDropActive?.classList.remove("directory-drop-active", "directory-drop-before", "directory-drop-after");
    directoryDropActive = null;
  }

  function overDirectoryDrop(event) {
    const plan = validDirectoryDrop(event);
    const highlight = plan?.mode === "inside" && plan.node.dataset.directoryCategory && plan.parentId !== plan.node.dataset.directoryCategory
      ? directoryDragNodes.get(plan.parentId) || plan.node : plan?.node;
    if (highlight !== directoryDropActive || plan?.mode !== directoryDropPlan?.mode) {
      clearDirectoryHighlight();
      directoryDropActive = highlight;
      if (highlight) highlight.classList.add(plan.mode === "inside" ? "directory-drop-active" : "directory-drop-" + plan.mode);
    }
    directoryDropPlan = plan;
    if (!plan) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function leaveDirectoryDrop(event) {
    // Child inputs and adjacent rows fire dragleave while the pointer is still
    // in the same panel. Keep the marker until the next actual hit or exit.
    const list = event.target.closest(".category-admin-list");
    if (list && event.relatedTarget && !list.contains(event.relatedTarget)) {
      clearDirectoryHighlight();
      directoryDropPlan = null;
    }
  }

  function finishDirectoryDrop(event) {
    const zone = validDirectoryDrop(event);
    if (!zone) return;
    event.preventDefault();
    const draft = ensureCategoryDraft();
    let parentId = zone.parentId || "";
    let beforeId = zone.beforeId || "";
    if (zone.promote) {
      const current = draft.find(category => category.id === directoryDraggedId);
      const parent = draft.find(category => category.id === current?.parentId);
      if (!parent) { clearDirectoryDrag(); return; }
      parentId = parent.parentId || "";
      const siblings = core.childrenOf(draft, parentId);
      beforeId = siblings[siblings.findIndex(category => category.id === parent.id) + 1]?.id || "";
    }
    const moved = moveDirectoryCategory(draft, directoryDraggedId, parentId, beforeId);
    clearDirectoryDrag();
    if (!moved) return;
    categoryDraftDirty = true;
    renderEditorOnly();
  }

  function clearDirectoryDrag() {
    directoryDraggedId = "";
    directoryDragTargets = null;
    directoryDragNodes = null;
    clearDirectoryHighlight();
    directoryDropPlan = null;
    directoryDragGeometry = null;
    app.classList.remove("directory-dragging");
    app.querySelectorAll(".directory-drag-source").forEach(node => {
      node.classList.remove("directory-drop-active", "directory-drag-source");
    });
  }

  function appendCategoryRows(rows, parentId, level, categories) {
    core.childrenOf(categories, parentId).forEach((category) => {
      rows.push({ category, level });
      appendCategoryRows(rows, category.id, level + 1, categories);
    });
  }

  function categoryLevelLabel(level) {
    return ["一级", "二级", "三级", "四级"][level] || (level + 1) + "级";
  }

  function categoryTreeLabel(category, level) {
    return categoryLevelLabel(level) + " · " + (category.name || category.id);
  }

  function categoryBadgeNodes(classification) {
    const byId = categoryMap();
    return ((classification && classification.categoryIds) || [])
      .map((id) => byId.get(id))
      .filter(category => category && category.enabled !== false)
      .map((category) => el("span", {
        className: "badge",
        style: categoryStyle(category, "badge"),
        title: core.categoryPath(category, byId) || category.name,
        textContent: category.name || category.id
      }));
  }

  function activeFilterLabel() {
    let categoryText = "全部视频";
    if (activeFilter.includeUnclassified) {
      categoryText = "待精细分类";
    } else if (activeFilter.categoryIds.length) {
      const ids = activeFilter.sourceCategoryId ? [activeFilter.sourceCategoryId] : activeFilter.categoryIds;
      const names = ids
        .map((id) => state.categories.find((category) => category.id === id))
        .filter(Boolean)
        .map((category) => category.name);
      categoryText = names.slice(0, 3).join("、") + (names.length > 3 ? " 等" : "");
    }
    const videoText = videoFilter && core.VIDEO_FILTER_OPTIONS.find(([value]) => value === videoFilter);
    return categoryText + (videoText ? " · " + videoText[1] : "");
  }

  function defaultOpeningCategory(settings = state.settings) {
    return core.normalizeOpeningCategory(settings.defaultOpeningCategory, state.categories);
  }

  function openingCategoryOptions(current) {
    return [
      option("", "全部视频", current),
      option("pending", "待精细分类", current),
      ...flattenCategoriesInTree().map(({ category }) => option("category:" + category.id, categoryLabel(category), current))
    ];
  }

  function defaultVideoFilter(settings = state.settings) {
    return core.VIDEO_FILTER_OPTIONS.find(([value]) => value === settings.defaultVideoFilter)?.[0] ?? "";
  }

  function videoFilterOptions(current = videoFilter ?? "") {
    return core.VIDEO_FILTER_OPTIONS.map(([value, label]) => option(value, label, current));
  }

  function statusText() {
    if (statusNotice.text) return statusNotice.text;
    if (state.progress && state.progress.message) {
      return state.progress.message + (state.progress.pending ? " · 待处理 " + state.progress.pending : "");
    }
    return "同步完成 · 共 " + presentVideos().length + " 个视频";
  }

  function setStatus(textValue) {
    statusNotice = { text: textValue || "", kind: statusKind(textValue) };
    recordOperationLog(statusNotice);
    noticeExpiresAt = Date.now() + (statusNotice.kind === "error" ? 8000 : 5000);
    clearTimeout(noticeTimer);
    updateStatusSurface();
    noticeTimer = setTimeout(() => {
      noticeExpiresAt = 0;
      updateStatusSurface();
    }, statusNotice.kind === "error" ? 8000 : 5000);
  }

  function readOperationLogs() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(OPERATION_LOG_KEY) || "[]");
      if (!Array.isArray(stored)) throw new Error("Invalid operation log");
      operationLogError = "";
      const entries = stored.concat(operationLogs)
        .filter((entry) => entry && Number.isFinite(entry.time) && typeof entry.text === "string");
      return Array.from(new Map(entries.map((entry) => [JSON.stringify([entry.time, entry.kind, entry.text]), entry])).values())
        .sort((a, b) => a.time - b.time).slice(-OPERATION_LOG_LIMIT);
    } catch {
      operationLogError = "无法读取本地日志；本次记录仍会显示在这里。";
      return operationLogs;
    }
  }

  function redactLogText(value) {
    let textValue = String(value || "");
    const configs = [state.settings, apiSettingsDraft];
    configs.forEach((config) => {
      [config && config.llmApiKey, config && config.jevApiKey].filter(Boolean).forEach((secret) => {
        textValue = textValue.split(secret).join("[已隐藏密钥]");
      });
    });
    return textValue.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [已隐藏密钥]")
      .replace(/sk-[a-zA-Z0-9_-]+/g, "[已隐藏密钥]").slice(0, 1000);
  }

  function recordOperationLog(notice) {
    if (!notice.text) return;
    const textValue = redactLogText(notice.text);
    // Re-read before appending so another open dashboard's recent entries survive.
    operationLogs = readOperationLogs();
    const previous = operationLogs[operationLogs.length - 1];
    if (previous && previous.text === textValue && previous.kind === notice.kind) return;
    operationLogs = operationLogs.concat({ time: Date.now(), kind: notice.kind, text: textValue })
      .slice(-OPERATION_LOG_LIMIT);
    try {
      window.localStorage.setItem(OPERATION_LOG_KEY, JSON.stringify(operationLogs));
      operationLogError = "";
    } catch {
      operationLogError = "日志保存失败，本次记录仅在当前页面保留。";
    }
    updateOperationLogSurface();
  }

  function renderOperationLogSection() {
    return el("section", { className: "settings-subfold", dataset: { fold: "operation-log" } }, [
      el("div", { className: "settings-subbody" }, [
        el("p", { className: "sub", textContent: "自动保存在本机，保留最近 200 条操作反馈，最新记录在上方。" }),
        el("p", { className: "operation-log-error", dataset: { role: "operation-log-error" }, textContent: operationLogError }),
        renderOperationLogList()
      ])
    ]);
  }

  function renderOperationLogList() {
    const labels = { info: "提示", running: "进行中", success: "完成", error: "失败" };
    return el("ol", { className: "operation-log-list", dataset: { role: "operation-log-list" }, "aria-label": "操作日志" },
      operationLogs.length ? operationLogs.slice().reverse().map((entry) => el("li", {
        className: "operation-log-entry log-" + (Object.hasOwn(labels, entry.kind) ? entry.kind : "info")
      }, [
        el("div", { className: "operation-log-meta" }, [
          el("span", { textContent: labels[entry.kind] || labels.info }),
          el("time", { textContent: new Date(entry.time).toLocaleString("zh-CN", { hour12: false }) })
        ]),
        el("p", { textContent: entry.text })
      ])) : [el("li", { className: "sub", textContent: "暂无操作记录" })]);
  }

  function updateOperationLogSurface() {
    const list = document.querySelector('[data-role="operation-log-list"]');
    if (list) {
      const scrollTop = list.scrollTop;
      const next = renderOperationLogList();
      list.replaceWith(next);
      next.scrollTop = scrollTop;
    }
    const error = document.querySelector('[data-role="operation-log-error"]');
    if (error) error.textContent = operationLogError;
  }

  function positionStatusNotice() {
    const surface = document.querySelector('[data-role="status-surface"]');
    const toolbar = document.querySelector(".topbar");
    if (surface?.style && toolbar) {
      surface.style.setProperty("--notice-top", Math.max(16, toolbar.getBoundingClientRect().bottom + 12) + "px");
    }
  }

  function scheduleStatusPosition() {
    if (noticePositionFrame) return;
    noticePositionFrame = requestAnimationFrame(() => {
      noticePositionFrame = 0;
      positionStatusNotice();
    });
  }

  function observeStatusPosition() {
    noticeLayoutObserver?.disconnect();
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      noticeLayoutObserver = new ResizeObserver(positionStatusNotice);
      noticeLayoutObserver.observe(topbar);
    }
    positionStatusNotice();
  }

  function updateStatusSurface() {
    positionStatusNotice();
    const textValue = statusText();
    const kind = statusNotice.text ? statusNotice.kind : statusKind(textValue);
    const surface = document.querySelector('[data-role="status-surface"]');
    const node = document.querySelector('[data-role="status"]');
    const icon = document.querySelector('[data-role="status-icon"]');
    if (node) node.textContent = textValue;
    if (surface) {
      surface.hidden = Date.now() >= noticeExpiresAt;
      if (surface.hidden) surface.hidePopover?.();
      else if (!surface.matches?.(":popover-open")) surface.showPopover?.();
      const className = "activity-status feedback-notice status-" + kind;
      if (surface.className !== className) {
        surface.className = className;
        globalThis.BiliWLAura?.refresh();
      }
    }
    if (icon) icon.replaceChildren(statusIcon(kind));
  }

  function renderFeedbackAura(seed) {
    const aura = renderCategoryAura("large", seed);
    aura.className += " feedback-aura";
    return aura;
  }

  function renderFeedbackNotice(className, message) {
    return el("div", { className: className + " feedback-notice status-" + statusKind(message), role: "status" }, [
      renderFeedbackAura(className),
      el("span", { className: "feedback-notice-copy", textContent: message })
    ]);
  }

  function statusKind(textValue) {
    const value = String(textValue || "");
    if (/失败|错误|无法|缺少|未登录|不可用|超时/.test(value)) return "error";
    if (/正在|排队|请等待|启动中|处理中|更新中/.test(value)) return "running";
    if (/完成|成功|已同步|已保存|已移出|已确认移出|已生成|已复制|已导入|已定位|没有缺失/.test(value)) return "success";
    return "info";
  }

  function coverNode(video, className) {
    if (video && video.coverUrl) {
      const original = video.coverUrl.startsWith("//") ? "https:" + video.coverUrl : video.coverUrl;
      const coverKey = globalThis.BiliWLCoverCache?.key(original);
      return el("img", {
        className, loading: "lazy", decoding: "async", fetchpriority: "low", referrerpolicy: "no-referrer",
        dataset: coverKey ? { coverOriginal: original, coverKey } : { coverOriginal: original },
        ...(coverKey ? {} : { src: core.coverThumbnailUrl(original) }), alt: ""
      });
    }
    return el("div", { className: className + " placeholder", "aria-hidden": "true" });
  }

  function renderCover(video) {
    const watchProgress = videoWatchProgress(video);
    const duration = Number(video && video.duration) || 0;
    const progressPercent = duration > 0 && watchProgress > 0 ? Math.min(100, watchProgress / duration * 100) : 0;
    return el("div", { className: "cover-wrap" }, [
      coverNode(video, "cover"),
      el("span", { className: "cover-state", textContent: video?.coverUrl ? "正在加载封面" : "暂无封面" }),
      Number(video && video.viewCount) >= 0 ? el("span", { className: "view-count-badge" }, [
        iconNode("play"),
        el("span", { textContent: formatViewCount(video.viewCount) })
      ]) : null,
      duration ? el("span", {
        className: "duration-badge",
        textContent: watchProgress > 0 ? formatDuration(watchProgress) + "/" + formatDuration(duration) : formatDuration(duration)
      }) : null,
      progressPercent > 0 ? el("span", { className: "watch-progress", "aria-hidden": "true" }, [
        el("span", { className: "watch-progress-value", style: "width:" + progressPercent.toFixed(2) + "%;" })
      ]) : null
    ].filter(Boolean));
  }

  function videoWatchProgress(video) {
    const duration = Number(video && video.duration) || 0;
    if (video && video.isWatched && duration > 0) return duration;
    const progress = Number(video && video.watchProgress);
    if (!Number.isFinite(progress) || progress <= 0) return 0;
    return duration > 0 ? Math.min(progress, duration) : progress;
  }

  function formatViewCount(value) {
    const count = Math.max(0, Number(value) || 0);
    if (count >= 100000000) return trimCount(count / 100000000) + "亿";
    if (count >= 10000) return trimCount(count / 10000) + "万";
    return Math.floor(count).toLocaleString("zh-CN");
  }

  function trimCount(value) {
    return value >= 100 ? String(Math.floor(value)) : value.toFixed(1).replace(/\.0$/, "");
  }

  function statusLabel(status) {
    const labels = {
      unclassified: "分类异常",
      stale: "建议重新分类",
      low_confidence: "结果不确定",
      manual: "手动确认",
      llm: "AI 分类",
      keyword: "初步分类",
      classified: "已分类"
    };
    return labels[status] || status || "分类异常";
  }

  function sourceLabel(sourceType) {
    const labels = {
      manual: "手动确认",
      llm: "AI 分类",
      keyword: "初步分类"
    };
    return labels[sourceType] || sourceType || "";
  }

  function formatDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return "";
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    const rest = Math.floor(value % 60);
    return hours > 0
      ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0")
      : minutes + ":" + String(rest).padStart(2, "0");
  }

  function formatDate(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "";
    const ms = value < 100000000000 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    return "发布 " + date.toLocaleDateString("zh-CN");
  }

  function formatSettingsTime(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "尚未运行";
    const date = new Date(value < 100000000000 ? value * 1000 : value);
    if (Number.isNaN(date.getTime())) return "尚未运行";
    return date.toLocaleString("zh-CN");
  }

  function formatWatchlaterDate(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return "";
    const ms = value < 100000000000 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "";
    return "添加 " + date.toLocaleDateString("zh-CN");
  }

  function sortOptions(current = sortComboValue(), includeRandom = Boolean(randomOrder)) {
    return [
      ...(includeRandom ? [option("random", "随机排序", current)] : []),
      option("watchlater:desc", "添加时间-降序", current),
      option("watchlater:asc", "添加时间-升序", current),
      option("pubdate:desc", "发布时间-降序", current),
      option("pubdate:asc", "发布时间-升序", current),
      option("duration:desc", "视频时长-降序", current),
      option("duration:asc", "视频时长-升序", current)
    ];
  }

  function sortComboValue() {
    if (randomOrder) return "random";
    const sorting = currentSort || state.settings;
    const parsed = parseSortCombo(sorting.sortMode + ":" + sorting.sortDirection);
    return parsed.sortMode + ":" + parsed.sortDirection;
  }

  function defaultSortValue(settings = state.settings) {
    const parsed = parseSortCombo(settings.sortMode + ":" + settings.sortDirection);
    return parsed.sortMode + ":" + parsed.sortDirection;
  }

  function parseSortCombo(value) {
    const parts = String(value || "").split(":");
    const sortMode = ["watchlater", "pubdate", "duration"].includes(parts[0]) ? parts[0] : "watchlater";
    const sortDirection = parts[1] === "asc" ? "asc" : "desc";
    return { sortMode, sortDirection };
  }

  function option(value, label, current) {
    return el("option", { value, textContent: label, selected: value === current });
  }

  function renderCategoryAdminRow(category, level, categories) {
    const descendants = new Set(core.descendantsOf(category.id, categories));
    const targets = directoryMoveTargets(categories, category.id);
    const options = [el("option", {
      value: "",
      textContent: "无上级（一级分类）",
      selected: !category.parentId
    })].concat(flattenCategoriesInTree(categories)
      .filter((row) => row.level < 2 && row.category.id !== category.id && !descendants.has(row.category.id) && targets.get(row.category.id) === row.category.id)
      .map((row) => el("option", {
        value: row.category.id,
        textContent: categoryTreeLabel(row.category, row.level),
        selected: (category.parentId || "") === row.category.id
      })));
    return el("div", {
      className: "category-admin-row" + (level === 0 ? " category-admin-root" : ""),
      style: "--category-level:" + Math.min(level, 4) + ";",
      title: level === 2 ? "拖到此行上半部或下半部：插入到此分类前后" : "拖到名称中央：放入此分类末尾；拖到上下边缘：插入到此分类前后",
      dataset: { directoryCategory: category.id, level: String(level), directoryDrop: "true", parentId: category.id, beforeId: "" }
    }, [
      el("span", {
        className: "directory-move-handle", draggable: true,
        title: "拖动“" + category.name + "”调整顺序或层级",
        dataset: { directoryDrag: "true", categoryId: category.id }
      }, [iconNode("grip")]),
      el("div", { className: "category-admin-name" }, [
        el("input", { type: "text", value: category.name, title: categoryLevelLabel(level) + " · " + category.name, "aria-label": "分类名称：" + category.name, dataset: { role: "category-name", categoryId: category.id } })
      ]),
      el("button", {
        className: "category-delete-button", title: "从草稿删除“" + category.name + "”及其子分类",
        "aria-label": "删除分类“" + category.name + "”",
        dataset: { action: "delete-category", categoryId: category.id }
      }, [iconNode("trash")]),
      el("details", { className: "directory-row-options" }, [
        el("summary", { title: "调整上级", "aria-label": "调整上级：" + category.name }, [iconNode("chevron")]),
        el("select", { "aria-label": "上级分类：" + category.name, dataset: { role: "category-parent", categoryId: category.id } }, options)
      ])
    ]);
  }

  function findByRoleAndCategory(role, categoryId) {
    return Array.from(document.querySelectorAll('[data-role="' + role + '"]'))
      .find((node) => node.dataset.categoryId === categoryId);
  }

  function nodeByRole(role) {
    return document.querySelector('[data-role="' + role + '"]');
  }

  function valueByRole(role) {
    const node = nodeByRole(role);
    return node ? node.value : "";
  }

  function numberByRole(role, fallback) {
    return core.finiteNumberOrNull(valueByRole(role)) ?? fallback;
  }

  function checkedByRole(role) {
    const node = nodeByRole(role);
    return Boolean(node && node.checked);
  }

  function manualExportLimit() {
    const number = numberByRole("manual-export-limit", state.settings.manualExportLimit ?? state.settings.batchSize ?? 80);
    return Math.min(500, Math.max(0, Math.floor(number)));
  }

  function categoryStyle(category, kind) {
    if (kind === "swatch") return "background:" + core.categoryColorTokens(state.categories, category).accent + ";";
    if (kind === "badge") {
      const tone = core.categoryColorTokens(state.categories, category);
      return "background:" + tone.bg + ";border-color:transparent;color:" + tone.text + ";";
    }
    if (kind === "option") return "background:var(--surface);color:var(--ink);";
    return "";
  }

  function rememberScrollPositions() {
    const categoryNav = document.querySelector(".cat-nav");
    const main = document.querySelector(".main");
    const editor = document.querySelector(".editor");
    if (categoryNav) {
      const height = Number(categoryNav.dataset.cycleHeight);
      savedCategoryScrollTop = height ? categoryLoopOffset(categoryNav.scrollTop, height) : categoryNav.scrollTop;
    }
    if (main) savedMainScrollTop = main.scrollTop;
    if (editor) savedEditorScrollTop = editor.scrollTop;
  }

  function restoreScrollPositions() {
    const categoryNav = document.querySelector(".cat-nav");
    const main = document.querySelector(".main");
    const editor = document.querySelector(".editor");
    if (categoryNav) setupCategoryLoop(categoryNav);
    if (main) main.scrollTop = savedMainScrollTop;
    if (editor) editor.scrollTop = savedEditorScrollTop;
  }

  function toolbarIconButton(action, label, iconName, disabled = false) {
    return el("button", {
      className: "toolbar-icon-button liquid-glass liquid-glass--simple glass-control",
      title: label,
      "aria-label": label,
      disabled,
      dataset: { action }
    }, [iconNode(iconName)]);
  }

  function scrollIconButton(action, label, iconName) {
    const button = toolbarIconButton(action, label, iconName);
    const icon = button.firstElementChild;
    icon.setAttribute("stroke-width", "2.4");
    const mask = new XMLSerializer().serializeToString(icon);
    button.style.setProperty("--scroll-icon", 'url("data:image/svg+xml,' + encodeURIComponent(mask) + '")');
    return button;
  }

  function statusIcon(kind) {
    return iconNode(kind === "running" ? "spinner" : kind);
  }

  function iconNode(name) {
    const svg = svgNode("svg", {
      viewBox: "0 0 24 24",
      class: "ui-icon",
      width: "24", height: "24", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false"
    });
    const commonStroke = {
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    };
    // Lucide SVG subset, pinned at a04f228cd01185e09c188b7227b9600c08c565ec. License: icons/lucide/LICENSE.
    const shapes = {
      "search": [["path",{"d":"m21 21-4.34-4.34"}],["circle",{"cx":"11","cy":"11","r":"8"}]],
      "sync": [["path",{"d":"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"}],["path",{"d":"M21 3v5h-5"}],["path",{"d":"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"}],["path",{"d":"M8 16H3v5"}]],
      "batch": [["path",{"d":"M13 5h8"}],["path",{"d":"M13 12h8"}],["path",{"d":"M13 19h8"}],["path",{"d":"m3 17 2 2 4-4"}],["path",{"d":"m3 7 2 2 4-4"}]],
      "settings": [["path",{"d":"M14 17H5"}],["path",{"d":"M19 7h-9"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]],
      "shuffle": [["path",{"d":"m18 14 4 4-4 4"}],["path",{"d":"m18 2 4 4-4 4"}],["path",{"d":"M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"}],["path",{"d":"M2 6h1.972a4 4 0 0 1 3.6 2.2"}],["path",{"d":"M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"}]],
      "trash": [["path",{"d":"M10 11v6"}],["path",{"d":"M14 11v6"}],["path",{"d":"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"}],["path",{"d":"M3 6h18"}],["path",{"d":"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"}]],
      "play": [["path",{"d":"M21 5H3"}],["path",{"d":"M10 12H3"}],["path",{"d":"M10 19H3"}],["path",{"d":"M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z"}]],
      "spinner": [["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]],
      "success": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m16 9-5.5 5.5L8 12"}]],
      "error": [["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"12","x2":"12","y1":"8","y2":"12"}],["line",{"x1":"12","x2":"12.01","y1":"16","y2":"16"}]],
      "info": [["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],
      "check": [["path",{"d":"M20 6 9 17l-5-5"}]],
      "grip": [["circle",{"cx":"9","cy":"5","r":"1"}],["circle",{"cx":"9","cy":"12","r":"1"}],["circle",{"cx":"9","cy":"19","r":"1"}],["circle",{"cx":"15","cy":"5","r":"1"}],["circle",{"cx":"15","cy":"12","r":"1"}],["circle",{"cx":"15","cy":"19","r":"1"}]],
      "close": [["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],
      "chevron": [["path",{"d":"m6 9 6 6 6-6"}]],
      "arrow-up": [["path",{"d":"m5 12 7-7 7 7"}],["path",{"d":"M12 19V5"}]],
      "history": [["path",{"d":"M3 12a9 9 0 1 1 9 9 9.75 9.75 0 0 1-6.74-2.74L3 15"}],["path",{"d":"M3 21v-6h6"}],["path",{"d":"M12 7v5l4 2"}]],
      bilibili: [
        ["path", Object.assign({ d: "M8.2 4 10 6.2h4L15.8 4M5.2 7.1h13.6a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2V9.1a2 2 0 0 1 2-2Z" }, commonStroke)],
        ["path", Object.assign({ d: "M8 12v2.2M16 12v2.2" }, commonStroke)]
      ],
      watchlater: [
        ["circle", Object.assign({ cx: "12", cy: "12", r: "8.5" }, commonStroke)],
        ["path", Object.assign({ d: "M12 7.5v5l3.2 1.8" }, commonStroke)]
      ],
      dynamic: [
        ["circle", Object.assign({ cx: "12", cy: "12", r: "2.2" }, commonStroke)],
        ["path", Object.assign({ d: "M12 3.5a8.5 8.5 0 0 1 8.5 8.5M3.5 12A8.5 8.5 0 0 1 12 3.5M12 20.5A8.5 8.5 0 0 1 3.5 12" }, commonStroke)],
        ["circle", { cx: "20.5", cy: "12", r: "1.3", fill: "currentColor" }]
      ],
    };
    (shapes[name] || shapes.info).forEach(([tagName, attrs]) => svg.appendChild(svgNode(tagName, attrs)));
    return svg;
  }

  function svgNode(tagName, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function confirmAction(options) {
    const settings = Object.assign({ title: "确认操作？", message: "", confirmLabel: "确认" }, options || {});
    return new Promise((resolve) => {
      const dialog = el("dialog", { className: "confirm-dialog", "aria-labelledby": "confirm-title" }, [
        el("div", { className: "confirm-dialog-body" }, [
          el("div", { className: "confirm-dialog-icon" }, [iconNode("trash")]),
          el("div", {}, [
            el("h3", { id: "confirm-title", textContent: settings.title }),
            el("p", { textContent: settings.message })
          ])
        ]),
        el("div", { className: "confirm-dialog-actions" }, [
          el("button", { className: "ghost", type: "button", dataset: { role: "confirm-cancel" }, textContent: "取消" }),
          el("button", { className: "danger confirm-danger", type: "button", dataset: { role: "confirm-submit" }, textContent: settings.confirmLabel })
        ])
      ]);
      let finished = false;
      function finish(value) {
        if (finished) return;
        finished = true;
        dialog.close();
        resolve(value);
      }
      dialog.querySelector('[data-role="confirm-cancel"]').addEventListener("click", () => finish(false));
      dialog.querySelector('[data-role="confirm-submit"]').addEventListener("click", () => finish(true));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.addEventListener("close", () => {
        dialog.remove();
        if (!finished) {
          finished = true;
          resolve(false);
        }
      });
      document.body.appendChild(dialog);
      showModalWithNotice(dialog);
      dialog.querySelector('[data-role="confirm-cancel"]').focus();
    });
  }

  function el(tagName, props, children) {
    const node = document.createElement(tagName);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === "className") node.className = value;
      else if (key === "textContent") node.textContent = value;
      else if (key === "dataset") Object.entries(value || {}).forEach(([dataKey, dataValue]) => { node.dataset[dataKey] = dataValue; });
      else if (key === "hidden") node.hidden = Boolean(value);
      else if (key === "checked") node.checked = Boolean(value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key === "selected") node.selected = Boolean(value);
      else if (key === "value") node.value = value;
      else if (key === "placeholder") node.placeholder = value;
      else if (key === "style") node.setAttribute("style", value);
      else if (key === "title") node.title = value;
      else if (key === "draggable") node.draggable = Boolean(value);
      else if (key === "type") node.type = value;
      else if (key === "href") node.href = value;
      else if (key === "target") node.target = value;
      else if (key === "src") node.src = value;
      else if (key === "alt") node.alt = value;
      else node.setAttribute(key, value);
    });
    (children || []).filter(Boolean).forEach((child) => node.appendChild(child));
    return node;
  }

  function text(value) {
    return document.createTextNode(value);
  }
})();
