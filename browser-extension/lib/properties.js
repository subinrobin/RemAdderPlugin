/**
 * Application Properties and Configuration Constants.
 * Centralized location for endpoint URLs, model definitions, and constraints.
 */

const AppProperties = {
  // ══════════════════════════════════════
  // API Endpoints
  // ══════════════════════════════════════
  endpoints: {
    openai: {
      base: 'https://api.openai.com/v1',
      chat: 'https://api.openai.com/v1/chat/completions',
      models: 'https://api.openai.com/v1/models',
    },
    gemini: {
      base: 'https://generativelanguage.googleapis.com/v1beta',
      chat: (modelId, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`,
      models: (apiKey) => `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    },
    claude: {
      base: 'https://api.anthropic.com/v1',
      chat: 'https://api.anthropic.com/v1/messages',
      models: 'https://api.anthropic.com/v1/models',
      version: '2023-06-01',
    },
    local: {
      defaultBase: 'http://localhost:1234/v1',
    }
  },

  // ══════════════════════════════════════
  // Supported Providers & Models
  // ══════════════════════════════════════
  providers: {
        openai: {
            id: 'openai',
            name: 'OpenAI',
            icon: '🟢',
            models: [],
        },
        gemini: {
            id: 'gemini',
            name: 'Google Gemini',
            icon: '🔵',
            models: [],
        },
        claude: {
            id: 'claude',
            name: 'Anthropic Claude',
            icon: '🟠',
            models: [],
        },
    local: {
      id: 'local',
      name: 'Local LLM',
      icon: '🖥️',
      models: [],
    },
  },

  // ══════════════════════════════════════
  // Token Limits (Context Windows)
  // ══════════════════════════════════════
  tokenLimits: {
    'gpt-4o-mini': 128000,
    'gpt-4o': 128000,
    'gpt-4-turbo': 128000,
    'gemini-2.0-flash': 1000000,
    'gemini-2.5-pro': 1000000,
    'claude-sonnet-4-20250514': 200000,
    'claude-3-5-haiku-20241022': 200000,
    default: 32000,
  },

  // ══════════════════════════════════════
  // Default Settings
  // ══════════════════════════════════════
  defaults: {
    temperature: 0.0,
    maxTokens: 4096,
  }
};

// Make available globally in service worker context
if (typeof self !== 'undefined') {
  self.AppProperties = AppProperties;
}
