(function attachCoverCache(root) {
  "use strict";

  let cache;
  function originalUrl(value) {
    try {
      const url = new URL(value?.startsWith("//") ? "https:" + value : value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port ||
          !/(^|\.)(hdslb|biliimg)\.com$/i.test(url.hostname)) return "";
      url.protocol = "https:";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  }

  function key(value) {
    const original = originalUrl(value);
    return original ? root.BiliWLCore.coverThumbnailUrl(original) : "";
  }

  root.BiliWLCoverCache = Object.freeze({
    originalUrl,
    key,
    open: () => cache ||= caches.open("bili-watchlater-covers-v1").catch(error => {
      cache = null;
      throw error;
    })
  });
})(globalThis);
