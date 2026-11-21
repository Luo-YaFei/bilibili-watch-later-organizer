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
    await page.route('https://mock-ai.test/**', route => route.fulfill({
      json: { choices: [{ message: { content: '{"ok":true}' } }] }
    }));
    await page.route('https://api.typesafe.ai/v1/systemone', route => {
      const { questions } = route.request().postDataJSON();
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [
        id, { type: 'choice', choice: Object.keys(question.criteria).find(category => category === 'study'), confidence: 0.99 }
      ]));
      return route.fulfill({ json: { answers } });
    });
    await page.route('http://classification.test/**', async route => {
      const name = new URL(route.request().url()).pathname.slice(1) || 'dashboard.html';
      let body = fs.readFileSync(path.resolve(name));
      if (name === 'src/dashboard.js') body = Buffer.from(body.toString().replace('  init();', `
        state.categories = core.DEFAULT_CATEGORIES;
        state.videos = Array.from({ length: 3 }, (_, i) => core.canonicalizeVideo({ bvid: 'BV1xx411c7' + String(i).padStart(2, '0'), title: '分类选择演示视频 ' + i, upName: '演示 UP', tname: '科技 · 人工智能', tags: ['遥感', '变化检测', 'AI'], desc: '这是数据库中已保存的视频简介，包含方法介绍、应用范围和演示说明。', pageParts: ['方法介绍', '实验与演示'], duration: 620, watchProgress: 120, viewCount: 23456, pubdate: 1780000000, watchlaterAddedAt: 1780000300, upMid: 12345, aid: 67890, presentInWatchlater: true }));
        globalThis.sent = [];
        globalThis.showFixtureNotice = () => setStatus('已保存浏览设置');
        globalThis.redraw = () => renderShell();
        globalThis.markFirstManual = () => updateState({
          videos: state.videos,
          classifications: [{ bvid: state.videos[0].bvid, sourceType: 'manual', categoryIds: ['study'] }]
        });
        globalThis.useTallCategories = () => { state.categories = core.DEFAULT_CATEGORIES.concat(Array.from({ length: 60 }, (_, i) => ({ id: 'extra-' + i, name: '扩展子分类 ' + i, parentId: 'study', order: 100 + i, enabled: true }))); renderShell(); };
        globalThis.chrome = { runtime: { onMessage: { addListener() {} }, async sendMessage(payload) {
          sent.push(payload);
          if (payload.type === message.SAVE_CATEGORIES) return { ok: true, data: { categories: payload.categories, categorySaveResult: { keywordResult: { skipped: true } } } };
          if (payload.type === message.UPDATE_SETTINGS) return { ok: true, data: { settings: { ...state.settings, ...payload.settings } } };
          if (payload.type === message.EXPORT_CLASSIFY_BATCH) {
            const candidates = presentVideos().filter(video =>
              !payload.excludedBvids.includes(video.bvid) && core.needsLlmExport(video, classificationMap().get(video.bvid)));
            const batchVideos = candidates.slice(0, payload.limit);
            return { ok: true, data: { batchVideos, batchSize: batchVideos.length, totalCandidates: candidates.length, categories: state.categories } };
          }
          if (payload.type === message.IMPORT_CLASSIFICATIONS) {
            const { items } = JSON.parse(payload.payload);
            const classifications = state.classifications.concat(items.map(item =>
              core.mergeClassification(null, item, state.videos.find(video => video.bvid === item.bvid))));
            return { ok: true, data: { classifications, importResult: { imported: items.length } } };
          }
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
    assert.equal(await page.locator('.glass-search').evaluate(n => getComputedStyle(n).backgroundImage), base);
    await input.fill('演示');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('.glass-search').evaluate(n => getComputedStyle(n).backgroundImage), 'none');
    assert.equal(await page.locator('.glass-search .filter-gradient').count(), 1);
    assert.equal(await page.locator('.list-head #search-scope-hint').isVisible(), true);
    await input.fill('');
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#search-scope-hint').isVisible(), false);
    await page.locator('.video-card .title').first().click();
    const dialog = page.locator('.manual-dialog');
    await dialog.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.manual-opening'));
    const layout = await dialog.evaluate(n => {
      const body = n.querySelector('.editor-body');
      const list = n.querySelector('.manual-category-list');
      const footer = n.querySelector('.editor-actions');
      return { count: list.children.length, columns: new Set(Array.from(list.children, c => Math.round(c.getBoundingClientRect().left))).size,
        sideBySide: n.querySelector('.manual-video-info').getBoundingClientRect().right <= list.getBoundingClientRect().left, bodyOverflow: body.scrollHeight > body.clientHeight + 1, footerOutside: !body.contains(footer),
        rowHeight: list.querySelector('.manual-cat-row:not(.manual-cat-root)').getBoundingClientRect().height,
        grouped: Array.from(list.children).every(card => card.querySelectorAll('.manual-cat-root').length === 1) };
    });
    assert.equal(layout.columns, 3);
    assert.equal(layout.sideBySide, true);
    assert.ok((await dialog.locator('.manual-video-info').boundingBox()).width >= 475);
    assert.equal(layout.bodyOverflow, false);
    const firstRow = await dialog.locator('.category-panel').evaluateAll(nodes => nodes.filter(n => Math.abs(n.getBoundingClientRect().top - nodes[0].getBoundingClientRect().top) < 2).length);
    assert.equal(firstRow, layout.columns);
    assert.equal(layout.grouped, true);
    assert.ok(layout.rowHeight <= 36);
    assert.equal(layout.footerOutside, true);
    assert.equal(await dialog.locator('.manual-info-tag').count(), 3);
    assert.equal(await dialog.locator('.manual-video-parts li').count(), 2);
    assert.match(await dialog.locator('.manual-video-description').textContent(), /数据库中已保存/);
    assert.match(await dialog.locator('.manual-video-facts').textContent(), /2:00 \/ 10:20/);
    assert.ok(await dialog.locator('.preview-title').evaluate(n => parseFloat(getComputedStyle(n).fontSize)) >= 20);
    assert.ok((await dialog.locator('.cover-wrap').boundingBox()).width >= 230);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-manual-classification.png') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    const compactManual = await dialog.evaluate(n => {
      const body = n.querySelector('.editor-body');
      const info = n.querySelector('.manual-video-info').getBoundingClientRect();
      const categories = n.querySelector('.manual-category-list').getBoundingClientRect();
      return { sideBySide: info.right <= categories.left, overflow: body.scrollHeight > body.clientHeight + 1 };
    });
    assert.equal(compactManual.sideBySide, true);
    assert.equal(compactManual.overflow, false);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.locator('[data-role="manual-category"]').nth(1).check();
    await page.evaluate(() => redraw());
    assert.equal(await page.locator('[data-role="manual-category"]').nth(1).isChecked(), true);
    await page.locator('[data-action="close-modal"]').click();
    await page.evaluate(() => { globalThis.batchOriginalCard = document.querySelector('.video-card'); globalThis.batchOriginalSidebar = document.querySelector('.sidebar'); });
    await page.locator('.toolbar [data-action="toggle-batch"]').click();
    assert.equal(await page.evaluate(() => batchOriginalCard === document.querySelector('.video-card') && batchOriginalSidebar === document.querySelector('.sidebar')), true);
    assert.equal(await page.locator('.batch-category-scroll').isVisible(), true);
    await page.locator('.video-card .title').first().click();
    assert.equal(await page.locator('.batch-selected').count(), 1);
    const batchLayout = await page.locator('.batch-panel').evaluate(panel => {
      const picker = panel.querySelector('.batch-category-scroll');
      const cards = panel.querySelectorAll('.category-panel');
      return { height: panel.getBoundingClientRect().height, pickerHeight: picker.clientHeight, columns: new Set(Array.from(cards, c => Math.round(c.getBoundingClientRect().left))).size };
    });
    assert.ok(batchLayout.height < 340);
    assert.ok(batchLayout.pickerHeight <= 200);
    assert.ok(batchLayout.columns >= 3);
    const wide = page.locator('.batch-category-scroll .category-panel-wide').first();
    assert.equal(await wide.locator('.category-panel-branches').evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length), 2);
    assert.equal(await wide.locator('.category-branch').evaluateAll(branches => branches.every(branch => Array.from(branch.querySelectorAll('[data-level="2"]')).every(row => row.closest('.category-panel-column') === branch.querySelector('[data-level="1"]').closest('.category-panel-column')))), true);
    assert.ok((await wide.boundingBox()).width >= 400);
    // Expanded categories leave enough visible video area for pointer selection.
    await page.locator('.video-card .title').nth(1).click();
    assert.equal(await page.locator('.batch-selected').count(), 2);
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
    await page.locator('[data-action="toggle-batch-categories"]').click();
    assert.equal(await page.locator('.batch-category-scroll').isVisible(), false);
    await page.locator('[data-action="toggle-batch-categories"]').click();
    assert.equal(await page.locator('[data-role="batch-category"]:checked').count(), 2);
    await page.setViewportSize({ width: 600, height: 700 });
    await page.locator('.toolbar [data-action="toggle-batch"]').click();
    await page.locator('.video-card .title').first().click();
    assert.equal(await page.locator('[data-action="save-manual"]').isVisible(), true);
    assert.equal(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    assert.equal(await dialog.evaluate(n => n.querySelector('.manual-video-info').getBoundingClientRect().bottom <= n.querySelector('.manual-category-list').getBoundingClientRect().top), true);
    await page.locator('[data-action="close-modal"]').click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-action="open-management"]').click();
    await page.locator('[data-action="select-settings-page"][data-page="directory"]').click();
    const directory = page.locator('.directory-panels');
    const rootRows = directory.locator('.category-admin-root');
    const visibleRoots = await rootRows.evaluateAll(nodes => nodes.filter(n => { const r = n.getBoundingClientRect(), p = n.closest('.category-admin-list').getBoundingClientRect(); return r.top >= p.top && r.bottom <= p.bottom; }).map(n => n.dataset.directoryCategory));
    const first = visibleRoots[0], rootSecond = visibleRoots[1];
    const row = id => directory.locator('[data-directory-category="' + id + '"]');
    const handle = id => row(id).locator('[data-directory-drag]');
    const drop = (parent, before = '') => row(before || parent);
    await handle(rootSecond).dragTo(drop('', first), { targetPosition: { x: 60, y: 2 } });
    assert.equal(await rootRows.first().getAttribute('data-directory-category'), rootSecond);
    const second = 'tech.ai.llm';
    // For offscreen targets, dispatch the HTML drag lifecycle after scrolling.
    // The visible-root reorder above uses an actual pointer drag.
    const drag = async (id, target, fraction = .5) => {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await handle(id).scrollIntoViewIfNeeded();
      await handle(id).dispatchEvent('dragstart', { dataTransfer: transfer });
      await target.scrollIntoViewIfNeeded();
      const rect = await target.boundingBox();
      const point = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height * fraction };
      await target.dispatchEvent('dragover', { dataTransfer: transfer, ...point });
      await target.dispatchEvent('drop', { dataTransfer: transfer, ...point });
      await page.locator('#app').dispatchEvent('dragend', { dataTransfer: transfer });
      await transfer.dispose();
    };
    const name = row(second).locator('[data-role="category-name"]');
    await name.fill('改名后分类');
    await name.press('Tab');
    assert.equal(await row(second).locator('[data-role="category-name"]').inputValue(), '改名后分类');
    await drag(second, drop(first));
    assert.equal(await row(second).getAttribute('data-level'), '1');
    await drag(second, page.locator('.directory-drop-promote[data-parent-id=""]'));
    assert.equal(await row(second).getAttribute('data-level'), '0');
    assert.equal(await rootRows.last().getAttribute('data-directory-category'), second);
    // Invalid self-parent drops keep the hierarchy unchanged.
    await drag(first, drop(first));
    assert.equal(await row(first).getAttribute('data-level'), '0');
    const dragPerformance = await page.evaluate(id => {
      const app = document.getElementById('app');
      const transfer = new DataTransfer();
      app.querySelector('[data-directory-drag][data-category-id="' + id + '"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      const zones = Array.from(app.querySelectorAll('.category-admin-row[data-directory-drop]'));
      let scans = 0;
      const original = app.querySelectorAll;
      app.querySelectorAll = function(...args) { scans++; return original.apply(this, args); };
      const started = performance.now();
      for (let i = 0; i < 1000; i++) zones[i % zones.length].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const elapsedMs = performance.now() - started;
      app.querySelectorAll = original;
      const third = app.querySelector('[data-directory-category="study.course.school"]');
      const rect = third.getBoundingClientRect();
      third.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + rect.height * .8 }));
      const siblingMarked = third.classList.contains('directory-drop-after');
      third.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: third.querySelector('input') }));
      const stableAcrossInput = third.classList.contains('directory-drop-after');
      const markerHeight = parseFloat(getComputedStyle(third, '::after').height);
      const inputsFit = zones.every(row => { const r = row.getBoundingClientRect(), i = row.querySelector('input').getBoundingClientRect(); return i.left >= r.left && i.right <= r.right + 1; });
      const panel = third.closest('.category-panel');
      panel.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.bottom + 1 }));
      const nextRow = third.nextElementSibling;
      const gapAccepted = third.classList.contains('directory-drop-after') || nextRow.classList.contains('directory-drop-before');
      app.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      return { elapsedMs, scans, siblingMarked, stableAcrossInput, markerHeight, inputsFit, gapAccepted };
    }, second);
    assert.equal(dragPerformance.scans, 0);
    assert.equal(dragPerformance.siblingMarked, true);
    assert.equal(dragPerformance.stableAcrossInput, true);
    assert.equal(dragPerformance.inputsFit, true);
    assert.equal(dragPerformance.gapAccepted, true);
    assert.equal(dragPerformance.markerHeight, 2);
    await drag(second, row('study.course.school'));
    assert.equal(await row(second).getAttribute('data-level'), '2');
    assert.equal(await row(second).getAttribute('data-parent-id'), second);
    assert.equal(await row(second).locator('[data-role="category-parent"]').inputValue(), 'study.course');
    assert.equal(await directory.locator('[data-level="3"]').count(), 0);
    // The select is a keyboard-accessible alternative for changing parents.
    await row(second).locator('summary').click();
    await row(second).locator('[data-role="category-parent"]').selectOption(first);
    assert.equal(await row(second).getAttribute('data-level'), '1');
    await page.evaluate(() => redraw());
    assert.equal(await row(second).getAttribute('data-level'), '1');
    assert.equal(await row(second).locator('[data-role="category-name"]').inputValue(), '改名后分类');
    assert.equal(await page.locator('[data-role="category-draft-status"]').textContent(), '有未保存修改');
    await drag(second, page.locator('[data-promote-level="true"]'));
    assert.equal(await row(second).getAttribute('data-level'), '0');
    await page.locator('.category-admin-list').evaluate(n => { n.scrollTop = 0; });
    const directoryLayout = await page.locator('.category-admin-list').evaluate(list => {
      const r = list.getBoundingClientRect();
      return { height: r.height, visible: Array.from(list.querySelectorAll('.category-admin-row')).filter(n => { const b = n.getBoundingClientRect(); return b.top >= r.top && b.bottom <= r.bottom; }).length,
        rowHeight: list.querySelector('.category-admin-row').getBoundingClientRect().height };
    });
    assert.ok(directoryLayout.visible >= 24);
    assert.ok(directoryLayout.rowHeight <= 30);
    assert.ok(directoryLayout.height >= 450);
    assert.equal(await page.locator('.directory-drop-child').count(), 0);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-directory-panels.png') });
    await page.setViewportSize({ width: 600, height: 700 });
    assert.equal(await page.locator('.settings-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    assert.equal(await page.locator('[data-action="save-category-draft"]').isVisible(), true);
    await page.locator('[data-action="discard-category-draft"]').click();
    assert.equal(await row(second).getAttribute('data-level'), '2');
    assert.notEqual(await row(second).locator('[data-role="category-name"]').inputValue(), '改名后分类');
    await drag(second, page.locator('.directory-drop-promote[data-parent-id=""]'));
    await row(second).locator('[data-role="category-name"]').fill('保存后的分类');
    await page.locator('[data-action="save-category-draft"]').click();
    await page.waitForTimeout(100);
    const savedCategory = await page.evaluate(id => sent.find(p => p.type === BiliWLCore.MESSAGE_TYPES.SAVE_CATEGORIES).categories.find(c => c.id === id), second);
    assert.equal(savedCategory.name, '保存后的分类');
    assert.equal(savedCategory.parentId, undefined);
    await page.evaluate(() => redraw());
    assert.equal(await row(second).locator('[data-role="category-name"]').inputValue(), '保存后的分类');
    assert.equal(await rootRows.last().getAttribute('data-directory-category'), second);
    assert.equal(await page.locator('[data-role="category-draft-status"]').textContent(), '与已保存目录一致');
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-directory-panels-narrow.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-action="close-modal"]').click();
    await page.evaluate(() => useTallCategories());
    await page.locator('.video-card .title').first().click();
    await page.waitForTimeout(100);
    const uneven = await page.locator('.manual-category-list').evaluate(grid => {
      const rects = Array.from(grid.children, card => card.getBoundingClientRect());
      const columns = new Set(rects.map(r => Math.round(r.left))).size;
      return { columns, firstRow: rects.filter(r => Math.abs(r.top - rects[0].top) < 2).length,
        overlaps: rects.some((a, i) => rects.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)) };
    });
    assert.equal(uneven.firstRow, uneven.columns);
    assert.equal(uneven.overlaps, false);
    assert.equal(uneven.columns, 3);
    assert.equal(await dialog.locator('.editor-body').evaluate(n => n.scrollHeight > n.clientHeight + 1), true);
    await page.locator('[data-action="close-modal"]').click();
    await page.evaluate(() => markFirstManual());

    const settingsButton = page.getByRole('button', { name: '设置', exact: true });
    assert.equal(await settingsButton.locator('span').isVisible(), true);
    const notice = page.locator('[data-role="status-surface"]');
    await page.evaluate(() => showFixtureNotice());
    const noticeBounds = await notice.boundingBox();
    await notice.evaluate(node => node.addEventListener('beforetoggle', event => {
      if (event.newState === 'open') {
        node.dataset.openedAboveSettings = String(Boolean(document.querySelector('.settings-dialog[open]')));
      }
    }));
    await settingsButton.click();
    const settings = page.locator('.settings-dialog');
    assert.deepEqual(await notice.boundingBox(), noticeBounds);
    assert.equal(await notice.getAttribute('data-opened-above-settings'), 'true');
    assert.equal(await notice.evaluate(node => node.matches(':popover-open')), true);
    const role = value => settings.locator('[data-role="' + value + '"]');
    const settingsTab = label => settings.getByRole('button', { name: label, exact: true });
    const status = page.locator('[data-role="status"]');
    await settingsTab('AI 批量视频分类').click();
    assert.equal(await role('llm-limit').inputValue(), '2');
    await role('llm-batch-size').fill('1');
    assert.equal(await role('llm-limit').inputValue(), '0');
    await role('llm-batch-size').fill('50');
    assert.equal(await role('llm-limit').inputValue(), '2');
    await settingsTab('自动触发').click();
    assert.equal(await role('llm-auto-classify-mode').isVisible(), true);
    await settingsTab('操作日志').click();
    assert.equal(await role('operation-log-list').isVisible(), true);
    await settingsTab('AI 服务').click();
    await settingsTab('Jev').click();
    await role('jev-api-key').fill('fixture-jev');
    await settingsTab('测试连接').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('Jev 连接测试成功'));
    await settingsTab('保存连接').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('已保存 Jev'));
    await settingsTab('视频分类 API').click();
    await role('classification-provider').selectOption('jev');
    await settingsTab('保存视频分类设置').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('视频分类将使用 Jev'));
    await settingsTab('OpenAI-compatible').click();
    await role('llm-base-url').fill('https://mock-ai.test/v1');
    await role('llm-model').fill('fixture-model');
    await role('llm-api-key').fill('fixture-openai');
    await settingsTab('Jev').click();
    await settingsTab('OpenAI-compatible').click();
    assert.equal(await role('llm-model').inputValue(), 'fixture-model');
    await settingsTab('测试连接').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('OpenAI-compatible 连接测试成功'));
    await settingsTab('保存连接').click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('已保存 OpenAI-compatible'));
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-ai-settings.png') });
    await page.setViewportSize({ width: 540, height: 720 });
    assert.equal(await settings.evaluate(n => n.scrollWidth <= n.clientWidth + 1), true);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'bili-ai-settings-narrow.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await settingsTab('视频分类 API').click();
    assert.equal(await role('classification-provider').inputValue(), 'jev');
    await settings.locator('[data-action="close-modal"]').click();

    await page.locator('[data-action="filter-unclassified"]').click();
    const quick = page.getByRole('button', { name: '一键 AI 分类' });
    for (const width of [1440, 540]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await quick.evaluate(button => {
        const title = document.querySelector('.content-title').getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const glass = getComputedStyle(button);
        const sync = getComputedStyle(document.querySelector('.sync-button'));
        const sharedStyles = ['height', 'borderRadius', 'fontSize', 'fontWeight', 'color', 'backgroundImage', 'backdropFilter'];
        const gap = rect.left - title.right;
        return Math.abs((rect.top + rect.bottom - title.top - title.bottom) / 2 - 2) < 0.5 &&
          gap === 12 && sharedStyles.every(property => glass[property] === sync[property]);
      }), true, 'The quick action aligns with the title and matches the sync button at width ' + width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await quick.click();
    await page.waitForFunction(() => document.querySelector('[data-role="status"]').textContent.includes('导入 2 项'));
    assert.deepEqual(await page.evaluate(() => {
      const { IMPORT_CLASSIFICATIONS, UPDATE_SETTINGS } = BiliWLCore.MESSAGE_TYPES;
      return {
        patches: sent.filter(item => item.type === UPDATE_SETTINGS).map(item => Object.keys(item.settings).sort()),
        classified: JSON.parse(sent.find(item => item.type === IMPORT_CLASSIFICATIONS).payload).items.map(item => item.bvid)
      };
    }), {
      patches: [['jevApiKey', 'jevModel'], ['classificationProvider'], ['llmApiKey', 'llmBaseUrl', 'llmModel', 'llmTemperature', 'llmUseResponseFormat']],
      classified: ['BV1xx411c701', 'BV1xx411c702']
    });
    assert.equal(await role('llm-limit').inputValue(), '0');
    await role('llm-include-all').check();
    assert.equal(await role('llm-limit').inputValue(), '2');
    await role('llm-include-all').uncheck();
    await settings.locator('[data-action="close-modal"]').click();
    await quick.click();
    assert.match(await status.textContent(), /没有待精细分类的视频/);
    assert.deepEqual(errors, []);
    console.log('PASS: expanded batch with wide two-column cards, full video metadata, three-level directory moves, cached drag highlighting, rename/save/discard and narrow layout; ' + JSON.stringify({ manual: layout, batch: batchLayout, directory: directoryLayout, drag: dragPerformance }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
