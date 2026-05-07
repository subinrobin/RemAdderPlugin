/**
 * Content Script — Dual-purpose script.
 * Mode 1 (any page): Extracts content, captures selections.
 * Mode 2 (remnote.com): Acts as message bridge to companion plugin.
 */

(function () {
  'use strict';

  const REMADDER_PREFIX = 'REMADDER_';
  const isRemNotePage = window.location.hostname.includes('remnote.com');

  // ══════════════════════════════════════
  // Mode 1: Content extraction (any page)
  // ══════════════════════════════════════

  /**
   * Listen for messages from background worker.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === `${REMADDER_PREFIX}EXTRACT_PAGE`) {
      const result = extractPageContent();
      sendResponse(result);
      return true;
    }

    if (message.type === `${REMADDER_PREFIX}GET_SELECTION`) {
      const result = getSelectedContent();
      sendResponse(result);
      return true;
    }

    if (message.type === `${REMADDER_PREFIX}CS_PING`) {
      sendResponse({ status: 'alive' });
      return true;
    }

    // Mode 2: Forward to plugin
    if (isRemNotePage && message.type === `${REMADDER_PREFIX}TO_PLUGIN`) {
      forwardToPlugin(message);
      sendResponse({ forwarded: true });
      return true;
    }

    return false;
  });

  // ══════════════════════════════════════
  // Content Extraction Functions
  // ══════════════════════════════════════

  function extractPageContent() {
    const title = getTitle();
    const url = window.location.href;
    const content = getMainContent();
    const metadata = getMetadata();
    return { title, url, content, metadata };
  }

  function getSelectedContent() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;

    const selectedText = selection.toString().trim();
    let context = '';

    // Try to find nearest heading
    let node = selection.anchorNode;
    while (node && node !== document.body) {
      if (node.previousElementSibling) {
        const tag = node.previousElementSibling.tagName?.toLowerCase();
        if (tag && tag.match(/^h[1-6]$/)) {
          context = `Section: ${node.previousElementSibling.textContent.trim()}`;
          break;
        }
      }
      node = node.parentElement;
    }

    return { selectedText, context, title: getTitle(), url: window.location.href };
  }

  function getTitle() {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle?.content) return ogTitle.content.trim();
    const h1 = document.querySelector('h1');
    if (h1?.textContent) return h1.textContent.trim();
    return document.title || window.location.hostname;
  }

  function getMetadata() {
    const meta = { domain: window.location.hostname, timestamp: new Date().toISOString() };
    const desc = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (desc) meta.description = desc.content;
    return meta;
  }

  function getMainContent() {
    // Priority: semantic containers
    const selectors = ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.entry-content'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = cleanText(el);
        if (text.length > 200) return text;
      }
    }

    // Fallback: score divs by text density
    let bestEl = null, bestScore = 0;
    document.querySelectorAll('div, section').forEach(el => {
      if (isBoilerplate(el)) return;
      const text = el.textContent || '';
      const len = text.trim().length;
      const paragraphs = el.querySelectorAll('p').length;
      const score = len + paragraphs * 50;
      if (score > bestScore && len > 200) {
        bestScore = score;
        bestEl = el;
      }
    });

    return bestEl ? cleanText(bestEl) : cleanText(document.body);
  }

  function isBoilerplate(el) {
    const tag = el.tagName.toLowerCase();
    if (['nav', 'footer', 'header', 'aside'].includes(tag)) return true;
    const combined = `${el.id} ${el.className}`.toLowerCase();
    return /nav|sidebar|footer|header|menu|comment|widget|social|share|ad[-_s]|cookie|popup|modal|newsletter/.test(combined);
  }

  function cleanText(el) {
    if (!el) return '';
    // Clone to avoid modifying the page
    const clone = el.cloneNode(true);
    // Remove unwanted elements
    clone.querySelectorAll('script, style, noscript, svg, iframe, nav, footer, [role="navigation"], .ad, .advertisement').forEach(e => e.remove());

    const text = clone.textContent || '';
    // Clean up whitespace
    return text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  }

  // ══════════════════════════════════════
  // Mode 2: RemNote Bridge (remnote.com)
  // ══════════════════════════════════════

  if (isRemNotePage) {
    // Listen for messages from the companion plugin (via window.postMessage from iframe)
    window.addEventListener('message', (event) => {
      if (!event.data || !event.data.type) return;

      // Plugin sending response back (from iframe via window.parent.postMessage)
      if (event.data.type === `${REMADDER_PREFIX}FROM_PLUGIN`) {
        // Forward to background worker
        chrome.runtime.sendMessage({
          type: `${REMADDER_PREFIX}PLUGIN_RESPONSE`,
          requestId: event.data.requestId,
          response: event.data.response,
          error: event.data.error,
        });
      }
    });
  }

  /**
   * Forward a message from background worker to the companion plugin.
   * The plugin runs inside an iframe, so we post to all iframes on the page.
   */
  function forwardToPlugin(message) {
    const data = {
      type: `${REMADDER_PREFIX}TO_PLUGIN`,
      requestId: message.requestId,
      action: message.action,
      payload: message.payload,
    };

    // Post to all iframes — the plugin iframe will pick it up
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        iframe.contentWindow.postMessage(data, '*');
      } catch (e) {
        // Some iframes may block access, that's fine
      }
    });

    // Also post to main window as fallback
    window.postMessage(data, '*');
  }
})();
