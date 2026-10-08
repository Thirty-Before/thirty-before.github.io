(function () {
  if (typeof window.__demoFlowInit !== "undefined") return;
  window.__demoFlowInit = true;

  var toastEl = null;

  function ensureToast() {
    if (toastEl && document.body.contains(toastEl)) return;
    toastEl = document.createElement("div");
    toastEl.className = "demo-flow-toast";
    toastEl.setAttribute("aria-live", "polite");
    document.body.appendChild(toastEl);
  }

  function showToast(text) {
    ensureToast();
    toastEl.textContent = text;
    toastEl.classList.add("is-visible");
    window.clearTimeout(showToast._timer);
    showToast._timer = window.setTimeout(function () {
      if (toastEl) toastEl.classList.remove("is-visible");
    }, 1500);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }

    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      var ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch (_) {
      textarea.remove();
      return false;
    }
  }

  document.addEventListener("click", async function (event) {
    var btn = event.target.closest(".demo-flow__copy");
    if (!btn) return;

    var block = btn.closest(".demo-flow");
    if (!block) return;

    var code = block.querySelector(".demo-flow__source code");
    if (!code) return;

    var ok = await copyText(code.textContent || "");
    showToast(ok ? "源码已复制" : "复制失败");
  });
})();
