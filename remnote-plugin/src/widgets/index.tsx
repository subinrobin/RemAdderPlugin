import { declareIndexPlugin, type ReactRNPlugin, WidgetLocation } from '@remnote/plugin-sdk';
import '../style.css';
import '../index.css';

const REMADDER_PREFIX = 'REMADDER_';

async function onActivate(plugin: ReactRNPlugin) {
  // Register a sidebar widget to show connection status
  await plugin.app.registerWidget('remadder_bridge', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });

  // Show activation toast
  await plugin.app.toast('RemAdder Bridge — Active ✅');

  // Set up the postMessage listener for browser extension communication
  setupMessageBridge(plugin);
}

async function onDeactivate(_: ReactRNPlugin) {}

declareIndexPlugin(onActivate, onDeactivate);

// ═══════════════════════════════════════════
// Message Bridge
// ═══════════════════════════════════════════

function setupMessageBridge(plugin: ReactRNPlugin) {
  window.addEventListener('message', async (event: MessageEvent) => {
    if (!event.data || event.data.type !== `${REMADDER_PREFIX}TO_PLUGIN`) return;

    const { requestId, action, payload } = event.data;

    try {
      let response: any;

      switch (action) {
        case 'PING':
          response = { status: 'PONG', version: '1.0.0' };
          break;

        case 'GET_FOLDERS':
          response = await handleGetFolders(plugin, payload?.maxDepth || 3);
          break;

        case 'CREATE_FLASHCARDS':
          response = await handleCreateFlashcards(plugin, payload);
          break;

        default:
          response = { error: `Unknown action: ${action}` };
      }

      // Respond back to content script
      window.parent.postMessage({
        type: `${REMADDER_PREFIX}FROM_PLUGIN`,
        requestId,
        response,
      }, '*');

    } catch (error: any) {
      window.parent.postMessage({
        type: `${REMADDER_PREFIX}FROM_PLUGIN`,
        requestId,
        error: error.message || 'Unknown error in plugin',
      }, '*');
    }
  });
}

// ═══════════════════════════════════════════
// GET_FOLDERS Handler
// ═══════════════════════════════════════════

interface FolderNode {
  id: string;
  name: string;
  children: FolderNode[];
}

async function handleGetFolders(plugin: ReactRNPlugin, maxDepth: number) {
  const tree = await getFolderTree(plugin, maxDepth);
  return { folders: tree };
}

async function getFolderTree(plugin: ReactRNPlugin, maxDepth: number): Promise<FolderNode[]> {
  try {
    const topLevel = await plugin.rem.getAll();
    if (!topLevel || topLevel.length === 0) return [];

    const folders: FolderNode[] = [];

    for (const rem of topLevel) {
      const textArr = rem.text;
      if (!textArr || textArr.length === 0) continue;

      const name = textArr.map((t: any) => (typeof t === 'string' ? t : '')).join('').trim();
      if (!name) continue;

      const children = rem.children || [];
      const childNodes = (children.length > 0 && maxDepth > 1)
        ? await traverseChildren(plugin, children, 1, maxDepth)
        : [];

      folders.push({ id: rem._id, name, children: childNodes });
      if (folders.length >= 50) break;
    }

    return folders;
  } catch (error) {
    console.error('[RemAdder] Failed to get folder tree:', error);
    return [];
  }
}

async function traverseChildren(
  plugin: ReactRNPlugin,
  childIds: string[],
  depth: number,
  maxDepth: number
): Promise<FolderNode[]> {
  if (depth >= maxDepth) return [];
  const nodes: FolderNode[] = [];

  for (const childId of childIds) {
    try {
      const rem = await plugin.rem.findOne(childId);
      if (!rem) continue;

      const textArr = rem.text;
      if (!textArr || textArr.length === 0) continue;

      const name = textArr.map((t: any) => (typeof t === 'string' ? t : '')).join('').trim();
      if (!name) continue;

      const grandChildren = rem.children || [];
      const childNodes = (grandChildren.length > 0 && depth + 1 < maxDepth)
        ? await traverseChildren(plugin, grandChildren, depth + 1, maxDepth)
        : [];

      nodes.push({ id: rem._id, name, children: childNodes });
      if (nodes.length >= 30) break;
    } catch {
      continue;
    }
  }
  return nodes;
}

// ═══════════════════════════════════════════
// CREATE_FLASHCARDS Handler
// ═══════════════════════════════════════════

async function handleCreateFlashcards(
  plugin: ReactRNPlugin,
  payload: {
    flashcards: Array<{ type: string; front?: string; back?: string; text?: string }>;
    targetPath: string[];
    sourceTitle: string;
    sourceUrl: string;
  }
) {
  const { flashcards, targetPath, sourceTitle } = payload;

  // Find or create the folder hierarchy
  const parentRemId = await findOrCreatePath(plugin, targetPath);

  // Create each flashcard
  let created = 0;
  for (const card of flashcards) {
    try {
      if (card.type === 'cloze' && card.text) {
        const clozeRem = await plugin.rem.createWithMarkdown(card.text);
        if (clozeRem && parentRemId) {
          await clozeRem.setParent(parentRemId);
        }
        created++;
      } else if (card.front && card.back) {
        const rem = await plugin.rem.createRem();
        if (rem) {
          await rem.setText([card.front]);
          await rem.setBackText([card.back]);
          if (parentRemId) {
            await rem.setParent(parentRemId);
          }
          created++;
        }
      }
    } catch (err) {
      console.error('[RemAdder] Failed to create card:', err, card);
    }
  }

  await plugin.app.toast(`RemAdder: ${created} flashcards added from "${sourceTitle}" ✅`);

  return { success: true, createdCount: created, targetPath };
}

async function findOrCreatePath(plugin: ReactRNPlugin, segments: string[]): Promise<string | null> {
  if (!segments || segments.length === 0) return null;

  let parentId: string | null = null;

  for (const segment of segments) {
    const existing = await plugin.rem.findByName([segment], parentId ?? null);

    if (existing) {
      parentId = existing._id;
    } else {
      const newRem = await plugin.rem.createRem();
      if (!newRem) throw new Error(`Failed to create Rem for: ${segment}`);

      await newRem.setText([segment]);
      // Mark as Document so it appears in the sidebar
      await newRem.setIsDocument(true);
      if (parentId) {
        await newRem.setParent(parentId);
      }
      parentId = newRem._id;
    }
  }

  return parentId;
}
