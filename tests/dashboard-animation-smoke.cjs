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
        state.videos = Array.from({ length: 24 }, (_, i) => core.canonicalizeVideo({ bvid: 'BV1xx411c7' + String(i).padStart(2, '0'), title: (i % 2 ? 'Python 入门 ' : '音乐现场 ') + i + (i === 1 ? '：从入门到实战，这是一段会超过两行的视频标题，用于检查不同长度标题下的信息对齐' : ''), upName: '演示 UP', duration: 80 + i, pubdate: 1700000000 + ((i * 7) % 24) * 1000, watchlaterOrder: i, presentInWatchlater: true }));
        state.classifications = state.videos.map((v, i) => ({ bvid: v.bvid, categoryIds: [i % 2 ? 'study.code' : 'music'], source: 'manual' }));
        Object.assign(state.settings, JSON.parse(localStorage.getItem('smokeSettings') || '{}'));
        globalThis.refreshFixture = () => updateState({ videos: structuredClone(state.videos), settings: state.settings });
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          const settings = { ...state.settings, ...payload.settings };
          if (payload.settings) localStorage.setItem('smokeSettings', JSON.stringify(settings));
          return { ok: true, data: { settings } };
        } } };
        init();
      `).replace('    bootstrap();', '    refreshFixture();'));
      await route.fulfill({ body, contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
    });
    await page.goto('http://motion.test/dashboard.html');
    await page.waitForTimeout(150);
    assert.deepEqual(errors, []);
    // The default selection must fit its entire upper aura below the opaque title.
    const checkDefaultAuraClearance = async () => {
      const layout = await page.locator('[data-action="filter-all"]').evaluate(row => ({
        selected: row.getAttribute('aria-current'),
        auraTop: row.querySelector('.category-aura').getBoundingClientRect().top,
        titleBottom: document.querySelector('.sidebar-sticky').getBoundingClientRect().bottom,
        textBottom: document.querySelector('.side-head .sub').getBoundingClientRect().bottom
      }));
      assert.equal(layout.selected, 'true');
      assert.ok(layout.auraTop >= layout.titleBottom, 'Default aura must not extend behind the opaque title');
      assert.ok(layout.auraTop >= layout.textBottom, 'Default aura must clear the subtitle');
    };
    await checkDefaultAuraClearance();
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
    const corners = await page.evaluate(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      const row = style('.cat-row');
      return {
        toolbar: style('.topbar').borderTopLeftRadius,
        toolbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
        control: style('.glass-search').borderTopLeftRadius,
        card: style('.video-card').borderTopLeftRadius,
        cover: style('.video-card .cover-wrap').borderTopLeftRadius,
        action: style('.card-actions button').borderTopLeftRadius,
        inset: style('.card-body').paddingBottom,
        rowPadding: [row.paddingLeft, row.paddingRight]
      };
    });
    assert.equal(corners.toolbar, '24px');
    assert.ok(corners.toolbarHeight <= 60, 'Toolbar must keep its compact height');
    assert.equal(corners.control, '14px');
    assert.equal(corners.card, corners.cover);
    assert.equal(parseFloat(corners.card) - parseFloat(corners.inset), parseFloat(corners.action));
    assert.deepEqual(corners.rowPadding, ['12px', '16px']);
    // Compare actual arc centers, including all layout offsets, not just CSS radius values.
    const checkConcentricCenters = async () => {
      const centers = await page.evaluate(() => {
        const arc = (selector, side, bottom = false) => {
          const n = document.querySelector(selector), r = n.getBoundingClientRect();
          const css = getComputedStyle(n);
          const radius = parseFloat(css[bottom ? (side === 'left' ? 'borderBottomLeftRadius' : 'borderBottomRightRadius') : (side === 'left' ? 'borderTopLeftRadius' : 'borderTopRightRadius')]);
          return [side === 'left' ? r.left + radius : r.right - radius, bottom ? r.bottom - radius : r.top + radius];
        };
        return [
          [arc('.topbar', 'left'), arc('.glass-search', 'left')],
          [arc('.topbar', 'right'), arc('.toolbar-navigation button:last-child', 'right')],
          [arc('.video-card', 'left', true), arc('.video-card .card-actions a', 'left', true)],
          [arc('.video-card', 'right', true), arc('.video-card .card-actions button', 'right', true)]
        ];
      });
      for (const [outer, inner] of centers) {
        assert.ok(outer.every((value, i) => Math.abs(value - inner[i]) <= 1), `Arc centers differ: ${outer} vs ${inner}`);
      }
    };
    await checkConcentricCenters();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await checkConcentricCenters();
    const rowTitles = await page.locator('.grid .title').evaluateAll(titles => titles.map(n => n.getBoundingClientRect().height));
    assert.ok(Math.abs(rowTitles[0] - rowTitles[1]) < 1, 'Short and long titles must share their row height');
    assert.ok(rowTitles[0] > rowTitles[6] + 10, 'A long title must not expand unrelated rows');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-concentric-layout-v130.png') });
    await page.locator('.topbar').screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-concentric-toolbar-v130.png') });
    // Exercise real browser layout across desktop, sidebar collapse, and narrow windows.
    const firstTitle = page.locator('.video-card .title').first();
    const originalTitle = await firstTitle.textContent();
    await firstTitle.evaluate(n => n.textContent = 'VeryLongUnbrokenVideoTitle'.repeat(8));
    const responsiveColumns = new Set();
    for (const width of [...Array.from({ length: 57 }, (_, i) => 320 + i * 20), 761, 1077, 1078, 1279, 1280, 1600, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      await checkDefaultAuraClearance();
      const layout = await page.locator('.grid').evaluate(grid => {
        const cards = [...grid.querySelectorAll('.video-card')];
        return {
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          cardOverflow: cards.some(card => card.scrollWidth > card.clientWidth + 1 || card.querySelector('.card-body').scrollWidth > card.querySelector('.card-body').clientWidth + 1),
          cardWidth: cards[0].getBoundingClientRect().width,
          fullTitles: cards.every(card => {
            const title = card.querySelector('.title');
            const range = document.createRange(); range.selectNodeContents(title);
            return title.scrollHeight <= title.clientHeight + 1 && range.getBoundingClientRect().bottom <= title.getBoundingClientRect().bottom + 1;
          }),
          equalButtonInsets: cards.every(card => {
            const outer = card.getBoundingClientRect();
            const left = card.querySelector('.card-actions a').getBoundingClientRect();
            const right = card.querySelector('.card-actions button').getBoundingClientRect();
            return Math.abs(left.left - outer.left - 10) < 1 && Math.abs(outer.right - right.right - 10) < 1 &&
              Math.abs(outer.bottom - left.bottom - 10) < 1 && Math.abs(outer.bottom - right.bottom - 10) < 1;
          }),
          aligned: ['.title', '.meta', '.meta + .meta', '.badges'].every(selector => {
            const row = cards.filter(card => Math.abs(card.getBoundingClientRect().top - cards[0].getBoundingClientRect().top) < 1);
            const tops = row.map(card => card.querySelector(selector).getBoundingClientRect().top);
            return Math.max(...tops) - Math.min(...tops) < 1;
          }),
          coverRatio: cards[0].querySelector('.cover-wrap').getBoundingClientRect().width / cards[0].querySelector('.cover-wrap').getBoundingClientRect().height
        };
      });
      responsiveColumns.add(layout.columns);
      assert.equal(layout.fullTitles, true, `Full titles must remain visible at ${width}px`);
      assert.equal(layout.equalButtonInsets, true, `Action bottom and side insets must match at ${width}px`);
      assert.equal(layout.aligned, true, `Metadata must align across short and long titles at ${width}px`);
      assert.equal(layout.pageOverflow, false, `Page overflow at ${width}px`);
      assert.equal(layout.cardOverflow, false, `Card content overflow at ${width}px`);
      assert.ok(layout.cardWidth >= 190, `Card too narrow at ${width}px`);
      assert.ok(Math.abs(layout.coverRatio - 16 / 9) < .01, `Cover distorted at ${width}px`);
      if (width >= 1600) {
        assert.equal(layout.columns, 6, `Wide layout must have six columns at ${width}px`);
      }
      if (width === 1280) assert.equal(layout.columns, 5);
      if (width === 1200) assert.equal(layout.columns, 4);
      if (width === 1000) assert.equal(layout.columns, 3);
      if (width === 800) assert.equal(layout.columns, 2);
      if (width === 390 || width === 320) assert.equal(layout.columns, 1);
    }
    assert.deepEqual([...responsiveColumns].filter(n => n <= 5).sort(), [1, 2, 3, 4, 5]);
    await firstTitle.evaluate((n, title) => n.textContent = title, originalTitle);
    await page.setViewportSize({ width: 1440, height: 900 });
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
        entering: cards.some(c => c.dataset.resultMotion === 'edge')
          && cards.filter(c => c.dataset.resultMotion).every(c => c.getAnimations().some(a => a.effect.getKeyframes()[0].opacity === '1')) };
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
    assert.equal(await page.locator('[data-filter-aura="search"].filter-active .filter-gradient').count(), 1);
    assert.equal(await page.locator('[data-filter-aura="search"] .category-particle').count(), 16);
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
    assert.equal(await page.locator('[data-filter-aura="search"] .filter-gradient').count(), 0);
    await page.locator('[data-action="filter-all"]').click();
    const ids = await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid));
    await page.locator('[data-role="sort-combo"]').selectOption('duration:desc');
    await page.waitForTimeout(100);
    assert.notDeepEqual(await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid)), ids);
    const checkVisibleMotion = async () => {
      const motion = await page.locator('.content').evaluate(content => {
        return Array.from(content.querySelectorAll('.video-card[data-result-motion]')).map(card => {
          const animation = card.getAnimations()[0];
          return { delay: animation?.effect.getTiming().delay, frames: animation?.effect.getKeyframes() };
        });
      });
      assert.ok(motion.length > 1);
      assert.ok(new Set(motion.map(card => card.delay)).size > 1);
      assert.ok(motion.every(card => card.frames?.[0].transform && +card.frames[0].opacity >= 0));
      assert.ok(motion.every(card => +card.frames.at(-1).opacity === 1));
    };
    await checkVisibleMotion();
    for (const order of ['duration:asc', 'pubdate:desc', 'pubdate:asc', 'watchlater:desc', 'watchlater:asc']) {
      await page.waitForTimeout(650);
      await page.locator('[data-role="sort-combo"]').selectOption(order);
      await page.waitForTimeout(40);
      await checkVisibleMotion();
      const actual = await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => Number(c.dataset.bvid.slice(-2))));
      const [mode, direction] = order.split(':');
      const expected = Array.from({ length: 24 }, (_, i) => i).sort((a, b) => {
        const delta = mode === 'pubdate' ? (a * 7) % 24 - (b * 7) % 24 : a - b;
        return delta * ((direction === 'desc') !== (mode === 'watchlater') ? -1 : 1);
      });
      assert.deepEqual(actual, expected);
    }
    await page.waitForTimeout(650);
    const membership = await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid).sort());
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-action="shuffle-videos"]').click();
      await checkVisibleMotion();
      assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'random');
      assert.deepEqual(await page.locator('.content .video-card').evaluateAll(cards => cards.map(c => c.dataset.bvid).sort()), membership);
    }
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.content [data-result-motion]').count(), 0);
    assert.equal(await page.locator('.result-exit-layer').count(), 0);
    await page.locator('.main').evaluate(main => { main.scrollTop = 180; });
    const scrollBefore = await page.locator('.main').evaluate(main => main.scrollTop);
    await page.locator('[data-role="sort-combo"]').selectOption('duration:desc');
    await page.waitForTimeout(650);
    const reversal = await page.evaluate(async () => {
      const select = document.querySelector('[data-role="sort-combo"]');
      select.value = 'duration:asc'; select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      return {
        scroll: document.querySelector('.main').scrollTop,
        enter: Array.from(document.querySelectorAll('.content [data-result-motion="edge"]')).map(card => card.getAnimations()[0].effect.getKeyframes()[0]),
        exit: document.querySelectorAll('.result-exit-layer').length
      };
    });
    assert.equal(reversal.scroll, scrollBefore);
    assert.ok(reversal.enter.length);
    assert.ok(reversal.enter.every(frame => frame.transform && +frame.opacity === 1));
    assert.equal(reversal.exit, 1);
    await page.locator('.main').evaluate(main => { main.scrollTop = 0; });
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
    await page.locator('[data-action="shuffle-videos"]').click();
    await page.locator('[data-role="sort-combo"]').selectOption('duration:asc');
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.content [data-result-motion]').count(), 0);
    assert.equal(await page.locator('.result-exit-layer').count(), 0);
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
    await page.reload();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('[data-action="filter-all"]').click();
    await page.locator('[data-role="video-filter"]').selectOption('duration-120');
    assert.equal(await page.locator('[data-filter-aura="duration"].filter-active .filter-gradient').count(), 1);
    await page.locator('[data-action="shuffle-videos"]').click();
    assert.equal(await page.locator('[data-action="shuffle-videos"]').getAttribute('aria-label'), '刷新乱序');
    assert.equal(await page.locator('[data-filter-aura="shuffle"].filter-active .filter-gradient').count(), 1);
    await page.locator('[data-role="search"]').fill('Python');
    await page.waitForTimeout(150);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-active-filters.png') });
    await page.locator('.topbar').screenshot({ path: path.join(require('node:os').tmpdir(), 'biliwl-soft-toolbar.png') });
    assert.equal(await page.locator('.toolbar .filter-active .filter-gradient').count(), 3);
    assert.equal(await page.locator('.toolbar canvas.category-aura-flow').count(), 0);
    assert.equal(await page.locator('.toolbar .filter-active .category-particle').count(), 48);
    for (const action of ['shuffle-videos', 'exit-shuffle']) {
      const button = page.locator('[data-action="' + action + '"]');
      assert.equal(await button.locator('svg').count(), 1);
      assert.equal((await button.innerText()).trim(), '');
      assert.equal(await button.evaluate(n => n.getBoundingClientRect().width), 36);
    }
    const spill = await page.locator('[data-filter-aura="search"] .filter-gradient').evaluate(n => {
      const style = getComputedStyle(n);
      return { top: style.top, bottom: style.bottom, mask: style.maskImage, composite: style.maskComposite };
    });
    assert.ok(parseFloat(spill.top) < 0 && parseFloat(spill.bottom) < 0);
    assert.doesNotMatch(spill.mask, /url\(/);
    assert.match(spill.mask, /linear-gradient/);
    assert.match(spill.composite, /intersect/);
    for (const selector of ['.glass-search.filter-active', '.filter-active > select', '.filter-active > button']) {
      for (const node of await page.locator(selector).all()) {
        await node.hover();
        const paint = await node.evaluate(n => ({ border: getComputedStyle(n).borderTopColor, shadow: getComputedStyle(n).boxShadow, edge: getComputedStyle(n, '::after').display }));
        assert.equal(paint.border, 'rgba(0, 0, 0, 0)');
        assert.equal(paint.shadow, 'none');
        assert.equal(paint.edge, 'none');
      }
    }
    const field = await page.locator('[data-filter-aura="search"]').evaluate(n => {
      const button = n.getBoundingClientRect(), particles = n.querySelector('.filter-particles').getBoundingClientRect();
      const scrollport = n.closest('.toolbar').getBoundingClientRect();
      return { width: particles.width - button.width, height: particles.height - button.height,
        topRoom: button.top - scrollport.top, bottomRoom: scrollport.bottom - button.bottom,
        tops: Array.from(n.querySelectorAll('.category-particle')).map(p => parseFloat(getComputedStyle(p).top)) };
    });
    assert.ok(field.width >= 14 && field.height >= 14);
    assert.ok(field.topRoom >= 14 && field.bottomRoom >= 14);
    assert.ok(Math.min(...field.tops) < 8 && Math.max(...field.tops) > 44);
    await page.locator('[data-role="video-filter"]').selectOption('partially-played');
    assert.equal(await page.locator('[data-filter-aura="duration"].filter-active .filter-gradient').count(), 1);
    assert.equal(await page.locator('[data-filter-aura="duration"] .category-particle').count(), 16);
    await page.setViewportSize({ width: 600, height: 800 });
    assert.ok(await page.locator('.toolbar').evaluate(n => n.scrollWidth > n.clientWidth && n.scrollHeight === n.clientHeight));
    assert.equal(await page.locator('[data-filter-aura="duration"].filter-active .filter-gradient').count(), 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-role="search"]').fill('no matching video');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('[data-action="shuffle-videos"]').isDisabled(), true);
    assert.equal(await page.locator('[data-action="exit-shuffle"]').isEnabled(), true);
    await page.locator('[data-action="exit-shuffle"]').click();
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'watchlater:desc');
    assert.equal(await page.locator('[data-filter-aura="shuffle"] .filter-gradient').count(), 0);
    await page.locator('[data-role="search"]').fill('');
    await page.waitForTimeout(150);
    await page.locator('[data-role="video-filter"]').selectOption('');
    assert.equal(await page.locator('[data-filter-aura="duration"] .filter-gradient').count(), 0);
    await page.locator('[data-action="open-management"]').click();
    await page.locator('[data-action="select-settings-page"][data-page="general"]').click();
    await page.locator('[data-role="default-sort"]').selectOption('duration:desc');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('[data-role="default-sort"]').inputValue(), 'duration:desc');
    await page.keyboard.press('Escape');
    await page.locator('[data-role="sort-combo"]').selectOption('pubdate:asc');
    await page.locator('[data-action="shuffle-videos"]').click();
    await page.locator('[data-action="shuffle-videos"]').click();
    await page.locator('[data-action="exit-shuffle"]').click();
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'duration:desc');
    await page.locator('[data-role="sort-combo"]').selectOption('watchlater:asc');
    await page.reload();
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'duration:desc');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('[data-action="select-settings-page"][data-page="general"]').click();
    const batchSize = page.locator('[data-role="result-batch-size"]');
    await page.getByLabel('默认视频筛选').selectOption('duration-120');
    await page.getByLabel('打开时随机排序').check();
    await batchSize.fill('2');
    await batchSize.press('Tab');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('smokeSettings')).resultBatchSize === 2);
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'duration:desc');
    assert.equal(await page.locator('[data-role="video-filter"]').inputValue(), '');
    await page.reload();

    const cards = page.locator('.content .video-card');
    const cardIds = () => cards.evaluateAll(nodes => nodes.map(node => node.dataset.bvid));
    assert.equal(await page.locator('[data-role="video-filter"]').inputValue(), 'duration-120');
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'random');
    assert.equal(await page.locator('.toolbar .filter-active .filter-gradient').count(), 2);
    assert.equal(await cards.count(), 2);
    const initial = await cardIds();
    await page.getByRole('button', { name: '加载更多视频' }).click();
    assert.equal(await cards.count(), 4);
    assert.deepEqual((await cardIds()).slice(0, 2), initial);
    const expanded = await cardIds();
    await page.evaluate(() => refreshFixture());
    assert.deepEqual(await cardIds(), expanded);
    await page.getByRole('button', { name: '退出乱序' }).click();
    assert.equal(await page.locator('[data-role="sort-combo"]').inputValue(), 'duration:desc');

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('[data-action="select-settings-page"][data-page="general"]').click();
    await batchSize.fill('16');
    await batchSize.press('Tab');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('smokeSettings')).resultBatchSize === 16);
    await page.keyboard.press('Escape');
    assert.equal(await cards.count(), 4, 'Changing batch size preserves cards already shown');
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.reload();
    assert.equal(await cards.count(), 16);
    await page.locator('.main').evaluate(main => { main.scrollTop = main.scrollHeight; });
    await cards.nth(23).waitFor();
    assert.equal(await cards.count(), 24);
    assert.equal(await page.getByRole('button', { name: '加载更多视频' }).isVisible(), false);

    const openBrowseSettings = async () => {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.locator('[data-action="select-settings-page"][data-page="general"]').click();
    };
    const openingCategory = page.getByLabel('默认打开的分类');
    const title = page.locator('.content-title');
    const saveOpeningCategory = async value => {
      await openBrowseSettings();
      await openingCategory.selectOption(value);
      await page.waitForFunction(value => JSON.parse(localStorage.getItem('smokeSettings')).defaultOpeningCategory === value, value);
      await page.keyboard.press('Escape');
    };
    await saveOpeningCategory('category:study');
    assert.match(await title.textContent(), /^全部视频/);
    await page.reload();
    assert.match(await title.textContent(), /^学习/);
    assert.equal(await page.locator('[data-category-cycle="original"] [data-category-id="study"]').getAttribute('aria-current'), 'true');
    assert.equal(await cards.count(), 12, 'The opening parent category includes videos in its child category');
    await saveOpeningCategory('pending');
    await page.reload();
    assert.match(await title.textContent(), /^待精细分类/);
    assert.equal(await page.locator('[data-action="filter-unclassified"]').getAttribute('aria-current'), 'true');
    await page.locator('[data-action="filter-all"]').click();
    await page.evaluate(() => refreshFixture());
    assert.match(await title.textContent(), /^全部视频/, 'Refreshing details keeps the category chosen this session');

    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('smokeSettings'));
      localStorage.setItem('smokeSettings', JSON.stringify({ ...settings, defaultOpeningCategory: 'category:deleted' }));
    });
    await page.reload();
    assert.match(await title.textContent(), /^全部视频/);
    await openBrowseSettings();
    assert.equal(await openingCategory.inputValue(), '');
    assert.deepEqual(await openingCategory.locator('option').allTextContents(), ['全部视频', '待精细分类', '学习', '学习/编程', '音乐']);
    assert.equal(await page.locator('.browsing-settings select').evaluateAll(selects => selects.map(select => select.dataset.role)).then(roles => roles.join(',')),
      'default-opening-category,default-video-filter,default-sort');
    assert.deepEqual(errors, []);
    console.log('PASS: existing motion checks; active search/duration/shuffle auras, split shuffle controls, empty-result exit, saved default sort, temporary sort and page reload; no page errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
