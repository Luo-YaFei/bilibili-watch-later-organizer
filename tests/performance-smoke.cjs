const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));

// Local simulated data and a disposable browser profile; no Bilibili requests.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://performance.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      if (name.startsWith('covers/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#ccc"/></svg>' });
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = Array.from({ length: 1000 }, (_, i) => core.canonicalizeVideo({
          bvid: 'BV1xx411' + String(i).padStart(4, '0'), title: '性能测试 ' + i,
          coverUrl: 'http://performance.test/covers/' + i + '.svg',
          upName: i % 2 ? '学习' : '音乐', duration: 120, watchlaterOrder: i, presentInWatchlater: true
        }));
        state.classifications = state.videos.map(v => ({ bvid: v.bvid, categoryIds: ['other.todo'], sourceType: 'manual' }));
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {
          throw new Error('local paging should not send background messages');
        } } };
        globalThis.perfSubject = {
          filter: value => { searchText = value; renderVideoResults(); },
          repaint: () => renderShell(),
          remember: index => { lastOpenedBvid = state.videos[index].bvid; return lastOpenedBvid; },
          batch: () => { batchMode = true; updateBatchModeSurface(); },
          select: () => { selectedBvids.add(state.videos[0].bvid); updateSelectionUi(); },
          selection: () => [...selectedBvids]
        };
        const started = performance.now();
        init();
        globalThis.initialRenderMs = performance.now() - started;
      `).replace('    bootstrap();', ''));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'image/svg+xml' });
    });
    let coverRequests = 0;
    page.on('request', request => { if (request.url().includes('/covers/')) coverRequests++; });
    await page.goto('http://performance.test/dashboard.html');
    await page.waitForTimeout(600);
    const initialCoverRequests = coverRequests;
    assert.ok(initialCoverRequests > 0 && initialCoverRequests < 200, 'Only nearby covers should load on opening');
    assert.equal(await page.locator('.grid .video-card').count(), 200);
    assert.match(await page.locator('[data-role="result-count"]').textContent(), /1000 个视频.*已显示 200/);
    const metrics = await page.evaluate(() => {
      const measure = fn => { const start = performance.now(); fn(); return +(performance.now() - start).toFixed(1); };
      const initial = initialRenderMs;
      const repaint = measure(() => perfSubject.repaint());
      globalThis.retainedCard = document.querySelectorAll('.video-card')[1];
      let cardLayoutReads = 0;
      const getRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (this.matches('.video-card[data-bvid]')) cardLayoutReads++;
        return getRect.call(this);
      };
      let filter;
      try { filter = measure(() => perfSubject.filter('学习')); }
      finally { Element.prototype.getBoundingClientRect = getRect; }
      return { initialRenderMs: +initial.toFixed(1), repaintMs: repaint, filterMs: filter, cardLayoutReads };
    });
    metrics.initialCoverRequests = initialCoverRequests;
    assert.ok(metrics.cardLayoutReads < 180, 'filter should measure only cards near the viewport');
    assert.equal(await page.locator('.grid .video-card').count(), 200);
    assert.match(await page.locator('[data-role="result-count"]').textContent(), /500 个视频.*已显示 200/);
    assert.equal(await page.locator('.video-card').first().evaluate(card => card === retainedCard), true);
    const reachEnd = () => page.evaluate(() => {
      const main = document.querySelector('.main');
      main.scrollTop = main.scrollHeight;
      return main.scrollTop;
    });
    const firstEnd = await reachEnd();
    await page.waitForFunction(() => document.querySelector('.grid').childElementCount === 400);
    assert.equal(await page.locator('.video-card').first().evaluate(card => card === retainedCard), true);
    assert.ok(Math.abs(await page.locator('.main').evaluate(main => main.scrollTop) - firstEnd) <= 1, 'append preserves scroll offset');
    await reachEnd();
    await page.waitForFunction(() => document.querySelector('.grid').childElementCount === 500);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => perfSubject.filter('性能测试 998'));
    assert.equal(await page.locator('.grid .video-card').count(), 1);
    assert.equal(await page.locator('.video-card .title').textContent(), '性能测试 998');
    const target = await page.evaluate(() => perfSubject.remember(850));
    await page.locator('[data-action="scroll-last-video"]').evaluate(button => { button.disabled = false; button.click(); });
    await page.locator('.video-card[data-bvid="' + target + '"]').waitFor({ state: 'visible' });
    assert.ok(await page.locator('.video-card[data-bvid="' + target + '"]').evaluate(card =>
      card.getBoundingClientRect().top < innerHeight && card.getBoundingClientRect().bottom > 0), 'return can reveal an unmounted video');
    await page.evaluate(() => { perfSubject.filter('学习'); });
    assert.equal(await page.locator('.grid .video-card').count(), 200, 'a different filter starts with the first batch');
    await page.locator('[data-action="filter-category"][data-category-id="other.todo"]').first().evaluate(button => button.click());
    assert.equal(await page.locator('.grid .video-card').count(), 200, 'a large category starts with the first batch');
    assert.match(await page.locator('[data-role="result-count"]').textContent(), /500 个视频/);
    await page.evaluate(() => {
      document.querySelector('.main').scrollTop = 0;
      perfSubject.filter(''); perfSubject.batch(); perfSubject.select();
    });
    assert.equal(await page.locator('[data-result-motion]').count(), 0);
    assert.equal(await page.locator('.video-card.batch-selected').count(), 1);
    await page.evaluate(() => perfSubject.select());
    assert.equal(await page.locator('.video-card.batch-selected .select-mark svg').count(), 1);
    await page.locator('.video-card').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('.video-card:last-child img.cover').complete);
    await page.addScriptTag({ url: 'http://performance.test/src/idb.js' });
    metrics.database = await page.evaluate(async () => {
      const db = BiliWLDB;
      let transactions = 0;
      const connection = await db.openDB();
      const original = connection.transaction.bind(connection);
      connection.transaction = (...args) => { transactions++; return original(...args); };
      const items = Array.from({ length: 1000 }, (_, i) => ({ bvid: 'BV1xx411' + String(i).padStart(4, '0'), title: '测试 ' + i, presentInWatchlater: true }));
      const start = performance.now();
      const inserted = await db.upsertVideos(items);
      const upsertMs = +(performance.now() - start).toFixed(1);
      const upsertTransactions = transactions;
      const duplicate = await db.upsertVideos([{ ...items[0], title: '第一次' }, { ...items[0], title: '第二次' }]);
      const latest = await db.get('videos', items[0].bvid);
      const queued = await db.queueJobs('detail', items.map(item => item.bvid), 'test');
      const queuedAgain = await db.queueJobs('detail', items.map(item => item.bvid), 'test');
      const pending = await db.pendingJobs('detail');
      await db.putClassification({ bvid: items[0].bvid, sourceType: 'manual', categoryIds: ['other.todo'] });
      const removed = await db.markRemovedExcept([items[0].bvid]);
      const summary = await db.summary();
      // Forced transaction abort must reject and leave the previous stored row intact.
      connection.transaction = (...args) => {
        const tx = original(...args);
        if (args[1] === 'readwrite') {
          const getStore = tx.objectStore.bind(tx);
          tx.objectStore = name => {
            const store = getStore(name);
            const put = store.put.bind(store);
            store.put = value => { const request = put(value); queueMicrotask(() => tx.abort()); return request; };
            return store;
          };
        }
        return tx;
      };
      let aborted = false;
      try { await db.upsertVideos([{ ...items[0], title: '不应保存' }]); } catch { aborted = true; }
      connection.transaction = original;
      const afterAbort = await db.get('videos', items[0].bvid);
      return { upsertMs, upsertTransactions, inserted: inserted.results.length, errors: inserted.errors,
        duplicateCount: duplicate.results.length, latestTitle: latest.title, queued, queuedAgain,
        pending: pending.length, removed: removed.length, present: summary.videos.filter(v => v.presentInWatchlater !== false).length,
        manualSource: summary.classifications[0].sourceType, aborted, titleAfterAbort: afterAbort.title };
    });
    assert.equal(metrics.database.inserted, 1000);
    assert.deepEqual(metrics.database.errors, []);
    assert.equal(metrics.database.duplicateCount, 2);
    assert.equal(metrics.database.latestTitle, '第二次');
    assert.equal(metrics.database.queued, 1000);
    assert.equal(metrics.database.queuedAgain, 0);
    assert.equal(metrics.database.pending, 1000);
    assert.equal(metrics.database.removed, 999);
    assert.equal(metrics.database.present, 1);
    assert.equal(metrics.database.manualSource, 'manual');
    assert.equal(metrics.database.aborted, true);
    assert.equal(metrics.database.titleAfterAbort, '第二次');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(metrics, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
