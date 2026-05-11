/**
 * Popup JS — Controls the main toolbar popup.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const providerDisplay = document.getElementById('provider-display');
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

  const PROVIDER_NAMES = {
    openai: '🟢 OpenAI',
    gemini: '🔵 Google Gemini',
    claude: '🟠 Anthropic Claude',
    local: '⚙️ Custom Endpoint'
  };

  let currentProvider = '';

  // ── Load saved config ──
  const config = await sendMessage({ type: 'REMADDER_GET_CONFIG' });

  if (config?.activeProvider) {
    currentProvider = config.activeProvider;
    if (providerDisplay) {
      providerDisplay.value = PROVIDER_NAMES[currentProvider] || currentProvider;
    }
    updateModelDropdown(currentProvider);
  } else {
    if (providerDisplay) {
      providerDisplay.value = 'Not configured';
    }
  }

  // ── Check plugin connection ──
  checkConnection();

  // ── Load last activity ──
  const { remadderActivity } = await chrome.storage.local.get('remadderActivity');
  if (remadderActivity) {
    activityLog.textContent = remadderActivity;
  }

  // ── Event Listeners ──

  modelSelect.addEventListener('change', async () => {
    if (currentProvider) {
      await saveProviderSelection(currentProvider, modelSelect.value);
    }
  });

  settingsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  summarizeBtn.addEventListener('click', handleSummarize);

  // ── Functions ──

  function updateModelDropdown(provider) {
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;

    // Fetch config for credentials
    sendMessage({ type: 'REMADDER_GET_CONFIG' }).then(async (config) => {
      const provConf = config?.providers?.[provider] || {};
      
      let models = MODELS[provider] || [];
      
      try {
        const result = await sendMessage({
          type: 'REMADDER_FETCH_MODELS',
          payload: {
            provider,
            apiKey: provConf.apiKey || '',
            endpoint: provConf.endpoint || ''
          }
        });
        if (result.models && result.models.length > 0) {
          models = result.models;
        }
      } catch (err) {
        console.warn('Could not fetch models dynamically:', err);
      }

      modelSelect.innerHTML = '';
      
      if (models.length === 0) {
        const opt = document.createElement('option');
        opt.value = 'custom';
        opt.textContent = 'Custom (set in settings)';
        modelSelect.appendChild(opt);
      } else {
        models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.tokenLimit 
            ? `${m.name} (${m.tokenLimit >= 1000000 ? (m.tokenLimit/1000000).toFixed(1).replace(/\\.0$/, '') + 'M' : Math.round(m.tokenLimit/1000) + 'k'} tokens)` 
            : m.name;
          if (m.tokenLimit) opt.dataset.tokenLimit = m.tokenLimit;
          modelSelect.appendChild(opt);
        });
      }

      // Restore selected model from config if it exists
      if (provConf.model) {
        // If the model is not in the list, add it
        if (!Array.from(modelSelect.options).some(o => o.value === provConf.model)) {
          const opt = document.createElement('option');
          opt.value = provConf.model;
          opt.textContent = provConf.tokenLimit 
            ? `${provConf.model} (${provConf.tokenLimit >= 1000000 ? (provConf.tokenLimit/1000000).toFixed(1).replace(/\\.0$/, '') + 'M' : Math.round(provConf.tokenLimit/1000) + 'k'} tokens)` 
            : provConf.model;
          if (provConf.tokenLimit) opt.dataset.tokenLimit = provConf.tokenLimit;
          modelSelect.appendChild(opt);
        }
        modelSelect.value = provConf.model;
      }
      
      modelSelect.disabled = false;
    });
  }

  async function saveProviderSelection(provider, model) {
    const config = await sendMessage({ type: 'REMADDER_GET_CONFIG' }) || {};
    config.activeProvider = provider;
    if (!config.providers) config.providers = {};
    if (!config.providers[provider]) config.providers[provider] = {};
    config.providers[provider].model = model;

    const selectedOption = modelSelect.options[modelSelect.selectedIndex];
    const tokenLimit = selectedOption?.dataset?.tokenLimit ? parseInt(selectedOption.dataset.tokenLimit, 10) : undefined;
    config.providers[provider].tokenLimit = tokenLimit;

    await sendMessage({ type: 'REMADDER_SAVE_CONFIG', payload: config });
  }

  async function handleSummarize() {
    hideError();

    // Validate config
    if (!currentProvider) {
      showError('Please select an LLM provider in settings.');
      return;
    }

    // Check if API key is set
    const currentConfig = await sendMessage({ type: 'REMADDER_GET_CONFIG' });
    const provConf = currentConfig?.providers?.[currentProvider];
    if (currentProvider !== 'local' && (!provConf || !provConf.apiKey)) {
      showError('API key not set. Please configure in settings.');
      return;
    }

    // Show processing state
    summarizeBtn.disabled = true;
    summarizeText.textContent = 'Processing...';
    showStatus('Extracting page content...', 'Reading the current page');

    try {
      updateStatus('Generating flashcards...', `Using ${PROVIDER_NAMES[currentProvider] || currentProvider}`);

      const result = await sendMessage({ type: 'REMADDER_SUMMARIZE_PAGE' });

      if (result.error) throw new Error(result.error);

      updateStatus('Opening preview...', `${result.flashcardData.flashcards.length} flashcards generated`);

      // Note: background script handles storage updates and tab creation
      // to ensure persistence if this popup is closed.
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
