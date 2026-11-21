(function attachCoverWorker(root) {
  "use strict";

  const db = root.BiliWLDB;
  const covers = root.BiliWLCoverCache;
  const alarmName = "save-watchlater-covers";
  const maxRequests = 24;
  const initialConcurrency = 6;
  const requestInterval = 750;
  const maxImageBytes = 3 * 1024 * 1024;
  const priority = new Set();
  let active = null;
  let followupRequested = false;
  let nextRunAt = 0;

  function start() {
    if (active) {
      followupRequested = true;
    } else if (Date.now() >= nextRunAt) {
      followupRequested = false;
      active = saveBatch()
        .catch(error => console.warn("Cover cache:", error.message))
        .finally(() => { active = null; });
    }
    return active;
  }

  function prioritize(keys) {
    if (!Array.isArray(keys)) return;
    for (const key of keys.slice(0, 120)) {
      if (typeof key === "string" && covers.key(key) === key) priority.add(key);
    }
    start();
  }

  async function saveBatch() {
    const [previous, library] = await Promise.all([
      db.get("meta", alarmName), db.get("meta", root.BiliWLCore.INITIAL_LIBRARY_SYNC_KEY)
    ]);
    if (!library) return;
    let initialDone = previous?.initialDone === true;
    if (previous?.resumeAt > Date.now() && (initialDone || previous.paused || Object.keys(previous.delayed || {}).length)) {
      nextRunAt = previous.resumeAt;
      await chrome.alarms.create(alarmName, { when: previous.resumeAt });
      return;
    }
    const [videos, saved] = await Promise.all([db.getAll("videos"), covers.open()]);
    const stored = new Set((await saved.keys()).map(request => request.url));
    const delayed = previous?.delayed || {};
    const candidates = new Map();
    const initialKeys = new Set();
    let waitingForCoverUrl = false;
    for (const video of videos.filter(item => item.presentInWatchlater !== false)
      .sort((a, b) => (a.watchlaterOrder ?? Infinity) - (b.watchlaterOrder ?? Infinity))) {
      const initialVideo = !initialDone && (video.firstSeenAt || 0) <= library.through;
      if (initialVideo && !video.coverUrl && !video.detailCheckedAt) waitingForCoverUrl = true;
      const key = covers.key(video.coverUrl);
      if (!key || stored.has(key)) continue;
      candidates.set(key, covers.originalUrl(video.coverUrl));
      if (initialVideo) initialKeys.add(key);
    }
    initialDone ||= initialKeys.size === 0 && !waitingForCoverUrl;
    const now = Date.now();
    const waiting = [];
    for (const key of Object.keys(delayed)) {
      if (!(delayed[key] > now) || !candidates.has(key)) delete delayed[key];
      else {
        waiting.push(delayed[key]);
        candidates.delete(key);
      }
    }
    for (const key of priority) {
      if (!candidates.has(key)) priority.delete(key);
    }
    if (!candidates.size) {
      if (waiting.length) await schedule(Math.min(...waiting), delayed, initialDone);
      else {
        await db.put("meta", { key: alarmName, initialDone });
        await chrome.alarms.clear(alarmName);
      }
      return;
    }
    if (root.navigator?.onLine === false) {
      await schedule(now + 10 * 60000, delayed, initialDone, true);
      return;
    }
    const initial = [...initialKeys].some(key => candidates.has(key));
    // Register continuation before I/O in case Chrome suspends the worker.
    if (initial) await chrome.alarms.create(alarmName, { periodInMinutes: 1 });
    else await schedule(now + 60000, delayed, initialDone);

    let lastRequestAt = 0;
    let requestCount = 0;
    async function request(url) {
      const wait = lastRequestAt + requestInterval - Date.now();
      if (!initial && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastRequestAt = Date.now();
      requestCount++;
      const response = await fetch(url, {
        credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
        signal: AbortSignal.timeout(8000)
      });
      if (response.status === 404 || response.status === 410) return null;
      if (!response.ok) {
        const retryAfter = response.headers.get("retry-after");
        const seconds = Number(retryAfter);
        throw Object.assign(new Error("HTTP " + response.status), {
          retryAt: retryAfter && Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter)
        });
      }
      const mime = response.headers.get("content-type")?.split(";")[0];
      if (!/^image\/(avif|gif|jpeg|png|webp)$/i.test(mime || "") ||
          Number(response.headers.get("content-length")) > maxImageBytes) return null;
      const blob = await response.blob();
      return blob.size && blob.size <= maxImageBytes ? blob : null;
    }

    let failure;
    let pauseUntil = 0;
    const changed = [];
    let lastNoticeAt = 0;
    function notifySaved() {
      if (!changed.length) return;
      lastNoticeAt = Date.now();
      chrome.runtime.sendMessage({ type: "COVER_CACHE_CHANGED", keys: changed.splice(0) }).catch(() => {});
    }
    async function save(key, original) {
      try {
        let image = await request(key);
        if (!image && original !== key) {
          if (failure) return;
          image = await request(original);
        }
        await saved.put(key, image ? new Response(image) : new Response(null, { status: 404 }));
        initialKeys.delete(key);
        changed.push(key);
      } catch (error) {
        failure ||= error;
        pauseUntil = Math.max(pauseUntil, Date.now() + 10 * 60000, error.retryAt || 0);
        delayed[key] = Math.max(pauseUntil, Date.now() + 3600000);
      }
    }
    const ready = initial ? new Set([...initialKeys].filter(key => candidates.has(key))) : new Set(candidates.keys());
    // Regular updates reserve one possible fallback request before taking the next image.
    while (!failure && ready.size && (initial || (requestCount <= maxRequests - 2 && Date.now() - now < 25000))) {
      const batch = [];
      const size = initial ? initialConcurrency : 1;
      while (ready.size && batch.length < size) {
        const key = [...priority].find(value => ready.has(value)) || ready.values().next().value;
        priority.delete(key);
        ready.delete(key);
        batch.push(save(key, candidates.get(key)));
      }
      await Promise.all(batch);
      if (initial || Date.now() - lastNoticeAt >= 1000) notifySaved();
    }
    notifySaved();
    initialDone ||= initialKeys.size === 0 && !waitingForCoverUrl;
    if (failure) {
      await schedule(pauseUntil, delayed, initialDone, true);
      throw failure;
    }
    if (initial) {
      await schedule(Date.now() + 60000, delayed, initialDone);
    } else if (!followupRequested && !ready.size && !waiting.length) {
      await db.put("meta", { key: alarmName, initialDone });
      await chrome.alarms.clear(alarmName);
      nextRunAt = 0;
    }
  }

  async function schedule(resumeAt, delayed, initialDone, paused = false) {
    await db.put("meta", { key: alarmName, resumeAt, delayed, initialDone, paused });
    await chrome.alarms.create(alarmName, { when: resumeAt });
    nextRunAt = resumeAt;
  }

  root.BiliWLCoverWorker = Object.freeze({ alarmName, start, prioritize });
})(globalThis);
