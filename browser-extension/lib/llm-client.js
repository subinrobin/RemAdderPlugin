/**
 * LLM Client — Unified API client for OpenAI, Gemini, Claude, and local LLMs.
 * All providers expose a single `sendPrompt()` interface.
 */

const LLMClient = {
  /**
   * Available providers with their models.
   * Linked from centralized properties.
   */
  PROVIDERS: AppProperties.providers,

  /**
   * Send a prompt to the configured LLM provider.
   * @param {object} config - { provider, apiKey, model, endpoint? }
   * @param {string} systemPrompt - System message
   * @param {string} userContent - User message content
   * @returns {Promise<string>} - LLM response text
   */
  async sendPrompt(config, systemPrompt, userContent) {
    const { provider, apiKey, model, endpoint, tokenLimit } = config;

    switch (provider) {
      case 'openai':
      case 'local':
        return this._callOpenAICompatible(config, systemPrompt, userContent);
      case 'gemini':
        return this._callGemini(config, systemPrompt, userContent);
      case 'claude':
        return this._callClaude(config, systemPrompt, userContent);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  },

  /**
   * Test connection to a provider.
   * @param {object} config - { provider, apiKey, model, endpoint? }
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async testConnection(config) {
    try {
      const response = await this.sendPrompt(
        config,
        'You are a test assistant.',
        'Reply with exactly: CONNECTION_OK'
      );
      const success = response && response.includes('CONNECTION_OK');
      return {
        success,
        message: success ? 'Connection successful!' : 'Connected but unexpected response.',
      };
    } catch (error) {
      return {
        success: false,
        message: this._formatError(config.provider, error),
      };
    }
  },

  /**
   * Fetch available models from the provider's API.
   * Falls back to hardcoded models if the API call fails or is not supported.
   * @param {object} config - { provider, apiKey, endpoint? }
   * @returns {Promise<Array<{id: string, name: string}>>}
   */
  async fetchModels(config) {
    const { provider, apiKey, endpoint } = config;
    try {
      if (provider === 'openai' || provider === 'local') {
        let url;
        if (provider === 'local') {
          if (!endpoint) return this.PROVIDERS.local.models;
          let base = endpoint.replace(/\/+$/, '');
          if (!base.match(/\/v\d+$/)) base += '/v1';
          url = `${base}/models`;
        } else {
          url = AppProperties.endpoints.openai.models;
        }

        const headers = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return (data.data || []).map(m => ({ id: m.id, name: m.id }));
      }

      if (provider === 'gemini') {
        if (!apiKey) return this.PROVIDERS.gemini.models;
        const url = AppProperties.endpoints.gemini.models(apiKey);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return (data.models || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => {
            const id = m.name.replace('models/', '');
            return { id, name: m.displayName || id, tokenLimit: m.inputTokenLimit };
          });
      }

      if (provider === 'claude') {
        if (!apiKey) return this.PROVIDERS.claude.models;
        const response = await fetch(AppProperties.endpoints.claude.models, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': AppProperties.endpoints.claude.version,
            'anthropic-dangerous-direct-browser-access': 'true',
          }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return (data.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
      }
    } catch (error) {
      console.warn(`Failed to fetch models for ${provider}:`, error);
      // Fallback to defaults
    }

    return this.PROVIDERS[provider]?.models || [];
  },

  /**
   * OpenAI-compatible API call (works for OpenAI and Local/LM Studio)
   */
  async _callOpenAICompatible(config, systemPrompt, userContent) {
    const { apiKey, model, endpoint, provider } = config;

    let url;
    if (provider === 'local') {
      let base = (endpoint || AppProperties.endpoints.local.defaultBase).replace(/\/+$/, '');
      // Auto-append /v1 if the endpoint doesn't already include it
      if (!base.match(/\/v\d+$/)) {
        base += '/v1';
      }
      url = `${base}/chat/completions`;
    } else {
      url = AppProperties.endpoints.openai.chat;
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    // Local LLMs may not need an API key
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (!model) throw new Error('No model selected. Please select a model in settings.');

    const body = {
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: AppProperties.defaults.temperature,
      max_tokens: AppProperties.defaults.maxTokens,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  },

  /**
   * Google Gemini API call
   */
  async _callGemini(config, systemPrompt, userContent) {
    const { apiKey, model } = config;
    if (!model) throw new Error('No model selected. Please select a model in settings.');
    
    const url = AppProperties.endpoints.gemini.chat(model, apiKey);

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        parts: [{ text: userContent }],
      }],
      generationConfig: {
        temperature: AppProperties.defaults.temperature,
        maxOutputTokens: AppProperties.defaults.maxTokens,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  },

  /**
   * Anthropic Claude API call
   */
  async _callClaude(config, systemPrompt, userContent) {
    const { apiKey, model } = config;
    if (!model) throw new Error('No model selected. Please select a model in settings.');

    const body = {
      model: model,
      temperature: AppProperties.defaults.temperature,
      max_tokens: AppProperties.defaults.maxTokens,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userContent },
      ],
    };

    const response = await fetch(AppProperties.endpoints.claude.chat, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': AppProperties.endpoints.claude.version,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
  },

  /**
   * Estimate max characters based on provider/model token limits.
   */
  getMaxChars(provider, model, dynamicTokenLimit) {
    // Rough estimate: 1 token ≈ 4 chars, reserve 4096 tokens for output
    const tokenLimit = dynamicTokenLimit || AppProperties.tokenLimits[model] || AppProperties.tokenLimits.default;
    // Use 60% of token limit for input, convert to chars
    return Math.floor(tokenLimit * 0.6 * 4);
  },

  /**
   * Format provider-specific error messages.
   */
  _formatError(provider, error) {
    const msg = error.message || 'Unknown error';

    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('invalid')) {
      return 'Invalid API key. Please check your key in settings.';
    }
    if (msg.includes('429') || msg.includes('rate')) {
      return 'Rate limit exceeded. Please wait a moment and try again.';
    }
    if (msg.includes('403') || msg.includes('Forbidden')) {
      return 'Access denied. Your API key may not have access to this model.';
    }
    if (msg.includes('network') || msg.includes('Failed to fetch') || msg.includes('ECONNREFUSED')) {
      if (provider === 'local') {
        return 'Cannot connect to endpoint. Please check the URL and ensure the server is reachable.';
      }
      return 'Network error. Please check your internet connection.';
    }

    return `Error: ${msg}`;
  },
};

// Make available globally in service worker context
if (typeof self !== 'undefined') {
  self.LLMClient = LLMClient;
}
