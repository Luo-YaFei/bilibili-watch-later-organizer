(function attachCategoryAura() {
  "use strict";

  // One WebGL surface serves all visible copies of the looping category list.
  let surface = null;
  let gl = null;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let targets = new WeakMap();
  let frame = 0;
  let drawTimer = 0;
  let idleTimer = 0;
  let activeUntil = 0;
  let idle = true;
  let suspended = document.hidden;
  const IDLE_MS = 5000;
  const FRAME_MS = 1000 / 15;
  let lastDraw = -Infinity;
  let program = null;
  let uniforms;
  let refreshFrame = 0;
  let canvases = [];
  const visible = new Set();
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
      entry.target.closest(".category-aura")?.classList.toggle("aura-offscreen", !entry.isIntersecting);
    }
    scheduleDraw();
  });
  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target);
      if (target) {
        target.width = entry.contentRect.width;
        target.height = entry.contentRect.height;
      }
    }
    scheduleDraw();
  });

  function initialize() {
    if (surface) return;
    surface = document.createElement("canvas");
    gl = surface.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false });

    if (gl) {
      const vertex = compile(gl.VERTEX_SHADER, `
        attribute vec2 position;
        varying vec2 uv;
        void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }
      `);
      const fragment = compile(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec2 uv;
        uniform float time;
        uniform vec3 colorA, colorB, colorC;
        void main() {
          float x = uv.x;
          float y = (uv.y - .5) * 1.5;
          // Subtract the central phase so the selected row remains the anchor.
          float bend = .09 * (sin(x * 8. - time * .30) - sin(4. - time * .30));
          bend += .048 * (sin(x * 15. + time * .19) - sin(7.5 + time * .19));
          float width = .13 + .44 * pow(1. - x, .65);
          float field = y - bend;
          float warp = sin(x * 13. - time * .34 + field * 9.) * 2.4;
          warp += sin(x * 23. + time * .22 - field * 13.) * 1.2;
          float spacing = 46. + 8. * sin(x * 6. - time * .13);
          float streak = pow(.5 + .5 * sin(field * spacing + warp), 3.);
          float fine = pow(.5 + .5 * sin(field * 94. + warp * 1.3 + x * 7.), 5.);
          float dissolve = .48 + .52 * smoothstep(-.8, .9, sin(x * 19. - time * .27 + field * 17.));
          float body = exp(-pow(field / width, 2.) * 1.6);
          body *= .8 + .2 * sin(x * 11. - time * .21 + field * 13.);
          float ends = smoothstep(.01, .18, x) * (1. - smoothstep(.76, .99, x));
          float edges = smoothstep(.02, .17, uv.y) * (1. - smoothstep(.83, .98, uv.y));
          // Striations are a faint by-product of the changing field, not its main shape.
          float alpha = min(.85, body * ends * edges * (.38 + dissolve * (.22 * streak + .035 * fine)) * 1.15);
          float shift = .08 * sin(time * .16 + x * 5. + field * 3.);
          vec3 color = mix(colorA, colorB, smoothstep(.08, .57, x + shift));
          color = mix(color, colorC, smoothstep(.43, .96, x - shift));
          gl_FragColor = vec4(color, alpha);
        }
      `);
      if (vertex && fragment) {
        const candidate = gl.createProgram();
        gl.attachShader(candidate, vertex);
        gl.attachShader(candidate, fragment);
        gl.linkProgram(candidate);
        if (gl.getProgramParameter(candidate, gl.LINK_STATUS)) program = candidate;
        else gl.deleteProgram(candidate);
      }
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program) {
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, "position");
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
        uniforms = Object.fromEntries(["time", "colorA", "colorB", "colorC"].map(name => [name, gl.getUniformLocation(program, name)]));
      }
    }
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  }

  function color(hue, saturation, lightness) {
    const h = ((hue % 360) + 360) % 360 / 30;
    const a = saturation * Math.min(lightness, 1 - lightness);
    const rgb = [0, 8, 4].map(offset => {
      const k = (offset + h) % 12;
      return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    });
    // Equal brightness prevents dark hues from making the same faint streaks look stronger.
    const linear = rgb.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    const target = .65;
    return linear.map(value => {
      const adjusted = luminance < target
        ? value + (1 - value) * (target - luminance) / (1 - luminance)
        : value * target / luminance;
      return adjusted <= .0031308 ? adjusted * 12.92 : 1.055 * adjusted ** (1 / 2.4) - .055;
    });
  }

  function draw(now) {
    frame = 0;
    if (document.hidden || !visible.size) return;
    initialize();
    if (motion.matches || idle || now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      for (const canvas of visible) {
        const target = targets.get(canvas);
        if (!target || !target.width || !target.height) continue;
        if (!program) { canvas.classList.add("aura-fallback"); continue; }
        if (!target.colors) {
          const style = getComputedStyle(canvas);
          const hue = Number(style.getPropertyValue("--aura-hue"));
          target.context = canvas.getContext("2d");
          target.colors = ["a", "b", "c"].map((key, i) =>
            color(hue + Number(style.getPropertyValue("--aura-shift-" + key)), .78, [.72, .75, .76][i]));
        }
        if (!target.context) continue;
        // Soft decorative fields do not need a high-DPI GPU readback.
        const ratio = Math.min(window.devicePixelRatio || 1, 1);
        const width = Math.max(1, Math.round(target.width * ratio)), height = Math.max(1, Math.round(target.height * ratio));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; }
        gl.viewport(0, 0, width, height);
        gl.uniform1f(uniforms.time, motion.matches ? 0 : now / 1000);
        ["colorA", "colorB", "colorC"].forEach((key, i) => gl.uniform3fv(uniforms[key], target.colors[i]));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        target.context.clearRect(0, 0, width, height);
        target.context.drawImage(surface, 0, 0);
      }
    }
    if (!motion.matches && !idle && program) {
      drawTimer = setTimeout(() => {
        drawTimer = 0;
        scheduleDraw();
      }, FRAME_MS);
    }
  }

  function scheduleDraw() {
    if (!frame && !drawTimer && !document.hidden && !suspended && visible.size) frame = requestAnimationFrame(draw);
  }

  function stopDraw() {
    cancelAnimationFrame(frame);
    clearTimeout(drawTimer);
    frame = drawTimer = 0;
  }

  function pauseEffects() {
    idle = true;
    clearTimeout(idleTimer);
    idleTimer = 0;
    stopDraw();
    document.documentElement.classList.add("effects-paused");
  }

  function checkIdle() {
    const remaining = activeUntil - performance.now();
    idleTimer = 0;
    if (remaining > 0) idleTimer = setTimeout(checkIdle, remaining);
    else pauseEffects();
  }

  function wakeEffects() {
    if (document.hidden || suspended) return;
    activeUntil = performance.now() + IDLE_MS;
    if (!idleTimer) idleTimer = setTimeout(checkIdle, IDLE_MS);
    if (!idle) return;
    idle = false;
    document.documentElement.classList.remove("effects-paused");
    scheduleDraw();
  }

  function suspendEffects() {
    suspended = true;
    cancelAnimationFrame(refreshFrame);
    refreshFrame = 0;
    pauseEffects();
  }

  function refresh() {
    // Hover, status and shell updates in one turn share one observer refresh.
    if (refreshFrame || suspended) return;
    refreshFrame = requestAnimationFrame(() => {
      refreshFrame = 0;
      stopDraw();
      visibility.disconnect();
      sizes.disconnect();
      visible.clear();
      targets = new WeakMap();
      lastDraw = -Infinity;
      canvases = Array.from(document.querySelectorAll("canvas.category-aura-flow")).filter(canvas => {
        const row = canvas.closest(".cat-row");
        return !row || row.matches(".active, .aura-preview");
      });
      for (const canvas of canvases) {
        targets.set(canvas, { width: 0, height: 0 });
        visibility.observe(canvas);
        sizes.observe(canvas);
      }
    });
  }
  motion.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("page-hidden", document.hidden);
    suspended = document.hidden;
    if (suspended) suspendEffects();
    else { wakeEffects(); refresh(); }
  });
  for (const event of ["pointermove", "pointerdown", "keydown", "wheel", "scroll"]) {
    document.addEventListener(event, wakeEffects, { passive: true, capture: true });
  }
  window.addEventListener("blur", suspendEffects);
  window.addEventListener("focus", () => { suspended = false; wakeEffects(); refresh(); });
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  wakeEffects();
  globalThis.BiliWLAura = { refresh };
})();
