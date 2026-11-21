const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));

// Runs in a disposable Chrome profile with simulated sync and locally saved covers.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://www.bilibili.com/**', route => route.fulfill({ body: 'Simulated video' }));
    await context.route('http://localhost:38271/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = body.toString().replace('  init();', `
        const videos = Array.from({ length: 160 }, (_, i) => core.canonicalizeVideo({
          bvid: 'BV1xx411' + String(i).padStart(4, '0'), aid: i + 1,
          title: 'Video ' + i, duration: 150, watchlaterOrder: i,
          coverUrl: 'https://i0.hdslb.com/bfs/archive/' + i + '.jpg'
        }));
        const snapshot = { videos, categories: core.DEFAULT_CATEGORIES, classifications: [] };
        const requests = [];
        globalThis.syncRequests = requests;
        globalThis.changeDetail = () => {
          snapshot.videos[0] = { ...snapshot.videos[0], title: 'Updated title' };
          updateState(structuredClone(snapshot));
        };
        globalThis.rebuildShell = () => renderShell();
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          requests.push(payload.type);
          if (payload.type === message.REMOVE_FROM_WATCHLATER) {
            const index = snapshot.videos.findIndex(video => video.bvid === payload.bvid);
            snapshot.videos[index] = { ...snapshot.videos[index], presentInWatchlater: false };
          }
          if (payload.type === message.SYNC_ON_OPEN || payload.type === message.SCAN_WATCHLATER) {
            await new Promise(resolve => setTimeout(resolve, 400));
            const data = structuredClone(snapshot);
            data.settings = { ...state.settings, lastAutoLlmScheduleAt: Date.now() };
            return { ok: true, data };
          }
          return { ok: true, data: structuredClone(snapshot) };
        } } };
        BiliWLCoverCache.open().then(async cache => {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#96c8df"/></svg>';
          await Promise.all(videos.map(video => cache.put(BiliWLCoverCache.key(video.coverUrl), new Response(svg, {
            headers: { 'Content-Type': 'image/svg+xml' }
          }))));
          init();
        });
      `);
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'image/png' });
    });
    await page.goto('http://localhost:38271/dashboard.html');
    const cover = page.locator('.video-card').first().locator('img');
    await cover.evaluate(img => {
      window.originalMain = document.querySelector('.main');
      window.originalCard = img.closest('.video-card');
      window.originalImage = img;
      window.originalSearch = document.querySelector('.search-input');
    });
    await page.waitForFunction(() => originalImage.complete && originalImage.naturalWidth > 0);
    const source = await cover.getAttribute('src');
    assert.match(source, /^blob:/);
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.startsWith('已同步 '));
    const expectSameList = async () => {
      assert.equal(await page.evaluate(() => originalMain === document.querySelector('.main')
        && originalCard === document.querySelector('.video-card')
        && originalSearch === document.querySelector('.search-input')), true);
      assert.equal(await cover.getAttribute('src'), source);
    };
    await expectSameList();

    const input = page.locator('.search-input');
    await page.locator('.sync-button').click();
    await input.focus();
    await page.evaluate(() => { originalMain.scrollTop = 440; });
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent === '没有缺失详情的视频');
    await expectSameList();
    assert.equal(await input.evaluate(node => document.activeElement === node), true);
    assert.equal(await page.evaluate(() => originalMain.scrollTop), 440);
    await page.evaluate(() => changeDetail());
    assert.equal(await page.locator('.video-card .title').first().textContent(), 'Updated title');
    assert.equal(await cover.evaluate(img => img === originalImage), true);
    assert.equal(await cover.getAttribute('src'), source);
    assert.equal(await page.locator('.video-card .cover-state').first().evaluate(label => label.hidden), true);
    await page.evaluate(() => rebuildShell());
    assert.equal(await cover.getAttribute('src'), source, 'a full shell rebuild retains connected saved covers');

    const jumpAwayAndBack = await cover.evaluate(async img => {
      const main = img.closest('.main');
      const afterPaint = async () => {
        for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
      };
      main.scrollTop = main.scrollHeight;
      await afterPaint();
      const distance = main.getBoundingClientRect().top - img.getBoundingClientRect().bottom;
      const away = img.getAttribute('src');
      main.scrollTop = 0;
      await afterPaint();
      return { distance, away, back: img.getAttribute('src') };
    });
    assert.ok(jumpAwayAndBack.distance > 3600);
    assert.equal(jumpAwayAndBack.away, source, 'a quick scrollbar jump keeps the previous covers');
    assert.equal(jumpAwayAndBack.back, source, 'jumping back does not reload those covers');

    await cover.evaluate(img => { img.closest('.main').scrollTop = img.closest('.main').scrollHeight; });
    await page.waitForFunction(() => !originalImage.hasAttribute('src'));
    await context.setOffline(true);
    await cover.evaluate(img => { img.closest('.main').scrollTop = 0; });
    await page.waitForFunction(() => originalImage.complete && originalImage.naturalWidth > 0);
    assert.match(await cover.getAttribute('src'), /^blob:/, 'distant covers still reload from disk offline');
    await context.setOffline(false);

    const top = page.getByRole('button', { name: '回到最顶部', exact: true });
    const last = page.getByRole('button', { name: '回到上一次打开的视频位置', exact: true });
    assert.equal(await last.isEnabled(), true);
    await last.click();
    assert.match(await page.locator('[data-role="status"]').textContent(), /还没有打开视频的记录/);
    const target = page.locator('.video-card[data-bvid="BV1xx4110036"]');
    const popupPromise = context.waitForEvent('page');
    await target.locator('.cover-link').click();
    await (await popupPromise).close();
    await top.click();
    assert.equal(await page.locator('.main').evaluate(main => main.scrollTop), 0);
    await last.click();
    const expectTargetBelowToolbar = () => target.evaluate(card => {
      const top = card.getBoundingClientRect().top;
      const toolbarBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
      return top >= toolbarBottom && top - toolbarBottom <= 12;
    });
    assert.equal(await expectTargetBelowToolbar(), true);
    assert.match(await page.locator('[data-role="status"]').textContent(), /已定位/);
    await last.click();
    assert.match(await page.locator('[data-role="status"]').textContent(), /已在当前位置/);
    const collectionPopup = context.waitForEvent('page');
    const collection = page.locator('.video-card[data-bvid="BV1xx4110022"] .card-actions a');
    await collection.click({ button: 'middle' });
    await (await collectionPopup).close();
    assert.equal(await page.evaluate(() => localStorage.getItem('biliwl.lastOpenedVideo')), 'BV1xx4110022');

    await page.reload();
    await last.waitFor();
    assert.equal(await last.isEnabled(), true);
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.startsWith('已同步 '));
    await page.locator('.search-input').fill('no matching video');
    await page.locator('.empty').waitFor();
    await last.click();
    assert.equal(await page.locator('.search-input').inputValue(), '');
    assert.match(await page.locator('[data-role="status"]').textContent(), /已清除筛选并定位/);
    assert.equal(await collection.evaluate(link => {
      const top = link.closest('.video-card').getBoundingClientRect().top;
      const toolbarBottom = document.querySelector('.topbar').getBoundingClientRect().bottom;
      return top >= toolbarBottom && top - toolbarBottom <= 12;
    }), true);
    await page.locator('.video-card[data-bvid="BV1xx4110022"] [data-action="remove-watchlater"]').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.startsWith('B站已确认移出'));
    await last.click();
    assert.equal(await page.locator('[data-role="status"]').textContent(), '上一次打开的视频已从稍后再看删除');
    assert.equal(await page.locator('.activity-status').isVisible(), true);
    assert.equal(await collection.count(), 0);
    assert.deepEqual(errors, []);
    console.log('Automatic and manual sync retained loaded covers and scroll. Both return buttons and the removed-video notice passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
