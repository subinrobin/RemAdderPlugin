/**
 * Settings Page JS — Manages API keys, model selection, and connections.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const activeProvider = document.getElementById('active-provider');
  const providerConfigs = document.querySelectorAll('.provider-config');
  const saveBtn = document.getElementById('save-btn');
  const checkRemNoteBtn = document.getElementById('check-remnote-btn');
  const remnoteStatusDot = document.getElementById('remnote-status-dot');
  const remnoteStatusText = document.getElementById('remnote-status-text');

  // ── Load saved config ──
  const config = await sendMessage({ type: 'REMADDER_GET_CONFIG' });

  if (config) {
    activeProvider.value = config.activeProvider || '';
    showProviderConfig(config.activeProvider);

    // Populate saved values
    Object.entries(config.providers || {}).forEach(([provider, conf]) => {
      const keyInput = document.querySelector(`.api-key-input[data-provider="${provider}"]`);
      if (keyInput && conf.apiKey) keyInput.value = conf.apiKey;

      const modelSelect = document.querySelector(`.model-select[data-provider="${provider}"]`);
      if (modelSelect && conf.model) {
        // If the saved model isn't in the options yet, add it
        if (!Array.from(modelSelect.options).some(opt => opt.value === conf.model)) {
          const opt = document.createElement('option');
          opt.value = conf.model;
          opt.textContent = conf.tokenLimit 
            ? `${conf.model} (${conf.tokenLimit >= 1000000 ? (conf.tokenLimit/1000000).toFixed(1).replace(/\\.0$/, '') + 'M' : Math.round(conf.tokenLimit/1000) + 'k'} tokens)` 
            : conf.model;
          if (conf.tokenLimit) opt.dataset.tokenLimit = conf.tokenLimit;
          modelSelect.appendChild(opt);
        }
        modelSelect.value = conf.model;
      }

      const endpointInput = document.querySelector(`.endpoint-input[data-provider="${provider}"]`);
      if (endpointInput && conf.endpoint) endpointInput.value = conf.endpoint;
    });
  }

  // ── Event Listeners ──

  activeProvider.addEventListener('change', () => {
    showProviderConfig(activeProvider.value);
  });

  // Toggle password visibility
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });
  });

  // Test connection buttons
  document.querySelectorAll('.test-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const provider = btn.dataset.provider;
      await testConnection(provider);
    });
  });

  // Fetch models buttons
  document.querySelectorAll('.fetch-models-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); // In case it's in a form
      const provider = btn.dataset.provider;
      await fetchModels(provider);
    });
  });

  // Save
  saveBtn.addEventListener('click', handleSave);

  // Check RemNote
  checkRemNoteBtn.addEventListener('click', checkRemNote);

  // ── Functions ──

  function showProviderConfig(provider) {
    providerConfigs.forEach(el => {
      el.classList.toggle('active', el.dataset.provider === provider);
    });
  }

  async function handleSave() {
    const newConfig = {
      activeProvider: activeProvider.value,
      providers: {},
    };

    ['openai', 'gemini', 'claude', 'local'].forEach(provider => {
      const keyInput = document.querySelector(`.api-key-input[data-provider="${provider}"]`);
      const modelSelect = document.querySelector(`.model-select[data-provider="${provider}"]`);
      const endpointInput = document.querySelector(`.endpoint-input[data-provider="${provider}"]`);

      const selectedOption = modelSelect?.options[modelSelect.selectedIndex];
      const tokenLimit = selectedOption?.dataset?.tokenLimit ? parseInt(selectedOption.dataset.tokenLimit, 10) : undefined;

      newConfig.providers[provider] = {
        apiKey: keyInput?.value || '',
        model: modelSelect?.value || '',
        endpoint: endpointInput?.value || '',
        tokenLimit: tokenLimit,
      };
    });

    await sendMessage({ type: 'REMADDER_SAVE_CONFIG', payload: newConfig });

    showToast('Settings saved!');
  }

  async function testConnection(provider) {
    const resultEl = document.querySelector(`.test-result[data-provider="${provider}"]`);
    const btn = document.querySelector(`.test-btn[data-provider="${provider}"]`);

    resultEl.textContent = 'Testing...';
    resultEl.className = 'test-result loading';
    btn.disabled = true;

    const keyInput = document.querySelector(`.api-key-input[data-provider="${provider}"]`);
    const modelSelect = document.querySelector(`.model-select[data-provider="${provider}"]`);
    const endpointInput = document.querySelector(`.endpoint-input[data-provider="${provider}"]`);

    const testConfig = {
      provider,
      apiKey: keyInput?.value || '',
      model: modelSelect?.value || '',
      endpoint: endpointInput?.value || '',
    };

    try {
      const result = await sendMessage({ type: 'REMADDER_TEST_LLM', payload: testConfig });
      resultEl.textContent = result.success ? '✅ Working!' : `❌ ${result.message}`;
      resultEl.className = `test-result ${result.success ? 'success' : 'error'}`;
    } catch (error) {
      resultEl.textContent = `❌ ${error.message}`;
      resultEl.className = 'test-result error';
    }

    btn.disabled = false;
  }

  async function fetchModels(provider) {
    const btn = document.querySelector(`.fetch-models-btn[data-provider="${provider}"]`);
    const select = document.querySelector(`.model-select[data-provider="${provider}"]`);
    const keyInput = document.querySelector(`.api-key-input[data-provider="${provider}"]`);
    const endpointInput = document.querySelector(`.endpoint-input[data-provider="${provider}"]`);

    const originalText = btn.textContent;
    btn.textContent = '⏳';
    btn.disabled = true;

    try {
      const result = await sendMessage({
        type: 'REMADDER_FETCH_MODELS',
        payload: {
          provider,
          apiKey: keyInput?.value || '',
          endpoint: endpointInput?.value || ''
        }
      });

      if (result.models && result.models.length > 0) {
        const currentValue = select.value;
        select.innerHTML = ''; // clear current options

        result.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = m.tokenLimit 
            ? `${m.name} (${m.tokenLimit >= 1000000 ? (m.tokenLimit/1000000).toFixed(1).replace(/\\.0$/, '') + 'M' : Math.round(m.tokenLimit/1000) + 'k'} tokens)` 
            : m.name;
          if (m.tokenLimit) opt.dataset.tokenLimit = m.tokenLimit;
          select.appendChild(opt);
        });

        // Restore previous value if it exists in the new list
        if (result.models.some(m => m.id === currentValue)) {
          select.value = currentValue;
        }

        showToast(`Fetched ${result.models.length} models successfully!`);
      } else {
        showToast('No models returned from the API.');
      }
    } catch (error) {
      showToast('Error fetching models: ' + error.message);
    }

    btn.textContent = originalText;
    btn.disabled = false;
  }

  async function checkRemNote() {
    checkRemNoteBtn.disabled = true;
    remnoteStatusText.textContent = 'Checking...';

    try {
      const result = await sendMessage({ type: 'REMADDER_GET_STATUS' });
      if (result?.pluginConnected) {
        remnoteStatusDot.className = 'status-dot connected';
        remnoteStatusText.textContent = 'Connected to RemNote!';
      } else {
        remnoteStatusDot.className = 'status-dot disconnected';
        remnoteStatusText.textContent = 'Not connected. Is RemNote open with the plugin installed?';
      }
    } catch {
      remnoteStatusDot.className = 'status-dot disconnected';
      remnoteStatusText.textContent = 'Connection check failed.';
    }

    checkRemNoteBtn.disabled = false;
  }

  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function sendMessage(msg) {
    return chrome.runtime.sendMessage(msg);
  }
});
