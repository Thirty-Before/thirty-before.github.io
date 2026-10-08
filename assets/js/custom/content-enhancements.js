(function () {
  const CONFIG_ID = "content-enhancements-config";
  const ARTICLE_SELECTOR = "article.prose";
  const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";
  const NUMBER_CLASS = "heading-number";
  const TOC_NUMBER_CLASS = "toc-heading-number";
  const FOLDED_CLASS = "content-section-folded";
  const DEFAULT_CONFIG = {
    enabled: true,
    maxDepth: 4,
    base: "first-content-heading",
    levelOneStyle: "chinese",
    levelOneSuffix: "、",
    decimalSeparator: ".",
    space: " ",
  };

  const articleStates = new WeakMap();
  const enhancedArticles = [];
  let mermaidToolsBound = false;
  let mermaidLightbox = null;
  let katexCopyBound = false;
  let tocClickBound = false;

  function readJSONConfig(id) {
    const element = document.getElementById(id);
    if (!element?.textContent) return {};

    try {
      const parsed = JSON.parse(element.textContent);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (_) {
      return {};
    }
  }

  function getHeadingConfig() {
    const config = readJSONConfig(CONFIG_ID);
    const raw = config.headingNumbering || {};
    const normalized = {
      enabled: raw.enabled,
      maxDepth: raw.maxDepth ?? raw.maxdepth,
      base: raw.base,
      levelOneStyle: raw.levelOneStyle ?? raw.levelonestyle,
      levelOneSuffix: raw.levelOneSuffix ?? raw.levelonesuffix,
      decimalSeparator: raw.decimalSeparator ?? raw.decimalseparator,
      space: raw.space,
    };

    return {
      ...DEFAULT_CONFIG,
      ...raw,
      ...Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)),
      maxDepth: Number.parseInt(normalized.maxDepth || DEFAULT_CONFIG.maxDepth, 10),
    };
  }

  function getUIText(path, fallback) {
    const config = readJSONConfig("site-ui-config");
    let value = config?.text;

    for (const segment of String(path || "").split(".")) {
      if (!segment || !value || typeof value !== "object" || !(segment in value)) {
        return fallback;
      }
      value = value[segment];
    }

    return typeof value === "string" ? value : fallback;
  }

  function initContentEnhancements() {
    initHeadingNumberingAndFolding();
    initMermaidTools();
    initKatexCopyFallback();
  }

  function initHeadingNumberingAndFolding() {
    const config = getHeadingConfig();
    if (!config.enabled || config.maxDepth < 1) return;

    const articles = Array.from(document.querySelectorAll(ARTICLE_SELECTOR));
    articles.forEach((article) => enhanceArticle(article, config));

    bindTocClicks();

    if (window.location.hash) {
      window.requestAnimationFrame(() => expandForHash(window.location.hash));
    }
  }

  function enhanceArticle(article, config) {
    if (articleStates.has(article)) return;

    const allHeadings = Array.from(article.querySelectorAll(HEADING_SELECTOR)).filter(isContentHeading);
    if (allHeadings.length === 0) return;
    const tocNumberMap = buildTocNumberMap(config);

    const baseLevel =
      config.base === "first-content-heading"
        ? Math.min(...allHeadings.map((heading) => getHeadingLevel(heading)))
        : 1;

    const counters = Array.from({ length: config.maxDepth }, () => 0);
    const numberedHeadings = [];

    allHeadings.forEach((heading) => {
      const depth = getHeadingLevel(heading) - baseLevel + 1;
      if (depth < 1 || depth > config.maxDepth) return;

      const tocNumber = tocNumberMap.get(heading.id);
      let number = tocNumber?.number;
      const headingDepth = tocNumber?.depth || depth;

      /* Always advance counters so headings missing from TOC still get correct numbers */
      counters[depth - 1] += 1;
      for (let index = depth; index < counters.length; index += 1) counters[index] = 0;

      if (!number) {
        number = formatHeadingNumber(counters, depth, config);
      }

      insertHeadingNumber(heading, number, config.space);

      heading.dataset.contentHeading = "true";
      heading.dataset.headingDepth = String(headingDepth);
      heading.dataset.headingNumber = number;
      heading.setAttribute("aria-expanded", "true");
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = 0;

      numberedHeadings.push({ heading, depth: headingDepth, number });
      prefixTocLink(heading.id, number, config.space);
    });

    if (numberedHeadings.length === 0) return;

    const state = {
      article,
      sections: buildSections(article, numberedHeadings),
      collapsed: new WeakSet(),
    };

    articleStates.set(article, state);
    enhancedArticles.push(article);
    bindArticleFolding(article, state);
  }

  function buildTocNumberMap(config) {
    const toc = document.querySelector("#TableOfContents");
    const map = new Map();
    if (!toc) return map;

    const root = toc.querySelector(":scope > ul");
    if (!root) return map;

    const counters = Array.from({ length: config.maxDepth }, () => 0);
    const currentPath = normalizePath(window.location.pathname);

    function walk(ul, depth) {
      if (depth < 1 || depth > config.maxDepth) return;

      Array.from(ul.children).forEach((li) => {
        if (!(li instanceof HTMLElement) || li.tagName.toLowerCase() !== "li") return;

        const link = li.querySelector(":scope > a[href]");
        if (!link) return;

        counters[depth - 1] += 1;
        for (let index = depth; index < counters.length; index += 1) counters[index] = 0;

        const number = formatHeadingNumber(counters, depth, config);
        prefixTocElement(link, number, config.space);

        const target = parseTocHref(link.getAttribute("href"), currentPath);
        if (target?.id && target.path === currentPath) {
          map.set(target.id, { number, depth });
        }

        const child = li.querySelector(":scope > ul");
        if (child) walk(child, depth + 1);
      });
    }

    walk(root, 1);
    return map;
  }

  function parseTocHref(href, currentPath) {
    if (!href) return null;

    try {
      const url = new URL(href, window.location.href);
      return {
        path: normalizePath(url.pathname),
        id: decodeURIComponent(url.hash.replace(/^#/, "")),
      };
    } catch (_) {
      if (!href.startsWith("#")) return null;
      return { path: currentPath, id: decodeURIComponent(href.slice(1)) };
    }
  }

  function normalizePath(path) {
    const value = String(path || "/");
    return value.endsWith("/") ? value : `${value}/`;
  }

  function isContentHeading(heading) {
    return !heading.closest(".not-prose, .code-block-container, .mermaid-tool, .katex-display, .alert, .annot-block");
  }

  function getHeadingLevel(heading) {
    return Number.parseInt(heading.tagName.slice(1), 10);
  }

  function formatHeadingNumber(counters, depth, config) {
    if (depth === 1) {
      const value = counters[0];
      const prefix = config.levelOneStyle === "chinese" ? toChineseOrdinal(value) : String(value);
      return `${prefix}${config.levelOneSuffix || ""}`;
    }

    return counters.slice(0, depth).join(config.decimalSeparator || ".");
  }

  function toChineseOrdinal(value) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    if (value <= 0) return String(value);
    if (value < 10) return digits[value];
    if (value === 10) return "十";
    if (value < 20) return `十${digits[value % 10]}`;
    if (value < 100) {
      const tens = Math.floor(value / 10);
      const ones = value % 10;
      return `${digits[tens]}十${ones ? digits[ones] : ""}`;
    }
    return String(value);
  }

  function insertHeadingNumber(heading, number, space) {
    let numberElement = heading.querySelector(`:scope > .${NUMBER_CLASS}`);
    if (!numberElement) {
      numberElement = document.createElement("span");
      numberElement.className = NUMBER_CLASS;
      heading.insertBefore(numberElement, heading.firstChild);
    }

    numberElement.textContent = `${number}${space || " "}`;
  }

  function prefixTocLink(id, number, space) {
    if (!id) return;

    document.querySelectorAll(`#TableOfContents a[href="#${cssEscape(id)}"]`).forEach((link) => {
      prefixTocElement(link, number, space);
    });
  }

  function prefixTocElement(link, number, space) {
    let numberElement = link.querySelector(`:scope > .${TOC_NUMBER_CLASS}`);
    if (!numberElement) {
      numberElement = document.createElement("span");
      numberElement.className = TOC_NUMBER_CLASS;
      link.insertBefore(numberElement, link.firstChild);
    }
    numberElement.textContent = `${number}${space || " "}`;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
  }

  function buildSections(article, numberedHeadings) {
    const numberedSet = new Set(numberedHeadings.map((item) => item.heading));

    return numberedHeadings.map(({ heading, depth }) => {
      const nodes = [];
      let node = heading.nextElementSibling;

      while (node) {
        if (numberedSet.has(node) && Number.parseInt(node.dataset.headingDepth || "0", 10) <= depth) {
          break;
        }

        nodes.push(node);
        node = node.nextElementSibling;
      }

      return { heading, depth, nodes };
    });
  }

  function bindArticleFolding(article, state) {
    article.addEventListener("click", (event) => {
      const heading = event.target.closest("[data-content-heading='true']");
      if (!heading || !article.contains(heading)) return;
      if (event.target.closest("a, button, input, textarea, select, label")) return;

      event.preventDefault();
      toggleSection(state, heading);
    });

    article.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      const heading = event.target.closest("[data-content-heading='true']");
      if (!heading || !article.contains(heading)) return;

      event.preventDefault();
      toggleSection(state, heading);
    });
  }

  function toggleSection(state, heading) {
    if (state.collapsed.has(heading)) {
      state.collapsed.delete(heading);
    } else {
      state.collapsed.add(heading);
    }

    applyFoldingState(state);
  }

  function applyFoldingState(state) {
    state.sections.forEach((section) => {
      section.heading.setAttribute("aria-expanded", String(!state.collapsed.has(section.heading)));
      section.nodes.forEach((node) => {
        node.classList.remove(FOLDED_CLASS);
        node.removeAttribute("aria-hidden");
      });
    });

    state.sections.forEach((section) => {
      if (!state.collapsed.has(section.heading)) return;

      section.nodes.forEach((node) => {
        node.classList.add(FOLDED_CLASS);
        node.setAttribute("aria-hidden", "true");
      });
    });
  }

  function bindTocClicks() {
    if (tocClickBound) return;
    tocClickBound = true;

    document.addEventListener("click", (event) => {
      const link = event.target.closest("#TableOfContents a[href^='#']");
      if (!link) return;

      const target = getHashTarget(link.getAttribute("href"));
      if (!target) return;

      expandForHeading(target);
      event.preventDefault();

      window.requestAnimationFrame(() => {
        var top = target.getBoundingClientRect().top + window.scrollY - 112;
        window.scrollTo({ top: top, behavior: "smooth" });
        history.pushState(null, "", `#${target.id}`);
      });
    });
  }

  function expandForHash(hash) {
    const target = getHashTarget(hash);
    if (target) expandForHeading(target);
  }

  function getHashTarget(hash) {
    if (!hash || hash === "#") return null;

    try {
      const id = decodeURIComponent(hash.slice(1));
      return document.getElementById(id);
    } catch (_) {
      return document.getElementById(hash.slice(1));
    }
  }

  function expandForHeading(target) {
    enhancedArticles.forEach((article) => {
      const state = articleStates.get(article);
      if (!state) return;

      let changed = false;
      state.sections.forEach((section) => {
        if (!state.collapsed.has(section.heading)) return;
        if (!section.nodes.includes(target)) return;

        state.collapsed.delete(section.heading);
        changed = true;
      });

      if (changed) applyFoldingState(state);
    });
  }

  function initMermaidTools() {
    if (mermaidToolsBound) return;
    mermaidToolsBound = true;

    document.addEventListener("click", (event) => {
      // Click anywhere on collapsed mermaid code pane → expand
      const collapsedMermaid = event.target.closest("[data-mermaid-tool].is-mermaid-code-collapsed");
      if (collapsedMermaid && collapsedMermaid.dataset.mermaidFoldable === "true") {
        event.preventDefault();
        setMermaidCodeCollapsed(collapsedMermaid, false);
        return;
      }

      const button = event.target.closest("[data-mermaid-action]");
      if (!button) return;

      const tool = button.closest("[data-mermaid-tool]");
      if (!tool) return;

      event.preventDefault();

      const action = button.dataset.mermaidAction;
      if (action === "code") showMermaidCode(tool);
      if (action === "render") renderMermaidCode(tool, button);
      if (action === "zoom") showMermaidLightbox(tool);
      if (action === "copy-svg") copyMermaidSvg(tool, button);
      if (action === "download-svg") downloadMermaidSvg(tool, button);
      if (action === "copy-code") copyMermaidCode(tool, button);
      if (action === "toggle-code-collapse") {
        if (tool.dataset.mermaidFoldable !== "true") return;
        const collapsed = tool.dataset.mermaidCollapsed === "true";
        setMermaidCodeCollapsed(tool, !collapsed);
      }
      if (action === "expand-code" && tool.dataset.mermaidFoldable === "true") {
        setMermaidCodeCollapsed(tool, false);
      }
    });

    document.addEventListener("dblclick", (event) => {
      const pane = event.target.closest("[data-mermaid-render-pane]");
      if (!pane?.querySelector("svg")) return;

      const tool = pane.closest("[data-mermaid-tool]");
      if (tool) showMermaidLightbox(tool);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMermaidLightbox();
    });
  }

  function getMermaidSource(tool) {
    const source = tool.querySelector("[data-mermaid-source]");
    if (!source) return "";
    if ("value" in source) return source.value.trim();
    return source.textContent?.trim() || "";
  }

  function getMermaidPane(tool) {
    return tool.querySelector("[data-mermaid-render-pane]");
  }

  function showMermaidCode(tool) {
    const pane = getMermaidPane(tool);
    const source = getMermaidSource(tool);
    if (!pane || !source) return;

    tool.classList.add("is-code-mode");
    tool.classList.remove("mermaid-render-mode");
    pane.replaceChildren(createMermaidCodeView(source));

    const foldable = sourceLines > minCollapseLines;
    const autoCollapse = sourceLines > autoCollapseLines;
    tool.dataset.mermaidFoldable = String(foldable);
    setMermaidCodeCollapsed(tool, autoCollapse, { animate: false });
  }

  function createMermaidCodeView(source) {
    const shell = document.createElement("div");
    shell.className = "mermaid-source-shell relative";

    const pre = document.createElement("pre");
    pre.className = "mermaid-source-view";
    const code = document.createElement("code");
    code.className = "language-mermaid";
    code.append(...highlightMermaidSource(source));
    pre.appendChild(code);

    const overlay = document.createElement("div");
    overlay.className =
      "mermaid-code-collapse-overlay collapse-overlay to-card/90 pointer-events-none absolute inset-0 bg-linear-to-b from-transparent via-transparent opacity-0 transition-opacity duration-300";
    overlay.hidden = true;

    const expandButton = document.createElement("button");
    expandButton.type = "button";
    expandButton.className =
      "collapse-overlay-btn text-muted-foreground bg-card/80 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 absolute bottom-4 left-1/2 flex items-center justify-center rounded-full border p-2 backdrop-blur-sm transition-all duration-200";
    expandButton.dataset.mermaidAction = "expand-code";
    expandButton.setAttribute("aria-label", getUIText("code.expand", "展开"));
    expandButton.title = getUIText("code.expand", "展开");
    expandButton.innerHTML =
      '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>';
    overlay.appendChild(expandButton);

    const bottomBar = document.createElement("div");
    bottomBar.className =
      "code-block-bottom-bar absolute bottom-0 left-0 right-0 z-10 hidden items-center justify-center";
    bottomBar.style.height = "3.25rem";
    bottomBar.style.cursor = "pointer";
    bottomBar.dataset.mermaidAction = "toggle-code-collapse";
    bottomBar.hidden = true;
    bottomBar.setAttribute("aria-label", getUIText("code.collapse", "收起"));
    bottomBar.title = getUIText("code.collapse", "收起");

    const bottomIcon = document.createElement("span");
    bottomIcon.className =
      "code-block-bottom-collapse inline-flex items-center justify-center text-muted-foreground bg-card/80 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 rounded-full border p-2 backdrop-blur-sm transition-all duration-200 pointer-events-none";
    bottomIcon.innerHTML =
      '<svg class="h-4 w-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>';
    bottomBar.appendChild(bottomIcon);

    shell.append(pre, overlay, bottomBar);
    return shell;
  }

  async function renderMermaidCode(tool, button) {
    const pane = getMermaidPane(tool);
    const source = getMermaidSource(tool);
    if (!pane || !source) return;

    tool.classList.remove("is-code-mode");
    tool.classList.add("mermaid-render-mode");
    tool.dataset.mermaidFoldable = "false";
    setMermaidCodeCollapsed(tool, false, { animate: false });

    const pre = document.createElement("pre");
    pre.className = "mermaid";
    pre.dataset.originalCode = source;
    pre.textContent = source;
    pane.replaceChildren(pre);

    try {
      await waitForMermaidRenderer();
      await window.thirtyBeforeRenderMermaid(pre);
      if (!pane.querySelector("svg")) await window.thirtyBeforeRenderMermaid(pane);
      if (!pane.querySelector("svg")) throw new Error("Mermaid render produced no SVG");
      setButtonFeedback(button, getUIText("mermaid.rendered", "Rendered"));
    } catch (_) {
      setButtonFeedback(button, getUIText("mermaid.renderFailed", "Render failed"));
    }
  }

  function waitForMermaidRenderer() {
    if (typeof window.thirtyBeforeRenderMermaid === "function") return Promise.resolve();

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (typeof window.thirtyBeforeRenderMermaid === "function") {
          window.clearInterval(timer);
          resolve();
        } else if (attempts > 30) {
          window.clearInterval(timer);
          reject(new Error("Mermaid renderer unavailable"));
        }
      }, 100);
    });
  }

  function shouldFoldMermaidCode(tool, source, pane) {
    const autoCollapseLines = Number.parseInt(tool.dataset.autoCollapseLines || "8", 10);
    const autoCollapseHeight = Number.parseInt(tool.dataset.autoCollapseHeight || "400", 10);
    const sourceLines = source.split(/\r\n|\r|\n/).length;
    const minCollapseLines = Number.parseInt(tool.dataset.minCollapseLines || "6", 10);

    if (sourceLines < minCollapseLines) return false;

    const renderedCode = pane.querySelector(".mermaid-source-view");
    const renderedHeight = renderedCode?.offsetHeight || 0;

    return sourceLines > autoCollapseLines || renderedHeight > autoCollapseHeight;
  }

  function setMermaidCodeCollapsed(tool, collapsed, { animate = true } = {}) {
    const pane = getMermaidPane(tool);
    const button = tool.querySelector("[data-mermaid-action='toggle-code-collapse']");
    const text = button?.querySelector(".mermaid-code-collapse-text");
    const chevron = button?.querySelector(".mermaid-code-collapse-chevron");
    const overlay = pane?.querySelector(".mermaid-code-collapse-overlay");
    const bottomBar = pane?.querySelector(".code-block-bottom-bar");
    const bottomIcon = pane?.querySelector(".code-block-bottom-collapse");
    if (!pane) return;

    const foldable = tool.dataset.mermaidFoldable === "true";
    const nextCollapsed = foldable && collapsed;
    const collapsedHeight = Number.parseInt(tool.dataset.collapsedHeight || "120", 10);
    const expandLabel = button?.dataset.labelExpand || getUIText("code.expand", "展开");
    const collapseLabel = button?.dataset.labelCollapse || getUIText("code.collapse", "收起");
    const label = nextCollapsed ? expandLabel : collapseLabel;

    // Scroll anchoring: keep content below at same screen position
    var anchorDelta = 0;
    if (nextCollapsed && tool.dataset.mermaidCollapsed !== "true") {
      var rectBefore = tool.getBoundingClientRect();
      anchorDelta = rectBefore.bottom;
    }

    tool.dataset.mermaidCollapsed = String(nextCollapsed);
    tool.classList.toggle("is-mermaid-code-collapsed", nextCollapsed);

    pane.style.transition = animate ? "max-height 0.3s ease-out" : "";
    pane.style.maxHeight = nextCollapsed ? `${collapsedHeight}px` : "";
    pane.style.overflow = nextCollapsed ? "hidden" : "";

    if (button) {
      button.hidden = !foldable;
      button.classList.toggle("hidden", !foldable);
      button.classList.toggle("flex", foldable);
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-expanded", String(!nextCollapsed));
    }
    if (text) text.textContent = label;
    if (chevron) chevron.classList.toggle("rotate-180", !nextCollapsed);

    if (overlay) {
      const showOverlay = foldable && nextCollapsed;
      overlay.hidden = !showOverlay;
      overlay.classList.toggle("pointer-events-none", !showOverlay);
      overlay.classList.toggle("opacity-0", !showOverlay);
      overlay.classList.toggle("pointer-events-auto", showOverlay);
      overlay.classList.toggle("opacity-100", showOverlay);
    }

    if (bottomBar) {
      const showBottomBar = foldable && !nextCollapsed;
      bottomBar.hidden = !showBottomBar;
      bottomBar.classList.toggle("hidden", !showBottomBar);
      bottomBar.classList.toggle("flex", showBottomBar);
    }
    if (bottomIcon) {
      bottomIcon.innerHTML = nextCollapsed
        ? '<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>'
        : '<svg class="h-4 w-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9 6 6 6-6"/></svg>';
    }

    // Apply scroll anchor
    if (anchorDelta > 0) {
      var rectAfter = tool.getBoundingClientRect();
      var delta = rectAfter.bottom - anchorDelta;
      if (delta < 0) {
        window.scrollBy({ top: delta, behavior: "instant" });
      }
    }

    if (animate) {
      window.setTimeout(() => {
        pane.style.transition = "";
      }, 300);
    }
  }

  async function copyMermaidSvg(tool, button) {
    try {
      const { markup, blob } = getMermaidSvgAsset(tool);
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined" && window.isSecureContext) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/svg+xml": blob })]);
          setButtonFeedback(button, getUIText("mermaid.copied", "Copied"));
          return;
        } catch (_) {
          // Chromium commonly rejects SVG clipboard payloads; source text is the useful fallback.
        }
      }

      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(markup);
      setButtonFeedback(button, getUIText("mermaid.copied", "Copied"));
    } catch (_) {
      setButtonFeedback(button, getUIText("mermaid.copyFailed", "Copy failed"));
    }
  }

  function downloadMermaidSvg(tool, button) {
    try {
      const { blob } = getMermaidSvgAsset(tool);
      downloadBlob(blob, `${getMermaidFileName(tool)}.svg`);
      setButtonFeedback(button, getUIText("mermaid.saved", "Saved"));
    } catch (_) {
      setButtonFeedback(button, getUIText("mermaid.saveFailed", "Save failed"));
    }
  }

  async function copyMermaidCode(tool, button) {
    const source = getMermaidSource(tool);
    if (!source) return;

    try {
      await navigator.clipboard.writeText(source);
      setButtonFeedback(button, getUIText("mermaid.copied", "Copied"));
    } catch (_) {
      setButtonFeedback(button, getUIText("mermaid.copyFailed", "Copy failed"));
    }
  }

  function getMermaidSvgAsset(tool) {
    const svg = tool.querySelector("[data-mermaid-render-pane] svg");
    if (!svg) throw new Error("Rendered Mermaid SVG not found");

    const clone = svg.cloneNode(true);
    const { width, height } = getSvgSize(svg);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    const markup = new XMLSerializer().serializeToString(clone);
    return {
      markup,
      blob: new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
    };
  }

  function getSvgSize(svg) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    return {
      width: Math.ceil(rect.width || Number.parseFloat(svg.getAttribute("width")) || viewBox?.width || 1200),
      height: Math.ceil(rect.height || Number.parseFloat(svg.getAttribute("height")) || viewBox?.height || 800),
    };
  }

  function getMermaidFileName(tool) {
    return tool.id || "mermaid-diagram";
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function showMermaidLightbox(tool) {
    const svg = tool.querySelector("[data-mermaid-render-pane] svg");
    if (!svg) return;

    closeMermaidLightbox();

    const overlay = document.createElement("div");
    overlay.className = "mermaid-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", getUIText("mermaid.zoom", "Zoom Mermaid"));

    const stage = document.createElement("div");
    stage.className = "mermaid-lightbox-stage";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "mermaid-lightbox-close";
    closeButton.setAttribute("aria-label", getUIText("mermaid.close", "Close"));
    closeButton.textContent = "×";

    const clone = svg.cloneNode(true);
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMermaidLightbox();
    });
    stage.append(closeButton, clone);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);

    mermaidLightbox = overlay;
    document.documentElement.classList.add("mermaid-lightbox-open");
    closeButton.addEventListener("click", closeMermaidLightbox);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeMermaidLightbox();
    });
    window.requestAnimationFrame(() => overlay.classList.add("is-visible"));
    closeButton.focus();
  }

  function highlightMermaidSource(source) {
    const parts = [];
    const tokenPattern =
      /(%%.*$)|(\b(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|subgraph|end|participant|actor|loop|alt|else|opt|par|and|rect|note|over|style|classDef|class|linkStyle|click|direction)\b)|(\b(?:LR|RL|TB|BT|TD)\b)|(-\.->|==>|-->|---|===|-.->|--|==|o--|--o|x--|--x)|(\[[^\]]*\]|\([^)]+\)|\{[^}]+\})/g;

    source.split(/(\r?\n)/).forEach((line) => {
      if (line === "\n" || line === "\r\n") {
        parts.push(document.createTextNode(line));
        return;
      }

      let cursor = 0;
      line.replace(tokenPattern, (match, comment, keyword, direction, arrow, label, offset) => {
        if (offset > cursor) parts.push(document.createTextNode(line.slice(cursor, offset)));
        const span = document.createElement("span");
        if (comment) span.className = "mermaid-token-comment";
        else if (keyword) span.className = "mermaid-token-keyword";
        else if (direction) span.className = "mermaid-token-direction";
        else if (arrow) span.className = "mermaid-token-arrow";
        else if (label) span.className = "mermaid-token-label";
        span.textContent = match;
        parts.push(span);
        cursor = offset + match.length;
        return match;
      });

      if (cursor < line.length) parts.push(document.createTextNode(line.slice(cursor)));
    });

    return parts;
  }

  function closeMermaidLightbox() {
    if (!mermaidLightbox) return;

    const overlay = mermaidLightbox;
    mermaidLightbox = null;
    overlay.classList.remove("is-visible");
    document.documentElement.classList.remove("mermaid-lightbox-open");
    window.setTimeout(() => overlay.remove(), 180);
  }

  function setButtonFeedback(button, text) {
    if (!button) return;

    button.dataset.feedback = text;
    button.classList.add("has-feedback");
    window.setTimeout(() => {
      button.classList.remove("has-feedback");
      delete button.dataset.feedback;
    }, 1400);
  }

  function initKatexCopyFallback() {
    if (katexCopyBound) return;
    katexCopyBound = true;

    document.addEventListener(
      "copy",
      (event) => {
        const formula = getSingleSelectedKatexFormula();
        if (!formula || !event.clipboardData) return;

        const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
        if (!source) return;

        const isDisplay = formula.classList.contains("katex-display") || Boolean(formula.closest(".katex-display"));
        const wrapped = isDisplay ? `$$${source}$$` : `$${source}$`;

        event.clipboardData.setData("text/plain", wrapped);
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  function getSingleSelectedKatexFormula() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const anchorFormula = getKatexFormulaRoot(selection.anchorNode);
    const focusFormula = getKatexFormulaRoot(selection.focusNode);
    if (!anchorFormula || !focusFormula || anchorFormula !== focusFormula) return null;

    return anchorFormula;
  }

  function getKatexFormulaRoot(node) {
    if (!node) return null;

    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return null;

    const display = element.closest(".katex-display");
    if (display) return display;

    return element.closest(".katex");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initContentEnhancements, { once: true });
  } else {
    initContentEnhancements();
  }
})();
