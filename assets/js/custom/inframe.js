(function () {
  if (typeof window.infarmeInit !== "undefined") return;
  window.infarmeInit = true;

  var activeTimer = null;

  function showCopyStatus(statusEl, text) {
    statusEl.textContent = text;
    statusEl.classList.add("is-visible");
    window.clearTimeout(activeTimer);
    activeTimer = window.setTimeout(function () {
      statusEl.classList.remove("is-visible");
    }, 1600);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // fall through to fallback
      }
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
      var success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch (_) {
      document.body.removeChild(textarea);
      return false;
    }
  }

  document.addEventListener("click", async function (event) {
    var btn = event.target.closest(".inframe-btn--copy");
    if (!btn) return;

    event.preventDefault();

    var url = btn.getAttribute("data-url");
    if (!url) return;

    var actions = btn.closest(".inframe-card__actions");
    var status = actions ? actions.querySelector(".inframe-copy-status") : null;

    var ok = await copyText(url);
    if (status) {
      showCopyStatus(status, ok ? "已复制" : "复制失败");
    }
  });
})();
