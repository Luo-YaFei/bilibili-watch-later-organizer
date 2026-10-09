const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));
// Uses simulated extension state, without contacting Bilibili.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://classification.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = Array.from({ length: 3 }, (_, i) => core.canonicalizeVideo({ bvid: 'BV1xx411c7' + String(i).padStart(2, '0'), title: '分类选择演示视频 ' + i, upName: '演示 UP', presentInWatchlater: true }));
        globalThis.sent = [];
        globalThis.redraw = () => renderShell();
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          sent.push(payload);
          return { ok: true, data: { bulkUpdateResult: { updated: 0 } } };
        } } };
        init();
      `).replace('    bootstrap();', ''));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    });
    await page.goto('http://classification.test/dashboard.html');
    const input = page.locator('[data-role="search"]');
    const base = await page.locator('.glass-search').evaluate(n => getComputedStyle(n).backgroundImage);
    await input.click();
    assert.equal(await page.locator('.glass-search').evaluate(n => getComputedStyle(n).outlineStyle), 'none');
    await input.fill('演示');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.glass-search').evaluate(n => getComputedStyle(n).backgroundImage), base);
    assert.equal(await page.locator('.list-head #search-scope-hint').isVisible(), true);
    await input.fill('');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#search-scope-hint').isVisible(), false);
    await page.locator('.video-card .title').first().click();
    const dialog = page.locator('.manual-dialog');
    await dialog.waitFor({ state: 'visible' });
    const layout = await dialog.evaluate(n => {
      const body = n.querySelector('.editor-body');
      const list = n.querySelector('.manual-category-list');
      const footer = n.querySelector('.editor-actions');
      return { count: list.children.length, columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
        bodyOverflow: body.scrollHeight > body.clientHeight + 1, footerOutside: !body.contains(footer),
        rowHeight: list.firstElementChild.getBoundingClientRect().height };
    });
    assert.ok(layout.columns >= 4);
    assert.ok(layout.rowHeight <= 36);
    assert.equal(layout.footerOutside, true);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-manual-classification.png') });
    await page.locator('[data-role="manual-category"]').nth(1).check();
    await page.evaluate(() => redraw());
    assert.equal(await page.locator('[data-role="manual-category"]').nth(1).isChecked(), true);
    await page.locator('[data-action="close-modal"]').click();
    await page.locator('.toolbar [data-action="toggle-batch"]').click();
    assert.equal(await page.locator('select[data-role="batch-category"]').count(), 0);
    await page.locator('[data-role="batch-category"]').nth(1).check();
    await page.locator('[data-role="batch-category"]').nth(2).check();
    const ids = await page.locator('[data-role="batch-category"]:checked').evaluateAll(nodes => nodes.map(n => n.value));
    await page.locator('[data-action="batch-select-all"]').click();
    await page.evaluate(() => redraw());
    assert.equal(await page.locator('[data-role="batch-category"]:checked').count(), 2);
    await page.locator('[data-action="batch-add-category"]').click();
    await page.waitForTimeout(80);
    const payload = await page.evaluate(() => sent.find(p => p.action === 'add'));
    assert.deepEqual(payload.categoryIds, ids);
    assert.equal(payload.bvids.length, 3);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-batch-classification.png') });
    await page.setViewportSize({ width: 600, height: 700 });
    await page.locator('.toolbar [data-action="toggle-batch"]').click();
    await page.locator('.video-card .title').first().click();
    assert.equal(await page.locator('[data-action="save-manual"]').isVisible(), true);
    assert.equal(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log('PASS: neutral search focus, title filter hint, compact default categories, fixed footer, draft persistence, multiple categories in one payload, narrow layout; ' + JSON.stringify(layout));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
