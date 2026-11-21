importScripts("shared.js", "idb.js", "cover-cache.js", "cover-worker.js");

const core = globalThis.BiliWLCore;
const db = globalThis.BiliWLDB;
const CLASSIFICATION_REPAIR_VERSION = "0.2.4";
const ONBOARDING_VERSION = 1;
const AUTO_LLM_ALARM = "auto-llm-classify";
const AUTO_LLM_CONTINUE_ALARM = "auto-llm-classify-continue";
const AUTO_LLM_MAX_BATCHES_PER_WAKE = 2;
const DETAIL_ALARM = "continue-video-details";
const COMBINED_DETAILS_BACKOFF = "combined-video-details-backoff";
const DETAIL_BATCH_SIZE = 4;
const DETAIL_REQUEST_INTERVAL = 2000;
const DETAIL_BATCH_INTERVAL = 60000;
const DETAIL_ERROR_PAUSE = 15 * 60000;
const INITIAL_DETAIL_BATCH_SIZE = 20;
const INITIAL_DETAIL_REQUEST_INTERVAL = 1000;
const UNAVAILABLE_VIDEO_CODES = new Set([-404, 62002, 62004, 62012]);
const WATCHLATER_SYNC_META = "watchlater-sync";
const LIGHT_SYNC_INTERVAL = 5 * 60000;

let detailRunPromise = null;
let detailRerunRequested = false;
let classificationRepairPromise = null;
let classificationRepairDone = false;
let initializationPromise = null;
let autoLlmRunPromise = null;
let watchlaterMembershipQueue = Promise.resolve();
let watchlaterScan = null;
let progress = {
  status: "idle",
  message: "等待扫描",
  pending: 0,
  running: 0,
  done: 0,
  failed: 0,
  updatedAt: Date.now()
};

chrome.runtime.onInstalled.addListener((details) => {
  initializationPromise = initializeExtension(details)
    .catch((error) => console.warn("init failed", error))
    .finally(() => {
      initializationPromise = null;
    });
});

chrome.runtime.onStartup.addListener(() => {
  initializationPromise = initializeExtension({})
    .catch((error) => console.warn("startup init failed", error))
    .finally(() => {
      initializationPromise = null;
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm) return;
  if (alarm.name === DETAIL_ALARM) {
    startDetailQueue();
    return;
  }
  if (alarm.name === globalThis.BiliWLCoverWorker?.alarmName) {
    globalThis.BiliWLCoverWorker.start();
    return;
  }
  if (![AUTO_LLM_ALARM, AUTO_LLM_CONTINUE_ALARM].includes(alarm.name)) return;
  maybeRunAutoLlmClassification(alarm.name)
    .catch((error) => console.warn("automatic AI classification failed", error));
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message || {}, sender)
    .then((response) => sendResponse({ ok: true, data: response }))
    .catch((error) => sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }));
  return true;
});

async function handleMessage(message, sender) {
  if (message.type === "PRIORITIZE_COVERS") {
    if (sender?.url === chrome.runtime.getURL("dashboard.html")) {
      globalThis.BiliWLCoverWorker.prioritize(message.keys);
    }
    return {};
  }
  if (initializationPromise) await initializationPromise;
  await ensureConfig();
  await ensureClassificationRepair();
  switch (message.type) {
    case core.MESSAGE_TYPES.GET_STATE:
      return getState();
    case core.MESSAGE_TYPES.SCAN_WATCHLATER:
      return scanWatchlater(message);
    case core.MESSAGE_TYPES.UPSERT_VIDEO_ITEMS:
      return scanWatchlater({ domItems: message.items || [], skipAutoClassify: true });
    case core.MESSAGE_TYPES.FETCH_VIDEO_DETAILS:
      return queueMissingVideoDetails();
    case core.MESSAGE_TYPES.EXPORT_CATEGORY_PROPOSAL:
      return exportCategoryProposal(message);
    case core.MESSAGE_TYPES.IMPORT_CATEGORIES:
      return importCategories(message);
    case core.MESSAGE_TYPES.EXPORT_CLASSIFY_BATCH:
      return exportClassifyBatch(message);
    case core.MESSAGE_TYPES.IMPORT_CLASSIFICATIONS:
      return importClassifications(message.payload, message.options || {});
    case core.MESSAGE_TYPES.AUTO_CLASSIFY:
      return autoClassify(message.options || {});
    case core.MESSAGE_TYPES.CHECK_BILI_LOGIN:
      return checkBiliLogin();
    case core.MESSAGE_TYPES.SYNC_ON_OPEN:
      return syncOnOpen(message);
    case core.MESSAGE_TYPES.RESET_FOR_LLM_RECLASSIFY:
      return resetForLlmReclassify();
    case core.MESSAGE_TYPES.SAVE_MANUAL_CLASSIFICATION:
      return saveManualClassification(message);
    case core.MESSAGE_TYPES.BULK_UPDATE_CLASSIFICATIONS:
      return bulkUpdateClassifications(message);
    case core.MESSAGE_TYPES.REMOVE_FROM_WATCHLATER:
      return removeFromWatchlater(message, sender?.tab);
    case core.MESSAGE_TYPES.UPDATE_SETTINGS:
      return updateSettings(message.settings || {});
    case core.MESSAGE_TYPES.OPEN_DASHBOARD:
      await openDashboard();
      return { opened: true };
    case core.MESSAGE_TYPES.ADD_CATEGORY:
      return addCategory(message);
    case core.MESSAGE_TYPES.UPDATE_CATEGORY:
      return updateCategory(message);
    case core.MESSAGE_TYPES.DELETE_CATEGORY:
      return deleteCategory(message);
    case core.MESSAGE_TYPES.SAVE_CATEGORIES:
      return saveCategories(message);
    default:
      throw new Error("Unknown message type: " + message.type);
  }
}

async function initializeExtension(details) {
  await ensureConfig();
  await initializeOnboarding(details || {});
  await ensureClassificationRepair();
  const config = await getConfig();
  await configureAutoLlmAlarm(config.settings, false);
  if (config.settings.detailFetchEnabled && (await db.pendingJobs("detail")).length) {
    startDetailQueue();
  }
  globalThis.BiliWLCoverWorker?.start();
}

async function initializeOnboarding(details) {
  if (!details || !["install", "update"].includes(details.reason)) return;
  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {});
  if (details.reason === "install") {
    Object.assign(settings, {
      onboardingVersion: ONBOARDING_VERSION,
      onboardingEligible: true,
      onboardingCompleted: false,
      onboardingStage: "login",
      onboardingMethod: ""
    });
  } else if (!Object.prototype.hasOwnProperty.call(data.settings || {}, "onboardingVersion")) {
    Object.assign(settings, {
      onboardingVersion: ONBOARDING_VERSION,
      onboardingEligible: false,
      onboardingCompleted: true,
      onboardingStage: "complete",
      onboardingMethod: ""
    });
  } else {
    return;
  }
  await chromeStorageSet({ settings });
}

function chromeStorageGet(keys) {
  return chrome.storage.local.get(keys);
}

function chromeStorageSet(values) {
  return chrome.storage.local.set(values);
}

async function ensureConfig() {
  const data = await chromeStorageGet(["settings", "categories"]);
  const updates = {};
  if (!data.settings) {
    updates.settings = Object.assign({}, core.DEFAULT_SETTINGS);
  } else {
    if (Object.keys(core.DEFAULT_SETTINGS).some(key => !Object.prototype.hasOwnProperty.call(data.settings, key))) {
      updates.settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings);
    }
  }
  if (!Array.isArray(data.categories) || !data.categories.length) {
    updates.categories = core.DEFAULT_CATEGORIES.map((category) => Object.assign({}, category));
  } else if (data.categories.some((category) => category.id === "other.todo" && category.name === "待整理")) {
    updates.categories = data.categories.map((category) => category.id === "other.todo" && category.name === "待整理"
      ? Object.assign({}, category, { name: "暂未归类" }) : category);
  }
  if (Object.keys(updates).length) {
    await chromeStorageSet(updates);
  }
  return {
    settings: updates.settings || data.settings,
    categories: updates.categories || data.categories
  };
}

async function getConfig() {
  return ensureConfig();
}

async function ensureClassificationRepair() {
  if (classificationRepairDone) return;
  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {});
  if (settings.classificationRepairVersion === CLASSIFICATION_REPAIR_VERSION) {
    classificationRepairDone = true;
    return;
  }
  if (!classificationRepairPromise) {
    classificationRepairPromise = runClassificationRepair().then(() => { classificationRepairDone = true; })
      .catch((error) => {
        setProgress({ status: "error", message: "分类修复失败：" + (error && error.message ? error.message : String(error)), running: 0 });
        throw error;
      })
      .finally(() => {
        classificationRepairPromise = null;
      });
  }
  return classificationRepairPromise;
}

async function runClassificationRepair() {
  setProgress({ status: "running", message: "正在迁移分类来源标记", running: 1, pending: 0, done: 0, failed: 0 });
  let migrated = 0;
  const classifications = await db.getAll("classifications");
  for (const classification of classifications) {
    const originalSource = core.classificationSourceType(classification);
    if (classification.sourceType === originalSource &&
        Boolean(classification.manualOverride) === (originalSource === core.CLASSIFICATION_SOURCE_TYPES.MANUAL)) continue;
    const updated = await db.updateClassification(classification.bvid, (current) => {
      if (!current) return;
      const sourceType = core.classificationSourceType(current);
      const manualOverride = sourceType === core.CLASSIFICATION_SOURCE_TYPES.MANUAL;
      if (current.sourceType === sourceType && Boolean(current.manualOverride) === manualOverride) return;
      return { ...current, sourceType, manualOverride };
    });
    if (updated) migrated += 1;
  }
  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {}, {
    classificationRepairVersion: CLASSIFICATION_REPAIR_VERSION
  });
  await chromeStorageSet({ settings });
  setProgress({
    status: "idle",
    message: "分类来源迁移完成：更新 " + migrated + " 项",
    running: 0,
    updatedAt: Date.now()
  });
}

async function updateSettings(nextSettings) {
  const config = await getConfig();
  const settings = Object.assign({}, config.settings);
  if (["watchlater", "pubdate", "duration"].includes(nextSettings.sortMode)) {
    settings.sortMode = nextSettings.sortMode;
  }
  if (["asc", "desc"].includes(nextSettings.sortDirection)) {
    settings.sortDirection = nextSettings.sortDirection;
  }
  const openingCategory = core.normalizeOpeningCategory(nextSettings.defaultOpeningCategory, config.categories);
  if (openingCategory === nextSettings.defaultOpeningCategory) settings.defaultOpeningCategory = openingCategory;
  if (core.VIDEO_FILTER_OPTIONS.some(([value]) => value === nextSettings.defaultVideoFilter)) {
    settings.defaultVideoFilter = nextSettings.defaultVideoFilter;
  }
  if (typeof nextSettings.shuffleOnOpen === "boolean") settings.shuffleOnOpen = nextSettings.shuffleOnOpen;
  if (core.finiteNumberOrNull(nextSettings.resultBatchSize) !== null) {
    settings.resultBatchSize = core.normalizeResultBatchSize(nextSettings.resultBatchSize);
  }
  if (typeof nextSettings.showCommentLocation === "boolean") {
    settings.showCommentLocation = nextSettings.showCommentLocation;
  }
  for (const [key, min, max] of [
    ["batchSize", 20, 100], ["manualExportLimit", 0, 500], ["detailConcurrency", 1, 6],
    ["llmBatchSize", 1, 100], ["llmLimit", 0, 10000], ["llmAutoClassifyThreshold", 1, 10000]
  ]) {
    const number = core.finiteNumberOrNull(nextSettings[key]);
    if (number !== null) settings[key] = Math.min(max, Math.max(min, Math.floor(number)));
  }
  const temperature = core.finiteNumberOrNull(nextSettings.llmTemperature);
  if (temperature !== null) settings.llmTemperature = Math.min(2, Math.max(0, temperature));
  if (["off", "daily", "weekly", "threshold"].includes(nextSettings.llmAutoClassifyMode)) {
    settings.llmAutoClassifyMode = nextSettings.llmAutoClassifyMode;
  }
  if (typeof nextSettings.detailFetchEnabled === "boolean") {
    settings.detailFetchEnabled = nextSettings.detailFetchEnabled;
  }
  if (typeof nextSettings.llmIncludeAll === "boolean") {
    settings.llmIncludeAll = nextSettings.llmIncludeAll;
  }
  if (typeof nextSettings.llmUseResponseFormat === "boolean") {
    settings.llmUseResponseFormat = nextSettings.llmUseResponseFormat;
  }
  if (typeof nextSettings.onboardingEligible === "boolean") {
    settings.onboardingEligible = nextSettings.onboardingEligible;
  }
  if (typeof nextSettings.onboardingCompleted === "boolean") {
    settings.onboardingCompleted = nextSettings.onboardingCompleted;
  }
  if (["login", "setup", "setup-categories", "setup-api", "setup-prompt", "setup-result", "guide", "classify", "complete"].includes(nextSettings.onboardingStage)) {
    settings.onboardingStage = nextSettings.onboardingStage;
  }
  if (["", "categories", "api", "prompt"].includes(nextSettings.onboardingMethod)) {
    settings.onboardingMethod = nextSettings.onboardingMethod;
  }
  const onboardingVersion = core.finiteNumberOrNull(nextSettings.onboardingVersion);
  if (onboardingVersion !== null) settings.onboardingVersion = onboardingVersion;
  if (["openai", "jev"].includes(nextSettings.classificationProvider)) settings.classificationProvider = nextSettings.classificationProvider;
  ["llmBaseUrl", "llmModel", "llmApiKey", "jevApiKey", "jevModel"].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(nextSettings, key)) {
      settings[key] = core.normalizeText(nextSettings[key]);
    }
  });
  await chromeStorageSet({ settings });
  if (Object.prototype.hasOwnProperty.call(nextSettings, "llmAutoClassifyMode") || Object.prototype.hasOwnProperty.call(nextSettings, "llmAutoClassifyThreshold")) {
    await configureAutoLlmAlarm(settings, true);
  }
  return getState();
}

async function configureAutoLlmAlarm(settings, force) {
  const mode = settings && settings.llmAutoClassifyMode;
  const existing = await chrome.alarms.get(AUTO_LLM_ALARM);
  if (!force && existing && mode !== "off") return;
  await chrome.alarms.clear(AUTO_LLM_ALARM);
  await chrome.alarms.clear(AUTO_LLM_CONTINUE_ALARM);
  if (mode === "daily") {
    chrome.alarms.create(AUTO_LLM_ALARM, { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 });
  } else if (mode === "weekly") {
    chrome.alarms.create(AUTO_LLM_ALARM, { delayInMinutes: 7 * 24 * 60, periodInMinutes: 7 * 24 * 60 });
  } else if (mode === "threshold") {
    chrome.alarms.create(AUTO_LLM_ALARM, { delayInMinutes: 1, periodInMinutes: 30 });
  }
}

async function maybeRunAutoLlmClassification(triggerName) {
  if (autoLlmRunPromise) return autoLlmRunPromise;
  autoLlmRunPromise = runScheduledLlmClassification(triggerName)
    .finally(() => {
      autoLlmRunPromise = null;
    });
  return autoLlmRunPromise;
}

async function runScheduledLlmClassification(triggerName) {
  const config = await getConfig();
  const settings = config.settings || {};
  const mode = settings.llmAutoClassifyMode || "off";
  if (mode === "off") return { skipped: true, reason: "disabled" };
  if (!apiConfigReady(settings)) {
    await writeAutoLlmStatus({
      llmAutoClassifyLastRunAt: Date.now(),
      llmAutoClassifyLastStatus: "自动分类未运行：请先完成并测试 API 设置",
      llmAutoClassifyLastImported: 0
    });
    return { skipped: true, reason: "api-not-configured" };
  }

  const saved = await chromeStorageGet(["autoLlmAttempts", "autoLlmRetryAt"]);
  if (saved.autoLlmRetryAt > Date.now()) {
    chrome.alarms.create(AUTO_LLM_CONTINUE_ALARM, { when: saved.autoLlmRetryAt });
    return { skipped: true, reason: "rate-limited" };
  }
  const attempts = automaticAttempts(config, saved.autoLlmAttempts);
  const first = await exportClassifyBatch({ limit: 1, attemptedSources: attempts.sources });
  const pending = first.totalCandidates;
  const threshold = Math.max(1, Number(settings.llmAutoClassifyThreshold) || 50);
  if (triggerName !== AUTO_LLM_CONTINUE_ALARM && mode === "threshold" && pending < threshold) {
    await writeAutoLlmStatus({
      llmAutoClassifyLastStatus: "等待可自动分类的视频达到 " + threshold + " 个；当前 " + pending + " 个"
    });
    return { skipped: true, reason: "below-threshold", pending };
  }
  if (!pending) {
    await writeAutoLlmStatus({ llmAutoClassifyLastStatus: "没有新增或资料有变化的待精细分类视频" });
    return { skipped: true, reason: "no-pending" };
  }

  const startedAt = Date.now();
  setProgress({ status: "running", message: "正在自动进行 API 视频分类", running: 1, pending, done: 0, failed: 0 });
  try {
    const result = await runAutomaticLlmBatches(config, attempts);
    await writeAutoLlmStatus({
      llmAutoClassifyLastRunAt: startedAt,
      llmAutoClassifyLastStatus: "自动分类完成：导入 " + result.imported + " 项，跳过 " + result.skipped + " 项" + (result.remaining ? "；剩余任务稍后继续" : ""),
      llmAutoClassifyLastImported: result.imported
    });
    setProgress({ status: "idle", message: "自动 API 视频分类完成：导入 " + result.imported + " 项", running: 0, pending: result.remaining, done: result.imported, failed: 0 });
    return result;
  } catch (error) {
    if ([429, 529].includes(error.status)) {
      const when = Math.max(Date.now() + 5 * 60000, error.retryAt || 0);
      await chromeStorageSet({ autoLlmRetryAt: when });
      chrome.alarms.create(AUTO_LLM_CONTINUE_ALARM, { when });
    }
    const errorMessage = error && error.message ? error.message : String(error);
    await writeAutoLlmStatus({
      llmAutoClassifyLastRunAt: startedAt,
      llmAutoClassifyLastStatus: "自动分类失败：" + errorMessage,
      llmAutoClassifyLastImported: 0
    });
    setProgress({ status: "error", message: "自动 API 视频分类失败：" + errorMessage, running: 0, failed: 1 });
    throw error;
  }
}

function automaticAttempts({ settings, categories }, saved) {
  const signature = core.stableJson([
    core.CLASSIFIER_VERSION, settings.classificationProvider, settings.llmBaseUrl, settings.llmModel,
    settings.jevModel, settings.llmTemperature, settings.llmUseResponseFormat, categories
  ]);
  return { signature, sources: saved?.signature === signature ? { ...saved.sources } : {} };
}

async function runAutomaticLlmBatches({ settings }, attempts) {
  const batchSize = Math.min(settings.classificationProvider === "jev" ? 5 : 100, Math.max(1, Number(settings.llmBatchSize) || 50));
  let imported = 0;
  let skipped = 0;
  let batches = 0;
  let remaining = 0;
  while (batches < AUTO_LLM_MAX_BATCHES_PER_WAKE) {
    const exported = await exportClassifyBatch({ includeAll: false, limit: batchSize, attemptedSources: attempts.sources });
    remaining = exported.totalCandidates || 0;
    if (!exported.batchSize) break;
    setProgress({ message: "正在自动分类第 " + (batches + 1) + " 批，共 " + exported.batchSize + " 个视频", pending: remaining, running: 1 });
    const payload = settings.classificationProvider === "jev"
      ? await core.classifyWithJev(settings, exported.batchVideos, exported.categories, fetchWithTimeout)
      : await callAutomaticLlm(settings, exported.prompt || "");
    const importedState = await importClassifications(JSON.stringify(payload), { mergeMode: "replace" });
    const importResult = importedState.importResult || {};
    imported += importResult.imported || 0;
    skipped += importResult.skipped || 0;
    batches += 1;
    for (const video of exported.batchVideos) {
      attempts.sources[video.bvid] = video.sourceHash || core.computeSourceHash(video);
    }
    await chromeStorageSet({ autoLlmAttempts: attempts });
  }
  const next = await exportClassifyBatch({ includeAll: false, limit: 1, attemptedSources: attempts.sources });
  remaining = next.totalCandidates || 0;
  if (remaining > 0 && batches >= AUTO_LLM_MAX_BATCHES_PER_WAKE) {
    chrome.alarms.create(AUTO_LLM_CONTINUE_ALARM, { delayInMinutes: 1 });
  }
  return { imported, skipped, batches, remaining };
}

async function callAutomaticLlm(config, prompt) {
  const requestPrompt = [
    prompt,
    "",
    "重要：必须为本批待分类视频中的每一个 bvid 返回一项。不要漏掉视频；信息不足时用 other.todo。",
    "返回必须是严格 JSON 对象：所有属性名和字符串都必须使用双引号，顶层必须是 {\"items\":[...]}。"
  ].join("\n");
  let response = await sendAutomaticLlmRequest(config, requestPrompt, config.llmUseResponseFormat === true);
  let textValue = await response.text();
  if (!response.ok && [400, 422].includes(response.status) && config.llmUseResponseFormat === true && /response[_ ]format|json_object/i.test(textValue)) {
    response = await sendAutomaticLlmRequest(config, requestPrompt, false);
    textValue = await response.text();
  }
  if (!response.ok) throw core.classificationApiError(response, "AI API HTTP " + response.status + ": " + textValue.slice(0, 300));
  const data = core.parseAiJson(textValue);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  if (!content) throw new Error("AI 响应缺少 choices[0].message.content");
  return core.normalizeLlmPayload(core.parseAiJson(content));
}

function sendAutomaticLlmRequest(config, requestPrompt, useResponseFormat) {
  const body = {
    model: config.llmModel,
    temperature: Number(config.llmTemperature) || 0,
    messages: [
      { role: "system", content: "你只返回严格 JSON。不要 Markdown，不要解释。" },
      { role: "user", content: requestPrompt }
    ]
  };
  if (useResponseFormat) body.response_format = { type: "json_object" };
  return fetchWithTimeout(chatCompletionsUrl(config.llmBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + config.llmApiKey,
      "x-title": "Bili Watchlater Classifier"
    },
    body: JSON.stringify(body)
  }, 120000);
}

function apiConfigReady(settings) {
  return core.classificationApiReady(settings);
}

async function writeAutoLlmStatus(patch) {
  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {}, patch || {});
  await chromeStorageSet({ settings });
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

async function openDashboard() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
}

async function checkBiliLogin() {
  const cookie = await chrome.cookies.get({
    url: "https://www.bilibili.com/",
    name: "SESSDATA"
  });
  return {
    loginStatus: cookie && cookie.value ? "logged_in" : "logged_out"
  };
}

async function syncOnOpen(message) {
  const scanState = await scanWatchlater({
    skipAutoClassify: Boolean(message && message.skipAutoClassify),
    initializeLibrary: true
  });
  const scanResult = scanState.scanResult || {};
  const autoResult = scanState.autoClassifyResult || {};
  return Object.assign({}, scanState, { progress,
    openSyncResult: {
      scanResult,
      autoClassifyResult: autoResult,
      apiError: scanState.apiError || "",
      apiCode: scanState.apiCode == null ? null : scanState.apiCode,
      loginStatus: scanState.loginStatus || "unknown",
      initialLibraryStarted: scanState.initialLibraryStarted
    }
  });
}

async function getState() {
  const [config, summary] = await Promise.all([getConfig(), db.summary({ includeJobs: false })]);
  return Object.assign({}, summary, config, {
    progress,
    classifySummary: getClassifySummary(summary.videos, summary.classifications)
  });
}

function scanWatchlater(message) {
  if (watchlaterScan) {
    const pending = watchlaterScan.message;
    pending.domItems.push(...(message.domItems || []));
    pending.initializeLibrary ||= Boolean(message.initializeLibrary);
    pending.skipAutoClassify &&= Boolean(message.skipAutoClassify);
    pending.lightSync &&= Boolean(message.lightSync);
    return watchlaterScan.promise;
  }
  const batch = { message: { ...message, domItems: [...(message.domItems || [])] } };
  batch.promise = runWatchlaterMembershipTask(() => scanWatchlaterUnlocked(batch.message)).finally(() => {
    if (watchlaterScan === batch) watchlaterScan = null;
  });
  watchlaterScan = batch;
  return batch.promise;
}

async function scanWatchlaterUnlocked(message) {
  const syncMeta = await db.get("meta", WATCHLATER_SYNC_META);
  if (message.lightSync && Date.now() - (syncMeta?.syncedAt || 0) < LIGHT_SYNC_INTERVAL) {
    const state = await getState();
    const known = new Set(state.videos.map(video => video.bvid));
    if (message.lightSync && message.domItems.every(item => known.has(core.normalizeBvid(item?.bvid || item?.pageUrl)))) {
      return state;
    }
  }
  setProgress({ status: "running", message: "正在扫描稍后再看列表", running: 1 });
  let apiItems = [];
  let apiError = "";
  let apiCode = null;
  let apiSucceeded = false;
  let unidentifiedAids = [];
  let loginStatus = "unknown";
  try {
    if (syncMeta?.retryAt > Date.now()) throw new Error("B站正在限流，请稍后再同步");
    ({ items: apiItems, unidentifiedAids } = await fetchWatchlaterFromApi());
    apiSucceeded = true;
    loginStatus = "logged_in";
  } catch (error) {
    apiError = error && error.message ? error.message : String(error);
    apiCode = error && Number.isFinite(Number(error.biliCode)) ? Number(error.biliCode) : null;
    if (apiCode === -101) loginStatus = "logged_out";
    if (error.status === 429) {
      await db.put("meta", { key: WATCHLATER_SYNC_META, syncedAt: syncMeta?.syncedAt,
        retryAt: Math.max(Date.now() + 60000, error.retryAt || 0) });
    }
  }

  const domItems = Array.isArray(message.domItems) ? message.domItems : [];
  const trustedItems = apiSucceeded ? apiItems : domItems;
  const itemsByBvid = new Map();
  trustedItems.forEach((item) => {
    const bvid = core.normalizeBvid(item && (item.bvid || item.pageUrl));
    if (!bvid) return;
    itemsByBvid.set(bvid, Object.assign({}, itemsByBvid.get(bvid) || {}, item, { bvid, presentInWatchlater: true }));
  });

  const markRemoved = apiSucceeded;
  const upsertResult = await upsertVideoItems(Array.from(itemsByBvid.values()), { markRemoved, unidentifiedAids, skipState: true });
  if (apiSucceeded) await db.put("meta", { key: WATCHLATER_SYNC_META, syncedAt: Date.now() });
  const scanCount = itemsByBvid.size;
  const initialLibraryStarted = Boolean(message.initializeLibrary && apiSucceeded && scanCount &&
    !(await db.get("meta", core.INITIAL_LIBRARY_SYNC_KEY)));
  if (initialLibraryStarted) {
    await db.put("meta", { key: core.INITIAL_LIBRARY_SYNC_KEY, through: Date.now() });
  }
  globalThis.BiliWLCoverWorker?.start();
  const newCount = upsertResult.scanResult ? upsertResult.scanResult.newCount : 0;
  const changedCount = upsertResult.scanResult ? upsertResult.scanResult.changedCount : 0;
  const removedCount = upsertResult.scanResult ? upsertResult.scanResult.removedCount || 0 : 0;
  const scanConfig = await getConfig();
  const onboardingPending = scanConfig.settings.onboardingEligible === true && scanConfig.settings.onboardingCompleted !== true;
  const skipAutoClassify = Boolean(message.skipAutoClassify) || onboardingPending;
  const autoState = skipAutoClassify
    ? Object.assign(await getState(), {
      autoClassifyResult: { classified: 0, skippedManual: 0, reclassifiedManual: 0, unchanged: 0, skipped: true }
    })
    : await autoClassify({ silent: true, unclassifiedOnly: true });
  const autoResult = autoState.autoClassifyResult || {};
  setProgress({
    status: "idle",
    message: apiSucceeded
      ? "同步完成 · 共 " + scanCount + " 个视频，新增 " + newCount + " 个，变化 " + changedCount + " 个，移除 " + removedCount + " 个" + (autoResult.skipped ? "；暂不分类视频" : "；完成初步分类 " + (autoResult.classified || 0) + " 个")
      : "已同步页面可见的 " + scanCount + " 个视频" + (autoResult.skipped ? "；暂不分类视频" : "；完成初步分类 " + (autoResult.classified || 0) + " 个") + "；B站列表接口不可用：" + apiError,
    running: 0,
    updatedAt: Date.now()
  });
  const detailState = initialLibraryStarted ? await queueMissingVideoDetails() : null;
  return Object.assign({
    source: apiSucceeded ? "api+dom" : "dom",
    apiError,
    apiCode,
    loginStatus,
    initialLibraryStarted
  }, upsertResult, autoState, detailState);
}

async function upsertVideoItems(items, options) {
  const upsert = await db.upsertVideos(items, { authoritativeWatchlater: Boolean(options?.markRemoved) });
  const scanResult = {
    scannedCount: upsert.results.length,
    newCount: upsert.results.filter((result) => result.isNew).length,
    changedCount: upsert.results.filter((result) => result.sourceChanged).length,
    newBvids: upsert.results.filter((result) => result.isNew).map((result) => result.video.bvid),
    changedBvids: upsert.results.filter((result) => result.sourceChanged).map((result) => result.video.bvid)
  };
  const bvids = upsert.results.map((item) => item.video.bvid);
  if (options?.markRemoved) {
    if (upsert.errors?.length) throw new Error("部分视频无法保存，已保留原有稍后再看记录");
    const removedBvids = await db.markRemovedExcept(bvids, options.unidentifiedAids);
    scanResult.removedCount = removedBvids.length;
    scanResult.removedBvids = removedBvids;
  }

  if (options && options.skipState) return { scanResult };
  return Object.assign(await getState(), { scanResult });
}

async function queueMissingVideoDetails() {
  const config = await getConfig();
  if (!config.settings.detailFetchEnabled) {
    setProgress({ status: "idle", message: "详情更新已关闭", running: 0 });
    return Object.assign(await getState(), {
      detailQueueResult: { candidates: 0, queued: 0, disabled: true }
    });
  }

  const [videos, schedule] = await Promise.all([db.getAll("videos"), db.get("meta", DETAIL_ALARM)]);
  const missingDetailBvids = videos
    .filter((video) => video && video.presentInWatchlater !== false)
    .filter(shouldFetchDetails)
    .map((video) => video.bvid);
  const queued = await db.queueJobs("detail", missingDetailBvids, "manual");
  const activeJobs = await db.pendingJobs("detail");

  const pausedUntil = schedule?.error && schedule.resumeAt > Date.now() ? schedule.resumeAt : 0;
  if (activeJobs.length && pausedUntil) {
    setProgress({ status: "error", message: "详情更新已暂停：" + schedule.error, pending: activeJobs.length, running: 0 });
    startDetailQueue();
  } else if (activeJobs.length) {
    if (!detailRunPromise) setProgress({ status: "running", message: "已排队 " + activeJobs.length + " 个视频详情", pending: activeJobs.length, running: 0, done: 0, failed: 0 });
    startDetailQueue();
  } else if (!activeJobs.length) {
    setProgress({ status: "idle", message: "没有缺失详情的视频", pending: 0, running: 0 });
  }

  return Object.assign(await getState(), {
    detailQueueResult: {
      candidates: missingDetailBvids.length,
      queued,
      pending: activeJobs.length,
      pausedUntil,
      error: pausedUntil ? schedule.error : ""
    }
  });
}

function shouldFetchDetails(video) {
  if (!video || video.detailCheckedAt) return false;
  if (video.viewCount == null || !video.coverUrl || !video.pageParts?.length) return true;
  if (!video.tname || !video.desc || !Array.isArray(video.tags) || !video.tags.length) return true;
  return false;
}

async function fetchWatchlaterFromApi() {
  const response = await fetch("https://api.bilibili.com/x/v2/history/toview", {
    signal: AbortSignal.timeout(10000),
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json,text/plain,*/*" }
  });
  if (!response.ok) throw Object.assign(new Error("HTTP " + response.status), {
    status: response.status, retryAt: core.retryAfterAt(response)
  });
  const json = await response.json();
  if (json.code !== 0) throw Object.assign(new Error(json.message || ("B站接口返回 code " + json.code)), {
    biliCode: Number(json.code)
  });
  const list = readCompleteWatchlaterList(json.data);
  const items = [];
  const unidentifiedAids = [];
  const bvids = new Set();
  for (const [index, item] of list.entries()) {
    const video = convertBiliApiVideo(item, index);
    if (!video || !/^BV[0-9A-Za-z]{10}$/.test(video.bvid)) {
      unidentifiedAids.push(Number(item.aid));
      continue;
    }
    if (bvids.has(video.bvid)) throw new Error("B站列表包含重复的视频编号");
    bvids.add(video.bvid);
    items.push(video);
  }
  return { items, unidentifiedAids };
}

function readCompleteWatchlaterList(data) {
  const list = data && (Array.isArray(data.list) ? data.list : data.count === 0 && data.list === null ? [] : null);
  if (!list || !Number.isInteger(data.count) || data.count !== list.length) {
    throw new Error("B站未返回完整的稍后再看列表");
  }
  const aids = new Set();
  for (const item of list) {
    const rawAid = item?.aid;
    const aid = typeof rawAid === "number" || typeof rawAid === "string" ? Number(rawAid) : NaN;
    if (!Number.isSafeInteger(aid) || aid <= 0 || aids.has(aid)) throw new Error("B站列表的视频编号异常");
    aids.add(aid);
  }
  return list;
}

function convertBiliApiVideo(item, index) {
  const bvid = core.normalizeBvid(item && (item.bvid || item.bv_id || item.uri || item.redirect_url));
  if (!bvid) return null;
  const owner = item.owner || item.author || {};
  const duration = Number(item.duration) || 0;
  const rawProgress = core.finiteNumberOrNull(item.progress);
  const hasProgress = rawProgress !== null;
  return {
    bvid,
    oid: item.oid,
    aid: item.aid,
    title: item.title || item.name,
    pageUrl: item.uri || item.redirect_url || ("https://www.bilibili.com/video/" + bvid),
    upName: owner.name || item.author_name || item.owner_name,
    upMid: owner.mid || item.mid,
    coverUrl: item.pic || item.cover,
    tname: item.tname || item.typename || item.type_name,
    desc: item.desc,
    duration,
    viewCount: item.stat && item.stat.view,
    watchProgress: hasProgress ? rawProgress : undefined,
    isWatched: hasProgress ? rawProgress < 0 || duration > 0 && rawProgress >= duration : undefined,
    pubdate: item.pubdate || item.pubtime || item.ctime,
    watchlaterAddedAt: item.add_at || item.addAt || item.add_time || item.addtime || item.view_at,
    watchlaterOrder: Number.isFinite(Number(index)) ? Number(index) : undefined,
    pageParts: Array.isArray(item.pages) ? item.pages.map((page) => page.part).filter(Boolean) : [],
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => tag.tag_name || tag.name || tag) : [],
    presentInWatchlater: true
  };
}

async function removeFromWatchlater(message, sourceTab) {
  watchlaterScan = null;
  return runWatchlaterMembershipTask(() => removeFromWatchlaterUnlocked(message, sourceTab));
}

async function removeFromWatchlaterUnlocked(message, sourceTab) {
  const bvid = core.normalizeBvid(message && message.bvid);
  if (!bvid) throw new Error("缺少 bvid");

  const video = await db.get("videos", bvid);
  if (!video) throw new Error("本地记录中没有这个视频：" + bvid);
  // Resolve the current aid from the server list, including unavailable videos.
  const result = await requestWatchlaterRemove(video.aid || video.oid, bvid, sourceTab);
  if (!result || result.verified !== true) throw new Error("未能核实 B站删除结果，请同步列表后重试");
  const removed = await db.markRemoved(bvid);
  return Object.assign(await getState(), {
    removeResult: { ...result, watchlaterMembershipRevision: removed?.watchlaterMembershipRevision }
  });
}

async function requestWatchlaterRemove(aid, bvid, sourceTab) {
  const pageFailures = [];
  const tabs = await chrome.tabs.query({});
  const candidates = (tabs || []).filter(tab => tab.id != null &&
    Boolean(tab.incognito) === Boolean(sourceTab?.incognito) &&
    isBilibiliUrl(tab.pendingUrl || tab.url));
  const remaining = candidates.slice();
  let tab = findBilibiliTab(remaining);
  while (tab) {
    try {
      return await requestWatchlaterRemoveFromPage(aid, bvid, tab);
    } catch (error) {
      if (error.retryable === false) throw new Error("B站页面 · " + error.message);
      pageFailures.push(error.message);
      remaining.splice(remaining.indexOf(tab), 1);
      tab = findBilibiliTab(remaining);
    }
  }
  try {
    const prepared = await loadExistingBilibiliTab(remaining);
    if (prepared) return await requestWatchlaterRemoveFromPage(aid, bvid, prepared);
  } catch (error) {
    if (error.retryable === false) throw new Error("B站页面 · " + error.message);
    pageFailures.push(error.message);
  }
  const pageStatus = pageFailures.length ? "B站页面不可用（" + pageFailures.join("；") + "）"
    : candidates.some(candidate => candidate.frozen) ? "B站标签页已休眠，请切到该标签页唤醒"
      : "未找到可用的 B站标签页，请在同一个浏览器窗口打开 B站稍后再看";
  if (sourceTab?.incognito) throw new Error(pageStatus);
  try {
    const csrf = await getBiliCsrf();
    return readWatchlaterRemovalResult(await performWatchlaterRemoval({ aid, csrf, bvid, deadline: Date.now() + 20000 }));
  } catch (error) {
    throw new Error(pageStatus + "。扩展后台 · " + error.message);
  }
}

function readWatchlaterRemovalResult(result) {
  if (result && result.verified === true) return result;
  const error = new Error(result && result.error || "B站删除请求没有返回可核实的结果");
  error.retryable = result && result.retryable;
  throw error;
}

async function requestWatchlaterRemoveFromPage(aid, bvid, tab) {
  let timer;
  const results = await Promise.race([chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    // This request only needs fetch/cookies. Waiting for all page resources can
    // block deletion forever on tabs with stalled images or third-party scripts.
    injectImmediately: true,
    args: [{ aid, bvid, fromPage: true, deadline: Date.now() + 20000 }],
    func: performWatchlaterRemoval
  }), new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("B站页面无响应，请刷新该页面并同步列表后重试"), { retryable: false })), 22000);
  })]).catch((error) => {
    if (error.retryable === false) throw error;
    const rejectedBeforeInjection = /No tab with id|Cannot access contents|Missing host permission/i.test(error.message);
    throw Object.assign(new Error("无法在 B站标签页运行删除操作：" + error.message), { retryable: rejectedBeforeInjection });
  }).finally(() => clearTimeout(timer));
  const result = results?.[0]?.result;
  if (!result) throw Object.assign(new Error("B站页面未返回移出结果，请先同步列表确认"), { retryable: false });
  return readWatchlaterRemovalResult(result);
}

// Self-contained: this exact function also runs in the Bilibili page's MAIN world.
// Current official watchlater UI uses v2/dels + FormData(resources, csrf).
async function performWatchlaterRemoval(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, request.deadline - Date.now()));
  let postStarted = false;
  let stage = "读取稍后再看列表";
  function checkDeadline() {
    if (Date.now() >= request.deadline || controller.signal.aborted) throw new Error("请求超时，请同步列表后重试");
  }
  async function api(path, options) {
    checkDeadline();
    const response = await fetch("https://api.bilibili.com" + path, Object.assign({
      credentials: "include", cache: "no-store", signal: controller.signal
    }, options));
    if (!response.ok) {
      const rejected = [401, 403, 412, 429].includes(response.status);
      const advice = response.status === 412 ? "。B站拒绝了本次请求，可在 B站稍后再看页面操作后再同步"
        : response.status === 429 ? "。请求过于频繁，请稍后再试" : "";
      throw Object.assign(new Error("HTTP " + response.status + advice), { retryable: rejected ? false : undefined });
    }
    const json = await response.json();
    if (!json || json.code !== 0) {
      const code = json && json.code;
      const advice = code === -101 ? "请先登录 B站" : code === -111 ? "登录凭据已变化，请刷新 B站页面后重试" : json && json.message || "未知错误";
      throw Object.assign(new Error(advice + "（code " + code + "）"), { retryable: false });
    }
    return json.data;
  }
  async function list() {
    // This unfiltered endpoint returns the entire list; never treat an incomplete
    // or malformed response as proof that a video is absent.
    const data = await api("/x/v2/history/toview");
    const items = data && (Array.isArray(data.list) ? data.list : data.count === 0 && data.list === null ? [] : null);
    if (!items || !Number.isInteger(data.count) || data.count !== items.length ||
        items.some((item) => !item || !Number.isSafeInteger(Number(item.aid)) || Number(item.aid) <= 0)) {
      throw Object.assign(new Error("B站未返回完整列表，无法核实删除结果"), { retryable: false });
    }
    return items;
  }
  try {
    if (request.fromPage && location.origin !== "https://www.bilibili.com") {
      throw new Error("标签页正在打开 B站，请等待页面显示后重试");
    }
    if (!/^BV[0-9A-Za-z]{10}$/.test(request.bvid)) throw Object.assign(new Error("视频编号无效"), { retryable: false });
    const before = await list();
    const target = before.find((item) => item.bvid === request.bvid);
    if (!target) {
      // A stale local aid must not target another video, or hide an invalid item
      // which the server has returned without its bvid.
      if (before.some((item) => Number(item.aid) === Number(request.aid))) {
        throw Object.assign(new Error("视频编号与 B站列表不一致，请重新同步"), { retryable: false });
      }
      return { bvid: request.bvid, verified: true, alreadyAbsent: true };
    }
    const aid = Number(target.aid);
    const pageCsrf = typeof document === "undefined" ? "" : (document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/) || [])[1];
    const csrf = pageCsrf || request.csrf;
    if (!csrf) throw Object.assign(new Error("未找到登录凭据，请先登录 B站"), { retryable: false });
    const body = new FormData();
    body.set("resources", String(aid));
    body.set("csrf", csrf);
    stage = "移出稍后再看";
    checkDeadline();
    postStarted = true;
    let postError;
    try {
      await api("/x/v2/history/toview/v2/dels", { method: "POST", body });
    } catch (error) {
      if (error.retryable === false) throw error;
      postError = error; // The server may have applied a request whose response was lost.
    }
    stage = "核实删除结果";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      const after = await list();
      if (!after.some((item) => item.bvid === request.bvid || Number(item.aid) === aid)) {
        return { bvid: request.bvid, aid, verified: true };
      }
    }
    throw new Error(postError ? postError.message + "；视频仍在 B站列表中" : "接口返回成功，但视频仍在 B站列表中，请稍后重试");
  } catch (error) {
    return { error: stage + "失败：" + (controller.signal.aborted ? "请求超时，请同步列表后重试" : error.message), retryable: !postStarted && error.retryable !== false };
  } finally {
    clearTimeout(timer);
  }
}

function isBilibiliUrl(url) {
  return /^https:\/\/www\.bilibili\.com\//.test(url || "");
}

function findBilibiliTab(candidates) {
  // Restored tabs can be unloaded without being marked discarded or frozen.
  const tabs = candidates.filter((tab) => isBilibiliUrl(tab.url) && (!tab.pendingUrl || tab.pendingUrl === tab.url) &&
    tab.status !== "unloaded" && !tab.discarded && !tab.frozen);
  return tabs.find((tab) => tab.status === "complete" && /^\/(?:watchlater\/list|list\/watchlater)(?:\/|$)/.test(new URL(tab.url).pathname)) ||
    tabs.find((tab) => tab.status === "complete" && tab.active) ||
    tabs.find((tab) => tab.status === "complete") ||
    tabs[0] || null;
}

async function loadExistingBilibiliTab(candidates) {
  const candidate = candidates.find((tab) => !tab.frozen &&
    (isBilibiliUrl(tab.pendingUrl) || tab.status === "unloaded" || tab.discarded));
  if (!candidate) return null;
  // Recheck before reloading: the user may have started watching this tab.
  const current = await chrome.tabs.get(candidate.id);
  if (!isBilibiliUrl(current.pendingUrl || current.url)) {
    throw new Error("B站标签页正在跳转，请重试");
  }
  if (!current.pendingUrl && (current.status === "unloaded" || current.discarded)) {
    // Reload the existing URL in the background; never activate or replace it.
    await chrome.tabs.reload(current.id);
  }
  let timer;
  const deadline = Date.now() + 12000;
  try {
    return await Promise.race([
      (async () => {
        while (Date.now() < deadline) {
          const tab = await chrome.tabs.get(current.id);
          if (!isBilibiliUrl(tab.pendingUrl || tab.url)) {
            throw new Error("B站标签页正在跳转，请重试");
          }
          if (isBilibiliUrl(tab.url) && (!tab.pendingUrl || tab.pendingUrl === tab.url) &&
              tab.status !== "unloaded" && !tab.discarded && !tab.frozen) {
            try {
              // Probe the committed document, not the tab's cached URL or load event.
              const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id }, world: "MAIN", injectImmediately: true,
                func: () => location.origin === "https://www.bilibili.com"
              });
              if (results && results[0] && results[0].result === true) return tab;
            } catch (_) {
              // A restored tab can briefly retain its empty initial document.
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("后台加载 B站页面超时，请检查网络后重试");
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("后台加载 B站页面超时，请检查网络后重试")), 12000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function runWatchlaterMembershipTask(task) {
  const result = watchlaterMembershipQueue.then(task, task);
  watchlaterMembershipQueue = result.catch(() => {});
  return result;
}

async function getBiliCsrf() {
  if (!chrome.cookies || !chrome.cookies.get) {
    throw new Error("缺少 cookies 权限，无法读取 B站 csrf");
  }
  const cookie = await chrome.cookies.get({
    url: "https://www.bilibili.com/",
    name: "bili_jct"
  });
  if (!cookie || !cookie.value) {
    throw new Error("未找到 bili_jct，请确认当前 Chrome 已登录 B站");
  }
  return cookie.value;
}

function startDetailQueue() {
  if (detailRunPromise) {
    detailRerunRequested = true;
    return;
  }
  detailRunPromise = processDetailQueue()
    .catch((error) => setProgress({ status: "error", message: error && error.message ? error.message : String(error), running: 0 }))
    .finally(() => {
      detailRunPromise = null;
      if (detailRerunRequested) {
        detailRerunRequested = false;
        startDetailQueue();
      }
    });
}

async function scheduleDetailQueue(resumeAt, error = "") {
  await db.put("meta", { key: DETAIL_ALARM, resumeAt, error });
  await chrome.alarms.create(DETAIL_ALARM, { when: resumeAt });
}

function detailSortTime(video) {
  const timestamp = Number(video.watchlaterAddedAt || video.firstSeenAt) || 0;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

async function processDetailQueue() {
  const config = await getConfig();
  if (!config.settings.detailFetchEnabled) return;

  const [pending, videos, schedule, initialLibrary, combinedBackoff] = await Promise.all([
    db.pendingJobs("detail"), db.getAll("videos"), db.get("meta", DETAIL_ALARM),
    db.get("meta", core.INITIAL_LIBRARY_SYNC_KEY), db.get("meta", COMBINED_DETAILS_BACKOFF)
  ]);
  const byBvid = new Map(videos.map(video => [video.bvid, video]));
  const remaining = [];
  for (const job of pending) {
    const video = byBvid.get(job.bvid);
    if (video?.presentInWatchlater !== false && shouldFetchDetails(video)) remaining.push(job);
    else await db.updateJob(job.id, { status: "done" });
  }
  if (!remaining.length) {
    await db.put("meta", { key: DETAIL_ALARM });
    await chrome.alarms.clear(DETAIL_ALARM);
    setProgress({ status: "idle", message: "详情更新完成", pending: 0, running: 0 });
    return;
  }

  const now = Date.now();
  const ready = remaining.filter(job => !(job.retryAt > now));
  ready.sort((a, b) => detailSortTime(byBvid.get(b.bvid)) - detailSortTime(byBvid.get(a.bvid)));
  const initialJobs = initialLibrary ? ready.filter(job =>
    (byBvid.get(job.bvid).firstSeenAt || 0) <= initialLibrary.through) : [];
  const initial = initialJobs.length > 0;
  if (schedule?.resumeAt > now) {
    await chrome.alarms.create(DETAIL_ALARM, { when: schedule.resumeAt });
    return;
  }
  if (globalThis.navigator?.onLine === false) {
    await scheduleDetailQueue(now + DETAIL_ERROR_PAUSE, "当前未联网");
    setProgress({ status: "error", message: "详情更新已暂停：当前未联网", pending: remaining.length, running: 0 });
    return;
  }
  if (!ready.length) {
    await scheduleDetailQueue(Math.min(...remaining.map(job => job.retryAt)));
    setProgress({ status: "idle", message: "部分视频详情暂不可用，稍后重试", pending: remaining.length, running: 0 });
    return;
  }

  const batch = initial ? initialJobs.slice(0, INITIAL_DETAIL_BATCH_SIZE) : ready.slice(0, DETAIL_BATCH_SIZE);
  const requestInterval = initial ? INITIAL_DETAIL_REQUEST_INTERVAL : DETAIL_REQUEST_INTERVAL;
  // Schedule before starting so a suspended worker can resume any unfinished job.
  const nextBatchAt = now + DETAIL_BATCH_INTERVAL;
  await scheduleDetailQueue(nextBatchAt);
  setProgress({ status: "running", message: initial ? "正在首次补齐视频详情" : "正在分批补充视频详情",
    pending: remaining.length, running: 1, done: 0, failed: 0 });

  let lastRequestAt = 0;
  async function requestDetails(path) {
    const wait = lastRequestAt + requestInterval - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const response = await fetch("https://api.bilibili.com" + path, {
      signal: AbortSignal.timeout(8000),
      credentials: "include",
      headers: { accept: "application/json,text/plain,*/*" }
    });
    if (!response.ok) {
      if (response.status === 412 && path.startsWith("/x/web-interface/view/detail?")) {
        await db.put("meta", { key: COMBINED_DETAILS_BACKOFF, retryAt: Date.now() + 24 * 60 * 60000 });
      }
      throw Object.assign(new Error("HTTP " + response.status), {
        status: response.status, retryAt: core.retryAfterAt(response)
      });
    }
    const result = await response.json();
    if (result?.code !== 0) {
      throw Object.assign(new Error(result?.message || "B 站详情接口返回异常"), { biliCode: Number(result?.code) });
    }
    return result.data;
  }

  const changedVideos = new Map();
  let done = 0;
  let failed = 0;
  let lastProgressAt = Date.now();
  async function saveDetail(changes) {
    const saved = await db.upsertVideos([changes]);
    if (saved?.errors?.length) throw new Error(saved.errors[0]);
    const video = saved?.results[0]?.video;
    if (video) changedVideos.set(video.bvid, video);
  }
  function publishDetails() {
    if (!changedVideos.size) return;
    globalThis.BiliWLCoverWorker?.start();
    chrome.runtime.sendMessage({ type: core.MESSAGE_TYPES.DETAILS_SAVED, videos: [...changedVideos.values()] }).catch(() => {});
  }
  for (const job of batch) {
    try {
      const video = byBvid.get(job.bvid);
      const query = "?bvid=" + encodeURIComponent(job.bvid);
      let tags;
      if (!video.detailViewCheckedAt && (video.viewCount == null || !video.tname || !video.desc || !video.coverUrl || !video.pageParts?.length)) {
        const canCombine = !video.tags?.length && !(combinedBackoff?.retryAt > now);
        const details = await fetchVideoDetails(job.bvid, requestDetails, canCombine);
        tags = details.tags;
        await saveDetail({ ...details, bvid: job.bvid, detailViewCheckedAt: Date.now() });
      }
      if (tags === undefined && !video.tags?.length) {
        const data = await requestDetails("/x/tag/archive/tags" + query);
        if (data != null && !Array.isArray(data)) throw new Error("B 站返回的标签格式异常");
        tags = (data || []).map(tag => tag?.tag_name || tag?.name).filter(Boolean);
      }
      await saveDetail({ bvid: job.bvid, tags, detailCheckedAt: Date.now() });
      await db.updateJob(job.id, { status: "done", error: "", retryAt: 0 });
      done++;
    } catch (error) {
      const message = error.message || String(error);
      if (UNAVAILABLE_VIDEO_CODES.has(error.biliCode)) {
        await saveDetail({ bvid: job.bvid, detailCheckedAt: Date.now() });
        await db.updateJob(job.id, { status: "done", error: message, retryAt: 0 });
        failed++;
      } else {
        const resumeAt = Math.max(Date.now() + DETAIL_ERROR_PAUSE, error.retryAt || 0);
        await scheduleDetailQueue(resumeAt, message);
        await db.updateJob(job.id, {
          status: "pending", error: message,
          retryAt: Math.max(resumeAt, Date.now() + 3600000)
        });
        publishDetails();
        setProgress({ status: "error", message: "详情更新已暂停：" + message, running: 0,
          done, failed: failed + 1, pending: remaining.length - done - failed });
        return;
      }
    }
    if (Date.now() - lastProgressAt >= 500) {
      lastProgressAt = Date.now();
      setProgress({ done, failed, pending: remaining.length - done - failed });
    }
  }

  const left = (await db.pendingJobs("detail")).length;
  if (left) {
    await scheduleDetailQueue(Math.max(nextBatchAt, lastRequestAt + requestInterval));
  } else {
    await db.put("meta", { key: DETAIL_ALARM });
    await chrome.alarms.clear(DETAIL_ALARM);
  }
  publishDetails();
  setProgress({ status: "idle", message: left ? "本批详情已保存，稍后继续" : "详情更新完成", pending: left, running: 0, done, failed });
}

async function fetchVideoDetails(bvid, requestDetails, needsTags) {
  const query = "?bvid=" + encodeURIComponent(bvid);
  let combined;
  if (needsTags) {
    combined = await requestDetails("/x/web-interface/view/detail" + query).catch(error => {
      if (error.status !== 404) throw error;
      return null;
    });
  }
  const data = combined?.View || await requestDetails("/x/web-interface/view" + query);
  if (!data || core.normalizeBvid(data.bvid) !== bvid) throw new Error("B 站未返回匹配的视频详情");
  const owner = data.owner || {};
  return {
    oid: data.aid,
    aid: data.aid,
    title: data.title,
    upName: owner.name,
    upMid: owner.mid,
    coverUrl: data.pic,
    tname: data.tname_v2 || data.tname,
    desc: data.desc,
    duration: data.duration,
    viewCount: data.stat?.view,
    pubdate: data.pubdate || data.ctime,
    tags: Array.isArray(combined?.Tags) ? combined.Tags.map(tag => tag?.tag_name || tag?.name).filter(Boolean) : undefined,
    pageParts: Array.isArray(data.pages) ? data.pages.map(page => page.part).filter(Boolean) : []
  };
}

function setProgress(patch) {
  progress = Object.assign({}, progress, patch || {}, { updatedAt: Date.now() });
  chrome.runtime.sendMessage({ type: core.MESSAGE_TYPES.JOB_PROGRESS, progress }).catch(() => {});
}

async function exportCategoryProposal(message) {
  const config = await getConfig();
  const summary = await db.summary({ includeJobs: false });
  const candidates = shuffledCopy(summary.videos
    .filter((video) => video && video.presentInWatchlater !== false));
  const requested = Math.min(100, Math.max(10, Number(message.limit) || 60));
  const sample = candidates.slice(0, requested);
  return {
    prompt: core.buildCategoryProposalPrompt(sample, config.categories, { sampleLimit: requested }),
    sampleCount: sample.length,
    totalVideos: candidates.length
  };
}

async function importCategories(message) {
  const config = await getConfig();
  const importedCategories = normalizeImportedCategories(message.payload);
  const classifications = await db.getAll("classifications");
  const categories = preserveManualCategoryDefinitions(importedCategories, config.categories, classifications);
  const previousIds = new Set(config.categories.map((category) => category.id));
  const nextIds = new Set(categories.map((category) => category.id));
  const addedCategoryIds = categories.map((category) => category.id).filter((id) => !previousIds.has(id));
  const removedIds = new Set(Array.from(previousIds).filter((id) => !nextIds.has(id)));
  await storeCategoryDirectory(categories, core.normalizeText(message.source) || "llm");
  await cleanupDeletedCategoryReferences(removedIds, categories);

  const onboardingPending = config.settings.onboardingEligible === true && config.settings.onboardingCompleted !== true;
  const keywordResult = message.skipAutoClassify || onboardingPending
    ? { checked: 0, matchedVideos: 0, addedAssignments: 0, skipped: true }
    : await appendKeywordCategories(addedCategoryIds, categories);

  const nextState = await getState();
  return Object.assign(nextState, {
    categoryImportResult: {
      imported: categories.length,
      roots: categories.filter((category) => !category.parentId).length,
      source: nextState.settings.categoryListSource,
      addedCategoryIds,
      removedCategoryIds: Array.from(removedIds),
      keywordResult
    }
  });
}

async function storeCategoryDirectory(categories, source = "manual") {
  const data = await chromeStorageGet(["settings"]);
  await chromeStorageSet({ categories, settings: {
    ...core.DEFAULT_SETTINGS, ...data.settings, categoryListSource: source, categoryListUpdatedAt: Date.now()
  } });
}

function preserveManualCategoryDefinitions(importedCategories, previousCategories, classifications) {
  const categories = importedCategories.map((category) => Object.assign({}, category));
  const nextIds = new Set(categories.map((category) => category.id));
  const previousById = new Map((previousCategories || []).map((category) => [category.id, category]));
  const protectedIds = new Set();

  function protectWithParents(categoryId) {
    let current = previousById.get(categoryId);
    const visited = new Set();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      protectedIds.add(current.id);
      current = current.parentId ? previousById.get(current.parentId) : null;
    }
  }

  (classifications || [])
    .filter((classification) => core.isManualClassification(classification))
    .forEach((classification) => {
      core.uniqueStrings(classification.categoryIds).forEach(protectWithParents);
    });

  (previousCategories || []).forEach((category) => {
    if (!protectedIds.has(category.id) || nextIds.has(category.id)) return;
    categories.push(Object.assign({}, category, { enabled: true }));
    nextIds.add(category.id);
  });
  return categories;
}

function normalizeImportedCategories(payload, options) {
  const settings = Object.assign({ allowSmall: false, ensureFallback: true }, options || {});
  let parsed = payload;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      throw new Error("分类目录 JSON 无法解析：" + error.message);
    }
  }
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed && parsed.categories)
      ? parsed.categories
      : [];
  if (!items.length) throw new Error("返回 JSON 中没有 categories 数组");
  if (!settings.allowSmall && items.length < 4) throw new Error("分类目录过少，至少需要 4 个分类");
  if (items.length > 60) throw new Error("分类数量不能超过 60 个");

  const categories = [];
  const seen = new Set();
  items.forEach((item, index) => {
    const id = core.normalizeText(item && item.id).toLowerCase();
    const rawName = core.truncateText(item && item.name, 30);
    const name = id === "other.todo" && rawName === "待整理" ? "暂未归类" : rawName;
    const parentId = core.normalizeText(item && item.parentId).toLowerCase();
    if (!id || !/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,79}$/u.test(id)) {
      throw new Error("分类 id 不合法：" + (id || "第 " + (index + 1) + " 项"));
    }
    if (!name) throw new Error("分类名称不能为空：" + id);
    if (seen.has(id)) throw new Error("分类 id 重复：" + id);
    if (parentId === id) throw new Error("分类不能以自己为父级：" + id);
    seen.add(id);
    categories.push({
      id,
      name,
      parentId: parentId || undefined,
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : (index + 1) * 10,
      keywords: core.uniqueStrings(Array.isArray(item && item.keywords) ? item.keywords : []).map((keyword) => core.truncateText(keyword, 24)).slice(0, 10),
      enabled: true
    });
  });

  if (settings.ensureFallback && !seen.has("other")) {
    categories.push({ id: "other", name: "其他", order: 900, keywords: [], enabled: true });
    seen.add("other");
  }
  if (settings.ensureFallback && !seen.has("other.todo")) {
    categories.push({ id: "other.todo", name: "暂未归类", parentId: "other", order: 900, keywords: [], enabled: true });
    seen.add("other.todo");
  }
  const otherCategory = categories.find((category) => category.id === "other");
  const todoCategory = categories.find((category) => category.id === "other.todo");
  if (settings.ensureFallback) {
    otherCategory.parentId = undefined;
    todoCategory.parentId = "other";
  }

  categories.forEach((category) => {
    if (category.parentId && !seen.has(category.parentId)) {
      throw new Error("父分类不存在：" + category.id + " -> " + category.parentId);
    }
    let depth = 1;
    let current = category;
    const path = new Set([category.id]);
    while (current.parentId) {
      if (path.has(current.parentId)) throw new Error("分类层级存在循环：" + category.id);
      path.add(current.parentId);
      current = categories.find((item) => item.id === current.parentId);
      depth += 1;
      if (depth > 3) throw new Error("分类最多支持三级：" + category.id);
    }
  });
  const rootCount = categories.filter((category) => !category.parentId).length;
  if (rootCount > 10) throw new Error("一级分类不能超过 10 个");
  return categories;
}

async function exportClassifyBatch(message) {
  const config = await getConfig();
  const summary = await db.summary({ includeJobs: false });
  const classificationByBvid = new Map(summary.classifications.map((item) => [item.bvid, item]));
  const includeAll = Boolean(message.includeAll);
  const excludedBvids = new Set(message.excludedBvids || []);
  const offset = Math.max(0, Number(message.offset || 0));
  let candidates = summary.videos
    .filter((video) => !excludedBvids.has(video.bvid))
    .filter((video) => !message.attemptedSources ||
      message.attemptedSources[video.bvid] !== (video.sourceHash || core.computeSourceHash(video)))
    .filter((video) => video.presentInWatchlater !== false)
    .filter((video) => {
      const classification = classificationByBvid.get(video.bvid);
      if (core.isManualClassification(classification)) return false;
      return includeAll || core.needsLlmExport(video, classification);
    })
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  if (message.randomize) candidates = shuffledCopy(candidates);
  const limit = exportLimit(message.limit, config.settings.manualExportLimit ?? config.settings.batchSize, candidates.length);
  const batch = candidates.slice(offset, offset + limit);
  return {
    prompt: core.buildClassificationPrompt(batch, config.categories, Object.assign({}, config.settings, {
      keywordReview: !includeAll,
      titleOnly: Boolean(message.titleOnly),
      compact: Boolean(message.compact)
    })),
    batchVideos: batch,
    categories: config.categories,
    countRemaining: Math.max(0, candidates.length - offset),
    totalCandidates: candidates.length,
    offset,
    batchSize: batch.length,
    mergeMode: "replace"
  };
}

function shuffledCopy(items) {
  const result = (items || []).slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function exportLimit(rawLimit, defaultLimit, total) {
  const number = core.finiteNumberOrNull(rawLimit) ?? core.finiteNumberOrNull(defaultLimit) ?? 80;
  if (rawLimit === "all" || number === 0) return Math.max(0, total);
  return Math.min(500, Math.max(1, Math.floor(number)));
}

async function resetForLlmReclassify() {
  if (autoLlmRunPromise) await autoLlmRunPromise.catch(() => {});
  const summary = await db.summary({ includeJobs: false });
  let removedClassifications = 0;
  let keptManual = 0;

  for (const classification of summary.classifications) {
    const updated = await db.updateClassification(classification.bvid, (current) => {
      if (!current) return;
      if (!core.isManualClassification(current)) return null;
      keptManual += 1;
      if (current.sourceType !== core.CLASSIFICATION_SOURCE_TYPES.MANUAL || !current.manualOverride) {
        return { ...current, sourceType: core.CLASSIFICATION_SOURCE_TYPES.MANUAL, manualOverride: true };
      }
    });
    if (updated === null) removedClassifications += 1;
  }

  const clearedJobs = await db.removeJobsExcept("detail");
  await chrome.storage.local.remove(["autoLlmAttemptedBvids", "autoLlmAttempts", "autoLlmRetryAt"]);
  await chrome.alarms.clear(AUTO_LLM_CONTINUE_ALARM);
  setProgress({
    status: "idle",
    message: "已重置 AI 全局视频分类：清除非手动确认结果 " + removedClassifications + " 项，保留手动确认 " + keptManual + " 项",
    pending: 0,
    running: 0,
    done: 0,
    failed: 0,
    updatedAt: Date.now()
  });

  return Object.assign(await getState(), {
    resetResult: {
      removedClassifications,
      keptManual,
      clearedJobs
    }
  });
}

async function importClassifications(payload, options) {
  const config = await getConfig();
  const summary = await db.summary({ includeJobs: false });
  const parsed = core.parseClassificationPayload(payload);
  const validated = core.validateClassificationItems(parsed.items, config.categories, summary.videos);
  const videosByBvid = new Map(summary.videos.map((video) => [video.bvid, video]));
  let imported = 0;
  let skipped = 0;

  for (const item of validated.items) {
    const video = await db.get("videos", item.bvid) || videosByBvid.get(item.bvid);
    if (!video || video.presentInWatchlater === false) {
      skipped += 1;
      continue;
    }
    const saved = await db.updateClassification(item.bvid, (existing) => {
      const incoming = {
        ...item, classifierVersion: core.CLASSIFIER_VERSION,
        manualOverride: false, sourceType: core.CLASSIFICATION_SOURCE_TYPES.LLM
      };
      if (options.mergeMode === "append" && existing && !core.isManualClassification(existing)) {
        incoming.categoryIds = core.uniqueStrings([...(existing.categoryIds || []), ...(item.categoryIds || [])]);
      }
      const merged = core.mergeClassification(existing, incoming, video);
      return merged.skippedImport ? undefined : merged;
    });
    if (saved) imported += 1;
    else skipped += 1;
  }

  return Object.assign(await getState(), {
    importResult: {
      imported,
      skipped,
      warnings: [...parsed.warnings, ...validated.warnings]
    }
  });
}

function initialClassificationSkipReason(video, existing, options) {
  const source = core.classificationSourceType(existing);
  if (options.unclassifiedOnly && existing && core.uniqueStrings(existing.categoryIds).length) return "unchanged";
  if (source === core.CLASSIFICATION_SOURCE_TYPES.MANUAL) return "manual";
  const needsClassification = core.needsClassification(video, existing);
  if (!needsClassification && (!options.includeAll || source === core.CLASSIFICATION_SOURCE_TYPES.LLM && !options.includeLlm)) {
    return "unchanged";
  }
  return "";
}

async function autoClassify(options) {
  const config = await getConfig();
  const selectedCategoryIds = core.uniqueStrings(options && options.selectedCategoryIds);
  if (selectedCategoryIds.length) {
    const targetedResult = await appendKeywordCategories(selectedCategoryIds, config.categories);
    return Object.assign(await getState(), {
      autoClassifyResult: Object.assign({ targeted: true, selectedCategoryIds }, targetedResult)
    });
  }
  const summary = await db.summary({ includeJobs: false });
  const classificationByBvid = new Map(summary.classifications.map((item) => [item.bvid, item]));
  let classified = 0;
  let skippedManual = 0;
  let reclassifiedManual = 0;
  let unchanged = 0;

  if (!options.silent) {
    setProgress({ status: "running", message: "正在执行本地自动分类", running: 1 });
  }
  for (const video of summary.videos) {
    if (!video || video.presentInWatchlater === false) continue;
    let skipReason = initialClassificationSkipReason(video, classificationByBvid.get(video.bvid), options);
    if (!skipReason) {
      const categoryIds = core.inferCategoryIds(video, config.categories);
      await db.updateClassification(video.bvid, (current) => {
        skipReason = initialClassificationSkipReason(video, current, options);
        if (skipReason) return;
        return core.mergeClassification(current, {
          bvid: video.bvid,
          categoryIds,
          confidence: categoryIds.includes("other.todo") ? 0.45 : 0.68,
          reason: "本地关键词规则自动分类",
          classifierVersion: core.LOCAL_CLASSIFIER_VERSION,
          manualOverride: false,
          sourceType: core.CLASSIFICATION_SOURCE_TYPES.KEYWORD
        }, video);
      });
    }
    if (skipReason === "manual") skippedManual += 1;
    else if (skipReason) unchanged += 1;
    else classified += 1;
  }

  if (!options.silent) {
    setProgress({ status: "idle", message: "本地自动分类完成：写入 " + classified + " 个，跳过手动 " + skippedManual + " 个", running: 0 });
  }
  return Object.assign(await getState(), {
    autoClassifyResult: {
      classified,
      skippedManual,
      reclassifiedManual,
      unchanged
    }
  });
}

async function saveManualClassification(message) {
  const bvid = core.normalizeBvid(message.bvid);
  if (!bvid) throw new Error("缺少 bvid");
  const video = await db.get("videos", bvid);
  if (!video) throw new Error("本地记录中没有这个视频：" + bvid);
  const config = await getConfig();
  const validCategoryIds = core.uniqueStrings(message.categoryIds)
    .filter((id) => config.categories.some((category) => category.id === id && category.enabled !== false));
  if (!validCategoryIds.length && !config.categories.some(category => category.id === "other.todo" && category.enabled !== false)) {
    throw new Error("请至少选择一个有效分类");
  }
  const classification = core.mergeClassification(await db.getClassification(bvid), {
    bvid,
    categoryIds: validCategoryIds.length ? validCategoryIds : ["other.todo"],
    confidence: 1,
    reason: "手动确认",
    manualOverride: true,
    sourceType: core.CLASSIFICATION_SOURCE_TYPES.MANUAL
  }, video, { forceManualOverride: true });
  await db.putClassification(classification);
  return getState();
}

async function bulkUpdateClassifications(message) {
  const bvids = core.uniqueStrings(message.bvids).map(core.normalizeBvid).filter(Boolean);
  if (!bvids.length) throw new Error("没有选择视频");
  const action = core.normalizeText(message.action);
  const config = await getConfig();
  const validIds = new Set(config.categories.filter((category) => category.enabled !== false).map((category) => category.id));
  const videos = await db.getAll("videos");
  const videosByBvid = new Map(videos.map((video) => [video.bvid, video]));
  const selectedCategoryIds = core.uniqueStrings(message.categoryIds);
  if (!["add", "clear"].includes(action)) throw new Error("无效的批量操作");
  if (action === "add" && (!selectedCategoryIds.length || selectedCategoryIds.some(id => !validIds.has(id)))) {
    throw new Error("请选择有效分类");
  }

  let updated = 0;
  for (const bvid of bvids) {
    const video = videosByBvid.get(bvid);
    if (!video) continue;
    if (action === "clear") {
      const removed = await db.updateClassification(bvid, current => current ? null : undefined);
      if (removed === null) updated += 1;
      continue;
    }
    const existing = await db.getClassification(bvid);
    const categoryIds = core.uniqueStrings([...(existing && existing.categoryIds || []), ...selectedCategoryIds]).filter((id) => validIds.has(id));
    const classification = core.mergeClassification(existing, {
      bvid,
      categoryIds,
      confidence: 1,
      reason: "批量添加分类",
      manualOverride: true,
      sourceType: core.CLASSIFICATION_SOURCE_TYPES.MANUAL
    }, video, { forceManualOverride: true });
    await db.putClassification(classification);
    updated += 1;
  }

  return Object.assign(await getState(), {
    bulkUpdateResult: { updated, action }
  });
}

async function addCategory(message) {
  const config = await getConfig();
  const name = core.normalizeText(message.name);
  if (!name) throw new Error("分类名称不能为空");
  const parentId = core.normalizeText(message.parentId);
  if (parentId && !config.categories.some((category) => category.id === parentId && category.enabled !== false)) {
    throw new Error("父分类不存在：" + parentId);
  }
  const id = core.categoryIdFromName(parentId, name, config.categories);
  const siblings = config.categories.filter((category) => (category.parentId || "") === (parentId || ""));
  const order = siblings.reduce((max, category) => Math.max(max, Number(category.order) || 0), 0) + 10;
  const categories = config.categories.concat([{ id, name, parentId: parentId || undefined, order, enabled: true }]);
  await storeCategoryDirectory(categories);
  return Object.assign(await stateAfterCategoryAutoClassify(message), { addedCategory: { id, name, parentId: parentId || undefined, order, enabled: true } });
}

async function saveCategories(message) {
  const config = await getConfig();
  const requestedCategories = normalizeImportedCategories({ categories: message.categories }, {
    allowSmall: true,
    ensureFallback: false
  });
  const categories = requestedCategories;
  const previousIds = new Set(config.categories.filter((category) => category.enabled !== false).map((category) => category.id));
  const nextIds = new Set(categories.map((category) => category.id));
  const addedCategoryIds = categories.map((category) => category.id).filter((id) => !previousIds.has(id));
  const removedIds = new Set(Array.from(previousIds).filter((id) => !nextIds.has(id)));

  await storeCategoryDirectory(categories);
  await cleanupDeletedCategoryReferences(removedIds, categories);
  const keywordResult = message.skipAutoClassify
    ? { checked: 0, matchedVideos: 0, addedAssignments: 0, skipped: true }
    : await appendKeywordCategories(addedCategoryIds, categories);
  return Object.assign(await getState(), {
    categorySaveResult: {
      addedCategoryIds,
      removedCategoryIds: Array.from(removedIds),
      keywordResult
    }
  });
}

async function appendKeywordCategories(categoryIds, categories) {
  const selectedCategoryIds = core.uniqueStrings(categoryIds);
  if (!selectedCategoryIds.length) {
    return { checked: 0, matchedVideos: 0, addedAssignments: 0 };
  }
  const summary = await db.summary({ includeJobs: false });
  let checked = 0;
  let matchedVideos = 0;
  let addedAssignments = 0;

  for (const video of summary.videos) {
    if (!video || video.presentInWatchlater === false) continue;
    checked += 1;
    const matchedIds = core.inferSelectedCategoryIds(video, categories, selectedCategoryIds);
    if (!matchedIds.length) continue;
    let addedCount = 0;
    const updated = await db.updateClassification(video.bvid, (existing) => {
      const existingIds = core.uniqueStrings(existing?.categoryIds);
      const nextIds = core.uniqueStrings(existingIds.concat(matchedIds));
      addedCount = nextIds.length - existingIds.length;
      if (!addedCount) return;
      return existing ? core.appendClassificationCategoryIds(existing, matchedIds) : core.mergeClassification(null, {
        bvid: video.bvid,
        categoryIds: nextIds,
        confidence: 0.68,
        reason: "新增分类的本地关键词追加判定",
        classifierVersion: core.LOCAL_CLASSIFIER_VERSION,
        manualOverride: false,
        sourceType: core.CLASSIFICATION_SOURCE_TYPES.KEYWORD
      }, video);
    });
    if (!updated) continue;
    matchedVideos += 1;
    addedAssignments += addedCount;
  }
  return { checked, matchedVideos, addedAssignments };
}

async function updateCategory(message) {
  const config = await getConfig();
  const id = core.normalizeText(message.id);
  if (!id) throw new Error("缺少分类 id");
  const categories = config.categories.map((category) => Object.assign({}, category));
  const category = categories.find((item) => item.id === id && item.enabled !== false);
  if (!category) throw new Error("分类不存在：" + id);

  const nextName = core.normalizeText(message.name);
  if (nextName) category.name = nextName;

  const nextParentId = core.normalizeText(message.parentId);
  if (nextParentId === id) throw new Error("分类不能设为自己的父分类");
  if (nextParentId && !categories.some((item) => item.id === nextParentId && item.enabled !== false)) {
    throw new Error("父分类不存在：" + nextParentId);
  }
  if (nextParentId && core.descendantsOf(id, categories).includes(nextParentId)) {
    throw new Error("不能移动到自己的子分类下面");
  }
  category.parentId = nextParentId || undefined;
  const siblings = categories.filter((item) => item.id !== id && (item.parentId || "") === (category.parentId || ""));
  category.order = siblings.reduce((max, item) => Math.max(max, Number(item.order) || 0), 0) + 10;

  await storeCategoryDirectory(categories);
  return Object.assign(await stateAfterCategoryAutoClassify(message), { updatedCategory: category });
}

async function deleteCategory(message) {
  const config = await getConfig();
  const id = core.normalizeText(message.id);
  if (!id) throw new Error("缺少分类 id");
  if (!config.categories.some((category) => category.id === id && category.enabled !== false)) {
    throw new Error("分类不存在：" + id);
  }
  const removeIds = new Set(core.descendantsOf(id, config.categories));
  const proposedCategories = config.categories
    .filter((category) => category.enabled !== false && !removeIds.has(category.id))
    .map((category) => Object.assign({}, category));
  const classifications = await db.getAll("classifications");
  const categories = preserveManualCategoryDefinitions(proposedCategories, config.categories, classifications);
  const retainedIds = new Set(categories.map((category) => category.id));
  const deletedIds = new Set(Array.from(removeIds).filter((categoryId) => !retainedIds.has(categoryId)));
  await storeCategoryDirectory(categories);
  await cleanupDeletedCategoryReferences(deletedIds, categories);
  return Object.assign(await stateAfterCategoryAutoClassify(message), { deletedCategoryIds: Array.from(deletedIds) });
}

async function stateAfterCategoryAutoClassify(options) {
  const config = await getConfig();
  const onboardingPending = config.settings.onboardingEligible === true && config.settings.onboardingCompleted !== true;
  if ((options && options.skipAutoClassify) || onboardingPending) {
    return Object.assign(await getState(), {
      autoClassifyResult: { classified: 0, skippedManual: 0, reclassifiedManual: 0, unchanged: 0, skipped: true }
    });
  }
  return autoClassify({ silent: true, includeAll: true });
}

async function cleanupDeletedCategoryReferences(removeIds, categories) {
  const validIds = new Set((categories || []).filter((category) => category.enabled !== false).map((category) => category.id));
  const classifications = await db.getAll("classifications");
  for (const classification of classifications) {
    if (!core.uniqueStrings(classification.categoryIds).some(id => removeIds.has(id) || !validIds.has(id))) continue;
    await db.updateClassification(classification.bvid, (current) => {
      if (!current) return;
      const invalidIds = core.uniqueStrings(current.categoryIds)
        .filter(id => removeIds.has(id) || !validIds.has(id));
      const next = core.removeClassificationCategoryIds(current, invalidIds, validIds.has("other.todo") ? "other.todo" : "");
      return next === current ? undefined : next;
    });
  }
}

function getClassifySummary(videos, classifications) {
  const counts = core.classificationStageCounts(videos, classifications);
  return {
    total: counts.total,
    pendingFineClassification: counts.pending,
    aiClassified: counts.ai,
    manualConfirmed: counts.manual
  };
}
