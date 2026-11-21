import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../src/shared.js';
import '../src/cover-cache.js';

const thumbnail = globalThis.BiliWLCore.coverThumbnailUrl;

test('Bilibili covers use stable HTTPS thumbnails without stacking existing transforms', () => {
  const expected = 'https://i0.hdslb.com/bfs/archive/cover.jpg@640w_360h_1c_85q.webp';
  for (const value of [
    'http://i0.hdslb.com/bfs/archive/cover.jpg',
    '//i0.hdslb.com/bfs/archive/cover.jpg',
    expected,
    'https://i0.hdslb.com/bfs/archive/cover.jpg@320w_180h.webp#ignored'
  ]) assert.equal(thumbnail(value), expected);
  assert.equal(thumbnail('https://i0.biliimg.com/bfs/archive/cover.png'), 'https://i0.biliimg.com/bfs/archive/cover.png@640w_360h_1c_85q.webp');
});

test('signed URLs, other hosts, animated images and unsupported paths stay intact', () => {
  for (const value of [
    'https://example.org/cover.jpg',
    'https://hdslb.com.example.org/bfs/archive/cover.jpg',
    'https://i0.hdslb.com/bfs/archive/cover.jpg?token=keep',
    'https://i0.hdslb.com/bfs/archive/cover.gif',
    'https://i0.hdslb.com/other/cover.jpg',
    'data:image/png;base64,abc', '', 'invalid'
  ]) assert.equal(thumbnail(value), value);
});

test('offline cover keys deduplicate known image URLs and reject other network targets', () => {
  const { key } = globalThis.BiliWLCoverCache;
  assert.equal(key('//i0.hdslb.com/bfs/archive/cover.jpg'), key('http://i0.hdslb.com/bfs/archive/cover.jpg#unused'));
  assert.equal(key('https://i0.hdslb.com:8080/bfs/archive/cover.jpg'), '');
  assert.equal(key('https://i0.biliimg.com.attacker.example/bfs/archive/cover.jpg'), '');
  assert.equal(key('https://trusted:i0@i0.hdslb.com/bfs/archive/cover.jpg'), '');
});

test('initial covers are saved in one pass and later covers return to the regular request interval', async () => {
  let now = 100000;
  let concurrent = 0;
  let peak = 0;
  let nextAt = 0;
  const requests = [];
  const notices = [];
  const saved = new Map();
  const videos = Array.from({ length: 55 }, (_, index) => ({
    firstSeenAt: 100,
    coverUrl: `https://i0.hdslb.com/bfs/archive/${index}.png`
  }));
  const meta = new Map([['initial-library-sync', { through: 100 }]]);
  const sandbox = vm.createContext({
    URL, AbortSignal, Response,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { now += delay; callback(); },
    BiliWLCore: globalThis.BiliWLCore,
    BiliWLCoverCache: {
      ...globalThis.BiliWLCoverCache,
      async open() {
        return {
          keys: async () => [...saved.keys()].map(url => ({ url })),
          put: async (url, image) => saved.set(url, image)
        };
      }
    },
    BiliWLDB: {
      get: async (_, key) => meta.get(key),
      getAll: async () => videos,
      put: async (_, value) => meta.set(value.key, value)
    },
    chrome: {
      alarms: { create: async (_, { when }) => { nextAt = when; }, clear: async () => {} },
      runtime: { sendMessage: async (message) => notices.push(message) }
    },
    async fetch(url) {
      requests.push(now);
      peak = Math.max(peak, ++concurrent);
      await Promise.resolve();
      concurrent--;
      return new Response('image', { headers: { 'content-type': 'image/png' } });
    }
  });
  const source = readFileSync(new URL('../src/cover-worker.js', import.meta.url), 'utf8');
  vm.runInContext(source, sandbox);
  await sandbox.BiliWLCoverWorker.start();
  assert.equal(saved.size, 55);
  assert.equal(peak, 6);
  assert.equal(now, 100000);
  assert.equal(meta.get('save-watchlater-covers').initialDone, true);
  assert.equal(notices.length, Math.ceil(55 / 6));
  assert.equal(notices.flatMap(message => message.keys).length, 55);

  videos[0].coverUrl = 'https://i0.hdslb.com/bfs/archive/changed.png';
  videos.push({ firstSeenAt: 101, coverUrl: 'https://i0.hdslb.com/bfs/archive/new.png' });
  now = nextAt;
  vm.runInContext(source, sandbox);
  await sandbox.BiliWLCoverWorker.start();
  assert.equal(requests.length, 57);
  assert.equal(requests.at(-1) - requests.at(-2), 750);
});

test('distant covers release their source, reload nearby, and cannot retry failed originals', () => {
  const observers = [];
  const listeners = {};
  const timers = new Map();
  let timerId = 0;
  function finishScrolling() {
    for (const [id, callback] of timers) {
      timers.delete(id);
      callback();
    }
  }
  const original = 'https://i0.hdslb.com/bfs/archive/cover.jpg';
  const attributes = new Map([['src', thumbnail(original)]]);
  const image = {
    tagName: 'IMG', dataset: { coverOriginal: original }, isConnected: true, loading: 'lazy',
    getAttribute: key => attributes.get(key) || null,
    removeAttribute: key => attributes.delete(key),
    get src() { return attributes.get('src'); }, set src(value) { attributes.set('src', value); }
  };
  const images = new Set([image]);
  const main = {
    querySelectorAll: () => [...images], contains: node => images.has(node),
    addEventListener: (name, callback) => { listeners[name] = callback; },
    removeEventListener: name => { delete listeners[name]; }
  };
  const sandbox = {
    URL,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
    },
    document: {
      querySelector: () => main, querySelectorAll: () => [], createElement: () => ({}),
      head: { appendChild() {} }, addEventListener: (name, callback) => { listeners[name] = callback; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../src/cover-loader.js', import.meta.url), 'utf8'), sandbox);
  sandbox.BiliWLCovers.refresh();
  const [nearby, visible, distant] = observers;
  visible.callback([{ target: image, isIntersecting: true }]);
  assert.equal(image.loading, 'eager');
  assert.equal(image.fetchPriority, 'high');
  distant.callback([{ target: image, isIntersecting: false }]);
  assert.equal(image.getAttribute('src'), thumbnail(original), 'scrolling keeps the image source');
  const releaseOnFirstStop = timerId;
  listeners.scroll();
  assert.equal(timers.has(releaseOnFirstStop), false, 'another scroll postpones release');
  distant.callback([{ target: image, isIntersecting: true }]);
  finishScrolling();
  assert.equal(image.getAttribute('src'), thumbnail(original), 'returning cancels release');
  distant.callback([{ target: image, isIntersecting: false }]);
  finishScrolling();
  assert.equal(image.getAttribute('src'), null);
  assert.equal(image.dataset.coverDeferred, thumbnail(original));
  nearby.callback([{ target: image, isIntersecting: true }]);
  assert.equal(image.src, thumbnail(original));
  assert.equal(image.dataset.coverDeferred, undefined);
  distant.callback([{ target: image, isIntersecting: false }]);
  finishScrolling();
  listeners.error({ target: image });
  assert.equal(image.getAttribute('src'), null, 'late thumbnail failure does not load an offscreen original');
  assert.equal(image.dataset.coverDeferred, original);
  nearby.callback([{ target: image, isIntersecting: true }]);
  assert.equal(image.src, original);
  listeners.error({ target: image });
  nearby.callback([{ target: image, isIntersecting: true }]);
  assert.equal(image.getAttribute('src'), null, 'failed original is never restored');
  assert.equal(image.alt, '封面暂不可用');
  images.clear();
  sandbox.BiliWLCovers.refresh();
  assert.ok(observers.every(observer => !observer.targets.has(image)), 'detached covers leave every observer');
  images.add(image);
  sandbox.BiliWLCovers.refresh();
  assert.ok(observers.every(observer => observer.targets.has(image)), 'returning cached cards are observed again');
});
