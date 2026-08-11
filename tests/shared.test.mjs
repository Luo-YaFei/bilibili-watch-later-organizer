import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCore() {
  const source = readFileSync(new URL("../src/shared.js", import.meta.url), "utf8");
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "shared.js" });
  return sandbox.BiliWLCore;
}

const core = loadCore();

function loadBackgroundHelpers() {
  const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const sandbox = {
    console,
    importScripts() {},
    chrome: {
      runtime: {
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener() {} },
        sendMessage() { return Promise.resolve(); },
        getURL(value) { return value; }
      },
      action: { onClicked: { addListener() {} } },
      tabs: { create() {} },
      alarms: {
        onAlarm: { addListener() {} },
        get() { return Promise.resolve(null); },
        clear() { return Promise.resolve(true); },
        create() {}
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.BiliWLCore = core;
  sandbox.BiliWLDB = {};
  vm.runInNewContext(source, sandbox, { filename: "background.js" });
  return sandbox;
}

test("extension version is consistent across manifests", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(core.EXTENSION_VERSION, "1.2.0");
  assert.equal(manifest.version, core.EXTENSION_VERSION);
  assert.equal(pkg.version, core.EXTENSION_VERSION);
});

function hslHue(value) {
  const match = String(value).match(/^hsl\(([\d.]+)/);
  return match ? Number(match[1]) : NaN;
}

function hueDistance(a, b) {
  const difference = Math.abs(a - b);
  return Math.min(difference, 360 - difference);
}

test("category colors give root categories distinct high-separation hues", () => {
  const categories = Array.from({ length: 10 }, (_, index) => ({
    id: "custom-root-" + index,
    name: "一级分类 " + index,
    order: index * 10,
    enabled: true
  }));
  const hues = categories.map((category) => hslHue(core.categoryColorTokens(categories, category).accent));
  assert.equal(new Set(hues).size, categories.length);
  const distances = hues.flatMap((hue, index) => hues.slice(index + 1).map((otherHue) => hueDistance(hue, otherHue)));
  assert.ok(Math.min(...distances) >= 30);
});

test("category colors keep descendants in their root family while distinguishing every level", () => {
  const categories = [
    { id: "root", name: "根分类", order: 10, enabled: true },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: "root.child-" + index,
      name: "子分类 " + index,
      parentId: "root",
      order: index * 10,
      enabled: true
    })),
    { id: "root.child-0.leaf", name: "孙分类", parentId: "root.child-0", order: 10, enabled: true }
  ];
  const rootHue = hslHue(core.categoryColorTokens(categories, categories[0]).accent);
  const descendantColors = categories.slice(1).map((category) => core.categoryColorTokens(categories, category));
  const descendantHues = descendantColors.map((color) => hslHue(color.accent));
  assert.equal(new Set(descendantColors.map((color) => color.accent)).size, descendantColors.length);
  assert.ok(descendantHues.every((hue) => hueDistance(hue, rootHue) <= 13.1));
  assert.ok(descendantColors.every((color) => color.text.endsWith("46% 23%)")));
});

test("category colors are stable when category input or display order changes", () => {
  const categories = [
    { id: "alpha", name: "Alpha", order: 10, enabled: true },
    { id: "alpha.one", name: "One", parentId: "alpha", order: 10, enabled: true },
    { id: "alpha.two", name: "Two", parentId: "alpha", order: 20, enabled: true },
    { id: "beta", name: "Beta", order: 20, enabled: true }
  ];
  const reordered = categories.slice().reverse().map((category, index) => Object.assign({}, category, { order: index * 10 }));
  categories.forEach((category) => {
    const matching = reordered.find((item) => item.id === category.id);
    assert.deepEqual(core.categoryColorTokens(categories, category), core.categoryColorTokens(reordered, matching));
  });
});

test("category colors degrade gracefully beyond the normal ten-root limit", () => {
  const categories = Array.from({ length: 14 }, (_, index) => ({ id: "overflow-" + index, name: "Root " + index, enabled: true }));
  const accents = categories.map((category) => core.categoryColorTokens(categories, category).accent);
  assert.equal(new Set(accents).size, categories.length);
});

test("sourceHash ignores popularity and volatile fields", () => {
  const base = {
    bvid: "BV1xx411c7mD",
    title: "AI 工具教程",
    upName: "测试UP",
    tname: "计算机技术",
    tags: ["AI", "教程"],
    desc: "介绍工具",
    duration: 600,
    stat: { view: 1 }
  };
  const changedPopularity = Object.assign({}, base, { stat: { view: 999999 }, viewCount: 999999, like: 42 });
  assert.equal(core.computeSourceHash(base), core.computeSourceHash(changedPopularity));
});

test("sourceHash changes when classification-relevant fields change", () => {
  const base = { bvid: "BV1xx411c7mD", title: "AI 工具教程", upName: "测试UP" };
  const changed = { bvid: "BV1xx411c7mD", title: "美食探店", upName: "测试UP" };
  assert.notEqual(core.computeSourceHash(base), core.computeSourceHash(changed));
});

test("canonicalizeVideo preserves watchlater order when details update", () => {
  const existing = core.canonicalizeVideo({
    bvid: "BV1xx411c7mD",
    title: "旧标题",
    watchlaterOrder: 12,
    watchlaterAddedAt: 1700000000
  }, null, { now: 1 });
  const updated = core.canonicalizeVideo({
    bvid: "BV1xx411c7mD",
    title: "新标题",
    pubdate: 1600000000
  }, existing, { now: 2 });
  assert.equal(updated.watchlaterOrder, 12);
  assert.equal(updated.watchlaterAddedAt, 1700000000);
  assert.equal(updated.pubdate, 1600000000);
});

test("watchlater video fields preserve views and normalize finished progress", () => {
  const helpers = loadBackgroundHelpers();
  const converted = helpers.convertBiliApiVideo({
    bvid: "BV1xx411c7mD",
    title: "测试视频",
    duration: 600,
    progress: -1,
    stat: { view: 17234 }
  }, 0);
  const video = core.canonicalizeVideo(converted, null, { now: 1 });
  assert.equal(video.viewCount, 17234);
  assert.equal(video.watchProgress, 600);
  assert.equal(video.isWatched, true);
});

test("watchlater partial progress survives a later detail-only update", () => {
  const helpers = loadBackgroundHelpers();
  const converted = helpers.convertBiliApiVideo({
    bvid: "BV1xx411c7mD",
    title: "测试视频",
    duration: 600,
    progress: 125,
    stat: { view: 9999 }
  }, 0);
  const existing = core.canonicalizeVideo(converted, null, { now: 1 });
  const updated = core.canonicalizeVideo({
    bvid: "BV1xx411c7mD",
    title: "详情更新后的标题",
    viewCount: 10001
  }, existing, { now: 2 });
  assert.equal(updated.watchProgress, 125);
  assert.equal(updated.isWatched, false);
  assert.equal(updated.viewCount, 10001);
});

test("standardVideoUrl always uses the normalized bvid", () => {
  assert.equal(
    core.standardVideoUrl({ bvid: "BV1xx411c7mD", pageUrl: "https://www.bilibili.com/watchlater/#/BVwrong" }),
    "https://www.bilibili.com/video/BV1xx411c7mD"
  );
  assert.equal(
    core.standardVideoUrl("https://www.bilibili.com/video/BV1yy411c7mE?p=2"),
    "https://www.bilibili.com/video/BV1yy411c7mE"
  );
});

test("watchlaterPlaybackUrl uses bvid and aid without trusting cached pageUrl", () => {
  const url = core.watchlaterPlaybackUrl({
    bvid: "BV1xx411c7mD",
    aid: 123456,
    pageUrl: "https://www.bilibili.com/video/BVwrong00000"
  });
  assert.equal(url.startsWith("https://www.bilibili.com/list/watchlater/?"), true);
  assert.match(url, /bvid=BV1xx411c7mD/);
  assert.match(url, /oid=123456/);
  assert.match(url, /watchlater_cfg=/);
  assert.equal(core.watchlaterPlaybackUrl({ bvid: "BV1yy411c7mE" }), "https://www.bilibili.com/video/BV1yy411c7mE");
});

test("classification payload parser accepts items wrapper", () => {
  const parsed = core.parseClassificationPayload(JSON.stringify({
    items: [{ bvid: "BV1xx411c7mD", categoryIds: ["tech.ai.llm"], confidence: 0.9, reason: "AI 教程" }]
  }));
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].bvid, "BV1xx411c7mD");
  assert.deepEqual(Array.from(parsed.items[0].categoryIds), ["tech.ai.llm"]);
});

test("manual override is not replaced by non-manual import", () => {
  const video = core.canonicalizeVideo({ bvid: "BV1xx411c7mD", title: "AI 工具教程" });
  const existing = core.mergeClassification(null, {
    bvid: "BV1xx411c7mD",
    categoryIds: ["tech.ai.llm"],
    confidence: 1,
    manualOverride: true
  }, video, { forceManualOverride: true });
  const merged = core.mergeClassification(existing, {
    bvid: "BV1xx411c7mD",
    categoryIds: ["entertainment.game"],
    confidence: 0.8,
    manualOverride: false
  }, video);
  assert.equal(merged.skippedImport, true);
  assert.deepEqual(Array.from(merged.categoryIds), ["tech.ai.llm"]);
});

test("classification source type distinguishes manual llm and keyword records", () => {
  assert.equal(core.classificationSourceType({
    bvid: "BV1xx411c7mD",
    categoryIds: ["tech.ai.llm"],
    manualOverride: true
  }), "manual");
  assert.equal(core.classificationSourceType({
    bvid: "BV1yy411c7mE",
    categoryIds: ["tech.ai.llm"],
    classifierVersion: core.LOCAL_CLASSIFIER_VERSION
  }), "keyword");
  assert.equal(core.classificationSourceType({
    bvid: "BV1zz411c7mF",
    categoryIds: ["tech.ai.llm"],
    classifierVersion: core.CLASSIFIER_VERSION
  }), "llm");
});

test("keyword classifications are pending LLM export", () => {
  const video = core.canonicalizeVideo({ bvid: "BV1xx411c7mD", title: "AI 工具教程" });
  const keyword = core.mergeClassification(null, {
    bvid: video.bvid,
    categoryIds: ["tech.ai.llm"],
    confidence: 0.68,
    classifierVersion: core.LOCAL_CLASSIFIER_VERSION,
    sourceType: core.CLASSIFICATION_SOURCE_TYPES.KEYWORD
  }, video);
  const llm = core.mergeClassification(null, {
    bvid: video.bvid,
    categoryIds: ["tech.ai.llm"],
    confidence: 0.9,
    sourceType: core.CLASSIFICATION_SOURCE_TYPES.LLM
  }, video);
  assert.equal(core.needsLlmExport(video, null), true);
  assert.equal(core.needsLlmExport(video, keyword), true);
  assert.equal(core.needsLlmExport(video, llm), false);
});

test("classification stages are mutually exclusive and cover every present video", () => {
  const videos = [
    core.canonicalizeVideo({ bvid: "BV1aa411c7mA", title: "无分类" }),
    core.canonicalizeVideo({ bvid: "BV1bb411c7mB", title: "初步分类" }),
    core.canonicalizeVideo({ bvid: "BV1cc411c7mC", title: "AI 分类" }),
    core.canonicalizeVideo({ bvid: "BV1dd411c7mD", title: "手动确认" }),
    core.canonicalizeVideo({ bvid: "BV1ee411c7mE", title: "结果过旧" }),
    core.canonicalizeVideo({ bvid: "BV1ff411c7mF", title: "结果不确定" }),
    core.canonicalizeVideo({ bvid: "BV1gg411c7mG", title: "已移除", presentInWatchlater: false })
  ];
  const classifications = [
    core.mergeClassification(null, { bvid: videos[1].bvid, categoryIds: ["tech"], confidence: 0.8, sourceType: "keyword" }, videos[1]),
    core.mergeClassification(null, { bvid: videos[2].bvid, categoryIds: ["tech"], confidence: 0.9, sourceType: "llm" }, videos[2]),
    core.mergeClassification(null, { bvid: videos[3].bvid, categoryIds: ["tech"], confidence: 1, sourceType: "manual" }, videos[3]),
    Object.assign(core.mergeClassification(null, { bvid: videos[4].bvid, categoryIds: ["tech"], confidence: 0.9, sourceType: "llm" }, videos[4]), { sourceHashAtClassification: "outdated" }),
    core.mergeClassification(null, { bvid: videos[5].bvid, categoryIds: ["tech"], confidence: 0.4, sourceType: "llm" }, videos[5])
  ];
  const counts = core.classificationStageCounts(videos, classifications);
  assert.deepEqual({ ...counts }, { total: 6, pending: 4, ai: 1, manual: 1 });
  assert.equal(counts.pending + counts.ai + counts.manual, counts.total);
});

test("pending fine classification filter includes keyword stale uncertain and invalid results", () => {
  const video = core.canonicalizeVideo({ bvid: "BV1hh411c7mH", title: "筛选测试" });
  const keyword = core.mergeClassification(null, { bvid: video.bvid, categoryIds: ["tech"], confidence: 0.8, sourceType: "keyword" }, video);
  const stale = Object.assign(core.mergeClassification(null, { bvid: video.bvid, categoryIds: ["tech"], confidence: 0.9, sourceType: "llm" }, video), { sourceHashAtClassification: "outdated" });
  const uncertain = core.mergeClassification(null, { bvid: video.bvid, categoryIds: ["tech"], confidence: 0.4, sourceType: "llm" }, video);
  const invalid = core.mergeClassification(null, { bvid: video.bvid, categoryIds: [], confidence: 0.9, sourceType: "llm" }, video);
  const manual = core.mergeClassification(null, { bvid: video.bvid, categoryIds: ["tech"], confidence: 1, sourceType: "manual" }, video);
  [null, keyword, stale, uncertain, invalid].forEach((classification) => {
    assert.equal(core.matchesFilter(video, classification, { includeUnclassified: true }), true);
  });
  assert.equal(core.matchesFilter(video, manual, { includeUnclassified: true }), false);
});

test("matchesFilter handles unclassified and category filters", () => {
  const video = { bvid: "BV1xx411c7mD", presentInWatchlater: true };
  assert.equal(core.matchesFilter(video, null, { includeUnclassified: true }), true);
  assert.equal(core.matchesFilter(video, { categoryIds: ["tech.ai.llm"] }, { categoryIds: ["tech.ai.llm"] }), true);
  assert.equal(core.matchesFilter(video, { categoryIds: ["tech.ai.llm"] }, { categoryIds: ["life.food"] }), false);
});

test("matchesFilter supports duration thresholds and partially played videos", () => {
  const short = { bvid: "BV1aa411c7mA", presentInWatchlater: true, duration: 120, watchProgress: 0 };
  const medium = { bvid: "BV1bb411c7mB", presentInWatchlater: true, duration: 301, watchProgress: 125, isWatched: false };
  const long = { bvid: "BV1cc411c7mC", presentInWatchlater: true, duration: 3600, watchProgress: 3600, isWatched: true };
  assert.equal(core.matchesFilter(short, null, { videoFilter: "duration-120" }), true);
  assert.equal(core.matchesFilter(medium, null, { videoFilter: "duration-300" }), false);
  assert.equal(core.matchesFilter(medium, null, { videoFilter: "duration-600" }), true);
  assert.equal(core.matchesFilter(long, null, { videoFilter: "duration-3600-plus" }), true);
  assert.equal(core.matchesFilter(medium, null, { videoFilter: "partially-played" }), true);
  assert.equal(core.matchesFilter(long, null, { videoFilter: "partially-played" }), false);
});

test("detail-only canonicalization preserves removed watchlater membership", () => {
  const removed = core.canonicalizeVideo({
    bvid: "BV1dd411c7mD",
    title: "已移除",
    presentInWatchlater: false
  });
  const detailed = core.canonicalizeVideo({
    bvid: removed.bvid,
    desc: "补充详情",
    duration: 600
  }, removed);
  assert.equal(detailed.presentInWatchlater, false);
});

test("categoryIdFromName creates stable ids under parent", () => {
  assert.equal(core.categoryIdFromName("", "研究", core.DEFAULT_CATEGORIES), "研究");
  const id = core.categoryIdFromName("entertainment", "个人影单", core.DEFAULT_CATEGORIES);
  assert.equal(id, "entertainment.个人影单");
  const nextId = core.categoryIdFromName("entertainment", "个人影单", core.DEFAULT_CATEGORIES.concat([{ id, name: "个人影单", parentId: "entertainment" }]));
  assert.equal(nextId, "entertainment.个人影单-2");
});

test("selected keyword classification only returns matching target categories", () => {
  const categories = [
    { id: "hobby", name: "兴趣", enabled: true, keywords: [] },
    { id: "hobby.woodwork", name: "木工", parentId: "hobby", enabled: true, keywords: ["榫卯"] },
    { id: "hobby.fishing", name: "钓鱼", parentId: "hobby", enabled: true, keywords: [] }
  ];
  assert.deepEqual(Array.from(core.inferSelectedCategoryIds(
    { title: "榫卯家具制作入门" },
    categories,
    ["hobby.woodwork", "hobby.fishing"]
  )), ["hobby.woodwork"]);
});

test("targeted keyword append keeps manual source while adding a new category", () => {
  const manual = {
    bvid: "BV1xx411c7mD",
    categoryIds: ["study"],
    sourceType: "manual",
    manualOverride: true,
    classifiedAt: 100
  };
  const appended = core.appendClassificationCategoryIds(manual, ["hobby.woodwork"], 200);
  assert.deepEqual(Array.from(appended.categoryIds), ["study", "hobby.woodwork"]);
  assert.equal(appended.sourceType, "manual");
  assert.equal(appended.manualOverride, true);
  assert.equal(appended.classifiedAt, 200);
});

test("targeted keyword append keeps fine AI source while adding a new category", () => {
  const llm = {
    bvid: "BV1xx411c7mD",
    categoryIds: ["tech.dev.backend"],
    sourceType: "llm",
    manualOverride: false,
    confidence: 0.92,
    classifiedAt: 100
  };
  const appended = core.appendClassificationCategoryIds(llm, ["tech.ai"], 200);
  assert.deepEqual(Array.from(appended.categoryIds), ["tech.dev.backend", "tech.ai"]);
  assert.equal(appended.sourceType, "llm");
  assert.equal(appended.confidence, 0.92);
  assert.equal(appended.classifiedAt, 200);
});

test("manual category directory deletion removes ids without changing manual source", () => {
  const manual = {
    bvid: "BV1xx411c7mD",
    categoryIds: ["study", "removed.category"],
    sourceType: "manual",
    manualOverride: true,
    classifiedAt: 100
  };
  const cleaned = core.removeClassificationCategoryIds(manual, ["removed.category"], "other.todo", 200);
  assert.deepEqual(Array.from(cleaned.categoryIds), ["study"]);
  assert.equal(cleaned.sourceType, "manual");
  assert.equal(cleaned.manualOverride, true);
  assert.equal(cleaned.classifiedAt, 200);
});

test("default categories include finer third-level categories", () => {
  const ids = new Set(core.DEFAULT_CATEGORIES.map((category) => category.id));
  assert.equal(ids.has("study.course.language"), true);
  assert.equal(ids.has("tech.ai.llm"), true);
  assert.equal(ids.has("tech.dev.backend"), true);
  assert.equal(ids.has("entertainment.film.commentary"), true);
  assert.equal(ids.has("life.pets"), true);
  assert.equal(ids.has("information.science"), true);
  assert.equal(ids.has("entertainment.anime-film.queer"), false);
});

test("local inference assigns fine categories from metadata", () => {
  const aiIds = core.inferCategoryIds({
    bvid: "BV1xx411c7mD",
    title: "ChatGPT Agent 工作流教程",
    tags: ["AI", "大模型"]
  }, core.DEFAULT_CATEGORIES);
  assert.equal(aiIds.includes("tech.ai.llm"), true);

  assert.equal(core.inferCategoryIds({
    bvid: "BV1yy411c7mE",
    title: "英语听力和 PTE 口语训练"
  }, core.DEFAULT_CATEGORIES).includes("study.course.language"), true);

  assert.equal(core.inferCategoryIds({
    bvid: "BV1zz411c7mF",
    title: "一部高分电影剧情解析"
  }, core.DEFAULT_CATEGORIES).includes("entertainment.film.commentary"), true);
});

test("new keyword rules fall back to legacy category ids for upgraded users", () => {
  const legacyCategories = [
    { id: "study", name: "学习", enabled: true },
    { id: "study.ai", name: "AI", parentId: "study", enabled: true },
    { id: "study.ai.llm", name: "大模型", parentId: "study.ai", enabled: true },
    { id: "other", name: "其他", enabled: true },
    { id: "other.todo", name: "暂未归类", parentId: "other", enabled: true }
  ];
  const ids = core.inferCategoryIds({ title: "ChatGPT 大模型入门" }, legacyCategories);
  assert.equal(ids.includes("study.ai.llm"), true);
});

test("compact first-run prompt only includes bvid and title", () => {
  const prompt = core.buildClassificationPrompt([{
    bvid: "BV1xx411c7mD",
    title: "一个用于首次分类的标题",
    upName: "不应出现的UP主",
    desc: "不应出现的长简介",
    tags: ["不应出现的标签"]
  }], core.DEFAULT_CATEGORIES, { titleOnly: true, compact: true, keywordReview: true });
  assert.equal(prompt.includes("一个用于首次分类的标题"), true);
  assert.equal(prompt.includes("不应出现的UP主"), false);
  assert.equal(prompt.includes("不应出现的长简介"), false);
  assert.equal(prompt.includes("只提供标题"), true);
});

test("category proposal prompt updates the category list instead of classifying videos", () => {
  const prompt = core.buildCategoryProposalPrompt([
    { bvid: "BV1xx411c7mD", title: "木工榫卯入门教程", desc: "不应发送的简介" },
    { bvid: "BV1yy411c7mE", title: "独立游戏开发记录" }
  ], core.DEFAULT_CATEGORIES, { sampleLimit: 20 });
  assert.equal(prompt.includes("生成并替换可选分类目录，不是给每个视频分配分类"), true);
  assert.equal(prompt.includes("\"categories\""), true);
  assert.equal(prompt.includes("keywords"), true);
  assert.equal(prompt.includes("木工榫卯入门教程"), true);
  assert.equal(prompt.includes("BV1xx411c7mD"), false);
  assert.equal(prompt.includes("不应发送的简介"), false);
});

test("custom category keywords participate in local video classification", () => {
  const categories = [
    { id: "hobby", name: "兴趣", enabled: true, keywords: ["爱好"] },
    { id: "hobby.woodwork", name: "木工", parentId: "hobby", enabled: true, keywords: ["榫卯", "木工"] },
    { id: "other", name: "其他", enabled: true },
    { id: "other.todo", name: "暂未归类", parentId: "other", enabled: true }
  ];
  const ids = core.inferCategoryIds({ title: "零基础木工榫卯教程" }, categories);
  assert.deepEqual(Array.from(ids), ["hobby.woodwork"]);
});

test("imported category trees are validated and receive required fallback categories", () => {
  const background = loadBackgroundHelpers();
  const categories = background.normalizeImportedCategories({ categories: [
    { id: "study", name: "学习", parentId: "", order: 10, keywords: ["教程"] },
    { id: "study.language", name: "语言", parentId: "study", order: 10, keywords: ["英语"] },
    { id: "entertainment", name: "娱乐", parentId: "", order: 20, keywords: ["游戏"] },
    { id: "life", name: "生活", parentId: "", order: 30, keywords: ["日常"] }
  ] });
  assert.equal(categories.some((category) => category.id === "other" && !category.parentId), true);
  assert.equal(categories.some((category) => category.id === "other.todo" && category.parentId === "other"), true);
  assert.deepEqual(Array.from(categories.find((category) => category.id === "study").keywords), ["教程"]);
  assert.throws(() => background.normalizeImportedCategories({ categories: [
    { id: "a", name: "A" },
    { id: "a.b", name: "B", parentId: "a" },
    { id: "a.b.c", name: "C", parentId: "a.b" },
    { id: "a.b.c.d", name: "D", parentId: "a.b.c" }
  ] }), /最多支持三级/);

  const preserved = background.preserveManualCategoryDefinitions(categories, [
    { id: "private", name: "我的分类", enabled: true },
    { id: "private.keep", name: "必须保留", parentId: "private", enabled: true },
    { id: "discard", name: "可删除", enabled: true }
  ], [{
    bvid: "BV1xx411c7mD",
    categoryIds: ["private.keep"],
    manualOverride: true,
    sourceType: core.CLASSIFICATION_SOURCE_TYPES.MANUAL
  }]);
  assert.equal(preserved.some((category) => category.id === "private"), true);
  assert.equal(preserved.some((category) => category.id === "private.keep"), true);
  assert.equal(preserved.some((category) => category.id === "discard"), false);
});

test("background scan only fills unclassified videos and does not auto queue details", () => {
  const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const scanStart = source.indexOf("async function scanWatchlater");
  const upsertStart = source.indexOf("async function upsertVideoItems");
  const detailQueueStart = source.indexOf("async function queueMissingVideoDetails");
  const scanSource = source.slice(scanStart, upsertStart);
  const upsertSource = source.slice(upsertStart, detailQueueStart);
  assert.match(scanSource, /autoClassify\(\{ silent: true, unclassifiedOnly: true \}\)/);
  assert.match(scanSource, /const trustedItems = apiSucceeded \? apiItems : domItems/);
  assert.match(scanSource, /trustedItems\.forEach/);
  assert.equal(scanSource.includes("[...apiItems, ...domItems]"), false);
  assert.equal(scanSource.includes("queueMissingVideoDetails("), false);
  assert.equal(upsertSource.includes("queueJobs("), false);
  assert.match(source, /FETCH_VIDEO_DETAILS:[\s\S]*?queueMissingVideoDetails\(\)/);
});

test("dashboard consolidates AI classification, category generation and API settings", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
  assert.match(dashboard, /sort-combo/);
  assert.match(dashboard, /添加时间-降序/);
  assert.match(dashboard, /添加时间-升序/);
  assert.match(dashboard, /sync-refresh/);
  assert.match(dashboard, /AI 批量视频分类/);
  assert.match(dashboard, /手动导入\/导出/);
  assert.match(dashboard, /使用 API 生成/);
  assert.match(dashboard, /手动复制 Prompt/);
  assert.match(dashboard, /测试 API/);
  assert.match(dashboard, /textContent: "设置API"/);
  assert.match(dashboard, /toggle-settings-panel/);
  assert.match(dashboard, /toggle-api-settings/);
  assert.match(dashboard, /自动 API 视频分类/);
  assert.match(dashboard, /待精细分类达到指定数量/);
  assert.match(dashboard, /编辑分类目录/);
  assert.equal(dashboard.includes("手动编辑分类目录"), false);
  assert.match(dashboard, /manual-export-limit/);
  assert.equal(dashboard.includes("keyword" + "判定"), false);
  assert.match(css, /\.exchange-panel textarea/);
});

test("dashboard renders watch progress and reorders category subtrees without automatic sync", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
  const reorderStart = background.indexOf("async function reorderCategory");
  const deleteStart = background.indexOf("async function deleteCategory");
  const reorderSource = background.slice(reorderStart, deleteStart);
  assert.match(dashboard, /view-count-badge/);
  assert.match(dashboard, /watch-progress-value/);
  assert.match(dashboard, /formatDuration\(watchProgress\) \+ "\/" \+ formatDuration\(duration\)/);
  assert.match(dashboard, /category-tree-group/);
  assert.match(dashboard, /categoryDropTargetGroup/);
  assert.match(dashboard, /event\.preventDefault\(\);[\s\S]*?categoryNav\.scrollTop \+= event\.deltaY/);
  assert.equal(dashboard.includes('syncAfterCategoryStructureChange("分类顺序已更新")'), false);
  assert.match(reorderSource, /message\.position === "after"/);
  assert.match(reorderSource, /await getState\(\)/);
  assert.equal(reorderSource.includes("stateAfterCategoryAutoClassify"), false);
  assert.match(css, /\.category-tree-group\.drop-before::before/);
  assert.match(css, /\.watch-progress-value/);
});

test("dashboard exposes the manual default state and redesigned fixed batch controls", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
  assert.match(dashboard, /选择一种调整方式/);
  assert.match(dashboard, /event\.target === grid/);
  assert.match(dashboard, /添加分类到选中视频/);
  assert.match(dashboard, /清除选中视频中所有现有分类/);
  assert.match(dashboard, /batch-category-swatch/);
  assert.match(css, /\.topbar[\s\S]*?position: sticky/);
  assert.match(css, /\.batch-panel[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(css, /\.cover-wrap[\s\S]*?flex: 0 0 auto/);
});

test("watchlater removal wiring is exposed in manifest background dashboard and db", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const content = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  const idb = readFileSync(new URL("../src/idb.js", import.meta.url), "utf8");
  assert.equal(manifest.permissions.includes("cookies"), true);
  assert.equal(manifest.permissions.includes("tabs"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(core.MESSAGE_TYPES.REMOVE_FROM_WATCHLATER, "REMOVE_FROM_WATCHLATER");
  assert.equal(core.MESSAGE_TYPES.REMOVE_FROM_WATCHLATER_PAGE, "REMOVE_FROM_WATCHLATER_PAGE");
  assert.match(background, /REMOVE_FROM_WATCHLATER:[\s\S]*?removeFromWatchlater\(message\)/);
  assert.match(background, /x\/v2\/history\/toview\/del/);
  assert.match(background, /body\.set\("aid", String\(aid\)\)/);
  assert.match(background, /referrer: "https:\/\/www\.bilibili\.com\/"/);
  assert.match(background, /referrerPolicy: "strict-origin-when-cross-origin"/);
  assert.match(background, /requestWatchlaterRemoveFromPage/);
  assert.match(background, /chrome\.tabs\.query/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /world: "MAIN"/);
  assert.match(background, /await waitForTabComplete\(tab\.id\)/);
  assert.match(background, /B站删除\|HTTP 412/);
  assert.match(content, /REMOVE_FROM_WATCHLATER_PAGE/);
  assert.match(content, /removeFromWatchlaterOnPage/);
  assert.match(content, /card === link \|\| !card\.querySelector \|\| !card\.querySelector\("img"\)/);
  assert.equal(background.includes("csrf_token"), false);
  assert.match(dashboard, /remove-watchlater/);
  assert.match(dashboard, /watchlaterPlaybackUrl/);
  assert.match(dashboard, /className: "cover-link"[\s\S]*?standardVideoUrl\(video\)/);
  assert.match(dashboard, /batchMode \? renderCover\(video\) : el\("a"/);
  assert.match(dashboard, /title: "移出稍后再看"/);
  assert.match(dashboard, /"aria-label": "移出稍后再看"/);
  assert.match(dashboard, /video\.presentInWatchlater = false/);
  assert.match(dashboard, /已从列表移除，正在向 B站确认/);
  assert.match(dashboard, /移出失败，视频已恢复/);
  assert.equal(dashboard.includes('title: "移出稍后再看？"'), false);
  assert.match(dashboard, /title: "删除分类？"/);
  assert.match(dashboard, /iconNode\("trash"\)/);
  assert.match(dashboard, /textContent: category\.name \|\| category\.id/);
  assert.match(dashboard, /toolbarIconButton\("open-bili-dynamic", "B站动态", "dynamic"\)/);
  assert.equal(dashboard.includes("普通打开"), false);
  assert.match(dashboard, /稍后合集中打开/);
  assert.match(idb, /async function markRemoved\(bvid\)/);
});

test("manifest exposes blue extension icons and homepage dashboard entry", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const dashboardHtml = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const content = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  assert.equal(manifest.icons["128"], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon["48"], "icons/icon-48.png");
  const iconSvg = readFileSync(new URL("../icons/icon.svg", import.meta.url), "utf8");
  assert.match(iconSvg, /fill="#00aeec"/);
  assert.match(iconSvg, /stroke="#ffffff"/);
  assert.equal(iconSvg.includes("Gradient"), false);
  assert.equal(iconSvg.includes("DropShadow"), false);
  assert.equal(manifest.content_scripts[0].matches.includes("https://www.bilibili.com/*"), true);
  assert.match(dashboardHtml, /icons\/icon-32\.png/);
  assert.match(content, /HOME_BUTTON_ID/);
  assert.match(content, /isBiliHomePage/);
  assert.match(content, /top = "20%"/);
  assert.match(content, /createLogoSvg/);
  assert.match(content, /width: 46px; height: 46px/);
  assert.match(content, /background: #00aeec/);
  assert.match(content, /svg \{ width: 25px; height: 25px/);
  assert.equal(content.includes("radial-gradient"), false);
  assert.equal(content.includes("drop-shadow"), false);
  assert.match(content, /OPEN_DASHBOARD/);
});

test("dashboard keeps stats in the right rail and removes duplicate video header", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
  const sidebarStart = dashboard.indexOf("function renderSidebar");
  const statsStart = dashboard.indexOf("function renderStats");
  const sidebarSource = dashboard.slice(sidebarStart, statsStart);
  assert.equal(sidebarSource.includes("renderStats()"), false);
  assert.equal(dashboard.includes("视频处理"), false);
  assert.match(dashboard, /"全部视频"/);
  assert.match(dashboard, /"待精细分类"/);
  assert.match(dashboard, /"AI 已分类"/);
  assert.match(dashboard, /"手动确认"/);
  assert.match(dashboard, /pendingFineClassification/);
  assert.match(dashboard, /aiClassified/);
  assert.match(dashboard, /manualConfirmed/);
  assert.equal(dashboard.includes('statNode((state.jobs || [])'), false);
  assert.match(dashboard, /renderEditorHeader\(\)/);
  assert.match(dashboard, /className: "activity-status status-" \+ kind/);
  assert.match(css, /\.editor-sticky-header[\s\S]*position: sticky/);
  assert.match(css, /\.activity-status\.status-error/);
});

test("background has one-time classification repair migration", () => {
  const source = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(source, /CLASSIFICATION_REPAIR_VERSION = "0\.2\.4"/);
  assert.match(source, /classificationRepairVersion/);
  assert.match(source, /classificationSourceType/);
  assert.equal(source.includes("includeManual: true"), false);
});

test("auto LLM script contains no committed API key and calls export/import messages", () => {
  const source = readFileSync(new URL("../scripts/auto-llm-classify.js", import.meta.url), "utf8");
  assert.match(source, /CONFIG/);
  assert.match(source, /apiKey: "YOUR_API_KEY_HERE"/);
  assert.equal(/sk-[A-Za-z0-9_-]{20,}/.test(source), false);
  assert.match(source, /EXPORT_CLASSIFY_BATCH/);
  assert.match(source, /IMPORT_CLASSIFICATIONS/);
  assert.match(source, /RESET_FOR_LLM_RECLASSIFY/);
  assert.match(source, /BiliWLAutoLlmClassify/);
});

test("dashboard exposes AI API batch video classification controls", () => {
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(source, /AI \(API\) 批量视频分类/);
  assert.match(source, /llm-base-url/);
  assert.match(source, /startLlmRun/);
  assert.match(source, /EXPORT_CLASSIFY_BATCH/);
  assert.match(source, /IMPORT_CLASSIFICATIONS/);
  assert.match(source, /fetchWithTimeout/);
  assert.match(source, /repairLooseJson/);
  assert.match(source, /chatCompletionsUrl/);
  assert.match(source, /sendLlmRequest/);
  assert.match(source, /AI 返回的内容不是严格 JSON/);
});

test("automatic API classification uses alarms and preserves manual results", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  assert.equal(manifest.permissions.includes("alarms"), true);
  assert.equal(core.DEFAULT_SETTINGS.llmAutoClassifyMode, "off");
  assert.equal(core.DEFAULT_SETTINGS.llmAutoClassifyThreshold, 50);
  assert.match(background, /AUTO_LLM_ALARM/);
  assert.match(background, /periodInMinutes: 24 \* 60/);
  assert.match(background, /periodInMinutes: 7 \* 24 \* 60/);
  assert.match(background, /mode === "threshold"/);
  assert.match(background, /core\.classificationStageCounts/);
  assert.match(background, /exportClassifyBatch\(\{ includeAll: false/);
  assert.match(background, /importClassifications\(JSON\.stringify\(payload\)/);
  assert.match(background, /core\.isManualClassification\(classification\)/);
});

test("fresh install onboarding detects login and exposes three first classification paths", () => {
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/dashboard.css", import.meta.url), "utf8");
  assert.match(background, /details\.reason === "install"/);
  assert.match(background, /onboardingEligible: true/);
  assert.match(background, /apiCode === -101/);
  assert.match(background, /loginStatus = "logged_out"/);
  assert.match(background, /name: "SESSDATA"/);
  assert.match(background, /if \(message\.randomize\) candidates = shuffledCopy/);
  assert.match(dashboard, /请先登录 B站/);
  assert.match(dashboard, /正在检查 B站登录状态/);
  assert.match(dashboard, /我要手动设置我的分类/);
  assert.match(dashboard, /我有 API，让 AI 帮我调整分类/);
  assert.match(dashboard, /我没有 API，手动复制 Prompt 来生成分类目录/);
  assert.match(dashboard, /open-onboarding-api-settings/);
  assert.match(dashboard, /llm-base-url/);
  assert.match(dashboard, /onboarding-prompt-import/);
  assert.match(dashboard, /EXPORT_CATEGORY_PROPOSAL/);
  assert.match(dashboard, /IMPORT_CATEGORIES/);
  assert.match(dashboard, /新的分类目录已生成/);
  assert.match(dashboard, /还需要手动调整吗/);
  assert.match(dashboard, /back-onboarding-setup/);
  assert.match(dashboard, /手动调整一个视频分类/);
  assert.match(dashboard, /AI \(手动导入\/导出\) 批量视频分类/);
  assert.match(dashboard, /启动 AI \(API\) 批量视频分类/);
  assert.match(dashboard, /finishClassificationAndSync/);
  assert.match(css, /\.onboarding-overlay/);
  assert.match(css, /\.onboarding-banner/);
  assert.equal(css.includes("backdrop-filter"), false);
});

test("onboarding category-list updates do not classify videos before step three", () => {
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const importStart = background.indexOf("async function importCategories");
  const preserveStart = background.indexOf("function preserveManualCategoryDefinitions");
  const importSource = background.slice(importStart, preserveStart);
  assert.equal(importSource.includes("autoClassify("), false);
  assert.match(importSource, /appendKeywordCategories\(addedCategoryIds, categories\)/);
  assert.match(dashboard, /confirmAndImportCategories\(payload, "api", "API"\)/);
  assert.match(dashboard, /confirmAndImportCategories\(parseJsonObject\(payload\), "prompt", "手动 Prompt"\)/);
  assert.match(dashboard, /source,\s*skipAutoClassify: onboardingActive\(\)/);
  assert.match(background, /message\.skipAutoClassify[\s\S]*?暂不分类视频/);
  assert.match(dashboard, /SYNC_ON_OPEN, skipAutoClassify: onboardingActive\(\)/);
  assert.match(dashboard, /syncAfterCategoryListChange/);
  assert.match(dashboard, /skipAutoClassify: onboardingActive\(\) && onboardingStage\(\) === "setup-categories"/);
  assert.match(dashboard, /分类目录已确定，接下来给视频分类/);
});

test("manual category directory save applies additions and deletions to every classification source", () => {
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(dashboard, /type: message\.SAVE_CATEGORIES/);
  assert.match(background, /cleanupDeletedCategoryReferences\(removedIds, categories\)/);
  assert.match(background, /appendKeywordCategories\(addedCategoryIds, categories\)/);
  assert.match(background, /const categories = requestedCategories/);
  assert.equal(background.includes("if (core.isManualClassification(existing))"), false);
  assert.equal(background.includes("if (core.isManualClassification(classification)) continue"), false);
  assert.match(background, /core\.appendClassificationCategoryIds\(existing, matchedIds\)/);
  assert.match(background, /core\.removeClassificationCategoryIds/);
  assert.equal(dashboard.includes("export-selected-categories"), false);
  assert.match(dashboard, /\(children \|\| \[\]\)\.filter\(Boolean\)\.forEach/);
});

test("sync keyword classification only fills videos without an existing category", () => {
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(background, /autoClassify\(\{ silent: true, unclassifiedOnly: true \}\)/);
  assert.match(background, /unclassifiedOnly && existing && core\.uniqueStrings\(existing\.categoryIds\)\.length/);
});

test("LLM batch import refreshes state and reads latest video records", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
  assert.match(dashboard, /updateState\(importedState\)/);
  assert.match(background, /await db\.get\("videos", item\.bvid\)/);
  assert.match(background, /await db\.getClassification\(item\.bvid\)/);
});
