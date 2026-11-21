(function showCommentLocation() {
  "use strict";

  const eventName = "bili-watchlater-comment-location";
  const rendererTag = "bili-comment-action-buttons-renderer";
  const labelId = "bili-watchlater-comment-ip";
  let enabled = false;
  let watchingRenderer = false;

  function updateLabel(renderer) {
    const root = renderer.shadowRoot;
    const label = root?.getElementById(labelId);
    const date = root?.getElementById("pubdate");
    const location = renderer.data?.reply_control?.location;
    // Respect a location already rendered by Bilibili or another add-on.
    if (!enabled || !date || typeof location !== "string" || !location.trim() ||
        root.getElementById("location")) {
      label?.remove();
      return;
    }

    const badge = label || document.createElement("div");
    const text = location.trim();
    badge.textContent = /^IP\s*属地[：:]/i.test(text) ? text : "IP属地：" + text;
    if (!label) {
      badge.id = labelId;
      date.after(badge);
    }
  }

  function updateExistingComments(root) {
    for (const node of root.querySelectorAll("*")) {
      if (node.localName === rendererTag) updateLabel(node);
      else if (node.shadowRoot) updateExistingComments(node.shadowRoot);
    }
  }

  async function watchRenderer() {
    const { prototype } = await customElements.whenDefined(rendererTag);
    const originalUpdate = prototype.update;
    if (typeof originalUpdate !== "function") return;
    // Both top-level comments and replies use this Lit renderer, including lazy-loaded pages.
    prototype.update = function (...args) {
      const result = Reflect.apply(originalUpdate, this, args);
      updateLabel(this);
      return result;
    };
  }

  document.addEventListener(eventName, (event) => {
    const nextEnabled = event.detail === true;
    if (nextEnabled === enabled) return;
    enabled = nextEnabled;
    if (enabled && !watchingRenderer) {
      watchingRenderer = true;
      watchRenderer().catch(() => {});
    }
    for (const comments of document.querySelectorAll("bili-comments")) {
      if (comments.shadowRoot) updateExistingComments(comments.shadowRoot);
      updateExistingComments(comments);
    }
  });
})();
