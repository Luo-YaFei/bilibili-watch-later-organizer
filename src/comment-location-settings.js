(function syncCommentLocationSetting() {
  "use strict";

  const eventName = "bili-watchlater-comment-location";
  let enabled = false;
  let receivedChange = false;

  function apply(settings) {
    const nextEnabled = settings?.showCommentLocation === true;
    if (nextEnabled === enabled) return;
    enabled = nextEnabled;
    document.dispatchEvent(new CustomEvent(eventName, { detail: enabled }));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    receivedChange = true;
    apply(changes.settings.newValue);
  });
  chrome.storage.local.get("settings").then(({ settings }) => {
    if (!receivedChange) apply(settings);
  }).catch(() => {});
})();
