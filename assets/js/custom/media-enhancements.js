(function () {
  "use strict";

  const ARTICLE_SELECTOR = "article.prose";
  const RESIZE_DEBOUNCE_MS = 120;
  let lightboxDoubleClickBound = false;
  let allowNextImageClick = false;

  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function initMediaEnhancements() {
    wrapWideTables();
    bindImageTools();
    observeGalleryImages();
    bindLightboxDoubleClick();
  }

  function wrapWideTables(root = document) {
    root.querySelectorAll(`${ARTICLE_SELECTOR} table`).forEach((table) => {
      if (table.closest(".prose-table-scroll")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "prose-table-scroll";
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "Scrollable table");
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);

      // Initial classification & re-classify on resize
      const classify = debounce(() => classifyTable(wrapper, table), RESIZE_DEBOUNCE_MS);
      requestAnimationFrame(classify);

      const ro = new ResizeObserver(classify);
      ro.observe(wrapper);
      wrapper._resizeObserver = ro;
    });
  }

  function classifyTable(wrapper, table) {
    // Check for forced display mode via data-table-mode attribute
    var forcedMode = table.dataset.tableMode;
    if (forcedMode === "scroll") {
      wrapper.classList.add("prose-table-wide");
      wrapper.classList.remove("prose-table-fit");
      return;
    }
    if (forcedMode === "stretch") {
      wrapper.classList.add("prose-table-fit");
      wrapper.classList.remove("prose-table-wide");
      return;
    }

    // Auto-detect: reset any inherited sizing so we measure natural table width
    table.style.width = "";
    table.style.minWidth = "";
    table.style.maxWidth = "";

    var wrapperWidth = wrapper.clientWidth;
    var tableWidth = table.scrollWidth;

    if (tableWidth > wrapperWidth) {
      wrapper.classList.add("prose-table-wide");
      wrapper.classList.remove("prose-table-fit");
    } else {
      wrapper.classList.add("prose-table-fit");
      wrapper.classList.remove("prose-table-wide");
    }
  }

  function bindImageTools() {
    document.addEventListener("click", blockSingleImageOpen, true);

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-image-action]");
      if (!button) return;

      const container = button.closest("[data-prose-image], .prose-gallery-image");
      if (!container) return;

      event.preventDefault();
      event.stopPropagation();

      if (button.dataset.imageAction === "download") {
        downloadImage(container);
      } else if (button.dataset.imageAction === "zoom") {
        openImage(container);
      }
    });

    document.addEventListener("dblclick", (event) => {
      if (event.target.closest("[data-image-action]")) return;
      const container = event.target.closest("[data-prose-image], .prose-gallery-image");
      if (!container) return;

      event.preventDefault();
      event.stopPropagation();
      openImage(container);
    });
  }

  function blockSingleImageOpen(event) {
    if (event.target.closest("[data-image-action]")) return;

    const container = event.target.closest("[data-prose-image], .prose-gallery-image");
    if (!container) return;

    if (allowNextImageClick) {
      allowNextImageClick = false;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function getImageSource(container) {
    const figure = container.closest(".image-figure");
    const image = container.querySelector("img");
    return (
      figure?.dataset.imageSrc ||
      container.dataset.imageSrc ||
      image?.currentSrc ||
      image?.src ||
      ""
    );
  }

  function openImage(container) {
    const trigger =
      container.matches(".lightbox-trigger, .sg-item")
        ? container
        : container.querySelector(".lightbox-trigger") ||
          container.closest(".lightbox-trigger, .sg-item");

    if (trigger) {
      allowNextImageClick = true;
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        allowNextImageClick = false;
      }, 0);
      return;
    }

    const image = container.querySelector("img");
    allowNextImageClick = true;
    image?.click();
    window.setTimeout(() => {
      allowNextImageClick = false;
    }, 0);
  }

  function downloadImage(container) {
    const source = getImageSource(container);
    if (!source) return;

    const link = document.createElement("a");
    link.href = source;
    link.download = getDownloadName(source);
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function getDownloadName(source) {
    try {
      const pathname = new URL(source, window.location.href).pathname;
      return decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "image");
    } catch (_) {
      return "image";
    }
  }

  function observeGalleryImages() {
    enhanceGalleryImages(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          enhanceGalleryImages(node);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function enhanceGalleryImages(root) {
    const items = [];
    if (root.matches?.(".sg-item")) items.push(root);
    root.querySelectorAll?.(".sg-item").forEach((item) => items.push(item));

    items.forEach((item) => {
      if (item.classList.contains("prose-gallery-image")) return;
      item.classList.add("prose-gallery-image");

      const image = item.querySelector("img");
      if (image) item.dataset.imageSrc = image.currentSrc || image.src;

      const actions = document.createElement("div");
      actions.className = "prose-image-actions";
      actions.innerHTML = [
        '<button class="prose-image-action" type="button" data-image-action="zoom" aria-label="Zoom" title="Zoom">',
        '  <span class="prose-image-maximize-icon" aria-hidden="true"></span>',
        "</button>",
        '<button class="prose-image-action" type="button" data-image-action="download" aria-label="Download" title="Download">',
        '  <span class="prose-image-download-icon" aria-hidden="true"></span>',
        "</button>",
      ].join("");
      item.appendChild(actions);
    });
  }

  function bindLightboxDoubleClick() {
    if (lightboxDoubleClickBound) return;
    lightboxDoubleClickBound = true;

    document.addEventListener("dblclick", (event) => {
      if (!event.target.closest(".gallery-lightbox.is-open .gallery-lightbox__image")) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelector(".gallery-lightbox.is-open .gallery-lightbox__close")?.click();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMediaEnhancements, { once: true });
  } else {
    initMediaEnhancements();
  }
})();
