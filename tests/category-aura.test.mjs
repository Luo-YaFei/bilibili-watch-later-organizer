import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function renderer() {
  const frames = new Map();
  let nextFrame = 0;
  const classes = new Set();
  const canvas = {
    classList: { add: value => classes.add(value) },
    getBoundingClientRect: () => ({ top: 20, bottom: 120, width: 300, height: 100 })
  };
  const sandbox = {
    document: {
      hidden: false,
      createElement: () => ({ getContext: () => null }),
      querySelectorAll: () => [canvas],
      addEventListener() {}
    },
    window: { innerHeight: 800, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); }
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../src/category-aura.js", import.meta.url), "utf8")
    .replace("globalThis.BiliWLAura = { refresh };", "globalThis.subject = { refresh, color };"), sandbox);
  return { ...sandbox.subject, frames, classes };
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
  assert.equal(app.classes.has("aura-fallback"), true);
  assert.equal(app.frames.size, 0);
});
