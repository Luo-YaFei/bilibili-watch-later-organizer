import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const delays = [];
const sandbox = { setTimeout(resolve, delay) { delays.push(delay); resolve(); } };
vm.runInNewContext(readFileSync(new URL("../src/shared.js", import.meta.url), "utf8"), sandbox);
const core = sandbox.BiliWLCore;
const categories = [
  { id: "study", name: "学习" },
  { id: "study.math", name: "数学", parentId: "study", keywords: ["数学"] },
  { id: "disabled", name: "停用", enabled: false },
  { id: "other.todo", name: "暂未归类" }
];
const videos = [{ bvid: "BV1xx411c7mD", title: "数学课程", cookie: "private", desc: "微积分" }];
const config = { classificationProvider: "jev", jevModel: "jev-latest", jevApiKey: "jev-test-key", llmApiKey: "other-test-key" };
const answer = (choice = "study.math", confidence = 0.9) => ({ model: "jev-1.13.0", answers: {
  video_0: { type: "choice", choice, confidence, probabilities: { [choice]: 1 } }
} });

test("Jev readiness needs only its own model and key", () => {
  assert.equal(core.classificationApiReady(config), true);
  assert.equal(core.classificationApiReady({ ...config, jevApiKey: "" }), false);
  assert.equal(core.classificationApiReady({ ...config, classificationProvider: "openai" }), false);
});

test("Jev requests contain full category paths and allowlisted video metadata", () => {
  const request = core.buildJevRequest(videos, categories, "jev-latest");
  assert.equal(request.questions.video_0.criteria["study.math"].path, "学习/数学");
  assert.equal(request.questions.video_0.criteria.disabled, undefined);
  assert.equal(request.state.videos[0].cookie, undefined);
  assert.equal(request.state.videos[0].bvid, undefined);
  assert.equal(request.state.videos[0].title, "数学课程");
  assert.match(request.questions.video_0.instructions, /state.videos\[0\]/);
});

test("Jev enforces API option and local batch limits before sending", () => {
  assert.throws(() => core.buildJevRequest(videos, [], "jev-latest"), /1–255/);
  assert.throws(() => core.buildJevRequest(videos, Array.from({ length: 256 }, (_, i) => ({ id: String(i), name: String(i) }))), /1–255/);
  assert.throws(() => core.buildJevRequest(Array(6).fill(videos[0]), categories), /1–5/);
});

test("Jev answers match question IDs instead of response order", () => {
  const batch = [...videos, { ...videos[0], bvid: "BV1yy411c7mD" }];
  const request = core.buildJevRequest(batch, categories);
  const data = { answers: { video_1: answer("other.todo").answers.video_0, video_0: answer().answers.video_0 } };
  const result = core.parseJevResponse(data, batch, request);
  assert.equal(result.items[0].categoryIds[0], "study.math");
  assert.equal(result.items[1].bvid, batch[1].bvid);
  assert.equal(result.items[1].categoryIds[0], "other.todo");
});

test("Jev rejects missing, unknown, disabled and malformed answers", () => {
  const request = core.buildJevRequest(videos, categories);
  for (const data of [{}, answer("missing"), answer("disabled"), answer("study.math", "0.9"), answer("study.math", NaN), answer("study.math", -1), answer("study.math", 1.1)]) {
    assert.throws(() => core.parseJevResponse(data, videos, request), /无效/);
  }
});

test("Jev uncertainty and fallback stay pending; manual confirmation still wins", () => {
  const request = core.buildJevRequest(videos, categories);
  for (const data of [answer("study.math", 0.4), answer("other.todo", 0.99)]) {
    const item = core.parseJevResponse(data, videos, request).items[0];
    const classified = core.mergeClassification(null, item, videos[0]);
    assert.equal(core.needsLlmExport(videos[0], classified), true);
    const manual = { ...classified, categoryIds: ["study"], sourceType: "manual", manualOverride: true, confidence: 1 };
    const merged = core.mergeClassification(manual, item, videos[0]);
    assert.equal(merged.skippedImport, true);
    assert.equal(merged.categoryIds[0], "study");
  }
});

test("Jev uses the official endpoint and only the TypeSafe key", async () => {
  const result = await core.classifyWithJev(config, videos, categories, async (url, options, timeout) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(options.headers.authorization, "Bearer jev-test-key");
    assert.equal(options.credentials, undefined);
    assert.equal(timeout, 25000);
    assert.equal(options.body.includes("other-test-key"), false);
    assert.equal(JSON.parse(options.body).model, "jev-latest");
    return { ok: true, status: 200, json: async () => answer() };
  });
  assert.equal(result.items[0].confidence, 0.9);
});

test("Jev retries transient limits with backoff and stops after three attempts", async () => {
  let calls = 0;
  delays.length = 0;
  await assert.rejects(core.classifyWithJev(config, videos, categories, async () => {
    calls++;
    return { ok: false, status: 529 };
  }), /HTTP 529/);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("Jev respects long Retry-After and does not retry authentication errors", async () => {
  for (const response of [{ ok: false, status: 429, headers: { get: () => "60" } }, { ok: false, status: 401 }]) {
    let calls = 0;
    await assert.rejects(core.classifyWithJev(config, videos, categories, async () => { calls++; return response; }), /HTTP/);
    assert.equal(calls, 1);
  }
});
