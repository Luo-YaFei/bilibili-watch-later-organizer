import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('configuration reads stop writing once defaults are present and preserve custom settings', async () => {
  let writes = 0;
  let reads = 0;
  const storage = { settings: { llmApiKey: 'local-test-value', sortDirection: 'asc' } };
  const event = { addListener() {} };
  const sandbox = {
    importScripts() {},
    BiliWLDB: { summary: async () => ({ videos: [], classifications: [] }) },
    chrome: {
      runtime: { onInstalled: event, onStartup: event, onMessage: event },
      alarms: { onAlarm: event }, action: { onClicked: event },
      storage: { local: {
        async get() { reads++; return structuredClone(storage); },
        async set(values) { writes++; Object.assign(storage, structuredClone(values)); }
      } }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), sandbox);
  vm.runInContext(readFileSync(new URL('../src/background.js', import.meta.url), 'utf8'), sandbox);
  await sandbox.getConfig();
  assert.equal(writes, 1);
  for (let i = 0; i < 5; i++) {
    const config = await sandbox.getConfig();
    assert.equal(config.settings.llmApiKey, 'local-test-value');
    assert.equal(config.settings.sortDirection, 'asc');
    assert.ok(config.categories.length > 0);
  }
  assert.equal(writes, 1);
  assert.equal(reads, 6);
  assert.equal(storage.settings.resultBatchSize, 200);
  assert.equal(storage.settings.defaultOpeningCategory, '');
  assert.equal(storage.settings.defaultVideoFilter, '');
  assert.equal(storage.settings.shuffleOnOpen, false);
  await sandbox.updateSettings({ defaultVideoFilter: 'partially-played', shuffleOnOpen: true, resultBatchSize: 12 });
  await sandbox.updateSettings({ defaultVideoFilter: 'unknown', shuffleOnOpen: 'false', resultBatchSize: -10 });
  assert.equal(storage.settings.defaultVideoFilter, 'partially-played');
  assert.equal(storage.settings.shuffleOnOpen, true);
  assert.equal(storage.settings.resultBatchSize, 1);
  await sandbox.updateSettings({ defaultVideoFilter: '', shuffleOnOpen: false, resultBatchSize: 1001 });
  assert.equal(storage.settings.defaultVideoFilter, '');
  assert.equal(storage.settings.shuffleOnOpen, false);
  assert.equal(storage.settings.resultBatchSize, 1000);
  assert.equal(storage.settings.llmApiKey, 'local-test-value');
  storage.categories.push(
    { id: 'custom', name: '自建分类' },
    { id: 'disabled', name: '停用分类', enabled: false },
    { id: 'hidden-child', name: '子分类', parentId: 'disabled' }
  );
  await sandbox.updateSettings({ defaultOpeningCategory: 'category:custom' });
  assert.equal(storage.settings.defaultOpeningCategory, 'category:custom');
  await sandbox.updateSettings({ defaultOpeningCategory: 'category:hidden-child' });
  assert.equal(storage.settings.defaultOpeningCategory, 'category:custom');
  await sandbox.updateSettings({ defaultOpeningCategory: 'pending' });
  assert.equal(storage.settings.defaultOpeningCategory, 'pending');
});

test('detail batches limit requests, stop on an error and keep progress across a restart', async () => {
  let now = 100000;
  let failTags = true;
  let blockCombined = false;
  const requestTimes = [];
  const paths = [];
  const jobs = new Map();
  const videos = new Map();
  const meta = new Map();
  for (let index = 1; index <= 10; index++) {
    const bvid = 'BV' + String(index).padStart(10, '0');
    videos.set(bvid, { bvid, firstSeenAt: index, tags: [] });
    jobs.set(bvid, { id: bvid, bvid, status: index === 10 ? 'running' : 'pending' });
  }
  let scheduledAt = 0;
  const event = { addListener() {} };

  function worker() {
    const sandbox = vm.createContext({
      importScripts() {},
      AbortSignal,
      Date: class extends Date { static now() { return now; } },
      setTimeout(callback, milliseconds) { now += milliseconds; callback(); },
      BiliWLDB: {
        getAll: async () => [...videos.values()],
        get: async (_, key) => meta.get(key),
        put: async (_, value) => meta.set(value.key, value),
        pendingJobs: async () => [...jobs.values()].filter(job => job.status !== 'done'),
        updateJob: async (id, patch) => jobs.set(id, { ...jobs.get(id), ...patch }),
        async upsertVideos(items) {
          const results = items.map(item => {
            const video = sandbox.BiliWLCore.canonicalizeVideo(item, videos.get(item.bvid));
            videos.set(item.bvid, video);
            return { video };
          });
          return { results };
        }
      },
      chrome: {
        runtime: { onInstalled: event, onStartup: event, onMessage: event, sendMessage: async () => {} },
        alarms: { onAlarm: event, create: async (_, { when }) => { scheduledAt = when || now + 60000; }, clear: async () => {} },
        action: { onClicked: event },
        storage: { local: { get: async () => ({}), set: async () => {} } }
      },
      async fetch(value) {
        const url = new URL(value);
        const isTags = url.pathname.includes('/tags');
        paths.push(url.pathname);
        requestTimes.push(now);
        if (blockCombined && url.pathname.endsWith('/detail')) return new Response(null, { status: 412 });
        if (isTags && failTags) return new Response(null, { status: 429, headers: { 'retry-after': '1200' } });
        const bvid = url.searchParams.get('bvid');
        const view = { bvid, title: 'Video', desc: '' };
        return Response.json({ code: 0, data: isTags ? [] : url.pathname.endsWith('/detail')
          ? { View: view, Tags: failTags ? undefined : [] } : view });
      }
    });
    sandbox.URL = URL;
    for (const file of ['shared.js', 'background.js']) {
      vm.runInContext(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), sandbox);
    }
    return sandbox;
  }

  const latest = 'BV0000000010';
  await worker().processDetailQueue();
  assert.deepEqual(requestTimes, [100000, 102000]);
  assert.equal(scheduledAt, now + 1200000);
  assert.equal(videos.get(latest).detailViewCheckedAt, 100000);
  assert.equal(jobs.get(latest).status, 'pending');

  await worker().processDetailQueue();
  assert.equal(requestTimes.length, 2, 'a restarted worker obeys the saved cooldown');
  now = scheduledAt;
  failTags = false;
  await worker().processDetailQueue();
  assert.equal(requestTimes.length, 6, 'complete combined responses use one request per video');
  assert.ok(requestTimes.every((time, index) => !index || time - requestTimes[index - 1] >= 2000));
  assert.equal([...jobs.values()].filter(job => job.status === 'done').length, 4);

  const checked = [...videos.values()].find(video => video.detailCheckedAt);
  assert.equal(worker().shouldFetchDetails(checked), false, 'empty tags and descriptions are valid after checking');
  now = jobs.get(latest).retryAt;
  const firstRequest = requestTimes.length;
  await worker().processDetailQueue();
  assert.equal(videos.get(latest).detailCheckedAt, requestTimes[firstRequest]);
  assert.equal(videos.get(latest).tags.length, 0);

  meta.set('initial-library-sync', { through: 35 });
  for (let index = 11; index <= 36; index++) {
    const bvid = 'BV' + String(index).padStart(10, '0');
    videos.set(bvid, { bvid, firstSeenAt: index, tags: [] });
    jobs.set(bvid, { id: bvid, bvid, status: 'pending' });
  }
  now = scheduledAt;
  const beforeInitial = requestTimes.length;
  await worker().processDetailQueue();
  const initialRequests = requestTimes.slice(beforeInitial);
  assert.equal(initialRequests.length, 20, 'the initial batch has a bounded size');
  assert.ok(initialRequests.every((time, index) => !index || time - initialRequests[index - 1] >= 1000));
  assert.equal(jobs.get('BV0000000036').status, 'pending', 'later additions stay in the regular queue');
  now = scheduledAt;
  await worker().processDetailQueue();
  assert.equal(jobs.get('BV0000000036').status, 'pending');
  now = scheduledAt;
  await worker().processDetailQueue();
  assert.equal(jobs.get('BV0000000036').status, 'done');

  const rejected = 'BV0000000037';
  jobs.set(rejected, { id: rejected, bvid: rejected, status: 'pending' });
  videos.set(rejected, { bvid: rejected, firstSeenAt: 37, tags: [] });
  blockCombined = true;
  const beforeRejection = paths.length;
  await worker().processDetailQueue();
  assert.deepEqual(paths.slice(beforeRejection), ['/x/web-interface/view/detail']);
  now = jobs.get(rejected).retryAt;
  await worker().processDetailQueue();
  assert.deepEqual(paths.slice(beforeRejection + 1), ['/x/web-interface/view', '/x/tag/archive/tags']);
  assert.equal(jobs.get(rejected).status, 'done');
});

test('IndexedDB retries after a blocked or failed open and forgets closed connections', async () => {
  const requests = [];
  const sandbox = vm.createContext({ indexedDB: { open() { const request = {}; requests.push(request); return request; } } });
  vm.runInContext(readFileSync(new URL('../src/idb.js', import.meta.url), 'utf8'), sandbox);
  const { openDB } = sandbox.BiliWLDB;
  const blocked = openDB();
  requests[0].onblocked();
  await assert.rejects(blocked, /数据库/);
  const failed = openDB();
  requests[1].error = new Error('open failed');
  requests[1].onerror();
  await assert.rejects(failed, /open failed/);
  const opened = openDB();
  let lateCloses = 0;
  requests[0].result = { close() { lateCloses++; } };
  requests[0].onsuccess();
  assert.equal(lateCloses, 1);
  let closes = 0;
  const connection = { close() { closes++; } };
  requests[2].result = connection;
  requests[2].onsuccess();
  assert.equal(await opened, connection);
  assert.equal(openDB(), opened);
  connection.onversionchange();
  assert.equal(closes, 1);
  const next = openDB();
  assert.notEqual(next, opened);
  const reopened = { close() {} };
  requests[3].result = reopened;
  requests[3].onsuccess();
  assert.equal(await next, reopened);
});
