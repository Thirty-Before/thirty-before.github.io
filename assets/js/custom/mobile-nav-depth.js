function initMobileNavDepth() {
  const panel = document.getElementById("mobile-nav-panel");
  if (!panel || panel.dataset.mobileDepthBound === "true") return;
  panel.dataset.mobileDepthBound = "true";

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]",
  ].join(", ");

  const getPrimaryItems = () =>
    Array.from(panel.querySelectorAll('[data-mobile-depth-level="1"]'));

  const getSecondaryItems = () =>
    Array.from(panel.querySelectorAll('[data-mobile-depth-level="2"]'));

  const getFocusables = (item) => {
    const focusables = [];
    if (item.matches(focusableSelector)) focusables.push(item);
    focusables.push(...item.querySelectorAll(focusableSelector));
    return focusables;
  };

  const setAttributeIfChanged = (element, name, value) => {
    if (element && element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  };

  const setFocusability = (item, hidden) => {
    getFocusables(item).forEach((element) => {
      if (hidden) {
        if (!element.dataset.mobileDepthTabindex) {
          element.dataset.mobileDepthTabindex = element.hasAttribute("tabindex")
            ? element.getAttribute("tabindex")
            : "__none__";
        }
        element.setAttribute("tabindex", "-1");
        return;
      }

      const previous = element.dataset.mobileDepthTabindex;
      if (!previous) return;
      if (previous === "__none__") {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", previous);
      }
      delete element.dataset.mobileDepthTabindex;
    });
  };

  const setDepthHidden = (item, hidden) => {
    item.toggleAttribute("data-mobile-depth-hidden", hidden);
    item.setAttribute("aria-hidden", hidden ? "true" : "false");
    setFocusability(item, hidden);
  };

  const resetVisibility = () => {
    [...getPrimaryItems(), ...getSecondaryItems()].forEach((item) => {
      setDepthHidden(item, false);
    });
  };

  const closeThemeGroups = () => {
    panel.querySelectorAll(".menu-theme-group").forEach((group) => {
      const toggle = group.querySelector(".menu-theme-toggle");
      const themePanel = group.querySelector(".menu-theme-panel");
      const chevron = group.querySelector(".menu-theme-chevron");

      themePanel?.classList.add("hidden");
      setAttributeIfChanged(toggle, "aria-expanded", "false");
      toggle?.classList.remove("bg-primary/10", "text-primary", "shadow-md");
      chevron?.classList.remove("rotate-180");
    });
  };

  const closeAccordions = () => {
    panel.querySelectorAll(".nav-accordion-panel").forEach((accordionPanel) => {
      accordionPanel.style.gridTemplateRows = "0fr";
      setAttributeIfChanged(accordionPanel, "aria-hidden", "true");
    });

    panel.querySelectorAll(".nav-accordion-toggle").forEach((toggle) => {
      setAttributeIfChanged(toggle, "aria-expanded", "false");
      toggle.querySelector(".accordion-chevron")?.classList.remove("rotate-180");
      toggle.classList.remove("bg-primary/10", "text-primary");
    });
  };

  const resetDepth = ({ closeNested = false } = {}) => {
    if (closeNested) {
      closeThemeGroups();
      closeAccordions();
    }
    resetVisibility();
  };

  const isPanelOpen = () =>
    !panel.classList.contains("hidden") && panel.getAttribute("aria-hidden") !== "true";

  const getOpenAccordionGroup = () => {
    const toggle = panel.querySelector('.nav-accordion-toggle[aria-expanded="true"]');
    return toggle?.closest('[data-mobile-depth-level="1"]') || null;
  };

  const isThemeOpen = () => {
    const toggle = panel.querySelector('.menu-theme-toggle[aria-expanded="true"]');
    return Boolean(toggle && !toggle.closest(".menu-theme-panel"));
  };

  const updateDepth = () => {
    if (!isPanelOpen()) {
      resetDepth({ closeNested: true });
      return;
    }

    const openAccordionGroup = getOpenAccordionGroup();
    const themeGroup = panel.querySelector('[data-mobile-depth-branch="theme"]');
    const themeOpen = isThemeOpen();

    if (!openAccordionGroup) {
      resetVisibility();
      return;
    }

    getPrimaryItems().forEach((item) => {
      setDepthHidden(item, item !== openAccordionGroup);
    });

    getSecondaryItems().forEach((item) => {
      setDepthHidden(item, themeOpen && item !== themeGroup);
    });
  };

  const scheduleUpdate = () => {
    window.requestAnimationFrame(updateDepth);
  };

  panel.addEventListener("click", (event) => {
    if (
      event.target.closest(".nav-accordion-toggle") ||
      event.target.closest(".menu-theme-toggle")
    ) {
      scheduleUpdate();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      window.requestAnimationFrame(() => resetDepth({ closeNested: true }));
    }
  });

  document.addEventListener("mobile-nav-depth:search-toggle", () => {
    resetDepth({ closeNested: true });
  });

  document.addEventListener("mobile-nav-depth:theme-toggle", scheduleUpdate);

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(panel, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
  panel.querySelectorAll(".nav-accordion-toggle, .menu-theme-toggle, .mobile-search-only").forEach(
    (element) => {
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["aria-expanded", "class"],
      });
    },
  );

  resetVisibility();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMobileNavDepth, { once: true });
} else {
  initMobileNavDepth();
}
