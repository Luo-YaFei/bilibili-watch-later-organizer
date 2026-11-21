const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));

// Disposable Chrome, simulated videos, no account access or Bilibili requests.
(async () => {
  const baseline = process.argv[2] === '--baseline' ? process.argv[3] : '';
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.auraDraws = 0;
      globalThis.auraFrames = 0;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        if (this.canvas.matches('.category-aura-flow')) auraDraws++;
        return draw.apply(this, args);
      };
      const raf = requestAnimationFrame;
      globalThis.requestAnimationFrame = callback => raf(time => { auraFrames++; callback(time); });
    });
    await page.route('http://idle.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      if (name.startsWith('covers/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#8dbbc9"/></svg>' });
      const snapshot = baseline && path.join(baseline, path.basename(name));
      let body = fs.readFileSync(snapshot && fs.existsSync(snapshot) ? snapshot : path.resolve(name), 'utf8');
      if (name === 'src/dashboard.js') body = body.replace('  init();', `
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = Array.from({ length: 1000 }, (_, i) => core.canonicalizeVideo({
          bvid: 'BV1xx411' + String(i).padStart(4, '0'), title: '空闲测试 ' + i,
          coverUrl: 'http://idle.test/covers/' + i + '.svg', duration: 120,
          presentInWatchlater: true, watchlaterOrder: i
        }));
        state.classifications = state.videos.map(v => ({ bvid: v.bvid, categoryIds: ['other.todo'], sourceType: 'manual' }));
        globalThis.chrome = { runtime: { onMessage: { addListener() {} } } };
        init();
      `).replace('    bootstrap();', '');
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : 'image/svg+xml' });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const counters = () => page.evaluate(() => ({ draws: auraDraws, frames: auraFrames,
      runningParticles: [...document.querySelectorAll('.category-particle')].filter(n => getComputedStyle(n).animationPlayState === 'running').length }));
    const tasks = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    await page.goto('http://idle.test/dashboard.html');
    await page.waitForTimeout(6500);
    const before = await counters(), start = await tasks();
    await page.waitForTimeout(3000);
    const after = await counters(), end = await tasks();
    const metrics = { baseline: Boolean(baseline), idleDraws: after.draws - before.draws,
      idleFrames: after.frames - before.frames, runningParticles: after.runningParticles,
      mainThreadMs: +((end.TaskDuration - start.TaskDuration) * 1000).toFixed(1),
      jsHeapMiB: +(end.JSHeapUsedSize / 1024 / 1024).toFixed(1) };
    if (!baseline) {
      assert.equal(metrics.idleDraws, 0, 'idle page must stop WebGL readback');
      assert.equal(metrics.idleFrames, 0, 'idle page must stop requesting frames');
      assert.equal(metrics.runningParticles, 0, 'idle particles must pause');
      await page.evaluate(() => { globalThis.firstCover = document.querySelector('.video-card img'); });
      await page.locator('.video-card').last().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => !firstCover.getAttribute('src') && firstCover.dataset.coverDeferred);
      await page.locator('.video-card').first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => firstCover.getAttribute('src') && !firstCover.dataset.coverDeferred && firstCover.complete);
      await page.mouse.move(120, 260);
      await page.waitForTimeout(600);
      const awake = await counters();
      assert.ok(awake.draws > after.draws, 'interaction resumes the wave');
      const inactive = await page.locator('[data-action="filter-unclassified"]').evaluate(row => {
        const aura = document.querySelector('.category-aura').cloneNode(true);
        row.appendChild(aura);
        globalThis.inactiveCanvas = aura.querySelector('canvas');
        BiliWLAura.refresh();
        return inactiveCanvas.width;
      });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => inactiveCanvas.width), inactive, 'transparent rows must not be drawn');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(200);
      const blurred = await counters();
      await page.waitForTimeout(400);
      assert.deepEqual(await counters(), blurred, 'unfocused window stops decorative work');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.waitForTimeout(250);
      assert.ok((await counters()).draws > blurred.draws);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(200);
      const hidden = await counters();
      await page.waitForTimeout(400);
      assert.deepEqual(await counters(), hidden, 'hidden tab stops decorative work');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(250);
      assert.ok((await counters()).draws > hidden.draws);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(250);
      const reduced = await counters();
      await page.waitForTimeout(400);
      assert.deepEqual(await counters(), reduced, 'reduced motion draws a static wave');
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(metrics, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
