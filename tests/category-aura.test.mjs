import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function renderer() {
  const frames = new Map();
  let nextFrame = 0;
  const classes = new Set();
  const observers = {};
  const events = {};
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const rootClasses = new Set();
  const canvas = {
    classList: { add: value => classes.add(value) },
    closest: selector => selector === ".cat-row" ? null : ({ classList: { toggle() {} } }),
    getBoundingClientRect: () => ({ top: 20, bottom: 120, width: 300, height: 100 })
  };
  const sandbox = {
    IntersectionObserver: class {
      constructor(callback) { observers.visibility = callback; }
      observe(target) { observers.visibility([{ target, isIntersecting: true }]); }
      disconnect() {}
    },
    ResizeObserver: class {
      constructor(callback) { observers.size = callback; }
      observe(target) { observers.size([{ target, contentRect: { width: 300, height: 100 } }]); }
      disconnect() {}
    },
    document: {
      hidden: false,
      documentElement: { classList: {
        add: value => rootClasses.add(value), remove: value => rootClasses.delete(value),
        toggle: (value, enabled) => enabled ? rootClasses.add(value) : rootClasses.delete(value)
      } },
      createElement: () => ({ getContext: () => null }),
      querySelectorAll: () => [canvas],
      addEventListener(name, callback) { events[name] = callback; }
    },
    window: { innerHeight: 800, matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener(name, callback) { events[name] = callback; } },
    performance: { now: () => now },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, at: now + delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../src/category-aura.js", import.meta.url), "utf8")
    .replace("globalThis.BiliWLAura = { refresh };", "globalThis.subject = { refresh, color };"), sandbox);
  const advance = ms => {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  };
  return { ...sandbox.subject, frames, classes, observers, canvas, sandbox, events, timers, rootClasses, advance };
}

test("every gradient hue has equal luminance without exceeding the display range", () => {
  const app = renderer();
  for (let hue = -120; hue < 480; hue += 10) {
    const rgb = app.color(hue, .78, .72);
    assert.ok(rgb.every(value => value >= 0 && value <= 1));
    const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const brightness = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    assert.ok(Math.abs(brightness - .65) < .00001, "hue " + hue);
  }
});

test("refresh replaces pending work and unavailable WebGL uses a static fallback without looping", () => {
  const app = renderer();
  app.refresh();
  app.refresh();
  assert.equal(app.frames.size, 1);
  const [id, callback] = [...app.frames][0];
  app.frames.delete(id);
  callback(1000);
  const [drawId, draw] = [...app.frames][0];
  app.frames.delete(drawId);
  draw(1016);
  assert.equal(app.classes.has("aura-fallback"), true);
  assert.equal(app.frames.size, 0);
});

test("offscreen aura stops drawing and observer visibility restarts it without layout reads", () => {
  const app = renderer();
  app.canvas.getBoundingClientRect = () => { throw new Error("per-frame layout read"); };
  app.refresh();
  const [id, refresh] = [...app.frames][0];
  app.frames.delete(id);
  refresh(0);
  app.observers.visibility([{ target: app.canvas, isIntersecting: false }]);
  const [drawId, draw] = [...app.frames][0];
  app.frames.delete(drawId);
  draw(16);
  assert.equal(app.frames.size, 0);
  assert.equal(app.classes.size, 0);
  app.observers.visibility([{ target: app.canvas, isIntersecting: true }]);
  assert.equal(app.frames.size, 1);
});

test("idle and window blur cancel decorative frames, interaction and focus resume them", () => {
  const app = renderer();
  app.refresh();
  const [id, refresh] = [...app.frames][0];
  app.frames.delete(id);
  refresh(0);
  assert.equal(app.frames.size, 1);
  app.advance(5000);
  assert.equal(app.frames.size, 0);
  assert.equal(app.timers.size, 0);
  assert.ok(app.rootClasses.has("effects-paused"));
  app.events.pointermove();
  assert.equal(app.frames.size, 1);
  assert.equal(app.rootClasses.has("effects-paused"), false);
  app.advance(4000);
  app.events.keydown();
  app.advance(1000);
  assert.equal(app.rootClasses.has("effects-paused"), false, "activity extends idle deadline");
  app.events.blur();
  assert.equal(app.frames.size, 0);
  app.events.focus();
  assert.ok(app.frames.size > 0);
  app.sandbox.document.hidden = true;
  app.events.visibilitychange();
  app.events.pointermove();
  assert.equal(app.frames.size, 0, "hidden tab cannot restart rendering");
});

test("transparent category rows are not observed or scheduled for drawing", () => {
  const app = renderer();
  app.canvas.closest = selector => selector === ".cat-row" ? { matches: () => false } : null;
  app.refresh();
  const [id, refresh] = [...app.frames][0];
  app.frames.delete(id);
  refresh(0);
  assert.equal(app.frames.size, 0);
});
