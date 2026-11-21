const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));

// Simulated extension state; no Bilibili requests or installed-extension claims.
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://manual-opening.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = [core.canonicalizeVideo({ bvid: 'BV1xx411c700', title: '用卫星影像观察城市变化：从数据处理到变化检测的完整流程', coverUrl: 'http://manual-opening.test/icons/icon-128.png', upName: '遥感演示', tname: '科技', tags: ['遥感', '变化检测', 'AI'], desc: '介绍影像处理方法、应用范围与实验结果。', pageParts: ['方法介绍', '实验演示'], duration: 620, watchProgress: 120, viewCount: 23456, pubdate: 1780000000, watchlaterAddedAt: 1780000300, upMid: 12345, aid: 67890, presentInWatchlater: true })];
        state.classifications = [{ bvid: 'BV1xx411c700', categoryIds: ['tech.ai'], sourceType: 'manual', reason: '包含影像处理与人工智能方法。' }];
        globalThis.redraw = () => renderShell();
        globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
        init();
      `).replace('    bootstrap();', ''));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'image/png' });
    });
    await page.goto('http://manual-opening.test/dashboard.html');
    const open = () => page.locator('.video-card .title').click();
    const close = () => page.locator('[data-action="close-modal"]').click();
    // Freeze at the start so actual viewport geometry can be compared exactly.
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('.video-card');
      const source = ['.cover-wrap', '.title', '.badges'].map(s => {
        const r = card.querySelector(s).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const beforeClass = card.className;
      card.querySelector('.title').click();
      document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; });
      const layer = document.querySelector('.manual-opening-layer');
      const ghosts = ['.cover-wrap', '.title', '.badges'].map(s => {
        const n = layer.querySelector(s);
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const dialog = document.querySelector('.manual-dialog');
      return { source, ghosts, hidden: card.style.visibility,
        moveDuration: layer.firstElementChild.getAnimations()[0].effect.getTiming().duration,
        totalDuration: Math.max(...document.getAnimations().filter(a => a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')).map(a => a.effect.getComputedTiming().endTime)),
        intactCard: layer.children.length === 1 && !!layer.querySelector('.card-actions') && getComputedStyle(layer.firstElementChild).backgroundColor !== 'rgba(0, 0, 0, 0)',
        cardUnchanged: beforeClass === card.className,
        panelOpacity: getComputedStyle(dialog).opacity,
        backdropColor: getComputedStyle(dialog, '::backdrop').backgroundColor,
        backdropBlur: getComputedStyle(dialog, '::backdrop').backdropFilter };
    });
    assert.equal(geometry.ghosts.length, 3);
    geometry.source.forEach((r, i) => Object.keys(r).forEach(k => assert.ok(Math.abs(r[k] - geometry.ghosts[i][k]) < 1, `${i} ${k}`)));
    assert.equal(geometry.hidden, 'hidden');
    assert.equal(geometry.cardUnchanged, true);
    assert.equal(geometry.intactCard, true);
    assert.equal(geometry.moveDuration, 320);
    assert.equal(Math.round(geometry.totalDuration), 440);
    assert.equal(geometry.panelOpacity, '0');
    assert.match(geometry.backdropColor, /rgba\(\d+, \d+, \d+, 0\)/);
    assert.equal(geometry.backdropBlur, 'blur(0px)');
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')) a.currentTime = 160; }));
    const midpoint = await page.locator('.manual-opening-layer .cover-wrap').evaluate(n => n.getBoundingClientRect().x);
    assert.notEqual(midpoint, geometry.source[0].x);
    assert.equal(await page.locator('.manual-dialog').evaluate(n => getComputedStyle(n).opacity), '0');
    assert.equal(await page.locator('.manual-dialog').evaluate(n => getComputedStyle(n, '::backdrop').backdropFilter), 'blur(0px)');
    if (process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT.replace('.png', '-midpoint.png') });
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')) a.currentTime = 240; }));
    const overlap = await page.evaluate(() => {
      const panel = document.querySelector('.manual-dialog');
      const a = document.querySelector('.manual-opening-layer .cover-wrap').getBoundingClientRect();
      const b = panel.querySelector('.cover-wrap').getBoundingClientRect();
      return { panelOpacity: Number(getComputedStyle(panel).opacity), moving: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1, targetHidden: getComputedStyle(panel.querySelector('.cover-wrap')).visibility === 'hidden' };
    });
    assert.ok(overlap.panelOpacity > 0 && overlap.panelOpacity < 1);
    assert.equal(overlap.moving, true);
    assert.equal(overlap.targetHidden, true);
    if (process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT.replace('.png', '-overlap.png') });
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')) a.currentTime = 320; }));
    const arrived = await page.evaluate(() => {
      const dialog = document.querySelector('.manual-dialog');
      const a = document.querySelector('.manual-opening-layer .cover-wrap').getBoundingClientRect();
      const b = dialog.querySelector('.cover-wrap').getBoundingClientRect();
      return { distance: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height), opacity: getComputedStyle(dialog).opacity };
    });
    assert.ok(arrived.distance < 1);
    assert.ok(Number(arrived.opacity) > 0 && Number(arrived.opacity) < 1);
    if (process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT.replace('.png', '-arrived.png') });
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')) a.currentTime = 360; }));
    const expansion = await page.locator('.manual-dialog').evaluate(n => ({ opacity: Number(getComputedStyle(n).opacity), clip: getComputedStyle(n).clipPath, blur: getComputedStyle(n, '::backdrop').backdropFilter }));
    assert.ok(expansion.opacity > 0 && expansion.opacity < 1);
    assert.notEqual(expansion.clip, 'none');
    assert.notEqual(expansion.blur, 'blur(0px)');
    const coverStable = await page.evaluate(() => {
      const a = document.querySelector('.manual-opening-layer .cover-wrap').getBoundingClientRect();
      const b = document.querySelector('.manual-dialog .cover-wrap').getBoundingClientRect();
      return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
    });
    assert.ok(coverStable < 1);
    if (process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT.replace('.png', '-expand.png') });
    await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.manual-opening-layer, .manual-dialog')) a.finish(); }));
    await page.waitForFunction(() => !document.querySelector('.manual-opening-layer'));
    assert.equal(await page.locator('#app .video-card').evaluate(n => n.style.visibility), 'hidden');
    const layouts = [];
    for (const width of [1440, 1280, 600, 390]) {
      await page.setViewportSize({ width, height: width >= 1280 ? 900 : 700 });
      const layout = await page.locator('.manual-dialog').evaluate(n => {
        const cover = n.querySelector('.cover-wrap').getBoundingClientRect();
        const body = n.querySelector('.editor-body');
        return { coverWidth: cover.width, ratio: cover.width / cover.height, overflow: n.scrollWidth > n.clientWidth + 1, bodyOverflow: body.scrollHeight > body.clientHeight + 1, fontSize: getComputedStyle(n.querySelector('.preview-title')).fontSize };
      });
      assert.equal(layout.overflow, false);
      assert.ok(Math.abs(layout.ratio - 16 / 9) < .01);
      layouts.push({ width, ...layout });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT });
    await close();
    assert.equal(await page.locator('#app .video-card').evaluate(n => n.style.visibility), '');
    await open();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.manual-opening-layer').count(), 0);
    assert.equal(await page.locator('#app .video-card').evaluate(n => n.style.visibility), '');
    await open();
    await page.evaluate(() => redraw());
    assert.equal(await page.locator('.manual-opening-layer').count(), 0);
    await close();
    await open();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => !document.querySelector('.manual-opening-layer'));
    assert.equal(await page.locator('.manual-opening-layer').count(), 0);
    await close();
    for (const width of [600, 390]) {
      await page.setViewportSize({ width, height: 700 });
      const distance = await page.evaluate(() => {
        document.querySelector('.video-card .title').click();
        document.getAnimations().forEach(a => { a.pause(); a.currentTime = 320; });
        const a = document.querySelector('.manual-opening-layer .cover-wrap').getBoundingClientRect();
        const b = document.querySelector('.manual-dialog .cover-wrap').getBoundingClientRect();
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
      });
      assert.ok(distance < 1, `cover aligned at ${width}px`);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#app .video-card').evaluate(n => n.style.visibility), '');
    }
    const settingsButton = page.locator('[data-action="open-management"]');
    for (const width of [1440, 600, 390]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 700 });
      await settingsButton.scrollIntoViewIfNeeded();
      const start = await settingsButton.evaluate(button => {
        const source = button.getBoundingClientRect();
        button.click();
        const dialog = document.querySelector('.settings-dialog');
        const finalWidth = dialog.offsetWidth;
        document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.settings-dialog')) { a.pause(); a.currentTime = 0; } });
        const r = dialog.getBoundingClientRect();
        return { error: Math.abs(r.x - source.x) + Math.abs(r.y - source.y) + Math.abs(r.width - source.width) + Math.abs(r.height - source.height), finalWidth, startWidth: r.width,
          opacity: getComputedStyle(dialog.querySelector('.editor-body')).opacity, backdrop: getComputedStyle(dialog, '::backdrop').backdropFilter };
      });
      assert.ok(start.error < 1, `settings starts at button at ${width}px`);
      assert.equal(start.opacity, '0');
      assert.equal(start.backdrop, 'blur(0px)');
      await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.settings-dialog')) a.currentTime = 210; }));
      const middle = await page.locator('.settings-dialog').boundingBox();
      assert.ok(middle.width > start.startWidth && middle.width < start.finalWidth, JSON.stringify({ width, start, middle }));
      if (width === 1440 && process.env.MANUAL_OPENING_SCREENSHOT) await page.screenshot({ path: process.env.MANUAL_OPENING_SCREENSHOT.replace('.png', '-settings-midpoint.png') });
      await page.evaluate(() => document.getAnimations().forEach(a => { if (a.effect?.target?.closest('.settings-dialog')) a.finish(); }));
      await page.waitForFunction(() => !document.querySelector('.settings-opening'));
      assert.equal(await page.locator('.settings-dialog').evaluate(n => getComputedStyle(n).transform), 'none');
      await page.locator('[data-action="select-settings-page"][data-page="directory"]').click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.directory-panels').evaluate(grid => {
        const rects = Array.from(grid.children, node => node.getBoundingClientRect());
        return rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
      }), false);
      await page.keyboard.press('Escape');
      assert.equal(await settingsButton.evaluate(n => document.activeElement === n), true);
    }
    await settingsButton.click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.settings-opening').count(), 0);
    await settingsButton.click();
    await page.evaluate(() => redraw());
    assert.equal(await page.locator('.settings-opening').count(), 0);
    await close();
    await settingsButton.click();
    await page.setViewportSize({ width: 600, height: 700 });
    await page.waitForFunction(() => !document.querySelector('.settings-opening'));
    assert.equal(await page.locator('.settings-dialog').evaluate(n => getComputedStyle(n).transform), 'none');
    await close();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open();
    assert.equal(await page.locator('.manual-opening-layer').count(), 0);
    assert.equal(await page.locator('.preview-title').evaluate(n => n.style.visibility), '');
    await close();
    await settingsButton.click();
    assert.equal(await page.locator('.settings-opening').count(), 0);
    assert.equal(await page.locator('.settings-dialog').evaluate(n => getComputedStyle(n).transform), 'none');
    assert.deepEqual(errors, []);
    console.log('PASS: movement/expansion overlap and finish in 440ms, one visible aligned cover; settings button origin, cleanup, focus restoration, reduced motion and responsive layout. ' + JSON.stringify(layouts));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
