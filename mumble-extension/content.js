/**
 * Suno Mumble Button Pinner
 *
 * Finds the "Mumble" toggle on Suno's create page and forces it to stay
 * visible, regardless of whatever conditional display logic Suno uses.
 *
 * Strategy:
 *  1. Walk the DOM looking for elements whose text or aria-label contains
 *     "mumble" (case-insensitive).
 *  2. For every matching element, walk up the ancestor chain to find the
 *     nearest container that is currently hidden (display:none,
 *     visibility:hidden, opacity:0, or has a zero-size clip) and force it
 *     visible.
 *  3. Inject a <style> tag that overrides any class-based hiding rules we
 *     can identify.
 *  4. Run again via MutationObserver whenever the DOM changes (Suno is a
 *     React SPA, so the UI rebuilds frequently).
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[Suno Mumble Pinner]';
  let pinnedCount = 0;
  let styleEl = null;
  const forcedClasses = new Set();

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  /** Return true if the element is visually hidden by inline style or
   *  computed style, ignoring its children. */
  function isHiddenByStyle(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    // Zero-size with overflow hidden is another hide pattern
    if (
      parseFloat(cs.width) === 0 &&
      parseFloat(cs.height) === 0 &&
      cs.overflow === 'hidden'
    )
      return true;
    return false;
  }

  /** Force an element to be visible via inline styles. */
  function forceVisible(el) {
    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('pointer-events', 'auto', 'important');
    el.style.setProperty('width', '', 'important');   // let layout decide
    el.style.setProperty('height', '', 'important');
    el.style.setProperty('overflow', 'visible', 'important');
  }

  /** Inject / refresh a <style> block that overrides class-based hiding
   *  for every class name we have seen on mumble containers. */
  function refreshStyleOverrides() {
    if (forcedClasses.size === 0) return;

    const rules = [...forcedClasses]
      .map(
        (cls) =>
          `.${CSS.escape(cls)} { display: flex !important; visibility: visible !important; opacity: 1 !important; }`
      )
      .join('\n');

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'suno-mumble-pinner-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = rules;
  }

  // ------------------------------------------------------------------
  // Core detection
  // ------------------------------------------------------------------

  /**
   * Collect every DOM node whose visible text or aria-label contains
   * "mumble" (case-insensitive).
   */
  function findMumbleNodes() {
    const results = [];

    // TreeWalker over text nodes
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent.trim().toLowerCase().includes('mumble')
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            const label =
              node.getAttribute('aria-label') ||
              node.getAttribute('data-testid') ||
              node.getAttribute('title') ||
              node.getAttribute('placeholder') ||
              '';
            return label.toLowerCase().includes('mumble')
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (el && !results.includes(el)) results.push(el);
    }

    return results;
  }

  /**
   * Given a mumble-labelled leaf element, walk up its ancestor chain and
   * force-show any hidden container within a reasonable depth (max 10
   * levels).  Stop once we hit the <body> or a clearly unrelated section.
   */
  function pinAncestors(leafEl) {
    let el = leafEl;
    let depth = 0;
    const maxDepth = 10;

    while (el && el !== document.body && depth < maxDepth) {
      if (isHiddenByStyle(el)) {
        log('Forcing visible:', el);
        forceVisible(el);
        pinnedCount++;

        // Collect class names so we can override stylesheet rules too
        el.classList.forEach((cls) => {
          if (cls && cls.length > 2) forcedClasses.add(cls);
        });
      }
      el = el.parentElement;
      depth++;
    }
  }

  // ------------------------------------------------------------------
  // Main scan
  // ------------------------------------------------------------------

  function scan() {
    const nodes = findMumbleNodes();
    if (nodes.length === 0) return;

    nodes.forEach((node) => {
      pinAncestors(node);
      // Also make the leaf itself visible in case it's hidden directly
      if (isHiddenByStyle(node)) {
        forceVisible(node);
        node.classList.forEach((cls) => {
          if (cls && cls.length > 2) forcedClasses.add(cls);
        });
      }
    });

    refreshStyleOverrides();

    if (nodes.length > 0) {
      log(`Found ${nodes.length} mumble node(s), pinned ${pinnedCount} element(s) so far.`);
    }
  }

  // ------------------------------------------------------------------
  // MutationObserver — re-scan whenever the DOM changes
  // ------------------------------------------------------------------

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  const observer = new MutationObserver((mutations) => {
    // Only bother if nodes were added or attributes changed
    const relevant = mutations.some(
      (m) => m.type === 'childList' || m.type === 'attributes'
    );
    if (relevant) scheduleScan();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
  });

  // Initial scan (page may already be loaded)
  scan();

  log('Mumble pinner active — watching for DOM changes.');
})();
