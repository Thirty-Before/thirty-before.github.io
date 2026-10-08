import { copyText } from "./clipboard.js";

const COPY_FEEDBACK_MS = 2000;
const copyTimers = new WeakMap();

function getCodeBlocks(root = document) {
  return [...root.querySelectorAll("[data-code-block]")];
}

function countSourceLines(block) {
  const sourceNode = block.querySelector("[data-code-source]");
  const sourceText = sourceNode?.textContent ?? "";
  if (!sourceText) return 0;
  return sourceText.split("\n").length;
}

function shouldAutoCollapse(block) {
  const autoCollapseLines = Number.parseInt(block.dataset.autoCollapseLines || "8", 10);
  const autoCollapseHeight = Number.parseInt(block.dataset.autoCollapseHeight || "400", 10);
  const renderedCode = block.querySelector(
    ".code-block-content pre.chroma, .code-block-content pre"
  );
  const renderedHeight = renderedCode?.offsetHeight || 0;
  const sourceLines = countSourceLines(block);

  return sourceLines > autoCollapseLines || renderedHeight > autoCollapseHeight;
}

function updateCollapseButton(block, collapsed) {
  const buttons = block.querySelectorAll("[data-code-action='toggle-collapse']");
  buttons.forEach((button) => {
    const label = collapsed ? button.dataset.labelExpand : button.dataset.labelCollapse;
    const text = button.querySelector(".collapse-text");
    const chevron = button.querySelector(".collapse-chevron");

    if (text) text.textContent = label || "";
    if (chevron) chevron.classList.toggle("rotate-180", !collapsed);

    button.title = label || "";
    button.setAttribute("aria-label", label || "");
    button.setAttribute("aria-expanded", String(!collapsed));
  });
}

function updateCollapseOverlay(block, collapsed) {
  const isOutput = block.matches(".code-block-output");
  const overlay = block.querySelector(".collapse-overlay");
  const bottomBar = block.querySelector(".code-block-bottom-bar[data-code-action='toggle-collapse']");
  const bottomIcon = block.querySelector(".code-block-bottom-bar[data-code-action='toggle-collapse'] .code-block-bottom-collapse");
  const chevron = block.querySelector(".output-chevron");

  if (overlay) {
    if (isOutput) {
      overlay.hidden = true;
      overlay.style.display = "none";
    } else {
      overlay.hidden = !collapsed;
      overlay.classList.toggle("pointer-events-none", !collapsed);
      overlay.classList.toggle("opacity-0", !collapsed);
      overlay.classList.toggle("pointer-events-auto", collapsed);
      overlay.classList.toggle("opacity-100", collapsed);
    }
  }

  // Bottom bar: only visible if block exceeds autoCollapseLines AND is expanded.
  // Bug fix: never show based on _userToggled — short blocks should never get bottom button.
  if (bottomBar) {
    if (isOutput) {
      var canShowO = !collapsed && block.dataset._isCollapsible === "true";
      bottomBar.hidden = !canShowO;
      bottomBar.classList.toggle("hidden", !canShowO);
      bottomBar.classList.toggle("flex", canShowO);
    } else {
      var canShowN = !collapsed && block.dataset._isCollapsible === "true";
      bottomBar.hidden = !canShowN;
      bottomBar.classList.toggle("hidden", !canShowN);
      bottomBar.classList.toggle("flex", canShowN);
    }

    var label = collapsed ? bottomBar.dataset.labelExpand : bottomBar.dataset.labelCollapse;
    bottomBar.title = label || "";
    bottomBar.setAttribute("aria-label", label || "");
    bottomBar.setAttribute("aria-expanded", String(!collapsed));
  }

  // Update icon inside bottom bar
  if (bottomIcon) {
    bottomIcon.innerHTML = collapsed
      ? '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>'
      : '<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
  }

  // Rotate output header chevron
  if (chevron) {
    chevron.style.transform = collapsed ? "" : "rotate(180deg)";
  }
}

function setCollapsed(block, collapsed, { animate = true, anchor = "top" } = {}) {
  const content = block.querySelector(".code-block-content");
  if (!content) return;

  const collapsedHeight = Number.parseInt(block.dataset.collapsedHeight || "120", 10);

  // Suppress native scroll anchoring during height change
  content.style.overflowAnchor = "none";

  // Scroll anchoring: when collapsing, preserve the specified edge position
  var anchorDelta = 0;
  if (collapsed && block.dataset.collapsed !== "true") {
    var rectBefore = block.getBoundingClientRect();
    if (anchor === "bottom") {
      anchorDelta = rectBefore.bottom;
    }
  }

  block.dataset.collapsed = String(collapsed);
  content.style.transition = animate ? "max-height 0.35s cubic-bezier(.4,0,.2,1)" : "";
  content.style.maxHeight = collapsed ? `${collapsedHeight}px` : "";
  content.style.overflow = collapsed ? "hidden" : "";

  updateCollapseButton(block, collapsed);
  updateCollapseOverlay(block, collapsed);

  // Apply scroll anchor for bottom-anchored collapses
  if (anchorDelta > 0) {
    var rectAfter = block.getBoundingClientRect();
    var delta = rectAfter.bottom - anchorDelta;
    if (delta < 0) {
      window.scrollBy({ top: delta, behavior: "instant" });
    }
  }

  // Restore native scroll anchoring after layout settles
  var restoreAnchor = function () { content.style.overflowAnchor = ""; };
  if (animate) {
    window.setTimeout(restoreAnchor, 400);
  } else {
    restoreAnchor();
  }

  if (animate) {
    window.setTimeout(() => {
      content.style.transition = "";
    }, 350);
  }
}

function initCollapsibleBlocks(root = document) {
  getCodeBlocks(root).forEach((block) => {
    if (block.dataset.collapsible !== "true") return;

    const defaultState = block.dataset.defaultState || "expanded";
    const collapsedAttr = block.dataset.collapsed === "true";
    const autoCollapses = shouldAutoCollapse(block);
    const startCollapsed =
      collapsedAttr || defaultState === "collapsed" || autoCollapses;

    // Mark if block exceeds autoCollapseLines (for bottom button visibility)
    if (autoCollapses) block.dataset._isCollapsible = "true";

    // Hide top-right collapse button for blocks below minCollapseLines
    const minCollapseLines = Number.parseInt(block.dataset.minCollapseLines || "6", 10);
    const sourceLines = countSourceLines(block);
    if (sourceLines < minCollapseLines) {
      const topBtn = block.querySelector(".collapse-code-btn");
      if (topBtn) {
        topBtn.hidden = true;
        topBtn.style.display = "none";
      }
      const overlay = block.querySelector(".collapse-overlay");
      if (overlay) {
        overlay.hidden = true;
        overlay.style.display = "none";
      }
    }

    setCollapsed(block, startCollapsed, { animate: false });
  });
}

function getCodeSource(block) {
  const sourceNode = block.querySelector("[data-code-source]");
  return sourceNode?.textContent ?? "";
}

function setCopyFeedback(button, copied) {
  const text = button.querySelector(".copy-text");
  const label = copied ? button.dataset.labelCopied : button.dataset.labelCopy;

  if (text) text.textContent = label || "";

  button.classList.toggle("text-green-600", copied);
  button.title = label || "";
  button.setAttribute("aria-label", label || "");
}

async function handleCopy(button) {
  const block = button.closest("[data-code-block]");
  if (!block) return;

  const copied = await copyText(getCodeSource(block));
  if (!copied) return;

  setCopyFeedback(button, true);

  const previousTimer = copyTimers.get(button);
  if (previousTimer) {
    window.clearTimeout(previousTimer);
  }

  const timer = window.setTimeout(() => {
    setCopyFeedback(button, false);
    copyTimers.delete(button);
  }, COPY_FEEDBACK_MS);

  copyTimers.set(button, timer);
}

function handleCodeBlockClick(event) {
  const copyButton = event.target.closest(".copy-code-btn[data-code-action='copy']");
  if (copyButton) {
    event.preventDefault();
    handleCopy(copyButton);
    return;
  }

  const collapseButton = event.target.closest(
    "[data-code-action='toggle-collapse']"
  );
  if (collapseButton) {
    event.preventDefault();
    const block = collapseButton.closest("[data-code-block]");
    if (!block) return;
    block.dataset._userToggled = "true";
    const isCollapsed = block.dataset.collapsed === "true";
    // Bottom bar → preserve bottom edge; top button / output header → preserve top
    var anchor = event.target.closest(".code-block-bottom-bar") ? "bottom" : "top";
    setCollapsed(block, !isCollapsed, { anchor: anchor });
    return;
  }

  // Click anywhere on a collapsed code block → expand (not just the button)
  const collapsedBlock = event.target.closest("[data-code-block]");
  if (collapsedBlock && collapsedBlock.dataset.collapsed === "true") {
    event.preventDefault();
    collapsedBlock.dataset._userToggled = "true";
    setCollapsed(collapsedBlock, false, { anchor: "top" });
    return;
  }
}

let initialized = false;

export function initCodeBlocks(root = document) {
  if (initialized) return;
  initialized = true;

  initCollapsibleBlocks(root);

  document.addEventListener("click", handleCodeBlockClick);
}
