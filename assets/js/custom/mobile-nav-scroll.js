function keepMobileNavScrollable() {
  const panel = document.getElementById("mobile-nav-panel");
  const toggle = document.getElementById("mobile-nav-toggle");
  if (!panel || !toggle) return;

  let pointerOpened = false;

  const restoreBodyScroll = () => {
    if (toggle.getAttribute("aria-expanded") === "true") {
      document.body.style.overflow = "";
    }
  };

  const clearPointerFocus = () => {
    if (!pointerOpened || toggle.getAttribute("aria-expanded") !== "true") return;

    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && panel.contains(activeElement)) {
        activeElement.blur();
      }
    });
  };

  toggle.addEventListener("pointerdown", () => {
    pointerOpened = true;
  });

  toggle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      pointerOpened = false;
    }
  });

  toggle.addEventListener("click", () => {
    window.requestAnimationFrame(restoreBodyScroll);
    clearPointerFocus();
  });

  const observer = new MutationObserver(restoreBodyScroll);
  observer.observe(panel, { attributes: true, attributeFilter: ["class", "aria-hidden"] });
  observer.observe(toggle, { attributes: true, attributeFilter: ["aria-expanded"] });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", keepMobileNavScrollable, { once: true });
} else {
  keepMobileNavScrollable();
}
