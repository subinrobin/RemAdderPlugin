/**
 * Background Service Worker — Orchestrates all extension flows.
 */

// Import libraries (service worker scope)
importScripts(
  'lib/llm-client.js',
  'lib/flashcard-generator.js',
  'lib/remnote-formatter.js',
  'lib/remnote-bridge.js'
);

// ══════════════════════════════════════
// Context Menu Registration
// ══════════════════════════════════════

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'add-to-remnote',
    title: 'Add to RemNote',
    contexts: ['selection'],
  });
});

// ══════════════════════════════════════
// Context Menu Click Handler
// ══════════════════════════════════════

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'add-to-remnote') return;

  try {
    // Inject content script if not on RemNote
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown.js', 'lib/Readability.js', 'content.js'],
    }).catch(() => {}); // May already be injected

    // Get selected content from the page
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        if (!selection || !selection.toString().trim()) return null;
        const selectedText = selection.toString().trim();
        const title = document.querySelector('meta[property="og:title"]')?.content
          || document.querySelector('h1')?.textContent?.trim()
          || document.title;
        return { selectedText, context: '', title, url: window.location.href };
      },
    });

    if (!result?.result) return;

    const selectionData = result.result;

    // Get LLM config
    const config = await getLLMConfig();
    if (!config) {
      openSettingsPage();
      return;
    }

    // Generate flashcards
    const flashcardData = await FlashcardGenerator.generateFromSelection(selectionData, config);

    // Store and open preview
    await chrome.storage.local.set({ pendingFlashcards: flashcardData });
    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });

  } catch (error) {
    console.error('RemAdder context menu error:', error);
  }
});

// ══════════════════════════════════════
// Message Handler
// ══════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = messageHandlers[message.type];
  if (handler) {
    handler(message, sender).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Async response
  }
  return false;
});

const messageHandlers = {
  /**
   * Summarize the active tab's content.
   */
  async 'REMADDER_SUMMARIZE_PAGE'(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown.js', 'lib/Readability.js', 'content.js'],
    }).catch(() => {});

    // Extract page content
    const pageData = await chrome.tabs.sendMessage(tab.id, {
      type: 'REMADDER_EXTRACT_PAGE',
    });

    if (!pageData || !pageData.content) {
      throw new Error('Could not extract content from this page');
    }

    // Get LLM config
    const config = await getLLMConfig();
    if (!config) throw new Error('LLM not configured. Please set up in settings.');

    // Generate flashcards
    const flashcardData = await FlashcardGenerator.generateFromPage(pageData, config);

    // Store for preview page
    await chrome.storage.local.set({ pendingFlashcards: flashcardData });

    return { success: true, flashcardData };
  },

  /**
   * Get current connection status with RemNote plugin.
   */
  async 'REMADDER_GET_STATUS'() {
    const pluginAvailable = await RemNoteBridge.isPluginAvailable();
    return {
      pluginConnected: pluginAvailable,
      status: RemNoteBridge.getStatus(),
    };
  },

  /**
   * Get folder tree from companion plugin.
   */
  async 'REMADDER_GET_FOLDERS'() {
    const connected = await RemNoteBridge.ensureConnection();
    if (!connected) return { folders: [], connected: false };

    const folders = await RemNoteBridge.getFolderTree();
    return { folders, connected: true };
  },

  /**
   * Create flashcards via companion plugin.
   */
  async 'REMADDER_CREATE_FLASHCARDS'(message) {
    const { flashcards, targetPath, sourceTitle, sourceUrl } = message.payload;

    const connected = await RemNoteBridge.ensureConnection();
    if (!connected) {
      // Fallback: copy to clipboard
      return { success: false, method: 'clipboard', message: 'Plugin not available' };
    }

    const result = await RemNoteBridge.createFlashcards({
      flashcards, targetPath, sourceTitle, sourceUrl,
    });

    return { success: true, method: 'plugin', ...result };
  },

  /**
   * Get saved LLM configuration.
   */
  async 'REMADDER_GET_CONFIG'() {
    return await getFullConfig();
  },

  /**
   * Save LLM configuration.
   */
  async 'REMADDER_SAVE_CONFIG'(message) {
    await chrome.storage.local.set({ remadderConfig: message.payload });
    return { success: true };
  },

  /**
   * Test LLM connection.
   */
  async 'REMADDER_TEST_LLM'(message) {
    const { provider, apiKey, model, endpoint } = message.payload;
    return await LLMClient.testConnection({ provider, apiKey, model, endpoint });
  },

  /**
   * Plugin response forwarded from content script.
   */
  async 'REMADDER_PLUGIN_RESPONSE'(message) {
    RemNoteBridge.handlePluginResponse(message);
    return { handled: true };
  },
};

// ══════════════════════════════════════
// Helper Functions
// ══════════════════════════════════════

async function getLLMConfig() {
  const { remadderConfig } = await chrome.storage.local.get('remadderConfig');
  if (!remadderConfig) return null;

  const provider = remadderConfig.activeProvider;
  if (!provider) return null;

  const providerConfig = remadderConfig.providers?.[provider];
  if (!providerConfig) return null;

  // Local LLM may not need an API key
  if (provider !== 'local' && !providerConfig.apiKey) return null;

  return {
    provider,
    apiKey: providerConfig.apiKey || '',
    model: providerConfig.model || '',
    endpoint: providerConfig.endpoint || '',
  };
}

async function getFullConfig() {
  const { remadderConfig } = await chrome.storage.local.get('remadderConfig');
  return remadderConfig || {
    activeProvider: '',
    providers: {
      openai: { apiKey: '', model: 'gpt-4o-mini' },
      gemini: { apiKey: '', model: 'gemini-2.0-flash' },
      claude: { apiKey: '', model: 'claude-sonnet-4-20250514' },
      local: { apiKey: '', model: '', endpoint: 'http://localhost:1234/v1' },
    },
  };
}

function openSettingsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
}
