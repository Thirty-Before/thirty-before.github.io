(function () {
  "use strict";

  let searchModal = null;
  let searchOverlay = null;
  let searchInput = null;
  let searchClear = null;
  let searchClose = null;
  let searchEmpty = null;
  let searchLoading = null;
  let searchNoResults = null;
  let searchResultsList = null;
  let searchStats = null;
  let searchItems = null;

  let isModalVisible = false;
  let searchData = null;
  let searchDataPromise = null;
  let currentResults = [];
  let selectedIndex = -1;
  let searchTimeout = null;
  let lastFocusedElement = null;
  const INLINE_SEARCH_STATE_KEY = "thirty-before:inline-search-navigation";

  function readJSONConfig(id) {
    const configElement = document.getElementById(id);
    if (!configElement?.textContent) return null;

    try {
      const parsed = JSON.parse(configElement.textContent);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (_) {
      return null;
    }
  }

  function getUIBridge() {
    return window.HugoNarrowUI || null;
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

  function lockScroll() {
    const ui = getUIBridge();
    if (ui?.lockScroll) {
      ui.lockScroll("search");
      return;
    }

    document.body.style.overflow = "hidden";
  }

  function unlockScroll() {
    const ui = getUIBridge();
    if (ui?.unlockScroll) {
      ui.unlockScroll("search");
      return;
    }

    document.body.style.overflow = "";
  }

  function init() {
    searchModal = document.getElementById("search-modal");
    searchOverlay = document.getElementById("search-overlay");
    searchInput = document.getElementById("search-input");
    searchClear = document.getElementById("search-clear");
    searchClose = document.getElementById("search-close");
    searchEmpty = document.getElementById("search-empty");
    searchLoading = document.getElementById("search-loading");
    searchNoResults = document.getElementById("search-no-results");
    searchResultsList = document.getElementById("search-results-list");
    searchStats = document.getElementById("search-stats");
    searchItems = document.getElementById("search-items");

    if (!searchModal) return;

    bindEvents();
  }

  function bindEvents() {
    searchClose?.addEventListener("click", hideSearch);
    searchClear?.addEventListener("click", clearSearch);
    searchOverlay?.addEventListener("click", hideSearch);

    if (searchInput) {
      searchInput.addEventListener("input", handleInput);
      searchInput.addEventListener("keydown", handleInputKeydown);
    }

    document.addEventListener("keydown", handleGlobalKeydown);
    document.addEventListener("search:open", handleSearchOpenEvent);
    document.addEventListener("search:close", handleSearchCloseEvent);
    document.addEventListener("search:toggle", handleSearchToggleEvent);
  }

  function handleSearchOpenEvent(event) {
    if (event?.detail) event.detail.handled = true;
    if (event?.detail?.origin === "search-module") return;
    showSearch();
  }

  function handleSearchCloseEvent(event) {
    if (event?.detail) event.detail.handled = true;
    if (event?.detail?.origin === "search-module") return;
    hideSearch();
  }

  function handleSearchToggleEvent(event) {
    if (event?.detail) event.detail.handled = true;
    if (event?.detail?.origin === "search-module") return;
    toggleSearch();
  }

  function handleGlobalKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      showSearch();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
      event.preventDefault();
      if (isModalVisible) hideSearch();
      document.dispatchEvent(
        new CustomEvent("inline-search:open", {
          detail: { origin: "search-module", focus: true },
        }),
      );
      return;
    }

    if (!isModalVisible) return;

    if (event.key === "Escape") {
      event.preventDefault();
      hideSearch();
      return;
    }

    if (event.key === "Tab") {
      trapFocus(event);
    }
  }

  function handleInputKeydown(event) {
    if (!isModalVisible) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        navigateResults(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        navigateResults(-1);
        break;
      case "Enter":
        if (selectedIndex >= 0) {
          event.preventDefault();
          selectResult();
        }
        break;
      default:
        break;
    }
  }

  function getFocusableElements() {
    if (!searchModal) return [];

    const selector = [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ");

    return [...searchModal.querySelectorAll(selector)].filter((element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.hasAttribute("hidden")) return false;
      return !element.classList.contains("pointer-events-none");
    });
  }

  function trapFocus(event) {
    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  function showSearch() {
    if (!searchModal || isModalVisible) return;

    isModalVisible = true;
    lastFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    getUIBridge()?.closeAllMenus?.({ restoreFocus: false });

    searchOverlay?.classList.remove("opacity-0", "pointer-events-none");
    searchOverlay?.classList.add("opacity-100");

    searchModal.classList.remove("opacity-0", "scale-95", "pointer-events-none");
    searchModal.classList.add("opacity-100", "scale-100");
    searchModal.setAttribute("aria-hidden", "false");

    lockScroll();

    window.setTimeout(() => {
      searchInput?.focus();
    }, 50);

    ensureSearchData().catch(() => {});

    document.dispatchEvent(
      new CustomEvent("search:open", {
        detail: { origin: "search-module" },
      })
    );
  }

  function hideSearch() {
    if (!searchModal || !isModalVisible) return;

    isModalVisible = false;

    searchOverlay?.classList.add("opacity-0", "pointer-events-none");
    searchOverlay?.classList.remove("opacity-100");

    searchModal.classList.add("opacity-0", "scale-95", "pointer-events-none");
    searchModal.classList.remove("opacity-100", "scale-100");
    searchModal.setAttribute("aria-hidden", "true");

    unlockScroll();
    clearSearchContent();
    lastFocusedElement?.focus();
    lastFocusedElement = null;

    document.dispatchEvent(
      new CustomEvent("search:close", {
        detail: { origin: "search-module" },
      })
    );
  }

  function toggleSearch() {
    if (isModalVisible) {
      hideSearch();
    } else {
      showSearch();
    }

    document.dispatchEvent(
      new CustomEvent("search:toggle", {
        detail: { origin: "search-module" },
      })
    );
  }

  function clearSearch() {
    clearSearchContent();
    searchInput?.focus();
  }

  function clearSearchContent() {
    if (searchInput) {
      searchInput.value = "";
    }

    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }

    currentResults = [];
    resetNavigation();
    toggleClearButton(false);
    showEmptyState();
  }

  function toggleClearButton(show) {
    if (!searchClear) return;

    if (show) {
      searchClear.classList.remove("opacity-0", "pointer-events-none");
      searchClear.classList.add("opacity-100");
    } else {
      searchClear.classList.add("opacity-0", "pointer-events-none");
      searchClear.classList.remove("opacity-100");
    }
  }

  function resetNavigation() {
    selectedIndex = -1;
    syncSelectedResult();
  }

  function showEmptyState() {
    hideAllStates();
    searchEmpty && (searchEmpty.hidden = false);
  }

  function showLoadingState() {
    hideAllStates();
    searchLoading && (searchLoading.hidden = false);
  }

  function showNoResultsState() {
    hideAllStates();
    searchNoResults && (searchNoResults.hidden = false);
  }

  function showResultsList() {
    hideAllStates();
    searchResultsList && (searchResultsList.hidden = false);
  }

  function hideAllStates() {
    [searchEmpty, searchLoading, searchNoResults, searchResultsList].forEach((element) => {
      if (element) element.hidden = true;
    });
  }

  async function ensureSearchData() {
    if (searchData) return searchData;
    if (searchDataPromise) return searchDataPromise;

    const searchConfig = readJSONConfig("search-config");
    const indexURL = searchConfig?.searchIndexURL || "/index.json";

    searchDataPromise = fetch(indexURL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
      })
      .then((data) => {
        searchData = Array.isArray(data) ? data : [];
        return searchData;
      })
      .catch((error) => {
        searchData = [];
        throw error;
      })
      .finally(() => {
        searchDataPromise = null;
      });

    return searchDataPromise;
  }

  function handleInput(event) {
    const query = event.target.value.trim();
    toggleClearButton(query.length > 0);
    resetNavigation();

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = window.setTimeout(() => {
      if (!query) {
        currentResults = [];
        showEmptyState();
        return;
      }

      performSearch(query);
    }, 200);
  }

  async function performSearch(query) {
    showLoadingState();

    try {
      const data = await ensureSearchData();
      currentResults = searchRecords(data, query);

      if (currentResults.length === 0) {
        showNoResultsState();
        return;
      }

      renderResults(currentResults, query);
      showResultsList();
    } catch (_) {
      currentResults = [];
      showNoResultsState();
    }
  }

  function parseKeywords(query) {
    return query
      .toLowerCase()
      .split(/\s+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  function normalizeText(value) {
    if (Array.isArray(value)) {
      return value.join(" ").toLowerCase();
    }

    return String(value || "").toLowerCase();
  }

  function scoreRecord(record, keywords) {
    const title = normalizeText(record.title);
    const summary = normalizeText(record.summary);
    const content = normalizeText(record.content);
    const tags = normalizeText(record.tags);
    const categories = normalizeText(record.categories);
    const series = normalizeText(record.series);
    const section = normalizeText(record.section);

    let score = 0;

    for (const keyword of keywords) {
      let keywordMatched = false;

      if (title.includes(keyword)) {
        score += 40;
        keywordMatched = true;
      }

      if (tags.includes(keyword)) {
        score += 18;
        keywordMatched = true;
      }

      if (categories.includes(keyword)) {
        score += 16;
        keywordMatched = true;
      }

      if (series.includes(keyword)) {
        score += 14;
        keywordMatched = true;
      }

      if (section.includes(keyword)) {
        score += 8;
        keywordMatched = true;
      }

      if (summary.includes(keyword)) {
        score += 10;
        keywordMatched = true;
      }

      if (content.includes(keyword)) {
        score += 4;
        keywordMatched = true;
      }

      if (!keywordMatched) {
        return -1;
      }
    }

    return score;
  }

  function getKindLabel(kind) {
    const labels = {
      post: getUIText("search.kinds.post", "文章"),
      project: getUIText("search.kinds.project", "项目"),
      category: getUIText("search.kinds.category", "分类"),
      series: getUIText("search.kinds.series", "系列"),
      tag: getUIText("search.kinds.tag", "标签"),
    };

    return labels[kind] || getUIText("search.kindFallback", "内容");
  }

  function stringifySearchField(value, label) {
    if (Array.isArray(value)) {
      const text = value.filter(Boolean).join(" ");
      return text && label ? `${label}: ${text}` : text;
    }

    return String(value || "");
  }

  function getBestExcerptText(record, keywords) {
    const candidates = [
      stringifySearchField(record.summary),
      stringifySearchField(record.content),
      stringifySearchField(record.categories, getUIText("search.fields.categories", "分类")),
      stringifySearchField(record.tags, getUIText("search.fields.tags", "标签")),
      stringifySearchField(record.series, getUIText("search.fields.series", "系列")),
    ].filter(Boolean);

    const matchedCandidate = candidates.find(
      (candidate) => findHighlightRanges(candidate, keywords).length > 0
    );

    return matchedCandidate || candidates[0] || "";
  }

  function searchRecords(records, query) {
    const keywords = parseKeywords(query);
    if (keywords.length === 0) return [];

    return records
      .map((record) => {
        const score = scoreRecord(record, keywords);
        const matchCount = countRecordMatches(record, keywords);
        return { ...record, keywords, score, matchCount };
      })
      .filter((record) => record.score >= 0)
      .sort((left, right) => right.score - left.score);
  }

  function countRecordMatches(record, keywords) {
    if (record.kind !== "post" && record.kind !== "project") return 0;

    return [record.title, record.summary, record.content].reduce((total, value) => {
      return total + findHighlightRanges(String(value || ""), keywords).length;
    }, 0);
  }

  function createSearchTarget(result, query) {
    if (!result?.permalink || !query) return result?.permalink || "#";
    if (result.kind !== "post" && result.kind !== "project") return result.permalink;

    const url = new URL(result.permalink, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function rememberInlineSearchNavigation(result, query) {
    if (!result?.permalink || !query) return;
    if (result.kind !== "post" && result.kind !== "project") return;

    try {
      const url = new URL(result.permalink, window.location.origin);
      window.sessionStorage.setItem(
        INLINE_SEARCH_STATE_KEY,
        JSON.stringify({
          query,
          targetPath: url.pathname,
          createdAt: Date.now(),
        }),
      );
    } catch (_) {
      // sessionStorage can be unavailable in strict privacy contexts; clean links still work.
    }
  }

  function renderResults(results, query) {
    if (!searchItems || !searchStats) return;

    updateSearchStats(results.length);
    searchItems.replaceChildren();

    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => {
      fragment.appendChild(createResultElement(result, query, index));
    });

    searchItems.appendChild(fragment);
    syncSelectedResult();
  }

  function updateSearchStats(count) {
    const template =
      searchStats?.dataset.countOther || searchStats?.textContent || `Found ${count} results`;

    searchStats.textContent = template.replace("%d", count);
  }

  function createResultElement(result, query, index) {
    const link = document.createElement("a");
    link.href = createSearchTarget(result, query);
    link.dataset.index = String(index);
    link.className =
      "search-result-item block rounded-lg p-4 transition-colors duration-200 hover:bg-primary/10";
    link.setAttribute("role", "listitem");
    link.addEventListener("click", () => rememberInlineSearchNavigation(result, query));

    const container = document.createElement("div");
    container.className = "flex flex-col gap-2";

    const heading = document.createElement("div");
    heading.className = "flex min-w-0 items-start justify-between gap-3";

    const title = document.createElement("h3");
    title.className = "text-foreground line-clamp-1 text-base font-semibold";
    title.appendChild(createHighlightedFragment(result.title || "", result.keywords));

    const badge = document.createElement("span");
    badge.className =
      "bg-primary/10 text-primary border-primary/20 shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium";
    badge.textContent = getKindLabel(result.kind);

    heading.append(title, badge);

    const excerptText = getBestExcerptText(result, result.keywords);
    const summary = document.createElement("p");
    summary.className = "text-muted-foreground line-clamp-2 text-sm";
    summary.appendChild(createExcerptFragment(excerptText, result.keywords, 140));

    const meta = document.createElement("div");
    meta.className = "text-muted-foreground flex flex-wrap items-center gap-2 text-xs";

    const metaParts = [];
    if (result.date) metaParts.push(result.date);
    if (
      (result.kind === "post" || result.kind === "project") &&
      Number.isFinite(result.matchCount) &&
      result.matchCount > 0
    ) {
      metaParts.push(`${result.matchCount} 处匹配`);
    }
    if (typeof result.count === "number" && result.count > 0) {
      metaParts.push(
        getUIText("search.itemCount", "%d items").replace("%d", String(result.count)),
      );
    }
    if (Array.isArray(result.categories) && result.categories[0]) {
      metaParts.push(result.categories[0]);
    }
    if (Array.isArray(result.series) && result.series[0]) {
      metaParts.push(result.series[0]);
    }

    metaParts.forEach((part) => {
      const span = document.createElement("span");
      span.textContent = part;
      meta.appendChild(span);
    });

    container.appendChild(heading);
    if (excerptText) {
      container.appendChild(summary);
    }
    if (metaParts.length > 0) {
      container.appendChild(meta);
    }

    link.appendChild(container);
    return link;
  }

  function createExcerptFragment(text, keywords, maxLength) {
    if (!text) return document.createTextNode("");

    const ranges = findHighlightRanges(text, keywords);
    if (ranges.length === 0) {
      return document.createTextNode(text.slice(0, maxLength));
    }

    const start = Math.max(0, ranges[0][0] - 30);
    const end = Math.min(text.length, Math.max(ranges[0][1] + 80, start + maxLength));
    const excerpt = text.slice(start, end);
    const fragment = createHighlightedFragment(excerpt, keywords);

    if (start > 0) {
      fragment.prepend(document.createTextNode("..."));
    }

    if (end < text.length) {
      fragment.append(document.createTextNode("..."));
    }

    return fragment;
  }

  function createHighlightedFragment(text, keywords) {
    const fragment = document.createDocumentFragment();
    const ranges = findHighlightRanges(text, keywords);

    if (ranges.length === 0) {
      fragment.append(document.createTextNode(text));
      return fragment;
    }

    let cursor = 0;
    ranges.forEach(([start, end]) => {
      if (start > cursor) {
        fragment.append(document.createTextNode(text.slice(cursor, start)));
      }

      const mark = document.createElement("mark");
      mark.className = "bg-primary/20 text-primary rounded px-1 font-medium";
      mark.textContent = text.slice(start, end);
      fragment.append(mark);
      cursor = end;
    });

    if (cursor < text.length) {
      fragment.append(document.createTextNode(text.slice(cursor)));
    }

    return fragment;
  }

  function findHighlightRanges(text, keywords) {
    if (!text || !Array.isArray(keywords) || keywords.length === 0) {
      return [];
    }

    const lowerText = text.toLowerCase();
    const ranges = [];

    keywords.forEach((keyword) => {
      if (!keyword) return;

      let fromIndex = 0;
      while (fromIndex < lowerText.length) {
        const matchIndex = lowerText.indexOf(keyword.toLowerCase(), fromIndex);
        if (matchIndex === -1) break;

        ranges.push([matchIndex, matchIndex + keyword.length]);
        fromIndex = matchIndex + keyword.length;
      }
    });

    ranges.sort((left, right) => left[0] - right[0]);

    return ranges.reduce((merged, range) => {
      const lastRange = merged[merged.length - 1];
      if (!lastRange || range[0] > lastRange[1]) {
        merged.push([...range]);
        return merged;
      }

      lastRange[1] = Math.max(lastRange[1], range[1]);
      return merged;
    }, []);
  }

  function navigateResults(direction) {
    if (!currentResults.length || !searchItems) return;

    if (selectedIndex === -1) {
      selectedIndex = direction > 0 ? 0 : currentResults.length - 1;
    } else {
      selectedIndex += direction;

      if (selectedIndex < 0) {
        selectedIndex = currentResults.length - 1;
      } else if (selectedIndex >= currentResults.length) {
        selectedIndex = 0;
      }
    }

    syncSelectedResult();

    const selectedElement = searchItems.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function syncSelectedResult() {
    if (!searchItems) return;

    searchItems.querySelectorAll(".search-result-item").forEach((element, index) => {
      const isSelected = index === selectedIndex;
      element.classList.toggle("bg-primary/10", isSelected);
      element.classList.toggle("text-primary", isSelected);
      element.setAttribute("aria-selected", isSelected ? "true" : "false");
    });
  }

  function selectResult() {
    if (selectedIndex < 0 || selectedIndex >= currentResults.length || !searchItems) return;

    const selectedElement = searchItems.querySelector(`[data-index="${selectedIndex}"]`);
    selectedElement?.click();
  }

  window.Search = {
    show: showSearch,
    hide: hideSearch,
    toggle: toggleSearch,
    isVisible: () => isModalVisible,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
