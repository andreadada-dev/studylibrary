// Recoverable, user-scoped editor drafts + bounded undo history.
// Only browser storage is used; no draft is automatically published.
export function editorDraftKey(userId, catalogRef = 'new') {
  if (!userId) throw new Error('User ID richiesto');
  return 'studylibrary:editor-draft:v1:' + encodeURIComponent(userId) + ':' + encodeURIComponent(catalogRef);
}

export function readEditorDraft(key, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (!value || !value.catalog || typeof value.catalog !== 'object') return null;
    return value;
  } catch { return null; }
}

export function storeEditorDraft(key, catalog, baseVersion, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, JSON.stringify({ catalog, baseVersion, updatedAt: Date.now() }));
    return true;
  } catch { return false; } // storage quota/private mode should never break editing
}

export function clearEditorDraft(key, storage = globalThis.localStorage) {
  try { storage.removeItem(key); } catch { /* no storage available */ }
}

export function createEditorHistory(initial, limit = 40) {
  let current = structuredClone(initial);
  const past = [];
  const future = [];
  let lastRecordAt = -Infinity;
  const copy = value => structuredClone(value);
  return {
    record(next, at = Date.now()) {
      if (JSON.stringify(next) === JSON.stringify(current)) return false;
      if (at - lastRecordAt > 700 || !past.length) {
        past.push(copy(current));
        if (past.length > limit) past.shift();
      }
      lastRecordAt = at;
      current = copy(next);
      future.length = 0;
      return true;
    },
    reset(next) {
      current = copy(next);
      past.length = 0;
      future.length = 0;
      lastRecordAt = -Infinity;
    },
    undo() {
      if (!past.length) return null;
      future.push(copy(current));
      current = past.pop();
      lastRecordAt = -Infinity;
      return copy(current);
    },
    redo() {
      if (!future.length) return null;
      past.push(copy(current));
      current = future.pop();
      lastRecordAt = -Infinity;
      return copy(current);
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; }
  };
}
