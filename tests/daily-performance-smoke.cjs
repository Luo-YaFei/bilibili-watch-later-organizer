const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));

// Disposable Chrome with 1,000 simulated videos and 200ms cover responses.
// Optional --baseline <snapshot directory> reports timings for the previous source.
(async () => {
  const baseline = process.argv[2] === '--baseline' ? process.argv[3] : '';
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    const requests = new Map();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://i0.hdslb.com/**', async route => {
      const url = route.request().url();
      requests.set(url, (requests.get(url) || 0) + 1);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (url.includes('/0.jpg@') || url.includes('/1.jpg')) return route.fulfill({ status: 404, body: 'unavailable' });
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#8dbbc9"/></svg>' });
    });
    await page.route('http://daily.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      const snapshot = baseline && path.join(baseline, path.basename(name));
      let body = fs.readFileSync(snapshot && fs.existsSync(snapshot) ? snapshot : path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        // Exercise the direct-image fallback. Offline Cache Storage has its own smoke test.
        globalThis.BiliWLCoverCache = null;
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = Array.from({ length: 1000 }, (_, i) => core.canonicalizeVideo({
          bvid: 'BV1xx411' + String(i).padStart(4, '0'), title: '日常操作 ' + i,
          upName: i % 2 ? '学习' : '音乐', watchlaterOrder: i, duration: 120 + i,
          coverUrl: 'https://i0.hdslb.com/bfs/archive/' + i + '.jpg', presentInWatchlater: true
        }));
        state.classifications = state.videos.map(v => ({ bvid: v.bvid, categoryIds: ['other.todo'], sourceType: 'manual' }));
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          if (payload.type === message.REMOVE_FROM_WATCHLATER) return { ok: false, error: '模拟删除失败' };
          return { ok: true, data: { settings: state.settings } };
        } } };
        globalThis.daily = {
          filter: value => { searchText = value; renderVideoResults('search'); },
          sort: value => onChange({ target: { dataset: { role: 'sort-combo' }, value } }),
          shuffle: shuffleVideos,
          sync: () => updateState({ videos: state.videos.map(v => ({ ...v, lastSeenAt: Date.now() })), categories: structuredClone(state.categories), classifications: structuredClone(state.classifications) }),
          detail: () => updateState({ videos: state.videos.map((v, i) => i === 2 ? { ...v, viewCount: 123456 } : v) }),
          rename: () => updateState({ categories: state.categories.map(c => c.id === 'other.todo' ? { ...c, name: '新的目录名称' } : c) }),
          removeHidden: () => updateState({ videos: state.videos.map(v => {
            if (v.upName !== '音乐') return v;
            const removed = { ...v };
            core.setAuthoritativeWatchlaterMembership(removed, false);
            return removed;
          }) })
        };
        init();
      `).replace('    bootstrap();', ''));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'image/svg+xml' });
    });
    await page.goto('http://daily.test/dashboard.html');
    await page.waitForTimeout(700);
    if (!baseline) {
      const preloaded = await page.evaluate(() => {
        const bottom = document.querySelector('.main').getBoundingClientRect().bottom;
        const images = [...document.querySelectorAll('.video-card img')].filter(img => {
          const top = img.getBoundingClientRect().top; return top > bottom + 1500 && top < bottom + 2200;
        });
        return images.length > 0 && images.every(img => img.loading === 'eager' && img.complete);
      });
      assert.equal(preloaded, true, 'preload beyond the next screen before scrolling');
    }
    const metrics = await page.evaluate(() => {
      const timed = fn => { const start = performance.now(); fn(); return +(performance.now() - start).toFixed(1); };
      return {
        syncRedrawMs: timed(() => daily.sync()),
        sortMs: timed(() => daily.sort('duration:desc')),
        shuffleMs: timed(() => daily.shuffle()),
        filterMs: timed(() => daily.filter('学习')),
        clearFilterMs: timed(() => daily.filter(''))
      };
    });
    if (baseline) { console.log(JSON.stringify({ baseline: true, ...metrics })); return; }
    await page.evaluate(() => daily.sort('watchlater:desc'));
    await page.waitForTimeout(650);
    await page.waitForFunction(() => document.querySelector('.video-card img').complete);
    assert.equal(await page.locator('.video-card img').first().getAttribute('data-cover-fallback'), 'true');
    assert.equal(requests.get('https://i0.hdslb.com/bfs/archive/0.jpg'), 1);
    assert.equal(requests.get('https://i0.hdslb.com/bfs/archive/1.jpg'), 1, 'failed fallback must not loop');
    const visible = await page.evaluate(() => {
      const main = document.querySelector('.main').getBoundingClientRect();
      return [...document.querySelectorAll('.video-card img')].filter(img => {
        const r = img.getBoundingClientRect(); return r.top < main.bottom && r.bottom > main.top;
      }).every(img => img.loading === 'eager' && img.fetchPriority === 'high');
    });
    assert.equal(visible, true, 'visible covers take priority over prefetch');
    await page.evaluate(() => {
      globalThis.card2 = document.querySelectorAll('.video-card')[2];
      globalThis.cover2 = card2.querySelector('img');
      globalThis.searchInput = document.querySelector('[data-role="search"]');
    });
    await page.evaluate(() => { daily.filter('学习'); daily.filter(''); });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.video-card')[2] === card2), true, 'clearing filters restores cached cards');
    await page.evaluate(() => { daily.sort('duration:desc'); daily.shuffle(); });
    assert.equal(await page.evaluate(() => document.querySelector('[data-role="search"]') === searchInput), true, 'sort/shuffle preserve toolbar and input');
    await page.evaluate(() => { daily.sort('watchlater:desc'); daily.sync(); });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.video-card')[2] === card2), true, 'unchanged sync preserves cards');
    await page.evaluate(() => daily.detail());
    assert.equal(await page.evaluate(() => document.querySelectorAll('.video-card')[2].querySelector('img') === cover2), true, 'detail updates preserve decoded covers');
    assert.match(await page.locator('.video-card').nth(2).locator('.view-count-badge').textContent(), /12\.3万/);
    await page.evaluate(() => daily.rename());
    assert.match(await page.locator('.video-card').nth(2).locator('.badges').textContent(), /新的目录名称/);
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      document.querySelector('.main').scrollTop = 0;
      globalThis.jumpImage = document.querySelector('.video-card:last-child img');
      document.querySelector('.main').scrollTop = document.querySelector('.main').scrollHeight;
    });
    await page.waitForFunction(() => jumpImage.loading === 'eager' && jumpImage.fetchPriority === 'high');
    await page.waitForFunction(() => jumpImage.complete && jumpImage.naturalWidth > 0);
    await page.waitForFunction(() => document.querySelector('.grid').childElementCount === 400);
    await page.evaluate(() => document.querySelector('.main').scrollTop = 0);
    await page.locator('.video-card').first().locator('[data-action="remove-watchlater"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.video-card[data-bvid]').length === 400);
    assert.match(await page.locator('[data-role="status"]').textContent(), /视频已恢复/);
    const input = page.locator('[data-role="search"]');
    await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await input.fill('学习');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.grid .video-card').count(), 400);
    await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.waitForFunction(() => document.querySelectorAll('.grid .video-card').length === 200);
    await page.locator('[data-action="toggle-batch"]').click();
    await page.locator('[data-action="batch-select-all"]').click();
    assert.equal(await page.locator('.video-card.batch-selected').count(), 200);
    assert.match(await page.locator('[data-role="batch-panel-count"]').textContent(), /500/);
    await page.locator('[data-action="batch-clear-selection"]').click();
    assert.equal(await page.locator('.video-card.batch-selected').count(), 0);
    await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
    const firstTitle = await page.locator('.video-card .title').nth(0).boundingBox();
    const secondTitle = await page.locator('.video-card .title').nth(1).boundingBox();
    await page.mouse.move(firstTitle.x + 5, firstTitle.y + 4);
    await page.mouse.down();
    await page.mouse.move(secondTitle.x + 12, secondTitle.y + 12, { steps: 7 });
    await page.mouse.up();
    assert.equal(await page.locator('.video-card.batch-selected').count(), 2, 'drag selects intersected cards');
    await page.locator('[data-action="toggle-batch"]').click();
    await page.locator('.video-card .title').first().click();
    await page.waitForFunction(() => !document.querySelector('.manual-opening'));
    assert.equal(await page.locator('.manual-dialog img').getAttribute('loading'), 'eager');
    await page.keyboard.press('Escape');
    await page.evaluate(() => daily.removeHidden());
    assert.equal(await page.locator('.grid .video-card').count(), 200);
    assert.equal(await page.locator('[data-action="filter-all"] .cat-count').textContent(), '500', 'sync updates counts outside the active filter');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...metrics, passed: 'thumbnail fallback, viewport priority, scroll jump, card/cover reuse, sync/detail/category updates, deletion rollback, IME, bulk selection and manual dialog' }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
