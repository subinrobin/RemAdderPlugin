/**
 * RemNote Bridge — Communication layer between browser extension and companion RemNote plugin.
 * Uses chrome.tabs + content script + window.postMessage to reach the plugin inside RemNote.
 */

const RemNoteBridge = {
  REMNOTE_URL: 'https://www.remnote.com',
  MSG_PREFIX: 'REMADDER_',
  PING_TIMEOUT: 5000,
  CONNECTION_TIMEOUT: 15000,

  _status: 'disconnected', // 'connected' | 'connecting' | 'disconnected'
  _remnoteTabId: null,
  _pendingRequests: new Map(),

  /**
   * Get current connection status.
   */
  getStatus() {
    return this._status;
  },

  /**
   * Check if the companion plugin is available.
   */
  async isPluginAvailable() {
    try {
      const tab = await this._findRemNoteTab();
      if (!tab) return false;

      this._remnoteTabId = tab.id;
      return await this._ping();
    } catch {
      return false;
    }
  },

  /**
   * Ensure RemNote is open and plugin is connected.
   * Opens RemNote in a background tab if needed.
   */
  async ensureConnection() {
    this._status = 'connecting';

    // Step 1: Find or open RemNote tab
    let tab = await this._findRemNoteTab();
    if (!tab) {
      tab = await this._openRemNoteTab();
    }
    this._remnoteTabId = tab.id;

    // Step 2: Inject content script if needed
    await this._ensureContentScript(tab.id);

    // Step 3: Wait for plugin to respond
    const connected = await this._waitForPlugin();
    this._status = connected ? 'connected' : 'disconnected';
    return connected;
  },

  /**
   * Request folder tree from the companion plugin.
   * @param {number} maxDepth - Maximum depth to traverse
   * @returns {Promise<Array>} - Folder tree nodes
   */
  async getFolderTree(maxDepth = 3) {
    return this._sendToPlugin('GET_FOLDERS', { maxDepth });
  },

  /**
   * Request flashcard creation via the companion plugin.
   * @param {object} data - { flashcards, targetPath, sourceTitle, sourceUrl }
   * @returns {Promise<object>} - { success, createdCount }
   */
  async createFlashcards(data) {
    return this._sendToPlugin('CREATE_FLASHCARDS', data);
  },

  // ── Internal Methods ──

  /**
   * Find an existing RemNote tab.
   */
  async _findRemNoteTab() {
    const tabs = await chrome.tabs.query({ url: 'https://*.remnote.com/*' });
    return tabs.length > 0 ? tabs[0] : null;
  },

  /**
   * Open RemNote in a background tab.
   */
  async _openRemNoteTab() {
    const tab = await chrome.tabs.create({
      url: this.REMNOTE_URL,
      active: false,
    });

    // Wait for the tab to fully load
    return new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout fallback
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      }, 10000);
    });
  },

  /**
   * Ensure content script is injected into the RemNote tab.
   */
  async _ensureContentScript(tabId) {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { type: `${this.MSG_PREFIX}CS_PING` });
    } catch {
      // Content script not injected, inject it
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Give it a moment to initialize
      await new Promise(r => setTimeout(r, 500));
    }
  },

  /**
   * Ping the companion plugin to check if it's alive.
   */
  async _ping() {
    try {
      const response = await this._sendToPlugin('PING', {}, this.PING_TIMEOUT);
      return response && response.status === 'PONG';
    } catch {
      return false;
    }
  },

  /**
   * Wait for the companion plugin to become available (with retries).
   */
  async _waitForPlugin() {
    const startTime = Date.now();
    const retryInterval = 2000;

    while (Date.now() - startTime < this.CONNECTION_TIMEOUT) {
      const available = await this._ping();
      if (available) return true;
      await new Promise(r => setTimeout(r, retryInterval));
    }
    return false;
  },

  /**
   * Send a message to the companion plugin via content script bridge.
   */
  async _sendToPlugin(action, payload = {}, timeout = 10000) {
    if (!this._remnoteTabId) {
      throw new Error('RemNote tab not found');
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(requestId);
        reject(new Error(`Plugin request timed out: ${action}`));
      }, timeout);

      this._pendingRequests.set(requestId, { resolve, reject, timer });

      // Send to content script on remnote.com tab
      chrome.tabs.sendMessage(this._remnoteTabId, {
        type: `${this.MSG_PREFIX}TO_PLUGIN`,
        requestId,
        action,
        payload,
      }).catch(err => {
        clearTimeout(timer);
        this._pendingRequests.delete(requestId);
        reject(err);
      });
    });
  },

  /**
   * Handle response from the companion plugin (called by background.js message listener).
   */
  handlePluginResponse(message) {
    const { requestId, response, error } = message;
    const pending = this._pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this._pendingRequests.delete(requestId);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(response);
    }
  },
};

if (typeof self !== 'undefined') self.RemNoteBridge = RemNoteBridge;
