/**
 * Preview Page JS — Displays flashcards for review before adding to RemNote.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const sourceTitle = document.getElementById('source-title');
  const sourceUrl = document.getElementById('source-url');
  const cardCountBadge = document.getElementById('card-count-badge');
  const pathInput = document.getElementById('path-input');
  const pathBreadcrumb = document.getElementById('path-breadcrumb');
  const cardsSection = document.getElementById('cards-section');
  const addBtn = document.getElementById('add-btn');
  const copyBtn = document.getElementById('copy-btn');
  const connDot = document.getElementById('conn-dot');
  const connText = document.getElementById('conn-text');

  let flashcardData = null;
  let isPluginConnected = false;

  // ── Load pending flashcard data ──
  const { pendingFlashcards } = await chrome.storage.local.get('pendingFlashcards');

  if (!pendingFlashcards || !pendingFlashcards.flashcards) {
    cardsSection.innerHTML = '<div class="empty-state">No flashcards to preview. Use the extension popup to generate flashcards first.</div>';
    addBtn.disabled = true;
    return;
  }

  flashcardData = pendingFlashcards;

  // ── Populate UI ──
  sourceTitle.textContent = flashcardData.sourceTitle || 'Untitled Page';
  sourceUrl.textContent = flashcardData.sourceUrl || '';
  sourceUrl.href = flashcardData.sourceUrl || '#';

  // Path
  const path = flashcardData.suggestedPath || ['Imported Notes'];
  pathInput.value = path.join(' > ');
  renderBreadcrumb(path);

  // Cards
  renderCards(flashcardData.flashcards);
  updateCardCount();

  // Check plugin connection
  checkConnection();

  // ── Event Listeners ──

  pathInput.addEventListener('input', () => {
    const segments = pathInput.value.split('>').map(s => s.trim()).filter(Boolean);
    renderBreadcrumb(segments);
    flashcardData.suggestedPath = segments;
  });

  addBtn.addEventListener('click', handleAddToRemNote);
  copyBtn.addEventListener('click', handleCopyToClipboard);

  // ── Render Functions ──

  function renderBreadcrumb(segments) {
    pathBreadcrumb.innerHTML = '';
    segments.forEach((seg, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'path-separator';
        sep.textContent = '›';
        pathBreadcrumb.appendChild(sep);
      }
      const span = document.createElement('span');
      span.className = 'path-segment';
      span.textContent = `📁 ${seg}`;
      pathBreadcrumb.appendChild(span);
    });
  }

  function renderCards(cards) {
    cardsSection.innerHTML = '';
    cards.forEach((card) => {
      const el = createCardElement(card);
      cardsSection.appendChild(el);
    });
  }

  function createCardElement(card) {
    const div = document.createElement('div');
    div.className = `flashcard type-${card.type}`;
    div.dataset.id = card.id;

    const typeLabel = { basic: 'Basic', cloze: 'Cloze', bidirectional: 'Bidirectional' }[card.type] || 'Basic';

    let contentHTML = '';
    if (card.type === 'cloze') {
      const highlighted = card.text.replace(/\{\{(.+?)\}\}/g, '<span class="cloze-highlight">$1</span>');
      contentHTML = `<div class="flashcard-cloze">${highlighted}</div>`;
    } else {
      const arrow = card.type === 'bidirectional' ? '⟷' : '→';
      contentHTML = `
        <div class="flashcard-front">${escapeHTML(card.front)}</div>
        <div class="flashcard-divider"></div>
        <div class="flashcard-back">${arrow} ${escapeHTML(card.back)}</div>
      `;
    }

    div.innerHTML = `
      <div class="flashcard-header">
        <span class="flashcard-type">${typeLabel}</span>
        <div class="flashcard-actions">
          <button class="edit-btn" title="Edit">✏️</button>
          <button class="delete-btn" title="Delete">🗑️</button>
        </div>
      </div>
      ${contentHTML}
    `;

    // Delete handler
    div.querySelector('.delete-btn').addEventListener('click', () => {
      flashcardData.flashcards = flashcardData.flashcards.filter(c => c.id !== card.id);
      div.style.opacity = '0';
      div.style.transform = 'translateX(20px)';
      div.style.transition = 'all 0.3s ease';
      setTimeout(() => { div.remove(); updateCardCount(); }, 300);
    });

    // Edit handler
    div.querySelector('.edit-btn').addEventListener('click', () => {
      toggleEdit(div, card);
    });

    return div;
  }

  function toggleEdit(div, card) {
    const isEditing = div.classList.contains('editing');

    if (isEditing) {
      // Save edits
      if (card.type === 'cloze') {
        const input = div.querySelector('.edit-input');
        card.text = input.value;
      } else {
        const inputs = div.querySelectorAll('.edit-input');
        card.front = inputs[0].value;
        card.back = inputs[1].value;
      }
      // Update data
      const idx = flashcardData.flashcards.findIndex(c => c.id === card.id);
      if (idx >= 0) flashcardData.flashcards[idx] = card;

      // Re-render
      const newEl = createCardElement(card);
      div.replaceWith(newEl);
    } else {
      // Enter edit mode
      div.classList.add('editing');
      const contentArea = card.type === 'cloze'
        ? div.querySelector('.flashcard-cloze')
        : div.querySelector('.flashcard-front').parentElement;

      if (card.type === 'cloze') {
        const container = div.querySelector('.flashcard-cloze');
        container.innerHTML = `<textarea class="edit-input" rows="2">${escapeHTML(card.text)}</textarea>`;
      } else {
        const frontEl = div.querySelector('.flashcard-front');
        const backEl = div.querySelector('.flashcard-back');
        frontEl.innerHTML = `<textarea class="edit-input" rows="2">${escapeHTML(card.front)}</textarea>`;
        backEl.innerHTML = `<textarea class="edit-input" rows="2">${escapeHTML(card.back)}</textarea>`;
      }

      // Change edit button to save
      const editBtn = div.querySelector('.edit-btn');
      editBtn.textContent = '💾';
    }
  }

  function updateCardCount() {
    const count = flashcardData.flashcards.length;
    cardCountBadge.textContent = `${count} card${count !== 1 ? 's' : ''}`;
    addBtn.disabled = count === 0;
  }

  // ── Action Handlers ──

  async function handleAddToRemNote() {
    if (!flashcardData || flashcardData.flashcards.length === 0) return;

    addBtn.disabled = true;
    addBtn.innerHTML = '<div class="spinner spinner-sm"></div> Adding...';

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'REMADDER_CREATE_FLASHCARDS',
        payload: {
          flashcards: flashcardData.flashcards,
          targetPath: flashcardData.suggestedPath,
          sourceTitle: flashcardData.sourceTitle,
          sourceUrl: flashcardData.sourceUrl,
        },
      });

      if (result.success) {
        showToast(`✅ ${flashcardData.flashcards.length} flashcards added to RemNote!`, 'success');
        await chrome.storage.local.remove('pendingFlashcards');
        setTimeout(() => window.close(), 2000);
      } else {
        // Fallback to clipboard
        await copyToClipboard();
        showToast('📋 Copied to clipboard! Plugin not connected — paste into RemNote.', 'info');
      }
    } catch (error) {
      // Fallback to clipboard
      await copyToClipboard();
      showToast('📋 Copied to clipboard. Open RemNote and paste.', 'info');
    } finally {
      addBtn.disabled = false;
      addBtn.innerHTML = '<span>⚡</span> Add to RemNote';
    }
  }

  async function handleCopyToClipboard() {
    await copyToClipboard();
    showToast('📋 Flashcards copied to clipboard!', 'success');
  }

  async function copyToClipboard() {
    // Format as RemNote-pasteable text
    const lines = [];
    for (const card of flashcardData.flashcards) {
      if (card.type === 'basic') lines.push(`${card.front} >> ${card.back}`);
      else if (card.type === 'cloze') lines.push(card.text);
      else if (card.type === 'bidirectional') lines.push(`${card.front} <> ${card.back}`);
    }
    const text = lines.join('\n');
    await navigator.clipboard.writeText(text);
  }

  async function checkConnection() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'REMADDER_GET_STATUS' });
      isPluginConnected = result?.pluginConnected || false;
      connDot.className = `status-dot ${isPluginConnected ? 'connected' : 'disconnected'}`;
      connText.textContent = isPluginConnected ? 'Plugin connected' : 'Plugin not connected';

      if (!isPluginConnected) {
        addBtn.innerHTML = '<span>📋</span> Copy & Add to RemNote';
      }
    } catch {
      connDot.className = 'status-dot disconnected';
      connText.textContent = 'Not connected';
    }
  }

  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
