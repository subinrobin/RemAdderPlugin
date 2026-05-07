/**
 * LLM Client — Unified API client for OpenAI, Gemini, Claude, and local LLMs.
 * All providers expose a single `sendPrompt()` interface.
 */

const LLMClient = {
  /**
   * Available providers with their models.
   * Used to populate dropdowns in settings.
   */
  PROVIDERS: {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      icon: '🟢',
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', default: true },
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      ],
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      icon: '🔵',
      models: [
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', default: true },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      ],
      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/',
    },
    claude: {
      id: 'claude',
      name: 'Anthropic Claude',
      icon: '🟠',
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', default: true },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      ],
      endpoint: 'https://api.anthropic.com/v1/messages',
    },
    local: {
      id: 'local',
      name: 'Local LLM',
      icon: '🖥️',
      models: [],
      endpoint: '', // User configured
    },
  },

  /**
   * Send a prompt to the configured LLM provider.
   * @param {object} config - { provider, apiKey, model, endpoint? }
   * @param {string} systemPrompt - System message
   * @param {string} userContent - User message content
   * @returns {Promise<string>} - LLM response text
   */
  async sendPrompt(config, systemPrompt, userContent) {
    const { provider, apiKey, model, endpoint } = config;

    // Truncate content to avoid token limits
    const maxChars = this._getMaxChars(provider, model);
    const truncatedContent = userContent.length > maxChars
      ? userContent.substring(0, maxChars) + '\n\n[Content truncated due to length]'
      : userContent;

    switch (provider) {
      case 'openai':
      case 'local':
        return this._callOpenAICompatible(config, systemPrompt, truncatedContent);
      case 'gemini':
        return this._callGemini(config, systemPrompt, truncatedContent);
      case 'claude':
        return this._callClaude(config, systemPrompt, truncatedContent);
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
   * OpenAI-compatible API call (works for OpenAI and Local/LM Studio)
   */
  async _callOpenAICompatible(config, systemPrompt, userContent) {
    const { apiKey, model, endpoint, provider } = config;

    let url;
    if (provider === 'local') {
      let base = (endpoint || 'http://localhost:1234/v1').replace(/\/+$/, '');
      // Auto-append /v1 if the endpoint doesn't already include it
      if (!base.match(/\/v\d+$/)) {
        base += '/v1';
      }
      url = `${base}/chat/completions`;
    } else {
      url = 'https://api.openai.com/v1/chat/completions';
    }

    const headers = {
      'Content-Type': 'application/json',
    };

    // Local LLMs may not need an API key
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body = {
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 4096,
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
    const modelId = model || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [{
        parts: [{ text: userContent }],
      }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
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

    const body = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userContent },
      ],
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
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
  _getMaxChars(provider, model) {
    // Rough estimate: 1 token ≈ 4 chars, reserve 4096 tokens for output
    const limits = {
      'gpt-4o-mini': 128000,
      'gpt-4o': 128000,
      'gpt-4-turbo': 128000,
      'gemini-2.0-flash': 1000000,
      'gemini-2.5-pro': 1000000,
      'claude-sonnet-4-20250514': 200000,
      'claude-3-5-haiku-20241022': 200000,
    };

    const tokenLimit = limits[model] || 32000;
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
