/**
 * Content Extractor — Extracts meaningful content from web pages.
 * Uses a simplified Readability-like algorithm to find the main article content.
 */

const ContentExtractor = {
  /**
   * Extract the main content from the current page.
   * @returns {{ title: string, url: string, content: string, metadata: object }}
   */
  extractPageContent() {
    const title = this._getTitle();
    const url = window.location.href;
    const content = this._getMainContent();
    const metadata = this._getMetadata();

    return { title, url, content, metadata };
  },

  /**
   * Get the currently selected text with surrounding context.
   * @returns {{ selectedText: string, context: string, title: string, url: string } | null}
   */
  getSelectedContent() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return null;
    }

    const selectedText = selection.toString().trim();
    const context = this._getSelectionContext(selection);
    const title = this._getTitle();
    const url = window.location.href;

    return { selectedText, context, title, url };
  },

  /**
   * Get the best page title.
   */
  _getTitle() {
    // Try og:title first, then <title>, then h1
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content.trim();

    const titleEl = document.querySelector('title');
    if (titleEl && titleEl.textContent) return titleEl.textContent.trim();

    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent) return h1.textContent.trim();

    return document.title || window.location.hostname;
  },

  /**
   * Get page metadata.
   */
  _getMetadata() {
    const meta = {};

    const description = document.querySelector('meta[name="description"], meta[property="og:description"]');
    if (description) meta.description = description.content;

    const author = document.querySelector('meta[name="author"]');
    if (author) meta.author = author.content;

    const keywords = document.querySelector('meta[name="keywords"]');
    if (keywords) meta.keywords = keywords.content;

    const published = document.querySelector('meta[property="article:published_time"], time[datetime]');
    if (published) meta.publishedDate = published.content || published.getAttribute('datetime');

    meta.domain = window.location.hostname;
    meta.timestamp = new Date().toISOString();

    return meta;
  },

  /**
   * Extract the main textual content from the page using a scoring approach.
   */
  _getMainContent() {
    // Priority 1: Look for semantic containers
    const candidates = [
      document.querySelector('article'),
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.querySelector('.post-content'),
      document.querySelector('.article-content'),
      document.querySelector('.entry-content'),
      document.querySelector('.content'),
      document.querySelector('#content'),
    ].filter(Boolean);

    if (candidates.length > 0) {
      // Use the first valid candidate with enough text
      for (const candidate of candidates) {
        const text = this._extractText(candidate);
        if (text.length > 200) {
          return text;
        }
      }
    }

    // Priority 2: Score all top-level divs by text density
    const scoredElements = this._scoreElements();
    if (scoredElements.length > 0) {
      return this._extractText(scoredElements[0].element);
    }

    // Fallback: body text
    return this._extractText(document.body);
  },

  /**
   * Score elements by text density to find the main content container.
   */
  _scoreElements() {
    const candidates = document.querySelectorAll('div, section, article');
    const scored = [];

    for (const el of candidates) {
      // Skip navigation, sidebars, headers, footers
      if (this._isBoilerplate(el)) continue;

      const text = el.textContent || '';
      const textLength = text.trim().length;
      const links = el.querySelectorAll('a');
      const linkTextLength = Array.from(links).reduce((sum, a) => sum + (a.textContent || '').length, 0);

      // Text density = text length minus link text, divided by total length
      const density = textLength > 0 ? (textLength - linkTextLength) / textLength : 0;

      // Paragraphs count
      const paragraphs = el.querySelectorAll('p');
      const paragraphScore = paragraphs.length * 10;

      // Headings inside suggest content
      const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const headingScore = headings.length * 5;

      const score = (textLength * density) + paragraphScore + headingScore;

      if (score > 100 && textLength > 200) {
        scored.push({ element: el, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  },

  /**
   * Check if an element is likely boilerplate (nav, sidebar, footer, etc.)
   */
  _isBoilerplate(el) {
    const tag = el.tagName.toLowerCase();
    if (['nav', 'footer', 'header', 'aside'].includes(tag)) return true;

    const id = (el.id || '').toLowerCase();
    const className = (el.className || '').toString().toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    const boilerplatePatterns = [
      'nav', 'sidebar', 'footer', 'header', 'menu', 'comment',
      'widget', 'social', 'share', 'related', 'recommend',
      'advertisement', 'ad-', 'ads-', 'advert', 'cookie',
      'popup', 'modal', 'overlay', 'banner', 'promo',
      'newsletter', 'subscribe', 'signup'
    ];

    const combined = `${id} ${className} ${role}`;
    return boilerplatePatterns.some(p => combined.includes(p));
  },

  /**
   * Extract clean text from an element, preserving structure.
   */
  _extractText(element) {
    if (!element) return '';

    const blocks = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            // Skip unwanted elements
            if (['script', 'style', 'noscript', 'svg', 'img', 'video', 'audio', 'iframe', 'canvas', 'button', 'input', 'select', 'textarea', 'form'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (node.closest && (node.closest('nav') || node.closest('footer') || node.closest('[role="navigation"]'))) {
              return NodeFilter.FILTER_REJECT;
            }
            // Check computed style for hidden elements
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_SKIP;
          }
          // Text node
          const text = node.textContent.trim();
          if (text.length > 0) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let currentBlock = '';
    let lastParent = null;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      const parentTag = parent ? parent.tagName.toLowerCase() : '';

      // Block-level elements start new blocks
      const isBlockParent = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'td', 'th', 'dt', 'dd'].includes(parentTag);

      if (isBlockParent && parent !== lastParent) {
        if (currentBlock.trim()) {
          blocks.push(currentBlock.trim());
        }

        // Add heading markers
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(parentTag)) {
          const level = parseInt(parentTag[1]);
          const prefix = '#'.repeat(level) + ' ';
          currentBlock = prefix;
        } else if (parentTag === 'li') {
          currentBlock = '• ';
        } else {
          currentBlock = '';
        }
        lastParent = parent;
      }

      currentBlock += node.textContent.trim() + ' ';
    }

    if (currentBlock.trim()) {
      blocks.push(currentBlock.trim());
    }

    // Clean up and join
    return blocks
      .map(b => b.replace(/\s+/g, ' ').trim())
      .filter(b => b.length > 0)
      .join('\n\n');
  },

  /**
   * Get surrounding context for a text selection.
   */
  _getSelectionContext(selection) {
    const range = selection.getRangeAt(0);
    let container = range.commonAncestorContainer;

    // Walk up to find a meaningful container
    while (container && container.nodeType !== Node.ELEMENT_NODE) {
      container = container.parentNode;
    }

    // Get the parent section/article
    const section = container
      ? (container.closest('section, article, [role="main"], main, .content') || container)
      : null;

    if (!section) return '';

    // Find the nearest heading above
    let heading = '';
    let el = container;
    while (el && el !== document.body) {
      const prevSibling = el.previousElementSibling;
      if (prevSibling) {
        const tag = prevSibling.tagName.toLowerCase();
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          heading = prevSibling.textContent.trim();
          break;
        }
      }
      el = el.parentElement;
    }

    return heading ? `Section: ${heading}` : '';
  }
};

// Export for use as content script or module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentExtractor;
}
