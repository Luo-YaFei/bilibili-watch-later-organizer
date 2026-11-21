(function attachBiliWatchLaterDB(root) {
  "use strict";

  const core = root.BiliWLCore;
  const DB_NAME = "bili-watchlater-classifier";
  const DB_VERSION = 1;
  let dbPromise = null;

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function txDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    });
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    const attempt = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("videos")) {
          const store = db.createObjectStore("videos", { keyPath: "bvid" });
          store.createIndex("presentInWatchlater", "presentInWatchlater", { unique: false });
          store.createIndex("lastSeenAt", "lastSeenAt", { unique: false });
          store.createIndex("sourceHash", "sourceHash", { unique: false });
        }
        if (!db.objectStoreNames.contains("classifications")) {
          const store = db.createObjectStore("classifications", { keyPath: "bvid" });
          store.createIndex("manualOverride", "manualOverride", { unique: false });
          store.createIndex("classifiedAt", "classifiedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("jobs")) {
          const store = db.createObjectStore("jobs", { keyPath: "id" });
          store.createIndex("type", "type", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (dbPromise !== attempt) {
          db.close();
          return;
        }
        const clearConnection = () => {
          if (dbPromise === attempt) dbPromise = null;
        };
        db.onclose = clearConnection;
        db.onversionchange = () => { clearConnection(); db.close(); };
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error("Cannot open IndexedDB"));
      request.onblocked = () => reject(new Error("本地数据库正在被其他页面使用，请关闭旧的整理页后重试"));
    });
    dbPromise = attempt;
    attempt.catch(() => {
      if (dbPromise === attempt) dbPromise = null;
    });
    return attempt;
  }

  async function get(storeName, key) {
    const db = await openDB();
    const tx = db.transaction(storeName, "readonly");
    return requestToPromise(tx.objectStore(storeName).get(key));
  }

  async function getAll(storeName) {
    const db = await openDB();
    const tx = db.transaction(storeName, "readonly");
    return requestToPromise(tx.objectStore(storeName).getAll());
  }

  async function put(storeName, value) {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    await txDone(tx);
    return value;
  }

  async function remove(storeName, key) {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    await txDone(tx);
  }

  async function clear(storeName) {
    const db = await openDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    await txDone(tx);
  }

  async function upsertVideos(items, options) {
    const db = await openDB();
    const tx = db.transaction("videos", "readwrite");
    const done = txDone(tx);
    const store = tx.objectStore("videos");
    const results = [];
    const errors = [];
    const mergedByBvid = new Map();
    for (const item of items || []) {
      try {
        const bvid = core.normalizeBvid(item && (item.bvid || item.pageUrl));
        if (!bvid) continue;
        const request = store.get(bvid);
        request.onsuccess = () => {
          try {
            // Duplicate IDs in a batch must see the preceding merge.
            const existing = mergedByBvid.get(bvid) || request.result;
            const merged = core.canonicalizeVideo(item, existing, options);
            store.put(merged);
            mergedByBvid.set(bvid, merged);
            results.push({ video: merged, isNew: !existing, sourceChanged: existing && existing.sourceHash !== merged.sourceHash });
          } catch (error) {
            errors.push(error && error.message ? error.message : String(error));
          }
        };
      } catch (error) {
        errors.push(error && error.message ? error.message : String(error));
      }
    }
    // A disk/quota failure aborts the transaction and rejects the whole batch.
    await done;
    return { results, errors };
  }

  async function markRemovedExcept(presentBvids, unidentifiedAids) {
    const present = new Set(presentBvids || []);
    const unresolved = new Set(unidentifiedAids || []);
    const db = await openDB();
    const tx = db.transaction("videos", "readwrite");
    const done = txDone(tx);
    const removed = [];
    const request = tx.objectStore("videos").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const video = cursor.value;
      const aid = Number(video.aid || video.oid);
      const mightBeUnidentified = unresolved.size && (!aid || unresolved.has(aid));
      if (video.presentInWatchlater !== false && !present.has(video.bvid) && !mightBeUnidentified) {
        core.setAuthoritativeWatchlaterMembership(video, false);
        video.lastSeenAt = Date.now();
        cursor.update(video);
        removed.push(video.bvid);
      }
      cursor.continue();
    };
    await done;
    return removed;
  }

  async function markRemoved(bvid) {
    const normalized = core.normalizeBvid(bvid);
    if (!normalized) return null;
    const db = await openDB();
    const tx = db.transaction("videos", "readwrite");
    const done = txDone(tx);
    const store = tx.objectStore("videos");
    let video = null;
    const request = store.get(normalized);
    request.onsuccess = () => {
      if (!request.result) return;
      video = request.result;
      core.setAuthoritativeWatchlaterMembership(video, false);
      video.lastSeenAt = Date.now();
      store.put(video);
    };
    await done;
    return video;
  }

  async function putClassification(classification) {
    return put("classifications", classification);
  }

  async function getClassification(bvid) {
    return get("classifications", bvid);
  }

  async function updateClassification(bvid, update) {
    const db = await openDB();
    const tx = db.transaction("classifications", "readwrite");
    const done = txDone(tx);
    const store = tx.objectStore("classifications");
    let next, updateError;
    const request = store.get(bvid);
    request.onsuccess = () => {
      try {
        next = update(request.result);
        if (next === null) store.delete(bvid);
        else if (next !== undefined) store.put(next);
      } catch (error) {
        updateError = error;
        tx.abort();
      }
    };
    try {
      await done;
    } catch (error) {
      throw updateError || error;
    }
    return next;
  }

  async function queueJobs(type, bvids, reason) {
    const db = await openDB();
    const tx = db.transaction("jobs", "readwrite");
    const done = txDone(tx);
    const store = tx.objectStore("jobs");
    const now = Date.now();
    let queued = 0;
    for (const normalized of new Set((bvids || []).map(bvid => core.normalizeBvid(bvid)))) {
      if (!normalized) continue;
      const id = type + ":" + normalized;
      const request = store.get(id);
      request.onsuccess = () => {
        const existing = request.result;
        if (existing && (existing.status === "pending" || existing.status === "running")) return;
        store.put({
          id,
          type,
          bvid: normalized,
          reason: reason || "",
          status: "pending",
          attempts: existing && existing.attempts ? existing.attempts : 0,
          createdAt: existing && existing.createdAt ? existing.createdAt : now,
          updatedAt: now
        });
        queued += 1;
      };
    }
    await done;
    return queued;
  }

  async function updateJob(id, patch) {
    const existing = await get("jobs", id);
    if (!existing) return null;
    const next = Object.assign({}, existing, patch || {}, { updatedAt: Date.now() });
    await put("jobs", next);
    return next;
  }

  async function pendingJobs(type) {
    const db = await openDB();
    const tx = db.transaction("jobs", "readonly");
    const index = tx.objectStore("jobs").index("status");
    // Old versions could leave a job marked running when the worker stopped.
    const [pending, running] = await Promise.all(["pending", "running"].map(status =>
      requestToPromise(index.getAll(status))));
    const jobs = pending.concat(running);
    return jobs
      .filter((job) => job.type === type)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async function removeJobsExcept(type) {
    const db = await openDB();
    const tx = db.transaction("jobs", "readwrite");
    const done = txDone(tx);
    const request = tx.objectStore("jobs").openCursor();
    let removed = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.type !== type) {
        cursor.delete();
        removed++;
      }
      cursor.continue();
    };
    await done;
    return removed;
  }

  async function summary({ includeJobs = true } = {}) {
    const db = await openDB();
    const stores = includeJobs ? ["videos", "classifications", "jobs"] : ["videos", "classifications"];
    const tx = db.transaction(stores, "readonly");
    const [videos, classifications, jobs] = await Promise.all(
      stores.map(name => requestToPromise(tx.objectStore(name).getAll()))
    );
    return includeJobs ? { videos, classifications, jobs } : { videos, classifications };
  }

  root.BiliWLDB = Object.freeze({
    DB_NAME,
    DB_VERSION,
    openDB,
    get,
    getAll,
    put,
    remove,
    clear,
    upsertVideos,
    markRemovedExcept,
    markRemoved,
    putClassification,
    getClassification,
    updateClassification,
    queueJobs,
    updateJob,
    pendingJobs,
    removeJobsExcept,
    summary
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
