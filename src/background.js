importScripts("shared.js", "idb.js");

const core = globalThis.BiliWLCore;
const db = globalThis.BiliWLDB;
const CLASSIFICATION_REPAIR_VERSION = "0.2.4";
const ONBOARDING_VERSION = 1;
const AUTO_LLM_ALARM = "auto-llm-classify";
const AUTO_LLM_CONTINUE_ALARM = "auto-llm-classify-continue";
const AUTO_LLM_MAX_BATCHES_PER_WAKE = 2;

let detailRunPromise = null;
let classificationRepairPromise = null;
let initializationPromise = null;
let autoLlmRunPromise = null;
let watchlaterMembershipQueue = Promise.resolve();
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
  if (!alarm || ![AUTO_LLM_ALARM, AUTO_LLM_CONTINUE_ALARM].includes(alarm.name)) return;
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

async function handleMessage(message) {
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
      return removeFromWatchlater(message);
    case core.MESSAGE_TYPES.UPDATE_SETTINGS:
      return updateSettings(message.settings || {});
    case core.MESSAGE_TYPES.OPEN_DASHBOARD:
      await openDashboard();
      return getState();
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
    updates.settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings);
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
}

async function getConfig() {
  await ensureConfig();
  const data = await chromeStorageGet(["settings", "categories"]);
  return {
    settings: Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {}),
    categories: Array.isArray(data.categories) && data.categories.length
      ? data.categories
      : core.DEFAULT_CATEGORIES.map((category) => Object.assign({}, category))
  };
}

async function ensureClassificationRepair() {
  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {});
  if (settings.classificationRepairVersion === CLASSIFICATION_REPAIR_VERSION) return;
  if (!classificationRepairPromise) {
    classificationRepairPromise = runClassificationRepair()
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
    const sourceType = core.classificationSourceType(classification);
    const manualOverride = sourceType === core.CLASSIFICATION_SOURCE_TYPES.MANUAL;
    if (classification.sourceType !== sourceType || Boolean(classification.manualOverride) !== manualOverride) {
      await db.putClassification(Object.assign({}, classification, { sourceType, manualOverride }));
      migrated += 1;
    }
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
  if (Number.isFinite(Number(nextSettings.batchSize))) {
    settings.batchSize = Math.min(100, Math.max(20, Number(nextSettings.batchSize)));
  }
  if (Number.isFinite(Number(nextSettings.manualExportLimit))) {
    settings.manualExportLimit = Math.min(500, Math.max(0, Number(nextSettings.manualExportLimit)));
  }
  if (Number.isFinite(Number(nextSettings.detailConcurrency))) {
    settings.detailConcurrency = Math.min(6, Math.max(1, Number(nextSettings.detailConcurrency)));
  }
  if (Number.isFinite(Number(nextSettings.llmBatchSize))) {
    settings.llmBatchSize = Math.min(100, Math.max(1, Number(nextSettings.llmBatchSize)));
  }
  if (Number.isFinite(Number(nextSettings.llmLimit))) {
    settings.llmLimit = Math.min(10000, Math.max(0, Number(nextSettings.llmLimit)));
  }
  if (Number.isFinite(Number(nextSettings.llmTemperature))) {
    settings.llmTemperature = Math.min(2, Math.max(0, Number(nextSettings.llmTemperature)));
  }
  if (["off", "daily", "weekly", "threshold"].includes(nextSettings.llmAutoClassifyMode)) {
    settings.llmAutoClassifyMode = nextSettings.llmAutoClassifyMode;
  }
  if (Number.isFinite(Number(nextSettings.llmAutoClassifyThreshold))) {
    settings.llmAutoClassifyThreshold = Math.min(10000, Math.max(1, Math.floor(Number(nextSettings.llmAutoClassifyThreshold))));
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
  if (Number.isFinite(Number(nextSettings.onboardingVersion))) {
    settings.onboardingVersion = Number(nextSettings.onboardingVersion);
  }
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

  const summary = await db.summary();
  const counts = core.classificationStageCounts(summary.videos, summary.classifications);
  const threshold = Math.max(1, Number(settings.llmAutoClassifyThreshold) || 50);
  if (triggerName !== AUTO_LLM_CONTINUE_ALARM && mode === "threshold" && counts.pending < threshold) {
    await writeAutoLlmStatus({
      llmAutoClassifyLastStatus: "等待待精细分类达到 " + threshold + " 个；当前 " + counts.pending + " 个"
    });
    return { skipped: true, reason: "below-threshold", pending: counts.pending };
  }
  if (!counts.pending) {
    await writeAutoLlmStatus({ llmAutoClassifyLastStatus: "没有待精细分类的视频" });
    return { skipped: true, reason: "no-pending" };
  }

  const startedAt = Date.now();
  setProgress({ status: "running", message: "正在自动进行 API 视频分类", running: 1, pending: counts.pending, done: 0, failed: 0 });
  try {
    const result = await runAutomaticLlmBatches(settings, triggerName === AUTO_LLM_CONTINUE_ALARM);
    await writeAutoLlmStatus({
      llmAutoClassifyLastRunAt: startedAt,
      llmAutoClassifyLastStatus: "自动分类完成：导入 " + result.imported + " 项，跳过 " + result.skipped + " 项" + (result.remaining ? "；剩余任务稍后继续" : ""),
      llmAutoClassifyLastImported: result.imported
    });
    setProgress({ status: "idle", message: "自动 API 视频分类完成：导入 " + result.imported + " 项", running: 0, pending: result.remaining, done: result.imported, failed: 0 });
    return result;
  } catch (error) {
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

async function runAutomaticLlmBatches(settings, continuing) {
  const batchSize = Math.min(settings.classificationProvider === "jev" ? 5 : 100, Math.max(1, Number(settings.llmBatchSize) || 50));
  const saved = continuing ? await chromeStorageGet(["autoLlmAttemptedBvids"]) : {};
  const excludedBvids = Array.isArray(saved.autoLlmAttemptedBvids) ? saved.autoLlmAttemptedBvids.slice() : [];
  let imported = 0;
  let skipped = 0;
  let batches = 0;
  let remaining = 0;
  while (batches < AUTO_LLM_MAX_BATCHES_PER_WAKE) {
    const exported = await exportClassifyBatch({ includeAll: false, limit: batchSize, offset: 0, excludedBvids });
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
    excludedBvids.push(...exported.batchVideos.map((video) => video.bvid));
    await chromeStorageSet({ autoLlmAttemptedBvids: excludedBvids });
    if (!(importResult.imported || 0)) break;
  }
  const next = await exportClassifyBatch({ includeAll: false, limit: 1, excludedBvids });
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
  if (!response.ok && config.llmUseResponseFormat === true && /response[_ ]format|json_object/i.test(textValue)) {
    response = await sendAutomaticLlmRequest(config, requestPrompt, false);
    textValue = await response.text();
  }
  if (!response.ok) throw new Error("AI API HTTP " + response.status + ": " + textValue.slice(0, 300));
  const data = parseAutomaticJson(textValue);
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";
  if (!content) throw new Error("AI 响应缺少 choices[0].message.content");
  const parsed = parseAutomaticJson(content);
  const items = Array.isArray(parsed && parsed.items)
    ? parsed.items
    : Array.isArray(parsed && parsed.classifications)
      ? parsed.classifications
      : [];
  if (!items.length) throw new Error("AI 返回的 JSON 没有 items/classifications 数组");
  return { items };
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

function parseAutomaticJson(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("JSON 内容为空");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const unfenced = fenced ? fenced[1].trim() : raw;
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    const repaired = candidate
      .replace(/^\uFEFF/, "")
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, "$1\"$2\"$3")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, content) => JSON.stringify(content.replace(/\\"/g, "\"")))
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired);
    } catch (repairError) {
      throw new Error("AI 返回的内容不是严格 JSON：" + repairError.message);
    }
  }
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
  const scanState = await scanWatchlater({ skipAutoClassify: Boolean(message && message.skipAutoClassify) });
  const scanResult = scanState.scanResult || {};
  const autoResult = scanState.autoClassifyResult || {};
  setProgress({
    status: "idle",
    message: "打开时同步完成：扫描 " + (scanResult.scannedCount || 0) + " 个" + (autoResult.skipped ? "，首次引导暂不分类视频" : "，完成初步分类 " + (autoResult.classified || 0) + " 个"),
    running: 0,
    pending: 0,
    updatedAt: Date.now()
  });
  return Object.assign(await getState(), {
    openSyncResult: {
      scanResult,
      autoClassifyResult: autoResult,
      apiError: scanState.apiError || "",
      apiCode: scanState.apiCode == null ? null : scanState.apiCode,
      loginStatus: scanState.loginStatus || "unknown"
    }
  });
}

async function getState() {
  const config = await getConfig();
  const summary = await db.summary();
  return Object.assign({}, summary, config, {
    progress,
    classifySummary: getClassifySummary(summary.videos, summary.classifications)
  });
}

async function scanWatchlater(message) {
  return runWatchlaterMembershipTask(() => scanWatchlaterUnlocked(message));
}

async function scanWatchlaterUnlocked(message) {
  setProgress({ status: "running", message: "正在扫描稍后再看列表", running: 1 });
  let apiItems = [];
  let apiError = "";
  let apiCode = null;
  let apiSucceeded = false;
  let loginStatus = "unknown";
  try {
    apiItems = await fetchWatchlaterFromApi();
    apiSucceeded = true;
    loginStatus = "logged_in";
  } catch (error) {
    apiError = error && error.message ? error.message : String(error);
    apiCode = error && Number.isFinite(Number(error.biliCode)) ? Number(error.biliCode) : null;
    if (apiCode === -101) loginStatus = "logged_out";
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
  const upsertResult = await upsertVideoItems(Array.from(itemsByBvid.values()), { markRemoved, skipState: true });
  const scanCount = itemsByBvid.size;
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
  return Object.assign({
    source: apiSucceeded ? "api+dom" : "dom",
    apiError,
    apiCode,
    loginStatus
  }, upsertResult, autoState);
}

async function upsertVideoItems(items, options) {
  const upsert = await db.upsertVideos(items);
  const scanResult = {
    scannedCount: upsert.results.length,
    newCount: upsert.results.filter((result) => result.isNew).length,
    changedCount: upsert.results.filter((result) => result.sourceChanged).length,
    newBvids: upsert.results.filter((result) => result.isNew).map((result) => result.video.bvid),
    changedBvids: upsert.results.filter((result) => result.sourceChanged).map((result) => result.video.bvid)
  };
  const bvids = upsert.results.map((item) => item.video.bvid);
  if (options && options.markRemoved) {
    const removedBvids = await db.markRemovedExcept(bvids);
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

  const videos = await db.getAll("videos");
  const missingDetailBvids = videos
    .filter((video) => video && video.presentInWatchlater !== false)
    .filter(shouldFetchDetails)
    .map((video) => video.bvid);
  const queued = await db.queueJobs("detail", missingDetailBvids, "manual");
  const jobs = await db.getAll("jobs");
  const activeJobs = jobs.filter((job) => job.type === "detail" && (job.status === "pending" || job.status === "running"));

  if (activeJobs.length) {
    setProgress({ status: "running", message: "已排队 " + activeJobs.length + " 个视频详情", pending: activeJobs.length, running: 0, done: 0, failed: 0 });
    startDetailQueue();
  } else {
    setProgress({ status: "idle", message: "没有缺失详情的视频", pending: 0, running: 0 });
  }

  return Object.assign(await getState(), {
    detailQueueResult: {
      candidates: missingDetailBvids.length,
      queued,
      pending: activeJobs.length
    }
  });
}

function shouldFetchDetails(video) {
  if (!video) return false;
  if (video.viewCount == null) return true;
  if (!video.tname || !video.desc || !Array.isArray(video.tags) || !video.tags.length) return true;
  return false;
}

async function fetchWatchlaterFromApi() {
  const endpoints = [
    "https://api.bilibili.com/x/v2/history/toview?jsonp=jsonp",
    "https://api.bilibili.com/x/v2/history/toview"
  ];
  let lastError = null;
  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        credentials: "include",
        headers: { "accept": "application/json,text/plain,*/*" }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const json = await response.json();
      if (json.code !== 0) {
        const error = new Error(json.message || ("B站接口返回 code " + json.code));
        error.biliCode = Number(json.code);
        throw error;
      }
      const list = findVideoList(json.data);
      return list.map((item, index) => convertBiliApiVideo(item, index)).filter(Boolean);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.biliCode === -101) break;
    }
  }
  throw lastError || new Error("稍后再看接口不可用");
}

function findVideoList(data) {
  if (!data) return [];
  if (Array.isArray(data.list)) return data.list;
  if (data.list && Array.isArray(data.list.list)) return data.list.list;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

function convertBiliApiVideo(item, index) {
  const bvid = core.normalizeBvid(item && (item.bvid || item.bv_id || item.uri || item.redirect_url));
  if (!bvid) return null;
  const owner = item.owner || item.author || {};
  const duration = Number(item.duration) || 0;
  const rawProgress = Number(item.progress);
  const hasProgress = Number.isFinite(rawProgress);
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

async function removeFromWatchlater(message) {
  return runWatchlaterMembershipTask(() => removeFromWatchlaterUnlocked(message));
}

async function removeFromWatchlaterUnlocked(message) {
  const bvid = core.normalizeBvid(message && message.bvid);
  if (!bvid) throw new Error("缺少 bvid");

  const video = await db.get("videos", bvid);
  if (!video) throw new Error("本地记录中没有这个视频：" + bvid);
  // Resolve the current aid from the server list, including unavailable videos.
  const result = await requestWatchlaterRemove(video.aid || video.oid, bvid);
  if (!result || result.verified !== true) throw new Error("未能核实 B站删除结果，请同步列表后重试");
  await db.markRemoved(bvid);
  return Object.assign(await getState(), {
    removeResult: result
  });
}

async function requestWatchlaterRemove(aid, bvid) {
  const csrf = await getBiliCsrf();
  let pageError = null;
  try {
    const tab = await findBilibiliTab() || await loadExistingBilibiliTab();
    if (tab) {
      return await requestWatchlaterRemoveFromPage(aid, csrf, bvid, tab);
    }
  } catch (error) {
    if (error.retryable === false) throw error;
    pageError = error;
  }
  try {
    return readWatchlaterRemovalResult(await performWatchlaterRemoval({ aid, csrf, bvid, deadline: Date.now() + 20000 }));
  } catch (error) {
    if (error.name === "TimeoutError") error = new Error("B站后台删除请求超时，请重试");
    if (pageError) throw new Error(pageError.message + "；后台重试失败：" + error.message);
    throw new Error("没有已加载的 B站页面可用于删除。请点击一个 B站首页或视频标签页，等页面内容显示后返回重试。后台请求失败：" + error.message);
  }
}

function readWatchlaterRemovalResult(result) {
  if (result && result.verified === true) return result;
  const error = new Error(result && result.error || "B站删除请求没有返回可核实的结果");
  error.retryable = result && result.retryable;
  throw error;
}

async function requestWatchlaterRemoveFromPage(aid, csrf, bvid, tab) {
  if (!tab || tab.id == null) {
    throw new Error("B站限制了后台删除请求。请先打开任意 B站页面后重试；插件不会自动打开临时页面");
  }
  let timer;
  const results = await Promise.race([chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    // This request only needs fetch/cookies. Waiting for all page resources can
    // block deletion forever on tabs with stalled images or third-party scripts.
    injectImmediately: true,
    args: [{ aid, csrf, bvid, deadline: Date.now() + 20000 }],
    func: performWatchlaterRemoval
  }), new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("B站页面无响应，请刷新该页面并同步列表后重试"), { retryable: false })), 22000);
  })]).finally(() => clearTimeout(timer));
  return readWatchlaterRemovalResult(results && results[0] && results[0].result);
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
    if (!response.ok) throw new Error("HTTP " + response.status);
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

async function findBilibiliTab() {
  const candidates = await chrome.tabs.query({ url: "https://www.bilibili.com/*" });
  // Restored tabs can be unloaded without being marked discarded or frozen.
  const tabs = (candidates || []).filter((tab) => tab.status !== "unloaded" && !tab.discarded && !tab.frozen && tab.id != null);
  if (!tabs.length) return null;
  return tabs.find((tab) => tab.status === "complete" && tab.active) ||
    tabs.find((tab) => tab.status === "complete") ||
    tabs[0];
}

async function loadExistingBilibiliTab() {
  const candidates = await chrome.tabs.query({ url: "https://www.bilibili.com/*" });
  const candidate = (candidates || []).find((tab) => tab.id != null &&
    (tab.status === "unloaded" || tab.discarded) && !tab.pendingUrl);
  if (!candidate) return null;
  // Recheck before reloading: the user may have started watching this tab.
  const current = await chrome.tabs.get(candidate.id);
  if (!/^https:\/\/www\.bilibili\.com\//.test(current.url || "") || current.pendingUrl) {
    throw new Error("B站标签页正在跳转，请重试");
  }
  if (current.status === "unloaded" || current.discarded) {
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
          if (!/^https:\/\/www\.bilibili\.com\//.test(tab.url || "") ||
              tab.pendingUrl && !/^https:\/\/www\.bilibili\.com\//.test(tab.pendingUrl)) {
            throw new Error("B站标签页正在跳转，请重试");
          }
          if (tab.status !== "unloaded" && !tab.discarded && !tab.frozen) {
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
  if (!detailRunPromise) {
    detailRunPromise = processDetailQueue()
      .catch((error) => setProgress({ status: "error", message: error && error.message ? error.message : String(error), running: 0 }))
      .finally(() => {
        detailRunPromise = null;
      });
  }
}

async function processDetailQueue() {
  const config = await getConfig();
  const concurrency = config.settings.detailConcurrency || 3;
  let pending = await db.pendingJobs("detail");
  setProgress({ status: pending.length ? "running" : "idle", message: pending.length ? "正在更新视频详情" : "没有待更新详情", pending: pending.length, running: 0, done: 0, failed: 0 });

  while (pending.length) {
    const chunk = pending.slice(0, concurrency);
    pending = pending.slice(concurrency);
    setProgress({ running: chunk.length, pending: pending.length });
    await Promise.all(chunk.map(processDetailJob));
  }

  setProgress({ status: "idle", message: "详情更新完成", pending: 0, running: 0 });
}

async function processDetailJob(job) {
  await db.updateJob(job.id, { status: "running", attempts: (job.attempts || 0) + 1 });
  try {
    const details = await fetchVideoDetails(job.bvid);
    await db.upsertVideos([Object.assign({}, details, { bvid: job.bvid })]);
    await db.updateJob(job.id, { status: "done", error: "" });
    setProgress({ done: progress.done + 1 });
  } catch (error) {
    await db.updateJob(job.id, { status: "failed", error: error && error.message ? error.message : String(error) });
    setProgress({ failed: progress.failed + 1 });
  }
}

async function fetchVideoDetails(bvid) {
  const view = await fetchJson("https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid));
  if (!view || view.code !== 0 || !view.data) {
    return fetchVideoDetailsFromHtml(bvid);
  }

  let tags = [];
  try {
    const tagJson = await fetchJson("https://api.bilibili.com/x/tag/archive/tags?bvid=" + encodeURIComponent(bvid));
    if (tagJson && tagJson.code === 0 && Array.isArray(tagJson.data)) {
      tags = tagJson.data.map((tag) => tag.tag_name || tag.name).filter(Boolean);
    }
  } catch (error) {
    tags = [];
  }

  const data = view.data;
  const owner = data.owner || {};
  return {
    bvid: data.bvid || bvid,
    oid: data.aid,
    aid: data.aid,
    title: data.title,
    pageUrl: "https://www.bilibili.com/video/" + (data.bvid || bvid),
    upName: owner.name,
    upMid: owner.mid,
    coverUrl: data.pic,
    tname: data.tname_v2 || data.tname,
    tags,
    desc: data.desc,
    duration: data.duration,
    viewCount: data.stat && data.stat.view,
    pubdate: data.pubdate || data.ctime,
    pageParts: Array.isArray(data.pages) ? data.pages.map((page) => page.part).filter(Boolean) : []
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "accept": "application/json,text/plain,*/*" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

async function fetchVideoDetailsFromHtml(bvid) {
  const response = await fetch("https://www.bilibili.com/video/" + encodeURIComponent(bvid), {
    credentials: "include",
    headers: { "accept": "text/html,*/*" }
  });
  if (!response.ok) throw new Error("详情页 HTTP " + response.status);
  const html = await response.text();
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i);
  const initialMatch = html.match(/window\.__INITIAL_STATE__=([\s\S]*?);\(function\(\)/);
  let parsed = null;
  if (initialMatch) {
    try {
      parsed = JSON.parse(initialMatch[1]);
    } catch (error) {
      parsed = null;
    }
  }
  const videoData = parsed && (parsed.videoData || parsed.videoInfo || {});
  const aid = videoData && videoData.aid || parsed && parsed.aid;
  return {
    bvid,
    oid: aid,
    aid,
    title: videoData && videoData.title ? videoData.title : cleanHtmlText(titleMatch && titleMatch[1]),
    pageUrl: "https://www.bilibili.com/video/" + bvid,
    desc: videoData && videoData.desc ? videoData.desc : cleanHtmlText(descMatch && descMatch[1]),
    tname: videoData && videoData.tname,
    coverUrl: videoData && videoData.pic,
    duration: videoData && videoData.duration,
    viewCount: videoData && videoData.stat && videoData.stat.view,
    pubdate: videoData && (videoData.pubdate || videoData.ctime)
  };
}

function cleanHtmlText(value) {
  return core.normalizeText(String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/_哔哩哔哩_bilibili$/i, ""));
}

function setProgress(patch) {
  progress = Object.assign({}, progress, patch || {}, { updatedAt: Date.now() });
  chrome.runtime.sendMessage({ type: core.MESSAGE_TYPES.JOB_PROGRESS, progress }).catch(() => {});
}

async function exportCategoryProposal(message) {
  const config = await getConfig();
  const summary = await db.summary();
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
  await chromeStorageSet({ categories });
  await cleanupDeletedCategoryReferences(removedIds, categories);

  const onboardingPending = config.settings.onboardingEligible === true && config.settings.onboardingCompleted !== true;
  const keywordResult = message.skipAutoClassify || onboardingPending
    ? { checked: 0, matchedVideos: 0, addedAssignments: 0, skipped: true }
    : await appendKeywordCategories(addedCategoryIds, categories);

  const data = await chromeStorageGet(["settings"]);
  const settings = Object.assign({}, core.DEFAULT_SETTINGS, data.settings || {}, {
    categoryListUpdatedAt: Date.now(),
    categoryListSource: core.normalizeText(message.source) || "llm"
  });
  await chromeStorageSet({ settings });
  return Object.assign(await getState(), {
    categoryImportResult: {
      imported: categories.length,
      roots: categories.filter((category) => !category.parentId).length,
      source: settings.categoryListSource,
      addedCategoryIds,
      removedCategoryIds: Array.from(removedIds),
      keywordResult
    }
  });
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
  const summary = await db.summary();
  const classificationByBvid = new Map(summary.classifications.map((item) => [item.bvid, item]));
  const includeAll = Boolean(message.includeAll);
  const excludedBvids = new Set(message.excludedBvids || []);
  const offset = Math.max(0, Number(message.offset || 0));
  let candidates = summary.videos
    .filter((video) => !excludedBvids.has(video.bvid))
    .filter((video) => video.presentInWatchlater !== false)
    .filter((video) => {
      const classification = classificationByBvid.get(video.bvid);
      if (core.isManualClassification(classification)) return false;
      return includeAll || core.needsLlmExport(video, classification);
    })
    .sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  if (message.randomize) candidates = shuffledCopy(candidates);
  const limit = exportLimit(message.limit, config.settings.manualExportLimit || config.settings.batchSize, candidates.length);
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
  if (rawLimit === "all") return Math.max(0, total);
  const number = Number(rawLimit || defaultLimit || 80);
  if (!Number.isFinite(number)) return Math.min(100, Math.max(1, Number(defaultLimit) || 80));
  return Math.min(100, Math.max(1, number));
}

async function resetForLlmReclassify() {
  const summary = await db.summary();
  let removedClassifications = 0;
  let keptManual = 0;

  for (const classification of summary.classifications) {
    if (core.isManualClassification(classification)) {
      keptManual += 1;
      if (classification.sourceType !== core.CLASSIFICATION_SOURCE_TYPES.MANUAL || !classification.manualOverride) {
        await db.putClassification(Object.assign({}, classification, {
          sourceType: core.CLASSIFICATION_SOURCE_TYPES.MANUAL,
          manualOverride: true
        }));
      }
      continue;
    }
    await db.remove("classifications", classification.bvid);
    removedClassifications += 1;
  }

  await db.clear("jobs");
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
      clearedJobs: (summary.jobs || []).length
    }
  });
}

async function importClassifications(payload, options) {
  const config = await getConfig();
  const summary = await db.summary();
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
    const existing = await db.getClassification(item.bvid);
    const incoming = Object.assign({}, item, {
      classifierVersion: core.CLASSIFIER_VERSION,
      manualOverride: false,
      sourceType: core.CLASSIFICATION_SOURCE_TYPES.LLM
    });
    if (options.mergeMode === "append" && existing && !core.isManualClassification(existing)) {
      incoming.categoryIds = core.uniqueStrings([...(existing.categoryIds || []), ...(item.categoryIds || [])]);
    }
    const merged = core.mergeClassification(existing, incoming, video);
    if (merged.skippedImport) {
      skipped += 1;
      continue;
    }
    await db.putClassification(merged);
    imported += 1;
  }

  return Object.assign(await getState(), {
    importResult: {
      imported,
      skipped,
      warnings: [...parsed.warnings, ...validated.warnings]
    }
  });
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
  const summary = await db.summary();
  const classificationByBvid = new Map(summary.classifications.map((item) => [item.bvid, item]));
  const includeAll = Boolean(options.includeAll);
  const unclassifiedOnly = Boolean(options.unclassifiedOnly);
  let classified = 0;
  let skippedManual = 0;
  let reclassifiedManual = 0;
  let unchanged = 0;

  if (!options.silent) {
    setProgress({ status: "running", message: "正在执行本地自动分类", running: 1 });
  }
  for (const video of summary.videos) {
    if (!video || video.presentInWatchlater === false) continue;
    const existing = classificationByBvid.get(video.bvid);
    const existingSourceType = core.classificationSourceType(existing);
    if (unclassifiedOnly && existing && core.uniqueStrings(existing.categoryIds).length) {
      unchanged += 1;
      continue;
    }
    if (existingSourceType === core.CLASSIFICATION_SOURCE_TYPES.MANUAL) {
      skippedManual += 1;
      continue;
    }
    if (existingSourceType === core.CLASSIFICATION_SOURCE_TYPES.LLM && !core.needsClassification(video, existing) && !options.includeLlm) {
      unchanged += 1;
      continue;
    }
    if (!includeAll && !core.needsClassification(video, existing)) {
      unchanged += 1;
      continue;
    }
    const categoryIds = core.inferCategoryIds(video, config.categories);
    const next = core.mergeClassification(existing, {
      bvid: video.bvid,
      categoryIds,
      confidence: categoryIds.includes("other.todo") ? 0.45 : 0.68,
      reason: "本地关键词规则自动分类",
      classifierVersion: core.LOCAL_CLASSIFIER_VERSION,
      manualOverride: false,
      sourceType: core.CLASSIFICATION_SOURCE_TYPES.KEYWORD
    }, video);
    await db.putClassification(next);
    classified += 1;
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
    const existing = await db.getClassification(bvid);
    const categoryIds = action === "clear"
      ? []
      : core.uniqueStrings([...(existing && existing.categoryIds || []), ...selectedCategoryIds]).filter((id) => validIds.has(id));
    const classification = core.mergeClassification(existing, {
      bvid,
      categoryIds,
      confidence: 1,
      reason: action === "clear" ? "批量清除分类" : "批量添加分类",
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
  await chromeStorageSet({ categories });
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

  await chromeStorageSet({ categories });
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
  const summary = await db.summary();
  const classificationByBvid = new Map(summary.classifications.map((item) => [item.bvid, item]));
  let checked = 0;
  let matchedVideos = 0;
  let addedAssignments = 0;

  for (const video of summary.videos) {
    if (!video || video.presentInWatchlater === false) continue;
    const existing = classificationByBvid.get(video.bvid);
    checked += 1;
    const matchedIds = core.inferSelectedCategoryIds(video, categories, selectedCategoryIds);
    if (!matchedIds.length) continue;
    const existingIds = core.uniqueStrings(existing && existing.categoryIds);
    const nextIds = core.uniqueStrings(existingIds.concat(matchedIds));
    const addedCount = nextIds.length - existingIds.length;
    if (!addedCount) continue;
    const next = existing
      ? core.appendClassificationCategoryIds(existing, matchedIds)
      : core.mergeClassification(null, {
        bvid: video.bvid,
        categoryIds: nextIds,
        confidence: 0.68,
        reason: "新增分类的本地关键词追加判定",
        classifierVersion: core.LOCAL_CLASSIFIER_VERSION,
        manualOverride: false,
        sourceType: core.CLASSIFICATION_SOURCE_TYPES.KEYWORD
      }, video);
    await db.putClassification(next);
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

  await chromeStorageSet({ categories });
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
  await chromeStorageSet({ categories });
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
    const invalidIds = core.uniqueStrings(classification.categoryIds)
      .filter((id) => removeIds.has(id) || !validIds.has(id));
    const next = core.removeClassificationCategoryIds(
      classification,
      invalidIds,
      validIds.has("other.todo") ? "other.todo" : ""
    );
    if (next !== classification) await db.putClassification(next);
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
