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
 *     nearest container that is currently hidden and force it visible via
 *     element.style.setProperty() — which is never blocked by CSP.
 *  3. Use an adoptedStyleSheet (constructed programmatically, also CSP-safe)
 *     as a secondary override for class-based hiding rules.
 *  4. Re-run via MutationObserver whenever childList changes (NOT style/class
 *     attributes — watching those while also writing them causes a feedback
 *     loop and excessive React re-renders).
 */

(function () {
  'use strict';

  const LOG_PREFIX = '[Suno Mumble Pinner]';

  // Track elements we have already pinned so we don't log/re-process them
  // on every MutationObserver tick.
  const pinnedElements = new WeakSet();

  // CSP-safe stylesheet: constructed via JS, not injected as a <style> tag.
  // document.adoptedStyleSheets is available in all modern Chromium builds.
  let adoptedSheet = null;
  const forcedClasses = new Set();

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  /**
   * Return true if the element is visually hidden via computed style.
   * We only re-check elements we haven't pinned yet.
   */
  function isHidden(el) {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') return true;
    if (cs.visibility === 'hidden') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (
      parseFloat(cs.width) === 0 &&
      parseFloat(cs.height) === 0 &&
      cs.overflow === 'hidden'
    )
      return true;
    return false;
  }

  /**
   * Force an element visible using element.style.setProperty with !important.
   * This approach is NOT subject to CSP style-src restrictions — it is pure
   * JavaScript DOM manipulation, not an inline style attribute or <style> tag.
   */
  function forceVisible(el) {
    // Pause the observer while we touch styles to avoid triggering ourselves.
    observer.disconnect();

    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('pointer-events', 'auto', 'important');
    // Clear width/height overrides so the element can size naturally.
    el.style.removeProperty('width');
    el.style.removeProperty('height');
    el.style.setProperty('overflow', 'visible', 'important');

    pinnedElements.add(el);

    // Reconnect — only watching structural changes, not style/class attributes.
    observer.observe(document.body, OBSERVER_OPTIONS);

    log('Pinned:', el);
  }

  /**
   * Refresh the adoptedStyleSheet with rules for every class we've seen on
   * hidden mumble containers.  adoptedStyleSheets are constructed via the
   * CSSStyleSheet API (pure JS) and are NOT blocked by CSP style-src.
   */
  function refreshAdoptedSheet() {
    if (forcedClasses.size === 0) return;

    const rules = [...forcedClasses]
      .map(
        (cls) =>
          `.${CSS.escape(cls)} { display: flex !important; visibility: visible !important; opacity: 1 !important; overflow: visible !important; }`
      )
      .join('\n');

    try {
      if (!adoptedSheet) {
        adoptedSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [
          ...document.adoptedStyleSheets,
          adoptedSheet,
        ];
      }
      adoptedSheet.replaceSync(rules);
    } catch (e) {
      // adoptedStyleSheets not supported (shouldn't happen in Chrome MV3)
      log('adoptedStyleSheets unavailable:', e.message);
    }
  }

  // ------------------------------------------------------------------
  // Core detection
  // ------------------------------------------------------------------

  /**
   * Collect every element whose visible text or key attribute contains
   * "mumble" (case-insensitive).
   */
  function findMumbleNodes() {
    const results = [];

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
            const label = [
              node.getAttribute('aria-label'),
              node.getAttribute('data-testid'),
              node.getAttribute('title'),
              node.getAttribute('placeholder'),
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return label.includes('mumble')
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
   * Given a mumble-labelled leaf element, walk up its ancestors (max 10
   * levels) and force-show any hidden container.
   */
  function pinAncestors(leafEl) {
    let el = leafEl;
    let depth = 0;

    while (el && el !== document.body && depth < 10) {
      if (!pinnedElements.has(el) && isHidden(el)) {
        el.classList.forEach((cls) => {
          if (cls.length > 2) forcedClasses.add(cls);
        });
        forceVisible(el);
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

    let newPins = 0;
    nodes.forEach((node) => {
      // Pin the leaf itself
      if (!pinnedElements.has(node) && isHidden(node)) {
        node.classList.forEach((cls) => {
          if (cls.length > 2) forcedClasses.add(cls);
        });
        forceVisible(node);
        newPins++;
      }
      pinAncestors(node);
    });

    if (forcedClasses.size > 0) refreshAdoptedSheet();
    if (newPins > 0) log(`Pinned ${newPins} new element(s) (${nodes.length} mumble node(s) found).`);
  }

  // ------------------------------------------------------------------
  // MutationObserver
  //
  // IMPORTANT: we intentionally do NOT watch style or class attribute
  // changes.  Doing so while also writing styles creates a tight feedback
  // loop: our writes trigger the observer, which calls scan(), which writes
  // again, flooding React with DOM mutations and causing hydration errors.
  //
  // We only watch structural (childList) changes — enough to catch React
  // re-renders that remove or re-add the mumble container.
  // ------------------------------------------------------------------

  const OBSERVER_OPTIONS = {
    childList: true,
    subtree: true,
    // No attributes: true — avoids the style/class feedback loop.
  };

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  }

  // Defined early so forceVisible() can reference it.
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.type === 'childList' && m.addedNodes.length > 0)) {
      scheduleScan();
    }
  });

  observer.observe(document.body, OBSERVER_OPTIONS);

  // Initial scan
  scan();

  log('Mumble pinner active.');
})();
