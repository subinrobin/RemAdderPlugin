/**
 * Flashcard Generator — LLM prompt engineering and response parsing.
 * Generates RemNote-formatted flashcards from page content.
 */

const FlashcardGenerator = {
  SYSTEM_PROMPT: `You are an expert educator and spaced-repetition flashcard creator. Analyze web page content and create high-quality flashcards for long-term retention.

INSTRUCTIONS:
1. Identify important concepts, definitions, facts, processes worth remembering.
2. Create flashcards using a mix of types:
   - "basic": Question-answer for definitions, facts, concepts
   - "cloze": Fill-in-the-blank for key terms within statements
   - "bidirectional": Two-way cards for terms recalled both directions
3. Auto-select best type per item. Keep cards concise but complete.
4. Suggest a hierarchical folder path (e.g., ["Computer Science", "Algorithms"]).
5. Generate 3-15 flashcards depending on content richness.

OUTPUT: Respond with valid JSON ONLY. No markdown, no explanation:
{
  "suggestedPath": ["Topic", "Subtopic"],
  "flashcards": [
    { "type": "basic", "front": "What is X?", "back": "X is..." },
    { "type": "cloze", "text": "X involves {{key term}} which..." },
    { "type": "bidirectional", "front": "Term", "back": "Definition" }
  ]
}`,

  async generateFromPage(pageData, llmConfig) {
    const userPrompt = `PAGE TITLE: ${pageData.title}\nURL: ${pageData.url}\n\nPAGE CONTENT:\n${pageData.content}`;
    return this._generate(userPrompt, llmConfig, pageData);
  },

  async generateFromSelection(selectionData, llmConfig) {
    const userPrompt = `SOURCE PAGE: ${selectionData.title}\nURL: ${selectionData.url}\n${selectionData.context ? `CONTEXT: ${selectionData.context}\n` : ''}\nSELECTED TEXT (create flashcards ONLY from this):\n${selectionData.selectedText}`;
    return this._generate(userPrompt, llmConfig, selectionData);
  },

  async _generate(userPrompt, llmConfig, sourceData) {
    const rawResponse = await LLMClient.sendPrompt(llmConfig, this.SYSTEM_PROMPT, userPrompt);
    const parsed = this._parseResponse(rawResponse);
    parsed.sourceTitle = sourceData.title || '';
    parsed.sourceUrl = sourceData.url || '';
    return parsed;
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
      .filter(Boolean)
      .map((card, i) => ({ ...card, id: `fc_${Date.now()}_${i}` }));

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
    if (type === 'cloze' && card.text && card.text.includes('{{') && card.text.includes('}}')) {
      return { type: 'cloze', text: card.text.trim() };
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
