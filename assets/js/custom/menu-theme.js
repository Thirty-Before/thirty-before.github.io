function initMenuThemePanels() {
  const activeClasses = ["bg-primary/10", "text-primary", "shadow-md"];

  const resetGroup = (group) => {
    const toggle = group?.querySelector(".menu-theme-toggle");
    const panel = group?.querySelector(".menu-theme-panel");
    const chevron = group?.querySelector(".menu-theme-chevron");
    if (!toggle || !panel) return;

    panel.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.remove(...activeClasses);
    chevron?.classList.remove("rotate-180");
  };

  document.querySelectorAll(".nav-submenu-toggle, .nav-accordion-toggle").forEach((navToggle) => {
    if (navToggle.dataset.menuThemeResetBound === "true") return;
    navToggle.dataset.menuThemeResetBound = "true";

    navToggle.addEventListener("click", () => {
      document.querySelectorAll(".menu-theme-group").forEach(resetGroup);
    });
  });

  document.querySelectorAll(".menu-theme-toggle").forEach((toggle) => {
    if (toggle.dataset.menuThemeBound === "true") return;
    toggle.dataset.menuThemeBound = "true";

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const group = toggle.closest(".menu-theme-group");
      const panel = group?.querySelector(".menu-theme-panel");
      const chevron = toggle.querySelector(".menu-theme-chevron");
      if (!panel) return;

      const isOpening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !isOpening);
      toggle.setAttribute("aria-expanded", String(isOpening));
      toggle.classList.toggle("bg-primary/10", isOpening);
      toggle.classList.toggle("text-primary", isOpening);
      toggle.classList.toggle("shadow-md", isOpening);
      chevron?.classList.toggle("rotate-180", isOpening);

      document.dispatchEvent(
        new CustomEvent("mobile-nav-depth:theme-toggle", {
          detail: { open: isOpening },
        }),
      );
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMenuThemePanels, { once: true });
} else {
  initMenuThemePanels();
}
