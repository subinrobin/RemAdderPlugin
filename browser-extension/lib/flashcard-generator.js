/**
 * Flashcard Generator — LLM prompt engineering and response parsing.
 * Generates RemNote-formatted flashcards from page content.
 */

const FlashcardGenerator = {
  SYSTEM_PROMPT: null,
  CONSOLIDATION_PROMPT: null,

  async _loadPrompts() {
    if (this.SYSTEM_PROMPT && this.CONSOLIDATION_PROMPT) return;

    try {
      const [system, consolidation] = await Promise.all([
        fetch(chrome.runtime.getURL('lib/system_prompt.md')).then((r) => r.text()),
        fetch(chrome.runtime.getURL('lib/consolidation_prompt.md')).then((r) => r.text()),
      ]);
      this.SYSTEM_PROMPT = system.trim();
      this.CONSOLIDATION_PROMPT = consolidation.trim();
    } catch (err) {
      console.error('Failed to load prompts from markdown files:', err);
      throw new Error('LLM Prompts could not be loaded. Please ensure prompts exist in lib/ directory.');
    }
  },

  async generateFromPage(pageData, llmConfig) {
    const basePrompt = `PAGE TITLE: ${pageData.title}\nURL: ${pageData.url}`;
    return this._generate(basePrompt, pageData.content, llmConfig, pageData);
  },

  async generateFromSelection(selectionData, llmConfig) {
    const basePrompt = `SOURCE PAGE: ${selectionData.title}\nURL: ${selectionData.url}\n${selectionData.context ? `CONTEXT: ${selectionData.context}\n` : ''}SELECTED TEXT:`;
    return this._generate(basePrompt, selectionData.selectedText, llmConfig, selectionData);
  },

  chunkText(text, maxChars) {
    if (!text) return [];
    if (text.length <= maxChars) return [text];

    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let currentChunk = '';

    for (const p of paragraphs) {
      if (currentChunk.length + p.length + 2 > maxChars) {
        if (currentChunk) chunks.push(currentChunk.trim());
        // If a single paragraph is longer than maxChars, we still push it (or we could sub-split, but keep it simple)
        if (p.length > maxChars) {
          chunks.push(p.trim());
          currentChunk = '';
        } else {
          currentChunk = p;
        }
      } else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + p : p;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());

    return chunks;
  },

  async _generate(basePrompt, textContent, llmConfig, sourceData) {
    await this._loadPrompts();
    const { provider, model, tokenLimit } = llmConfig;
    const maxChars = LLMClient.getMaxChars(provider, model, tokenLimit);

    // Estimate overhead for base prompt and system prompt
    const overhead = basePrompt.length + 500;
    const availableChars = Math.max(1000, maxChars - overhead);

    const chunks = this.chunkText(textContent, availableChars);

    // Map: Send prompts in parallel
    const promises = chunks.map(chunk => {
      const userPrompt = `${basePrompt}\n\nCONTENT SEGMENT:\n${chunk}`;
      return LLMClient.sendPrompt(llmConfig, this.SYSTEM_PROMPT, userPrompt)
        .then(res => this._parseResponse(res))
        .catch(err => {
          console.error('Failed to parse chunk:', err);
          return null; // Return null on failure for this chunk
        });
    });

    const results = await Promise.all(promises);

    // Reduce: Merge results
    let mergedFlashcards = [];
    let suggestedPath = ['Imported Notes'];

    for (const res of results) {
      if (res && res.flashcards) {
        mergedFlashcards = mergedFlashcards.concat(res.flashcards);
        if (res.suggestedPath && suggestedPath.length === 1 && suggestedPath[0] === 'Imported Notes') {
          suggestedPath = res.suggestedPath;
        }
      }
    }

    if (mergedFlashcards.length === 0) {
      throw new Error('No valid flashcards generated from content');
    }

    // Deduplication pass if there were multiple chunks
    if (chunks.length > 1) {
      const dedupePrompt = `Here is the JSON list of flashcards to consolidate:\n${JSON.stringify({ flashcards: mergedFlashcards }, null, 2)}`;
      try {
        const dedupeResponse = await LLMClient.sendPrompt(llmConfig, this.CONSOLIDATION_PROMPT, dedupePrompt);
        const dedupeParsed = this._parseResponse(dedupeResponse);
        if (dedupeParsed && dedupeParsed.flashcards && dedupeParsed.flashcards.length > 0) {
          mergedFlashcards = dedupeParsed.flashcards;
        }
      } catch (err) {
        console.warn('Deduplication pass failed, falling back to raw merged flashcards:', err);
      }
    }

    return {
      suggestedPath,
      flashcards: mergedFlashcards.map((card, i) => ({ ...card, id: `fc_${Date.now()}_${i}` })),
      sourceTitle: sourceData.title || '',
      sourceUrl: sourceData.url || ''
    };
  },

  _parseResponse(rawResponse) {
    if (!rawResponse) throw new Error('Empty response from LLM');

    let jsonStr = rawResponse.trim();

    // Remove markdown code blocks if present
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

    // Extract JSON object
    const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonObjMatch) jsonStr = jsonObjMatch[0];

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error(`Failed to parse LLM response as JSON: ${e.message}`);
    }

    if (!parsed.flashcards || !Array.isArray(parsed.flashcards)) {
      throw new Error('LLM response missing "flashcards" array');
    }

    parsed.flashcards = parsed.flashcards
      .map((card) => this._validateCard(card))
      .filter(Boolean);

    if (parsed.flashcards.length === 0) {
      throw new Error('No valid flashcards generated from content');
    }

    if (!Array.isArray(parsed.suggestedPath)) {
      parsed.suggestedPath = ['Imported Notes'];
    }

    return parsed;
  },

  _validateCard(card) {
    if (!card || typeof card !== 'object') return null;
    const type = card.type || 'basic';

    if (type === 'basic' && card.front && card.back) {
      return { type: 'basic', front: card.front.trim(), back: card.back.trim() };
    }

    if (type === 'bidirectional' && card.front && card.back) {
      return { type: 'bidirectional', front: card.front.trim(), back: card.back.trim() };
    }
    // Fallback: try as basic
    if (card.front && card.back) {
      return { type: 'basic', front: card.front.trim(), back: card.back.trim() };
    }
    return null;
  },
};

if (typeof self !== 'undefined') self.FlashcardGenerator = FlashcardGenerator;
