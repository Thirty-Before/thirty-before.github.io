(function () {
  "use strict";

  const STORAGE_KEY = "thirty-before:bar-visibility-mode";
  const LEGACY_KEY = "thirty-before:immersive-mode";
  const SCROLL_EPSILON = 4;
  const MODES = new Set(["fixed", "top-fixed", "bottom-fixed", "dynamic", "hidden"]);

  function readJSON(id) {
    const element = document.getElementById(id);
    if (!element?.textContent) return {};

    try {
      const parsed = JSON.parse(element.textContent);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (_) {
      return {};
    }
  }

  function getText(config, path, fallback) {
    let value = config?.text;
    for (const segment of String(path || "").split(".")) {
      if (!segment || !value || typeof value !== "object" || !(segment in value)) return fallback;
      value = value[segment];
    }
    return typeof value === "string" ? value : fallback;
  }

  function initBarMode() {
    const header = document.querySelector(".site-header");
    const dock = document.getElementById("dock");
    const toggles = Array.from(document.querySelectorAll("[data-immersive-toggle]"));
    const menus = Array.from(document.querySelectorAll("[data-immersive-menu]"));
    const options = Array.from(document.querySelectorAll("[data-immersive-mode]"));
    if (!header || !dock || toggles.length === 0 || menus.length === 0) return;

    const config = readJSON("site-ui-config");
    const modeConfig = config.immersiveMode || {};
    if (modeConfig.enabled === false) return;

    const pageAllowsHidden = config.page?.isContentPage === true;
    const idleDelay = Math.max(250, Number.parseInt(modeConfig.idleDelay || 2000, 10));
    const hiddenLabel = getText(config, "header.immersiveHiddenTrigger", "显示悬浮栏");
    const fallbackMode = modeConfig.default === true ? "dynamic" : "fixed";

    let storedMode = normalizeMode(readStoredMode(fallbackMode), pageAllowsHidden);
    let activeMode = storedMode;
    let hiddenExpanded = false;
    let idleTimer = 0;
    let scrollFrame = 0;
    let lastScrollY = window.scrollY;
    let floatTrigger = null;

    function readStoredMode(fallback) {
      try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        if (value) return value;

        const legacy = window.localStorage.getItem(LEGACY_KEY);
        if (legacy === "true") return "dynamic";
        if (legacy === "false") return "fixed";
      } catch (_) {
        return fallback;
      }
      return fallback;
    }

    function storeMode(mode) {
      try {
        window.localStorage.setItem(STORAGE_KEY, mode);
      } catch (_) {
        /* Storage can be unavailable in restricted browser contexts. */
      }
    }

    function normalizeMode(mode, allowHidden) {
      if (!MODES.has(mode)) return fallbackMode;
      if (mode === "hidden" && !allowHidden) return "fixed";
      return mode;
    }

    function isAtTop() {
      return window.scrollY <= SCROLL_EPSILON;
    }

    function isMenuOpen() {
      return toggles.some((toggle) => toggle.getAttribute("aria-expanded") === "true");
    }

    function hasOpenHeaderUI() {
      if (header.classList.contains("is-search-open")) return true;
      if (isMenuOpen()) return true;
      return Boolean(header.querySelector('[aria-expanded="true"]'));
    }

    function hasOpenDockUI() {
      return Boolean(dock.querySelector('[aria-expanded="true"]'));
    }

    function setHeaderVisible(visible) {
      header.dataset.barVisibility = visible ? "visible" : "hidden";
      header.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function setDockVisible(visible) {
      dock.dataset.barVisibility = visible ? "visible" : "hidden";
      dock.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function setFloatVisible(visible) {
      if (!floatTrigger) floatTrigger = createFloatTrigger(hiddenLabel);
      floatTrigger.hidden = !visible;
      floatTrigger.classList.toggle("is-visible", visible);
      floatTrigger.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function createFloatTrigger(label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "immersive-float-trigger";
      button.setAttribute("aria-label", label);
      button.title = label;
      button.hidden = true;
      button.innerHTML = [
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '  <path d="M4 7h16"/>',
        '  <path d="M4 17h16"/>',
        '  <path d="M8 12h8"/>',
        "</svg>",
      ].join("");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hiddenExpanded = true;
        applyVisibility();
      });
      document.body.appendChild(button);
      return button;
    }

    function closeMenus() {
      menus.forEach((menu) => menu.classList.add("hidden"));
      toggles.forEach((toggle) => toggle.setAttribute("aria-expanded", "false"));
    }

    function toggleMenu(toggle) {
      const wrapper = toggle.closest(".immersive-mode-menu");
      const menu = wrapper?.querySelector("[data-immersive-menu]");
      if (!menu) return;

      const wasHidden = menu.classList.contains("hidden");
      window.HugoNarrowUI?.closeAllMenus?.({ restoreFocus: false });
      closeMenus();

      if (wasHidden) {
        menu.classList.remove("hidden");
        toggle.setAttribute("aria-expanded", "true");
        scheduleIdleHide();
      }
    }

    function syncSelection() {
      document.documentElement.dataset.barMode = activeMode;

      toggles.forEach((toggle) => {
        toggle.setAttribute("aria-label", getModeLabel(activeMode));
        toggle.title = getModeLabel(activeMode);
      });

      options.forEach((option) => {
        const selected = option.dataset.immersiveMode === activeMode;
        option.classList.toggle("bg-accent", selected);
        option.classList.toggle("text-accent-foreground", selected);
        option.setAttribute("aria-checked", selected ? "true" : "false");
      });
    }

    function getModeLabel(mode) {
      const map = {
        fixed: "header.immersiveModes.fixed",
        "top-fixed": "header.immersiveModes.topFixed",
        "bottom-fixed": "header.immersiveModes.bottomFixed",
        dynamic: "header.immersiveModes.dynamic",
        hidden: "header.immersiveModes.hidden",
      };
      return getText(config, map[mode], getText(config, "header.immersive", "沉浸模式"));
    }

    function chooseMode(mode) {
      storedMode = mode;
      activeMode = normalizeMode(mode, pageAllowsHidden);
      hiddenExpanded = false;
      storeMode(mode);
      closeMenus();
      applyMode();
    }

    function applyMode() {
      window.clearTimeout(idleTimer);
      syncSelection();
      applyVisibility();
      scheduleIdleHide();
    }

    function dynamicHeaderVisible() {
      if (isAtTop()) return true;
      return header.dataset.barVisibility !== "hidden";
    }

    function dynamicDockVisible() {
      return dock.dataset.barVisibility !== "hidden";
    }

    function applyVisibility() {
      const mode = activeMode;
      const top = isAtTop();

      if (mode === "fixed") {
        setHeaderVisible(true);
        setDockVisible(true);
        setFloatVisible(false);
        return;
      }

      if (mode === "top-fixed") {
        setHeaderVisible(true);
        setDockVisible(dynamicDockVisible());
        setFloatVisible(false);
        return;
      }

      if (mode === "bottom-fixed") {
        setHeaderVisible(top ? true : dynamicHeaderVisible());
        setDockVisible(true);
        setFloatVisible(false);
        return;
      }

      if (mode === "hidden") {
        if (top) {
          hiddenExpanded = false;
          setHeaderVisible(true);
          setDockVisible(false);
          setFloatVisible(false);
          return;
        }

        setHeaderVisible(hiddenExpanded);
        setDockVisible(hiddenExpanded);
        setFloatVisible(!hiddenExpanded);
        return;
      }

      setHeaderVisible(top ? true : dynamicHeaderVisible());
      setDockVisible(dynamicDockVisible());
      setFloatVisible(false);
    }

    function scheduleIdleHide() {
      window.clearTimeout(idleTimer);
      if (activeMode === "hidden") return;
      if (!usesDynamicHeader() && !usesDynamicDock()) return;

      idleTimer = window.setTimeout(() => {
        if (hasOpenHeaderUI() || hasOpenDockUI()) {
          scheduleIdleHide();
          return;
        }

        if (usesDynamicHeader() && !isAtTop()) setHeaderVisible(false);
        if (usesDynamicDock()) setDockVisible(false);
      }, idleDelay);
    }

    function usesDynamicHeader() {
      return activeMode === "dynamic" || activeMode === "bottom-fixed" || activeMode === "hidden";
    }

    function usesDynamicDock() {
      return activeMode === "dynamic" || activeMode === "top-fixed" || activeMode === "hidden";
    }

    function handleScroll() {
      if (scrollFrame) return;

      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;

        const currentScrollY = Math.max(0, window.scrollY);
        const delta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;

        if (Math.abs(delta) < SCROLL_EPSILON) {
          if (isAtTop()) applyVisibility();
          return;
        }

        if (activeMode === "hidden") {
          if (!isAtTop()) hiddenExpanded = false;
          applyVisibility();
          scheduleIdleHide();
          return;
        }

        if (isAtTop()) {
          if (usesDynamicHeader()) setHeaderVisible(true);
          if (usesDynamicDock()) setDockVisible(false);
          scheduleIdleHide();
          return;
        }

        if (delta > 0) {
          if (usesDynamicHeader()) setHeaderVisible(true);
          if (usesDynamicDock()) setDockVisible(false);
        } else {
          if (usesDynamicHeader()) setHeaderVisible(false);
          if (usesDynamicDock()) setDockVisible(true);
        }

        scheduleIdleHide();
      });
    }

    toggles.forEach((toggle) => {
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleMenu(toggle);
      });
    });

    options.forEach((option) => {
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        chooseMode(option.dataset.immersiveMode);
      });
    });

    document.addEventListener("click", (event) => {
      const insideBars = header.contains(event.target) || dock.contains(event.target);
      const insideFloat = Boolean(floatTrigger?.contains(event.target));

      if (!event.target.closest(".immersive-mode-menu")) closeMenus();

      if (activeMode === "hidden" && hiddenExpanded && !insideBars && !insideFloat) {
        hiddenExpanded = false;
        applyVisibility();
      }

      scheduleIdleHide();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeMenus();
      if (activeMode === "hidden" && hiddenExpanded && !isAtTop()) {
        hiddenExpanded = false;
        applyVisibility();
      }
    });

    document.addEventListener("inline-search:open", () => {
      if (usesDynamicHeader()) setHeaderVisible(true);
      scheduleIdleHide();
    });

    document.addEventListener("search:open", () => {
      if (usesDynamicDock()) setDockVisible(true);
      scheduleIdleHide();
    });

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", applyVisibility, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleIdleHide();
    });

    activeMode = normalizeMode(storedMode, pageAllowsHidden);
    applyMode();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBarMode, { once: true });
  } else {
    initBarMode();
  }
})();
