const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// Run from the repository root: node tests/dashboard-animation-smoke.cjs
// Uses simulated extension state; does not contact Bilibili or change browser profiles.
const { chromium } = require(require.resolve('playwright', { paths: [path.resolve(path.dirname(process.execPath), '../node_modules')] }));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://motion.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        globalThis.makeAuraPreview = (id) => {
          const row = document.createElement('div');
          row.className = 'cat-row active category-root';
          row.style.cssText = categoryAuraStyle(id);
          row.dataset.auraSize = 'large';
          row.appendChild(renderCategoryAura('large', id));
          const name = document.createElement('span'); name.className = 'cat-name'; name.textContent = id;
          row.appendChild(name);
          const glass = document.createElement('span'); glass.className = 'category-glass'; row.appendChild(glass);
          return row;
        };
        state.categories = [
          { id: 'study', name: '学习', order: 1, enabled: true },
          { id: 'study.code', name: '编程', parentId: 'study', order: 1, enabled: true },
          { id: 'music', name: '音乐', order: 2, enabled: true }
        ];
        state.videos = Array.from({ length: 24 }, (_, i) => core.canonicalizeVideo({ bvid: 'BV1xx411c7' + String(i).padStart(2, '0'), title: (i % 2 ? 'Python 入门 ' : '音乐现场 ') + i, upName: '演示 UP', duration: 80 + i, watchlaterOrder: i, presentInWatchlater: true }));
        state.classifications = state.videos.map((v, i) => ({ bvid: v.bvid, categoryIds: [i % 2 ? 'study.code' : 'music'], source: 'manual' }));
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          return { ok: true, data: { settings: { ...state.settings, ...payload.settings } } };
        } } };
        init();
      `).replace('    bootstrap();', ''));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    });
    await page.goto('http://motion.test/dashboard.html');
    await page.waitForTimeout(150);
    assert.deepEqual(errors, []);
    const row = async id => {
      await page.evaluate(id => {
        const nav = document.querySelector('.cat-nav');
        const viewport = nav.getBoundingClientRect();
        nav.querySelectorAll('.cat-row').forEach(n => n.removeAttribute('data-smoke-row'));
        const node = Array.from(nav.querySelectorAll('.cat-row')).find(n => {
          const rect = n.getBoundingClientRect();
          return n.dataset.categoryId === id && rect.top >= viewport.top && rect.bottom <= viewport.bottom;
        });
        if (!node) throw new Error('No visible category: ' + id);
        node.dataset.smokeRow = 'true';
      }, id);
      return page.locator('.cat-nav .cat-row[data-smoke-row="true"]');
    };
    assert.equal(await page.locator('.content .video-card').count(), 24);
    assert.equal(await page.locator('.cat-nav [data-action="filter-all"]').count(), 0);
    assert.equal(await page.locator('.category-glass').count(), 1);
    assert.ok(await page.locator('.sidebar-filters').evaluate(n => n.getBoundingClientRect().bottom <= document.querySelector('.cat-nav').getBoundingClientRect().top));
    await page.locator('.category-glass').evaluate(n => n._identity = 'single-glass');
    await (await row('study')).hover();
    await page.waitForTimeout(240);
    assert.equal(await (await row('study')).locator('.category-particle').count(), 28);
    assert.equal(await (await row('study')).getAttribute('aria-current'), 'false');
    assert.equal(await (await row('study')).locator('.category-glass').count(), 0);
    assert.equal(await (await row('study')).evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
    for (const captured of [false, true]) {
      const held = await row('study');
      if (captured) await held.evaluate(n => n.addEventListener('pointerdown', e => n.setPointerCapture(e.pointerId), { once: true }));
      await held.hover();
      await page.mouse.down();
      await page.waitForTimeout(180);
      await page.mouse.move(600, 110);
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.cat-row[data-category-id="study"].aura-preview').count(), 0);
      await page.mouse.up();
      assert.equal(await page.locator('.content .video-card').count(), 24);
      assert.equal(await page.locator('[data-action="filter-all"]').getAttribute('aria-current'), 'true');
    }
    await page.locator('[data-action="filter-unclassified"]').focus();
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.matches('.cat-row:focus-visible.aura-preview')));
    await page.locator('[data-role="search"]').focus();
    await (await row('study')).hover();
    await (await row('study')).click();
    assert.equal(await page.locator('.content .video-card').count(), 12);
    assert.ok(await (await row('study')).locator('.category-glass').evaluate(el => el.getAnimations().length));
    assert.equal(await page.locator('.category-glass').evaluate(n => n._identity), 'single-glass');
    assert.equal(await page.locator('.category-glass').count(), 1);
    const navBefore = await page.locator('.cat-nav').evaluate(n => n.scrollTop);
    await (await row('study.code')).click();
    assert.equal(await page.locator('.cat-nav').evaluate(n => n.scrollTop), navBefore);
    assert.equal(await (await row('study.code')).locator('.category-particle').count(), 16);
    await page.waitForTimeout(600);
    await (await row('music')).hover();
    assert.equal(await (await row('music')).locator('.category-glass').count(), 0);
    const disjoint = await (await row('music')).evaluate(n => {
      n.click();
      const cards = Array.from(document.querySelectorAll('.content .video-card'));
      return { count: cards.length, exitCount: document.querySelectorAll('.result-exit-layer').length,
        glassTop: document.querySelector('.category-glass').getBoundingClientRect().top,
        entering: cards.filter(c => { const r = c.getBoundingClientRect(); return r.bottom > 80 && r.top < 900; })
          .every(c => c.getAnimations().some(a => a.effect.getKeyframes()[0].opacity === '0')) };
    });
    assert.equal(disjoint.count, 12);
    assert.ok(disjoint.entering);
    assert.equal(disjoint.exitCount, 1);
    const glassStart = disjoint.glassTop;
    await page.waitForTimeout(180);
    const glassMid = await page.locator('.category-glass').evaluate(n => n.getBoundingClientRect().top);
    assert.notEqual(glassStart, glassMid);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-motion-midpoint.png') });
    await (await row('study.code')).click();
    const input = page.locator('[data-role="search"]');
    await input.fill('Python 入门 1');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.content .video-card').count(), 6);
    assert.equal(await page.locator('.list-head #search-scope-hint').isVisible(), true);
    assert.equal(await page.locator('.glass-search.search-active').count(), 0);
    assert.ok(await input.evaluate(el => document.activeElement === el));
    await (await row('music')).click();
    assert.equal(await page.locator('.empty').count(), 1);
    assert.equal(await input.inputValue(), 'Python 入门 1');
    await input.fill('');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.content .video-card').count(), 12);
    assert.equal(await page.locator('.glass-search.search-active').count(), 0);
    assert.equal(await page.locator('#search-scope-hint').isVisible(), false);
    await page.locator('[data-action="filter-all"]').click();
    const ids = await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid));
    await page.locator('[data-role="sort-combo"]').selectOption('duration:desc');
    await page.waitForTimeout(100);
    assert.notDeepEqual(await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid)), ids);
    assert.ok(await page.locator('.video-card[data-reflow]').count());
    await input.dispatchEvent('compositionstart');
    await input.fill('Python');
    await page.waitForTimeout(140);
    assert.equal(await page.locator('.content .video-card').count(), 24);
    await input.dispatchEvent('compositionend');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.content .video-card').count(), 12);
    for (const delta of [-20000, 20000, -700, 700]) {
      await page.locator('.cat-nav').evaluate((n, d) => { n.scrollTop += d; n.dispatchEvent(new Event('scroll')); }, delta);
      assert.ok(await page.locator('.cat-nav').evaluate(n => n.scrollTop >= +n.dataset.cycleHeight && n.scrollTop < +n.dataset.cycleHeight * 2));
      assert.equal(await page.locator('.category-glass').count(), 1);
    }
    await input.fill('');
    await page.waitForTimeout(150);
    await (await row('study')).click();
    await (await row('music')).click();
    await (await row('study.code')).click();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.content .video-card').count(), 12);
    assert.equal(await page.locator('.category-glass').evaluateAll(nodes => nodes.reduce((n, el) => n + el.getAnimations().length, 0)), 0);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-motion-preview.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await (await row('music')).click();
    assert.equal(await (await row('music')).locator('.category-glass').evaluate(el => el.getAnimations().length), 0);
    assert.equal(await page.locator('[data-role="content"]').evaluate(el => el.getAnimations().length), 0);
    await page.setViewportSize({ width: 600, height: 800 });
    await page.waitForTimeout(150);
    assert.ok(await page.locator('.cat-nav').evaluate(n => n.clientHeight > 0));
    assert.equal(await page.locator('.category-glass').count(), 1);
    assert.deepEqual(errors, []);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const gallery = document.createElement('div');
      gallery.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:26px 36px;padding:36px;background:#f4f6f7;min-height:100vh';
      const seeds = ['study', 'study.code', 'music', 'technology', 'science', 'games', 'films', 'animation', 'sports', 'fitness', 'cooking', 'travel', 'nature', 'art', 'design', 'photography', 'history', 'literature', 'language', 'finance', 'health', 'life', 'crafts', 'other'];
      seeds.forEach(id => { const row = makeAuraPreview(id); row.style.height = '58px'; gallery.appendChild(row); });
      document.getElementById('app').replaceChildren(gallery);
      BiliWLAura.refresh();
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-category-palettes.png') });
    console.log('PASS: held pointer exit with/without capture, keyboard focus, hover, glass size/movement, category/search intersection, sort reflow, IME, bidirectional wrap, rapid clicks, reduced motion, resize; no page errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
