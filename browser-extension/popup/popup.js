/**
 * Popup JS — Controls the main toolbar popup.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const summarizeBtn = document.getElementById('summarize-btn');
  const summarizeText = document.getElementById('summarize-text');
  const statusArea = document.getElementById('status-area');
  const statusTitle = document.getElementById('status-title');
  const statusDetail = document.getElementById('status-detail');
  const errorArea = document.getElementById('error-area');
  const errorText = document.getElementById('error-text');
  const statusDot = document.getElementById('status-dot');
  const statusTextEl = document.getElementById('status-text');
  const settingsBtn = document.getElementById('settings-btn');
  const activityLog = document.getElementById('activity-log');

  // Model lists per provider
  const MODELS = {
    openai: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    ],
    gemini: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    ],
    claude: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    ],
    local: [],
  };

  // ── Load saved config ──
  const config = await sendMessage({ type: 'REMADDER_GET_CONFIG' });

  if (config?.activeProvider) {
    providerSelect.value = config.activeProvider;
    updateModelDropdown(config.activeProvider);
    const provConf = config.providers?.[config.activeProvider];
    if (provConf?.model) modelSelect.value = provConf.model;
  }

  // ── Check plugin connection ──
  checkConnection();

  // ── Load last activity ──
  const { remadderActivity } = await chrome.storage.local.get('remadderActivity');
  if (remadderActivity) {
    activityLog.textContent = remadderActivity;
  }

  // ── Event Listeners ──

  providerSelect.addEventListener('change', async () => {
    const provider = providerSelect.value;
    updateModelDropdown(provider);
    await saveProviderSelection(provider, modelSelect.value);
  });

  modelSelect.addEventListener('change', async () => {
    await saveProviderSelection(providerSelect.value, modelSelect.value);
  });

  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  summarizeBtn.addEventListener('click', handleSummarize);

  // ── Functions ──

  function updateModelDropdown(provider) {
    modelSelect.innerHTML = '';
    const models = MODELS[provider] || [];

    if (provider === 'local') {
      const opt = document.createElement('option');
      opt.value = 'custom';
      opt.textContent = 'Custom (set in settings)';
      modelSelect.appendChild(opt);
      return;
    }

    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelSelect.appendChild(opt);
    });
  }

  async function saveProviderSelection(provider, model) {
    const config = await sendMessage({ type: 'REMADDER_GET_CONFIG' }) || {};
    config.activeProvider = provider;
    if (!config.providers) config.providers = {};
    if (!config.providers[provider]) config.providers[provider] = {};
    config.providers[provider].model = model;
    await sendMessage({ type: 'REMADDER_SAVE_CONFIG', payload: config });
  }

  async function handleSummarize() {
    hideError();

    // Validate config
    if (!providerSelect.value) {
      showError('Please select an LLM provider.');
      return;
    }

    // Check if API key is set
    const currentConfig = await sendMessage({ type: 'REMADDER_GET_CONFIG' });
    const provConf = currentConfig?.providers?.[providerSelect.value];
    if (providerSelect.value !== 'local' && (!provConf || !provConf.apiKey)) {
      showError('API key not set. Please configure in settings.');
      return;
    }

    // Show processing state
    summarizeBtn.disabled = true;
    summarizeText.textContent = 'Processing...';
    showStatus('Extracting page content...', 'Reading the current page');

    try {
      updateStatus('Generating flashcards...', `Using ${providerSelect.options[providerSelect.selectedIndex].text}`);

      const result = await sendMessage({ type: 'REMADDER_SUMMARIZE_PAGE' });

      if (result.error) throw new Error(result.error);

      updateStatus('Opening preview...', `${result.flashcardData.flashcards.length} flashcards generated`);

      // Save activity
      const activity = `${result.flashcardData.flashcards.length} cards from "${result.flashcardData.sourceTitle}" — just now`;
      await chrome.storage.local.set({ remadderActivity: activity });

      // Open preview page
      chrome.tabs.create({ url: chrome.runtime.getURL('preview/preview.html') });

      // Close popup after a short delay
      setTimeout(() => window.close(), 500);

    } catch (error) {
      showError(error.message);
    } finally {
      summarizeBtn.disabled = false;
      summarizeText.textContent = 'Summarize This Page';
      hideStatus();
    }
  }

  async function checkConnection() {
    try {
      const result = await sendMessage({ type: 'REMADDER_GET_STATUS' });
      if (result?.pluginConnected) {
        statusDot.className = 'status-dot connected';
        statusTextEl.textContent = 'RemNote connected';
      } else {
        statusDot.className = 'status-dot disconnected';
        statusTextEl.textContent = 'RemNote not connected';
      }
    } catch {
      statusDot.className = 'status-dot disconnected';
      statusTextEl.textContent = 'RemNote not connected';
    }
  }

  function showStatus(title, detail) {
    statusArea.classList.remove('hidden');
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  }

  function updateStatus(title, detail) {
    statusTitle.textContent = title;
    statusDetail.textContent = detail;
  }

  function hideStatus() {
    statusArea.classList.add('hidden');
  }

  function showError(msg) {
    errorArea.classList.remove('hidden');
    errorText.textContent = msg;
  }

  function hideError() {
    errorArea.classList.add('hidden');
  }

  function sendMessage(msg) {
    return chrome.runtime.sendMessage(msg);
  }
});
