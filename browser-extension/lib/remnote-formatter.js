/**
 * RemNote Formatter — Converts flashcard data to RemNote-pasteable text.
 * Used as fallback when companion plugin is not available.
 */

const RemNoteFormatter = {
  /**
   * Format flashcard data as RemNote-pasteable text.
   * @param {object} data - { suggestedPath, flashcards, sourceTitle, sourceUrl }
   * @returns {string} - Formatted text ready to paste into RemNote
   */
  formatForClipboard(data) {
    const lines = [];

    // Add folder path as nested headers
    if (data.suggestedPath && data.suggestedPath.length > 0) {
      const pathStr = data.suggestedPath.join(' > ');
      lines.push(`📁 Suggested path: ${pathStr}`);
      lines.push('');
    }

    // Add source attribution
    if (data.sourceTitle) {
      lines.push(`Source: ${data.sourceTitle}`);
      if (data.sourceUrl) lines.push(data.sourceUrl);
      lines.push('');
    }

    // Add flashcards
    for (const card of data.flashcards) {
      lines.push(this.formatCard(card));
    }

    return lines.join('\n');
  },

  /**
   * Format a single flashcard in RemNote syntax.
   */
  formatCard(card) {
    switch (card.type) {
      case 'basic':
        return `${card.front} >> ${card.back}`;
      case 'cloze':
        return card.text;
      case 'bidirectional':
        return `${card.front} <> ${card.back}`;
      default:
        if (card.front && card.back) return `${card.front} >> ${card.back}`;
        return card.text || '';
    }
  },

  /**
   * Format with indentation for hierarchical pasting.
   */
  formatHierarchical(data) {
    const lines = [];

    // Create nested path
    for (let i = 0; i < data.suggestedPath.length; i++) {
      const indent = '\t'.repeat(i);
      lines.push(`${indent}${data.suggestedPath[i]}`);
    }

    // Add flashcards under the deepest path
    const cardIndent = '\t'.repeat(data.suggestedPath.length);
    for (const card of data.flashcards) {
      lines.push(`${cardIndent}${this.formatCard(card)}`);
    }

    // Source reference
    if (data.sourceUrl) {
      lines.push(`${cardIndent}Source: ${data.sourceUrl}`);
    }

    return lines.join('\n');
  },
};

if (typeof self !== 'undefined') self.RemNoteFormatter = RemNoteFormatter;
