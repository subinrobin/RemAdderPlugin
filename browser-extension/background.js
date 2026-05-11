/**
 * Background Service Worker — Orchestrates all extension flows.
 */

// Import libraries (service worker scope)
importScripts(
  'lib/properties.js',
  'lib/llm-client.js',
  'lib/flashcard-generator.js',
  'lib/remnote-formatter.js',
  'lib/remnote-bridge.js'
);

// ══════════════════════════════════════
// Task Management
// ══════════════════════════════════════

const TaskManager = {
  async getTasks() {
    const { remadderTasks } = await chrome.storage.local.get('remadderTasks');
    return remadderTasks || [];
  },

  async addTask(task) {
    const tasks = await this.getTasks();
    const newTask = {
      id: Math.random().toString(36).substr(2, 9),
      startTime: Date.now(),
      status: 'in_progress',
      ...task
    };
    tasks.unshift(newTask);
    // Keep last 10 tasks
    const trimmed = tasks.slice(0, 10);
    await chrome.storage.local.set({ remadderTasks: trimmed });
    return newTask.id;
  },

  async updateTask(id, updates) {
    const tasks = await this.getTasks();
    const index = tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      const task = tasks[index];
      const isFinishing = (updates.status === 'completed' || updates.status === 'failed') && task.status === 'in_progress';
      
      tasks[index] = { 
        ...task, 
        ...updates,
        endTime: isFinishing ? Date.now() : task.endTime
      };
      await chrome.storage.local.set({ remadderTasks: tasks });
    }
  },

  async clearTasks() {
    await chrome.storage.local.set({ remadderTasks: [] });
  }
};

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

  const taskId = await TaskManager.addTask({
    type: 'summarize', // Reusing summarize type as it's card generation
    title: tab.title || 'Selected Text',
    detail: 'Extracting selection...'
  });

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

    if (!result?.result) {
      await TaskManager.updateTask(taskId, { status: 'failed', detail: 'No text selected' });
      return;
    }

    const selectionData = result.result;
    await TaskManager.updateTask(taskId, { detail: 'Generating flashcards...' });

    // Get LLM config
    const config = await getLLMConfig();
    if (!config) {
      await TaskManager.updateTask(taskId, { status: 'failed', detail: 'LLM not configured' });
      openSettingsPage();
      return;
    }

    // Generate flashcards
    const flashcardData = await FlashcardGenerator.generateFromSelection(selectionData, config);

    // Store and open preview
    await chrome.storage.local.set({ pendingFlashcards: flashcardData });

    await TaskManager.updateTask(taskId, { 
      status: 'completed', 
      detail: `${flashcardData.flashcards.length} cards generated from selection`,
      resultSummary: `${flashcardData.flashcards.length} cards`
    });

    chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });

  } catch (error) {
    console.error('RemAdder context menu error:', error);
    await TaskManager.updateTask(taskId, { 
      status: 'failed', 
      detail: error.message 
    });
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

    const taskId = await TaskManager.addTask({
      type: 'summarize',
      title: tab.title || 'Unknown Page',
      detail: 'Extracting content...'
    });

    try {
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

      await TaskManager.updateTask(taskId, { detail: 'Generating flashcards...' });

      // Get LLM config
      const config = await getLLMConfig();
      if (!config) throw new Error('LLM not configured. Please set up in settings.');

      // Generate flashcards
      const flashcardData = await FlashcardGenerator.generateFromPage(pageData, config);

      // Store for preview page
      await chrome.storage.local.set({ pendingFlashcards: flashcardData });

      // Save activity log (legacy - kept for compatibility)
      const activity = `${flashcardData.flashcards.length} cards from "${flashcardData.sourceTitle}" — just now`;
      await chrome.storage.local.set({ remadderActivity: activity });

      await TaskManager.updateTask(taskId, { 
        status: 'completed', 
        detail: `${flashcardData.flashcards.length} cards generated`,
        resultSummary: `${flashcardData.flashcards.length} cards`
      });

      // Open preview page
      chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });

      return { success: true, flashcardData };
    } catch (error) {
      await TaskManager.updateTask(taskId, { 
        status: 'failed', 
        detail: error.message 
      });
      throw error;
    }
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

    const taskId = await TaskManager.addTask({
      type: 'create_cards',
      title: sourceTitle || 'New Flashcards',
      detail: 'Connecting to RemNote...'
    });

    try {
      const connected = await RemNoteBridge.ensureConnection();
      if (!connected) {
        throw new Error('RemNote plugin not available');
      }

      await TaskManager.updateTask(taskId, { detail: `Sending ${flashcards.length} cards...` });

      const result = await RemNoteBridge.createFlashcards({
        flashcards, targetPath, sourceTitle, sourceUrl,
      });

      await TaskManager.updateTask(taskId, { 
        status: 'completed', 
        detail: `Successfully added to ${targetPath.length > 0 ? targetPath[targetPath.length-1].name : 'Home'}`,
        resultSummary: 'Added to RemNote'
      });

      return { success: true, method: 'plugin', ...result };
    } catch (error) {
      await TaskManager.updateTask(taskId, { 
        status: 'failed', 
        detail: error.message 
      });
      
      // Fallback: copy to clipboard (legacy behavior)
      if (error.message === 'RemNote plugin not available') {
        return { success: false, method: 'clipboard', message: 'Plugin not available' };
      }
      throw error;
    }
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

  /**
   * Fetch models from provider API.
   */
  async 'REMADDER_FETCH_MODELS'(message) {
    const { provider, apiKey, endpoint } = message.payload;
    const models = await LLMClient.fetchModels({ provider, apiKey, endpoint });
    return { models };
  },

  /**
   * Clear all background tasks.
   */
  async 'REMADDER_CLEAR_TASKS'() {
    await TaskManager.clearTasks();
    return { success: true };
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
    tokenLimit: providerConfig.tokenLimit,
  };
}

async function getFullConfig() {
  const { remadderConfig } = await chrome.storage.local.get('remadderConfig');
  return remadderConfig || {
    activeProvider: '',
    providers: {
      openai: { apiKey: '', model: '' },
      gemini: { apiKey: '', model: '' },
      claude: { apiKey: '', model: '' },
      local: { apiKey: '', model: '', endpoint: AppProperties.endpoints.local.defaultBase },
    },
  };
}

function openSettingsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
}
