(function () {
  const CONFIG_ID = "inline-search-context";
  const INDEX_FALLBACK_URL = "/index.json";
  const FIELD_SELECTOR = ".header-search-field";
  const HEADER_SELECTOR = ".site-header";
  const ORIGINAL_HIDDEN_KEY = "inlineSearchPreviousHidden";
  const RESULT_CONTAINER_ID = "inline-search-results";
  const HIT_CLASS = "inline-search-hit";
  const ACTIVE_HIT_CLASS = "inline-search-hit-current";
  const INLINE_SEARCH_STATE_KEY = "thirty-before:inline-search-navigation";

  const FIELD_MAP = {
    post: ["title", "summary", "content"],
    project: ["title", "summary", "content"],
    category: ["title", "summary"],
    series: ["title", "summary"],
    tag: ["title"],
  };

  let context = null;
  let header = null;
  let fields = [];
  let indexData = null;
  let indexPromise = null;
  let searchTimer = null;
  let requestId = 0;
  let resultContainer = null;
  let pageContentRoot = null;
  let pageHeader = null;
  let singleArticle = null;
  let hitIndex = 0;
  let hits = [];
  let navControls = [];
  let clearing = false;

  function readJSONConfig(id) {
    const element = document.getElementById(id);
    if (!element?.textContent) return null;

    try {
      const parsed = JSON.parse(element.textContent);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    } catch (_) {
      return null;
    }
  }

  function initInlineSearch() {
    context = readJSONConfig(CONFIG_ID);
    if (!context || context.mode === "none" || !context.kind) return;

    header = document.querySelector(HEADER_SELECTOR);
    fields = Array.from(document.querySelectorAll(FIELD_SELECTOR));
    if (!header || fields.length === 0) return;

    pageContentRoot = findPageContentRoot();
    pageHeader = findPageHeader();
    singleArticle = findSingleArticle();

    bindInputs();
    bindHeaderObserver();

    if (context.mode === "single") {
      document.body.classList.add("inline-search-page-mode");
      setupSingleNavigationControls();
      restoreSearchFromNavigationState();
    }
  }

  function bindInputs() {
    fields.forEach((field) => {
      field.addEventListener("input", () => handleInput(field));
      field.addEventListener("search", () => handleInput(field));
      field.addEventListener("keydown", (event) => {
        if (context.mode !== "single") return;
        if (event.key === "Enter" && hits.length > 0) {
          event.preventDefault();
          selectHit(1);
        }
      });
    });
  }

  function bindHeaderObserver() {
    const observer = new MutationObserver(() => {
      if (!header.classList.contains("is-search-open")) {
        clearSearch({ clearInputs: true });
      }
    });

    observer.observe(header, { attributes: true, attributeFilter: ["class"] });
  }

  function handleInput(sourceField) {
    if (clearing) return;

    const query = sourceField.value;
    syncFields(query, sourceField);

    if (searchTimer) {
      window.clearTimeout(searchTimer);
    }

    searchTimer = window.setTimeout(() => {
      if (context.mode === "single") {
        searchSingle(query);
      } else {
        searchCollection(query);
      }
    }, 120);
  }

  function syncFields(value, sourceField) {
    fields.forEach((field) => {
      if (field !== sourceField) {
        field.value = value;
      }
    });
  }

  function clearSearch({ clearInputs = false } = {}) {
    clearing = true;
    requestId += 1;

    if (searchTimer) {
      window.clearTimeout(searchTimer);
      searchTimer = null;
    }

    if (clearInputs) {
      fields.forEach((field) => {
        field.value = "";
        field.removeAttribute("aria-invalid");
      });
    }

    clearSingleHighlights();
    setSingleControls({ visible: false, label: "0/0" });
    restoreOriginalContent();

    if (resultContainer) {
      resultContainer.hidden = true;
      resultContainer.replaceChildren();
    }

    document.body.classList.remove("inline-search-active", "inline-search-single-active");
    clearing = false;
  }

  function findPageContentRoot() {
    const main = document.querySelector("main");
    if (!main) return null;
    return main.querySelector(":scope > div.px-4.py-6") || main;
  }

  function findPageHeader() {
    if (!pageContentRoot) return null;

    const directHeader = Array.from(pageContentRoot.children).find((child) => child.tagName === "HEADER");
    if (directHeader) return directHeader;

    return (
      Array.from(pageContentRoot.children)
        .map((child) => child.querySelector(":scope > header") || child.querySelector("header"))
        .find(Boolean) || null
    );
  }

  function findSingleArticle() {
    if (context.mode !== "single") return null;
    return document.querySelector("article.prose");
  }

  async function ensureIndex() {
    if (indexData) return indexData;
    if (indexPromise) return indexPromise;

    indexPromise = fetch(context.indexURL || INDEX_FALLBACK_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        indexData = Array.isArray(data) ? data : [];
        return indexData;
      })
      .finally(() => {
        indexPromise = null;
      });

    return indexPromise;
  }

  function parseQuery(rawQuery) {
    const query = String(rawQuery || "").trim();
    if (!query) return { type: "empty", query };

    const regexLiteral = parseRegexLiteral(query);
    if (regexLiteral) return regexLiteral;

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    return keywords.length > 0 ? { type: "fuzzy", query, keywords } : { type: "empty", query };
  }

  function parseRegexLiteral(query) {
    if (!query.startsWith("/") || query.length < 2) return null;

    let escaped = false;
    let closingIndex = -1;
    for (let index = 1; index < query.length; index += 1) {
      const char = query[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "/") {
        closingIndex = index;
        break;
      }
    }

    if (closingIndex === -1) return null;

    const source = query.slice(1, closingIndex);
    const flags = query.slice(closingIndex + 1);
    if (!source) {
      return { type: "invalid", query, message: "正则无效" };
    }
    if (!/^[gimu]*$/.test(flags)) {
      return { type: "invalid", query, message: "正则无效" };
    }

    try {
      const regex = new RegExp(source, flags);
      const globalRegex = new RegExp(source, flags.includes("g") ? flags : `${flags}g`);
      return { type: "regex", query, regex, globalRegex };
    } catch (_) {
      return { type: "invalid", query, message: "正则无效" };
    }
  }

  async function searchCollection(rawQuery) {
    const parsed = parseQuery(rawQuery);
    const currentRequest = (requestId += 1);

    if (parsed.type === "empty") {
      clearSearch();
      return;
    }

    setOriginalContentHidden(true);
    showResultContainer();

    if (parsed.type === "invalid") {
      setFieldsInvalid(true);
      renderMessage("正则无效", "请检查表达式或标志，只支持 i、m、u、g。");
      return;
    }

    setFieldsInvalid(false);
    renderLoading();

    try {
      const records = await ensureIndex();
      if (currentRequest !== requestId) return;

      const results = records
        .filter((record) => record.kind === context.kind)
        .map((record) => matchRecord(record, parsed))
        .filter(Boolean)
        .sort((left, right) => right.score - left.score);

      renderCollectionResults(results, parsed);
    } catch (_) {
      renderMessage("搜索索引加载失败", "请刷新页面后再试。");
    }
  }

  function setFieldsInvalid(invalid) {
    fields.forEach((field) => {
      if (invalid) {
        field.setAttribute("aria-invalid", "true");
      } else {
        field.removeAttribute("aria-invalid");
      }
    });
  }

  function matchRecord(record, parsed) {
    const fieldNames = FIELD_MAP[record.kind] || ["title", "summary", "content"];
    const values = fieldNames.map((name) => ({ name, text: normalizeText(record[name]) }));
    const combined = values.map((value) => value.text).join(" ");

    if (parsed.type === "fuzzy") {
      const lowerCombined = combined.toLowerCase();
      const hasAllKeywords = parsed.keywords.every((keyword) => lowerCombined.includes(keyword));
      if (!hasAllKeywords) return null;
    } else if (!testRegex(parsed.regex, combined)) {
      return null;
    }

    let score = 0;
    values.forEach(({ name, text }) => {
      if (!text) return;
      if (!textMatches(text, parsed)) return;

      if (name === "title") score += 50;
      else if (name === "summary") score += 20;
      else score += 6;
    });

    const excerptField =
      values.find(({ text }) => text && textMatches(text, parsed)) || values.find(({ text }) => text);
    const matchCount = values.reduce(
      (total, { text }) => total + findRanges(text, parsed).length,
      0,
    );

    return {
      ...record,
      score,
      matchCount,
      excerptText: excerptField?.text || "",
    };
  }

  function normalizeText(value) {
    if (Array.isArray(value)) return value.join(" ");
    return String(value || "");
  }

  function createSearchTarget(record, parsed) {
    if (!record?.permalink || !parsed?.query) return record?.permalink || "#";
    if (record.kind !== "post" && record.kind !== "project") return record.permalink;

    const url = new URL(record.permalink, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function rememberInlineSearchNavigation(record, parsed) {
    if (!record?.permalink || !parsed?.query) return;
    if (record.kind !== "post" && record.kind !== "project") return;

    try {
      const url = new URL(record.permalink, window.location.origin);
      window.sessionStorage.setItem(
        INLINE_SEARCH_STATE_KEY,
        JSON.stringify({
          query: parsed.query,
          targetPath: url.pathname,
          createdAt: Date.now(),
        }),
      );
    } catch (_) {
      // Keep navigation usable when sessionStorage is blocked.
    }
  }

  function attachInlineSearchNavigation(link, record, parsed) {
    link.addEventListener("click", () => rememberInlineSearchNavigation(record, parsed));
  }

  function textMatches(text, parsed) {
    if (!text) return false;
    if (parsed.type === "regex") return testRegex(parsed.regex, text);
    const lowerText = text.toLowerCase();
    return parsed.keywords.some((keyword) => lowerText.includes(keyword));
  }

  function testRegex(regex, text) {
    regex.lastIndex = 0;
    return regex.test(text);
  }

  function showResultContainer() {
    if (!resultContainer) {
      resultContainer = document.createElement("section");
      resultContainer.id = RESULT_CONTAINER_ID;
      resultContainer.className = "inline-search-results";
      resultContainer.setAttribute("aria-live", "polite");

      if (pageHeader?.parentElement) {
        pageHeader.insertAdjacentElement("afterend", resultContainer);
      } else if (pageContentRoot) {
        pageContentRoot.appendChild(resultContainer);
      }
    }

    resultContainer.hidden = false;
    document.body.classList.add("inline-search-active");
  }

  function setOriginalContentHidden(hidden) {
    if (!pageHeader?.parentElement) return;

    const siblings = Array.from(pageHeader.parentElement.children);
    const headerIndex = siblings.indexOf(pageHeader);
    siblings.slice(headerIndex + 1).forEach((element) => {
      if (element === resultContainer) return;
      if (hidden) {
        if (!element.dataset[ORIGINAL_HIDDEN_KEY]) {
          element.dataset[ORIGINAL_HIDDEN_KEY] = element.hidden ? "true" : "false";
        }
        element.hidden = true;
      }
    });
  }

  function restoreOriginalContent() {
    if (!pageHeader?.parentElement) return;

    Array.from(pageHeader.parentElement.children).forEach((element) => {
      const previous = element.dataset[ORIGINAL_HIDDEN_KEY];
      if (!previous) return;

      element.hidden = previous === "true";
      delete element.dataset[ORIGINAL_HIDDEN_KEY];
    });
  }

  function renderLoading() {
    if (!resultContainer) return;
    resultContainer.replaceChildren(createStatus("搜索中", "正在整理匹配结果。"));
  }

  function renderMessage(title, body) {
    if (!resultContainer) return;
    resultContainer.replaceChildren(createEmptyState(title, body));
  }

  function renderCollectionResults(results, parsed) {
    if (!resultContainer) return;

    resultContainer.replaceChildren();
    resultContainer.appendChild(
      createStatus(
        `找到 ${results.length} 个结果`,
        parsed.type === "regex" ? "正则匹配" : "模糊匹配",
      ),
    );

    if (results.length === 0) {
      resultContainer.appendChild(createEmptyState("没有匹配结果", "换一个关键词或正则表达式试试。"));
      return;
    }

    if (context.variant === "archives") {
      resultContainer.appendChild(renderArchiveResults(results, parsed));
      return;
    }

    if (context.kind === "project") {
      resultContainer.appendChild(renderProjectGrid(results, parsed));
      return;
    }

    if (context.kind === "category" || context.kind === "series") {
      resultContainer.appendChild(renderTermCards(results, parsed));
      return;
    }

    if (context.kind === "tag") {
      resultContainer.appendChild(renderTagCloud(results, parsed));
      return;
    }

    resultContainer.appendChild(renderPostCards(results, parsed));
  }

  function createStatus(title, body) {
    const wrapper = document.createElement("div");
    wrapper.className = "inline-search-status text-muted-foreground mb-4 flex items-center gap-1.5 text-sm";

    const titleElement = document.createElement("span");
    titleElement.className = "font-medium";
    titleElement.textContent = title;

    const bodyElement = document.createElement("span");
    bodyElement.textContent = body;

    const separator = document.createElement("span");
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";

    wrapper.append(titleElement, separator, bodyElement);
    return wrapper;
  }

  function createEmptyState(title, body) {
    const wrapper = document.createElement("div");
    wrapper.className = "inline-search-empty py-16 text-center";

    const heading = document.createElement("h2");
    heading.className = "text-foreground mb-3 text-xl font-medium";
    heading.textContent = title;

    const paragraph = document.createElement("p");
    paragraph.className = "text-muted-foreground";
    paragraph.textContent = body;

    wrapper.append(heading, paragraph);
    return wrapper;
  }

  function renderPostCards(results, parsed) {
    const list = document.createElement("div");
    list.className = "space-y-4";
    results.forEach((record) => list.appendChild(createPostCard(record, parsed)));
    return list;
  }

  function createPostCard(record, parsed) {
    const article = document.createElement("article");
    article.className = "group";

    const link = document.createElement("a");
    link.href = createSearchTarget(record, parsed);
    link.className = "block";
    attachInlineSearchNavigation(link, record, parsed);

    const card = document.createElement("div");
    card.className =
      "bg-card border-border hover:bg-primary/5 hover:border-primary/20 focus:ring-primary/20 relative flex flex-col overflow-hidden rounded-xl border transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg focus:ring-2 focus:outline-none md:flex-row";

    appendCover(card, record, "post");
    card.appendChild(createPostText(record, parsed));
    link.appendChild(card);
    article.appendChild(link);
    return article;
  }

  function appendCover(card, record, variant) {
    if (!record.cover) return;

    const outer = document.createElement("div");
    outer.className =
      variant === "post"
        ? "p-3 pb-0 md:order-last md:w-64 md:shrink-0 md:p-3 md:pl-0"
        : "absolute inset-0";

    const inner = document.createElement("div");
    inner.className = "relative aspect-video h-full w-full overflow-hidden rounded-lg";

    const image = document.createElement("img");
    image.src = record.cover;
    image.alt = record.title || "";
    image.loading = "lazy";
    image.className =
      variant === "post"
        ? "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        : "absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105";

    if (variant === "post") {
      inner.appendChild(image);
      outer.appendChild(inner);
      card.appendChild(outer);
      return;
    }

    card.appendChild(image);
    const overlay = document.createElement("div");
    overlay.className =
      "absolute inset-0 bg-linear-to-t from-black/90 via-black/60 to-black/30 transition-opacity duration-300 group-hover:opacity-100";
    card.appendChild(overlay);
  }

  function createPostText(record, parsed) {
    const body = document.createElement("div");
    body.className = "flex flex-1 flex-col justify-center gap-4 p-6";

    const title = document.createElement("h3");
    title.className =
      "text-foreground group-hover:text-primary text-xl leading-tight font-bold transition-colors duration-200";
    title.appendChild(createHighlightedFragment(record.title || "", parsed));

    const excerpt = document.createElement("p");
    excerpt.className = "text-muted-foreground line-clamp-3 text-sm leading-relaxed md:line-clamp-2";
    excerpt.appendChild(createExcerptFragment(record.excerptText || record.summary || "", parsed, 170));

    const meta = document.createElement("div");
    meta.className = "text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm";
    appendMeta(meta, record.date);
    if (record.readingTime) appendMeta(meta, `${record.readingTime} min`);
    appendMatchCount(meta, record.matchCount);
    appendTags(meta, record.tags);

    body.append(title, excerpt, meta);
    return body;
  }

  function appendMeta(parent, text) {
    if (!text) return;
    const item = document.createElement("span");
    item.className = "font-medium";
    item.textContent = text;
    parent.appendChild(item);
  }

  function appendMatchCount(parent, count) {
    if (!Number.isFinite(count) || count < 1) return;

    const item = document.createElement("span");
    item.className =
      "bg-primary/10 text-primary border-primary/20 rounded-md border px-2 py-0.5 text-xs font-medium";
    item.textContent = `${count} 处匹配`;
    parent.appendChild(item);
  }

  function appendTags(parent, tags) {
    if (!Array.isArray(tags) || tags.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "flex flex-wrap items-center gap-1.5";
    tags.slice(0, 4).forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "bg-muted/50 border-muted/30 rounded-md border px-2 py-0.5 text-xs";
      pill.textContent = tag;
      wrapper.appendChild(pill);
    });
    parent.appendChild(wrapper);
  }

  function renderProjectGrid(results, parsed) {
    const grid = document.createElement("div");
    grid.className = "mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3";
    results.forEach((record) => grid.appendChild(createProjectCard(record, parsed)));
    return grid;
  }

  function createProjectCard(record, parsed) {
    const article = document.createElement("article");
    article.className = "group h-full";

    const link = document.createElement("a");
    link.href = createSearchTarget(record, parsed);
    link.className = "block h-full";
    attachInlineSearchNavigation(link, record, parsed);

    const card = document.createElement("div");
    card.className =
      "border-border focus:ring-primary/20 bg-card relative flex h-full min-h-64 flex-col overflow-hidden rounded-xl border p-6 transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg focus:ring-2 focus:outline-none";

    appendCover(card, record, "project");

    const content = document.createElement("div");
    content.className = "relative z-10 flex h-full flex-1 flex-col";
    const spacer = document.createElement("div");
    spacer.className = "flex-1";
    const text = document.createElement("div");
    text.className = "mt-auto";

    const title = document.createElement("h3");
    title.className =
      (record.cover ? "text-white group-hover:text-white " : "text-foreground group-hover:text-primary ") +
      "mb-2 truncate text-xl leading-tight font-bold transition-colors duration-200";
    title.appendChild(createHighlightedFragment(record.title || "", parsed));

    const excerpt = document.createElement("p");
    excerpt.className =
      (record.cover ? "text-white/80 " : "text-muted-foreground ") +
      "mb-4 line-clamp-2 text-sm leading-relaxed drop-shadow-sm";
    excerpt.appendChild(createExcerptFragment(record.excerptText || record.summary || "", parsed, 140));

    text.append(title, excerpt);
    appendMatchCount(text, record.matchCount);
    appendProjectTags(text, record.tags, Boolean(record.cover));
    content.append(spacer, text);
    card.appendChild(content);
    link.appendChild(card);
    article.appendChild(link);
    return article;
  }

  function appendProjectTags(parent, tags, hasCover) {
    if (!Array.isArray(tags) || tags.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "flex w-full flex-wrap gap-2 pt-1";
    tags.slice(0, 3).forEach((tag) => {
      const pill = document.createElement("span");
      pill.className =
        (hasCover
          ? "bg-white/20 text-white border-white/10 backdrop-blur-sm "
          : "bg-muted/50 text-foreground border-muted/30 ") +
        "shrink-0 rounded border px-2.5 py-0.5 text-xs font-medium";
      pill.textContent = tag;
      wrapper.appendChild(pill);
    });
    parent.appendChild(wrapper);
  }

  function renderTermCards(results, parsed) {
    const list = document.createElement("div");
    list.className = "space-y-4";
    results.forEach((record) => list.appendChild(createTermCard(record, parsed)));
    return list;
  }

  function createTermCard(record, parsed) {
    const article = document.createElement("article");
    article.className = "group";

    const link = document.createElement("a");
    link.href = createSearchTarget(record, parsed);
    link.className = "block";
    attachInlineSearchNavigation(link, record, parsed);

    const card = document.createElement("div");
    card.className =
      "bg-card border-border hover:bg-primary/5 hover:border-primary/20 focus:ring-primary/20 relative flex flex-col overflow-hidden rounded-xl border transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-[1.02] hover:shadow-lg focus:ring-2 focus:outline-none md:flex-row";

    appendCover(card, record, "post");

    const body = document.createElement("div");
    body.className = "flex flex-1 flex-col justify-center gap-4 p-6";

    const title = document.createElement("h3");
    title.className =
      "text-foreground group-hover:text-primary text-xl leading-tight font-bold transition-colors duration-200";
    title.appendChild(createHighlightedFragment(record.title || "", parsed));

    const summary = document.createElement("p");
    summary.className = "text-muted-foreground line-clamp-3 text-sm leading-relaxed md:line-clamp-2";
    summary.appendChild(createExcerptFragment(record.excerptText || record.summary || "", parsed, 150));

    const meta = document.createElement("div");
    meta.className = "text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm";
    appendMeta(meta, `${record.count || 0} 篇内容`);

    body.append(title, summary, meta);
    card.appendChild(body);
    link.appendChild(card);
    article.appendChild(link);
    return article;
  }

  function renderTagCloud(results, parsed) {
    const cloud = document.createElement("div");
    cloud.className = "flex flex-wrap gap-3";
    results.forEach((record) => {
      const link = document.createElement("a");
      link.href = record.permalink;
      link.className =
        "bg-card border-border group text-base hover:bg-primary/10 hover:text-primary hover:border-primary/50 focus:ring-primary/20 inline-flex items-center gap-2 rounded-lg border px-3 py-2 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-105 focus:ring-2 focus:outline-none";

      const name = document.createElement("span");
      name.className = "text-foreground group-hover:text-primary font-medium transition-colors duration-200";
      name.appendChild(createHighlightedFragment(record.title || "", parsed));

      const count = document.createElement("span");
      count.className = "bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium";
      count.textContent = String(record.count || 0);

      link.append(name, count);
      cloud.appendChild(link);
    });
    return cloud;
  }

  function renderArchiveResults(results, parsed) {
    const wrapper = document.createElement("div");
    wrapper.className = "relative";

    const line = document.createElement("div");
    line.className = "bg-border absolute top-0 bottom-0 left-4 w-0.5";
    wrapper.appendChild(line);

    groupArchiveResults(results).forEach((yearGroup) => {
      const yearBlock = document.createElement("div");
      yearBlock.className = "mb-12";
      yearBlock.appendChild(createArchiveYearHeading(yearGroup.year, yearGroup.items.length));

      yearGroup.months.forEach((monthGroup) => {
        const monthBlock = document.createElement("div");
        monthBlock.className = "relative mb-8";
        monthBlock.appendChild(createArchiveMonthHeading(monthGroup.month, monthGroup.items.length));

        const list = document.createElement("div");
        list.className = "ml-12 space-y-3";
        monthGroup.items.forEach((record) => list.appendChild(createArchiveItem(record, parsed)));
        monthBlock.appendChild(list);
        yearBlock.appendChild(monthBlock);
      });

      wrapper.appendChild(yearBlock);
    });

    return wrapper;
  }

  function groupArchiveResults(results) {
    const years = new Map();
    results.forEach((record) => {
      const date = String(record.date || "");
      const year = date.slice(0, 4) || "未归档";
      const month = date.slice(0, 7) || year;

      if (!years.has(year)) years.set(year, new Map());
      const months = years.get(year);
      if (!months.has(month)) months.set(month, []);
      months.get(month).push(record);
    });

    return Array.from(years.entries()).map(([year, months]) => {
      const monthGroups = Array.from(months.entries()).map(([month, items]) => ({ month, items }));
      return {
        year,
        months: monthGroups,
        items: monthGroups.flatMap((group) => group.items),
      };
    });
  }

  function createArchiveYearHeading(year, count) {
    const wrapper = document.createElement("div");
    wrapper.className = "relative mb-8 flex items-center";

    const dot = document.createElement("div");
    dot.className = "bg-primary absolute left-0 z-10 flex h-8 w-8 items-center justify-center rounded-full";

    const body = document.createElement("div");
    body.className = "ml-12";
    const title = document.createElement("h2");
    title.className = "text-foreground text-2xl font-bold";
    title.textContent = year;
    const total = document.createElement("p");
    total.className = "text-muted-foreground text-sm";
    total.textContent = `${count} 篇内容`;
    body.append(title, total);
    wrapper.append(dot, body);
    return wrapper;
  }

  function createArchiveMonthHeading(month, count) {
    const wrapper = document.createElement("div");
    wrapper.className = "relative mb-4 flex items-center";

    const dot = document.createElement("div");
    dot.className = "bg-accent border-background absolute left-2 z-10 h-4 w-4 rounded-full border-2";

    const body = document.createElement("div");
    body.className = "ml-12";
    const title = document.createElement("h3");
    title.className = "text-foreground text-lg font-semibold";
    title.textContent = month;
    const total = document.createElement("p");
    total.className = "text-muted-foreground text-xs";
    total.textContent = `${count} 篇内容`;
    body.append(title, total);
    wrapper.append(dot, body);
    return wrapper;
  }

  function createArchiveItem(record, parsed) {
    const article = document.createElement("article");
    article.className = "group bg-card border-border hover:bg-accent/50 rounded-lg border p-4 transition-all duration-300";

    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-4";
    const body = document.createElement("div");
    body.className = "min-w-0 flex-1";

    const title = document.createElement("h4");
    title.className =
      "text-foreground group-hover:text-primary mb-3 font-medium transition-colors duration-200";
    const link = document.createElement("a");
    link.href = createSearchTarget(record, parsed);
    link.className = "block";
    attachInlineSearchNavigation(link, record, parsed);
    link.appendChild(createHighlightedFragment(record.title || "", parsed));
    title.appendChild(link);

    const excerpt = document.createElement("p");
    excerpt.className = "text-muted-foreground mb-3 line-clamp-2 text-sm";
    excerpt.appendChild(createExcerptFragment(record.excerptText || record.summary || "", parsed, 130));

    const meta = document.createElement("div");
    meta.className = "text-muted-foreground flex items-center gap-4 text-xs";
    appendMeta(meta, record.date);
    appendMatchCount(meta, record.matchCount);
    if (Array.isArray(record.categories) && record.categories.length > 0) {
      appendMeta(meta, record.categories.join(", "));
    }

    body.append(title, excerpt, meta);
    row.appendChild(body);
    article.appendChild(row);
    return article;
  }

  function createExcerptFragment(text, parsed, maxLength) {
    const normalized = normalizeText(text);
    if (!normalized) return document.createTextNode("");

    const ranges = findRanges(normalized, parsed);
    if (ranges.length === 0) {
      return document.createTextNode(normalized.slice(0, maxLength));
    }

    const start = Math.max(0, ranges[0][0] - 36);
    const end = Math.min(normalized.length, Math.max(ranges[0][1] + 92, start + maxLength));
    const excerpt = normalized.slice(start, end);
    const fragment = createHighlightedFragment(excerpt, parsed);

    if (start > 0) fragment.prepend(document.createTextNode("..."));
    if (end < normalized.length) fragment.append(document.createTextNode("..."));
    return fragment;
  }

  function createHighlightedFragment(text, parsed) {
    const fragment = document.createDocumentFragment();
    const source = normalizeText(text);
    const ranges = findRanges(source, parsed);

    if (ranges.length === 0) {
      fragment.appendChild(document.createTextNode(source));
      return fragment;
    }

    let cursor = 0;
    ranges.forEach(([start, end]) => {
      if (start > cursor) {
        fragment.appendChild(document.createTextNode(source.slice(cursor, start)));
      }

      const mark = document.createElement("mark");
      mark.className = "inline-search-mark";
      mark.textContent = source.slice(start, end);
      fragment.appendChild(mark);
      cursor = end;
    });

    if (cursor < source.length) {
      fragment.appendChild(document.createTextNode(source.slice(cursor)));
    }

    return fragment;
  }

  function findRanges(text, parsed) {
    if (!text || parsed.type === "empty" || parsed.type === "invalid") return [];

    const ranges = [];
    if (parsed.type === "regex") {
      const regex = parsed.globalRegex;
      regex.lastIndex = 0;
      let match = regex.exec(text);
      while (match) {
        const value = match[0];
        if (value.length === 0) {
          regex.lastIndex += 1;
        } else {
          ranges.push([match.index, match.index + value.length]);
        }
        match = regex.exec(text);
      }
      return mergeRanges(ranges);
    }

    const lowerText = text.toLowerCase();
    parsed.keywords.forEach((keyword) => {
      let fromIndex = 0;
      while (fromIndex < lowerText.length) {
        const index = lowerText.indexOf(keyword, fromIndex);
        if (index === -1) break;
        ranges.push([index, index + keyword.length]);
        fromIndex = index + keyword.length;
      }
    });

    return mergeRanges(ranges);
  }

  function mergeRanges(ranges) {
    ranges.sort((left, right) => left[0] - right[0]);
    return ranges.reduce((merged, range) => {
      const previous = merged[merged.length - 1];
      if (!previous || range[0] > previous[1]) {
        merged.push([...range]);
      } else {
        previous[1] = Math.max(previous[1], range[1]);
      }
      return merged;
    }, []);
  }

  function setupSingleNavigationControls() {
    navControls = Array.from(document.querySelectorAll(".header-search-control")).map((control) => {
      const wrapper = document.createElement("div");
      wrapper.className = "inline-search-match-nav";
      wrapper.hidden = true;

      const previous = document.createElement("button");
      previous.type = "button";
      previous.className = "inline-search-match-button inline-search-match-button-prev";
      previous.setAttribute("aria-label", "上一个匹配");
      const previousIcon = document.createElement("span");
      previousIcon.className = "inline-search-chevron";
      previousIcon.setAttribute("aria-hidden", "true");
      previous.appendChild(previousIcon);

      const count = document.createElement("span");
      count.className = "inline-search-match-count";
      count.textContent = "0/0";

      const next = document.createElement("button");
      next.type = "button";
      next.className = "inline-search-match-button inline-search-match-button-next";
      next.setAttribute("aria-label", "下一个匹配");
      const nextIcon = document.createElement("span");
      nextIcon.className = "inline-search-chevron";
      nextIcon.setAttribute("aria-hidden", "true");
      next.appendChild(nextIcon);

      previous.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectHit(-1);
      });
      next.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectHit(1);
      });

      wrapper.append(previous, count, next);
      control.appendChild(wrapper);
      return { control, wrapper, count, previous, next };
    });
  }

  function restoreSearchFromNavigationState() {
    let state = null;
    try {
      state = JSON.parse(window.sessionStorage.getItem(INLINE_SEARCH_STATE_KEY) || "null");
      window.sessionStorage.removeItem(INLINE_SEARCH_STATE_KEY);
    } catch (_) {
      return;
    }

    const query = typeof state?.query === "string" ? state.query : "";
    const targetPath = typeof state?.targetPath === "string" ? state.targetPath : "";
    const createdAt = Number(state?.createdAt || 0);
    const isFresh = !createdAt || Date.now() - createdAt < 10 * 60 * 1000;
    if (!query || !isFresh) return;
    if (targetPath && new URL(targetPath, window.location.origin).pathname !== window.location.pathname) return;

    window.requestAnimationFrame(() => {
      document.dispatchEvent(
        new CustomEvent("inline-search:open", {
          detail: { origin: "inline-search-navigation", focus: true },
        }),
      );

      fields.forEach((field) => {
        field.value = query;
      });

      const sourceField = fields.find((field) => field.offsetParent !== null) || fields[0];
      sourceField?.dispatchEvent(new Event("input", { bubbles: true }));

      window.setTimeout(() => {
        if (hits.length > 0) {
          hitIndex = 0;
          updateActiveHit({ scroll: true });
          sourceField?.focus({ preventScroll: true });
          return;
        }

        const fallback =
          pageHeader?.querySelector("h1") || document.querySelector("main h1") || pageHeader;
        fallback?.scrollIntoView({ behavior: "smooth", block: "start" });
        sourceField?.focus({ preventScroll: true });
      }, 240);
    });
  }

  function searchSingle(rawQuery) {
    const parsed = parseQuery(rawQuery);
    clearSingleHighlights();

    if (parsed.type === "empty") {
      setFieldsInvalid(false);
      setSingleControls({ visible: false, label: "0/0" });
      document.body.classList.remove("inline-search-single-active");
      return;
    }

    if (parsed.type === "invalid") {
      setFieldsInvalid(true);
      setSingleControls({ visible: true, label: "无效", disabled: true });
      document.body.classList.add("inline-search-single-active");
      return;
    }

    setFieldsInvalid(false);
    if (!singleArticle) {
      setSingleControls({ visible: true, label: "0/0", disabled: true });
      return;
    }

    const articleText = singleArticle.textContent || "";
    if (parsed.type === "fuzzy") {
      const lowerText = articleText.toLowerCase();
      const hasAllKeywords = parsed.keywords.every((keyword) => lowerText.includes(keyword));
      if (!hasAllKeywords) {
        setSingleControls({ visible: true, label: "0/0", disabled: true });
        document.body.classList.add("inline-search-single-active");
        return;
      }
    } else if (!testRegex(parsed.regex, articleText)) {
      setSingleControls({ visible: true, label: "0/0", disabled: true });
      document.body.classList.add("inline-search-single-active");
      return;
    }

    markArticleText(parsed);
    hitIndex = hits.length > 0 ? 0 : -1;
    updateActiveHit({ scroll: false });
    setSingleControls({
      visible: true,
      label: hits.length > 0 ? `1/${hits.length}` : "0/0",
      disabled: hits.length === 0,
    });
    document.body.classList.add("inline-search-single-active");
  }

  function clearSingleHighlights() {
    if (!singleArticle) return;

    singleArticle.querySelectorAll(`mark.${HIT_CLASS}`).forEach((mark) => {
      const text = document.createTextNode(mark.textContent || "");
      mark.replaceWith(text);
    });
    singleArticle.normalize();
    hits = [];
    hitIndex = 0;
  }

  function markArticleText(parsed) {
    if (!singleArticle) return;

    const walker = document.createTreeWalker(singleArticle, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkipNode(node.parentElement)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node);
      node = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue || "";
      const ranges = findRanges(text, parsed);
      if (ranges.length === 0) return;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      ranges.forEach(([start, end]) => {
        if (start > cursor) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
        }

        const mark = document.createElement("mark");
        mark.className = HIT_CLASS;
        mark.textContent = text.slice(start, end);
        fragment.appendChild(mark);
        cursor = end;
      });

      if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
      }

      textNode.replaceWith(fragment);
    });

    hits = Array.from(singleArticle.querySelectorAll(`mark.${HIT_CLASS}`));
  }

  function shouldSkipNode(element) {
    if (!element) return true;
    return Boolean(
      element.closest(
        "script, style, textarea, input, select, button, .katex, .mermaid, [data-mermaid-tool], .inline-search-match-nav",
      ),
    );
  }

  function selectHit(direction) {
    if (hits.length === 0) return;

    hitIndex += direction;
    if (hitIndex < 0) hitIndex = hits.length - 1;
    if (hitIndex >= hits.length) hitIndex = 0;
    updateActiveHit({ scroll: true });
  }

  function updateActiveHit({ scroll }) {
    hits.forEach((hit, index) => {
      hit.classList.toggle(ACTIVE_HIT_CLASS, index === hitIndex);
    });

    setSingleControls({
      visible: hits.length > 0,
      label: hits.length > 0 ? `${hitIndex + 1}/${hits.length}` : "0/0",
      disabled: hits.length === 0,
    });

    if (scroll && hits[hitIndex]) {
      hits[hitIndex].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function setSingleControls({ visible, label, disabled = false }) {
    navControls.forEach(({ control, wrapper, count, previous, next }) => {
      wrapper.hidden = !visible;
      count.textContent = label;
      previous.disabled = disabled;
      next.disabled = disabled;
      control.classList.toggle("has-inline-search-nav", visible);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInlineSearch, { once: true });
  } else {
    initInlineSearch();
  }
})();
