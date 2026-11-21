(function attachCoverLoader() {
  "use strict";

  let root = null;
  let nearbyObserver = null;
  let visibleObserver = null;
  let distantObserver = null;
  let observed = new WeakSet();
  const tracked = new Set();
  const connectedOrigins = new Set();
  const manual = new Set();
  const imagesByKey = new Map();
  const wanted = new WeakSet();
  const visible = new WeakSet();
  const reading = new WeakMap();
  const pendingRelease = new Set();
  let releaseTimer = 0;
  const priority = new Set();
  let priorityTimer = 0;

  function indexImage(image) {
    const key = image.dataset.coverKey;
    if (!key) return;
    if (!imagesByKey.has(key)) imagesByKey.set(key, new Set());
    imagesByKey.get(key).add(image);
  }

  function unindexImage(image) {
    const key = image.dataset.coverKey;
    const images = imagesByKey.get(key);
    images?.delete(image);
    if (images?.size === 0) imagesByKey.delete(key);
  }

  function showState(image, state) {
    const label = image.parentElement?.querySelector(".cover-state");
    if (!label) return;
    label.dataset.state = state;
    label.hidden = state === "ready";
    label.textContent = {
      saving: "等待保存封面",
      offline: "封面尚未保存",
      unavailable: "封面暂不可用",
      ready: ""
    }[state];
  }

  function prioritize(key) {
    if (navigator.onLine === false || !globalThis.chrome?.runtime?.sendMessage) return;
    priority.add(key);
    if (priorityTimer) return;
    priorityTimer = setTimeout(() => {
      priorityTimer = 0;
      const keys = [...priority];
      priority.clear();
      chrome.runtime.sendMessage({ type: "PRIORITIZE_COVERS", keys }).catch(() => {});
    }, 50);
  }

  async function restore(image, force = false) {
    if (image.dataset.coverDecodeFailed || image.getAttribute("src") || (!force && reading.has(image))) return;
    const token = {};
    reading.set(image, token);
    try {
      const cache = await globalThis.BiliWLCoverCache.open();
      const response = await cache.match(image.dataset.coverKey);
      const blob = response?.ok ? await response.blob() : null;
      if (reading.get(image) !== token || !image.isConnected) return;
      if (blob) {
        image.src = URL.createObjectURL(blob);
      } else if (response) {
        showState(image, "unavailable");
      } else {
        showState(image, navigator.onLine === false ? "offline" : "saving");
        if (visible.has(image) || manual.has(image)) prioritize(image.dataset.coverKey);
      }
    } catch {
      if (reading.get(image) === token) showState(image, "unavailable");
    } finally {
      if (reading.get(image) === token) reading.delete(image);
    }
  }

  function release(image) {
    wanted.delete(image);
    reading.delete(image);
    const source = image.getAttribute("src");
    if (source?.startsWith("blob:")) {
      image.removeAttribute("src");
      URL.revokeObjectURL(source);
    }
  }

  function scheduleRelease() {
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = 0;
    if (!pendingRelease.size) return;
    // Scrollbar jumps can reverse before the covers need to leave memory.
    releaseTimer = setTimeout(() => {
      releaseTimer = 0;
      for (const image of pendingRelease) {
        if (!image.isConnected) continue;
        if (image.dataset.coverKey) {
          release(image);
          continue;
        }
        const source = image.getAttribute("src");
        if (!source) continue;
        image.dataset.coverDeferred = source;
        image.removeAttribute("src");
      }
      pendingRelease.clear();
    }, 500);
  }

  function promote(image, priority) {
    if (image.dataset.coverKey) {
      wanted.add(image);
      restore(image);
    }
    if (image.dataset.coverDeferred) {
      image.src = image.dataset.coverDeferred;
      delete image.dataset.coverDeferred;
    }
    if ((priority === "high" || image.fetchPriority !== "high") && image.fetchPriority !== priority) image.fetchPriority = priority;
    if (image.loading !== "eager") image.loading = "eager";
  }

  function refresh() {
    const main = document.querySelector(".main");
    if (root !== main) {
      root?.removeEventListener("scroll", scheduleRelease);
      pendingRelease.clear();
      scheduleRelease();
      // A rebuilt shell may have moved the same loaded image into the new list.
      for (const image of tracked) {
        visible.delete(image);
        unindexImage(image);
        if (!main?.contains(image)) release(image);
      }
      nearbyObserver?.disconnect();
      visibleObserver?.disconnect();
      distantObserver?.disconnect();
      root = main;
      observed = new WeakSet();
      tracked.clear();
      if (main) {
        // Preload several screens, while a scrollbar jump promotes its destination.
        nearbyObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting || !entry.target.isConnected) continue;
            promote(entry.target, "low");
          }
        }, { root: main, rootMargin: "2400px 0px" });
        visibleObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting || !entry.target.isConnected) {
              visible.delete(entry.target);
              continue;
            }
            visible.add(entry.target);
            promote(entry.target, "high");
          }
        }, { root: main });
        // Keep nearby covers and release distant ones after scrolling settles.
        distantObserver = new IntersectionObserver(entries => {
          for (const entry of entries) {
            const image = entry.target;
            if (entry.isIntersecting) {
              pendingRelease.delete(image);
            } else if (image.isConnected && image.loading === "eager") {
              pendingRelease.add(image);
            }
          }
          scheduleRelease();
        }, { root: main, rootMargin: "3600px 0px" });
        main.addEventListener("scroll", scheduleRelease, { passive: true });
      }
    }
    for (const image of tracked) {
      if (main?.contains(image)) continue;
      nearbyObserver.unobserve(image);
      visibleObserver.unobserve(image);
      distantObserver.unobserve(image);
      visible.delete(image);
      pendingRelease.delete(image);
      release(image);
      observed.delete(image);
      tracked.delete(image);
      unindexImage(image);
    }
    for (const image of main?.querySelectorAll("img[data-cover-original]") || []) {
      if (observed.has(image)) continue;
      observed.add(image);
      tracked.add(image);
      indexImage(image);
      nearbyObserver.observe(image);
      visibleObserver.observe(image);
      distantObserver.observe(image);
      if (!image.getAttribute("src")) continue;
      let url;
      try { url = new URL(image.src); } catch { continue; }
      if (/\.(hdslb|biliimg)\.com$/i.test(url.hostname) && !connectedOrigins.has(url.origin) && connectedOrigins.size < 3) {
        connectedOrigins.add(url.origin);
        const link = document.createElement("link");
        link.rel = "preconnect";
        link.href = url.origin;
        document.head.appendChild(link);
      }
    }
    const activeManual = new Set(document.querySelectorAll(".manual-dialog img[data-cover-original]"));
    for (const image of manual) {
      if (activeManual.has(image)) continue;
      release(image);
      manual.delete(image);
      unindexImage(image);
    }
    for (const image of activeManual) {
      manual.add(image);
      indexImage(image);
      promote(image, "high");
    }
  }

  globalThis.chrome?.runtime?.onMessage?.addListener(message => {
    if (message?.type !== "COVER_CACHE_CHANGED") return;
    for (const key of Array.isArray(message.keys) ? message.keys : [message.key]) {
      for (const image of imagesByKey.get(key) || []) {
        if (wanted.has(image)) restore(image, true);
      }
    }
  });
  for (const event of ["online", "offline"]) {
    globalThis.addEventListener?.(event, () => {
      for (const image of [...tracked, ...manual]) {
        if (wanted.has(image) && image.dataset.coverKey) restore(image, true);
      }
    });
  }
  document.addEventListener("load", event => {
    const image = event.target;
    if (image.tagName === "IMG" && image.dataset.coverOriginal && image.getAttribute("src")) showState(image, "ready");
  }, true);

  // CDN failures fall back once; an unavailable original cannot create a retry loop.
  document.addEventListener("error", event => {
    const image = event.target;
    if (image.tagName !== "IMG" || !image.dataset.coverOriginal) return;
    if (image.dataset.coverKey) {
      if (!image.getAttribute("src")) return;
      image.dataset.coverDecodeFailed = "true";
      release(image);
      showState(image, "unavailable");
      return;
    }
    const deferred = image.dataset.coverDeferred;
    if (image.dataset.coverFallback || (deferred || image.getAttribute("src")) === image.dataset.coverOriginal) {
      delete image.dataset.coverDeferred;
      image.removeAttribute("src");
      image.alt = "封面暂不可用";
      showState(image, "unavailable");
      return;
    }
    image.dataset.coverFallback = "true";
    if (deferred) image.dataset.coverDeferred = image.dataset.coverOriginal;
    else image.src = image.dataset.coverOriginal;
  }, true);

  globalThis.BiliWLCovers = { refresh };
})();
