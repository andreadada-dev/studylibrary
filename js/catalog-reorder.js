// Reorder folder tiles by grabbing the grip. Pointer Events support mouse, pen
// and touch; keyboard users can focus the same handle and press arrow keys.
export function mountPersonalCatalogReorder(grid, { onSave = () => {}, onAnnounce = () => {} } = {}) {
  if (!grid) return () => {};
  const tileSelector = '[data-personal-catalog]';
  const handleSelector = '[data-personal-drag]';
  const tiles = () => [...grid.querySelectorAll(tileSelector)];
  let gesture = null;

  function moveTile(from, to) {
    const items = tiles();
    if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return false;
    if (from < to) items[to].after(items[from]);
    else items[to].before(items[from]);
    return true;
  }

  function notifyAndSave() {
    const count = tiles().length;
    onAnnounce('Ordine dei cataloghi aggiornato. ' + count + ' cataloghi.');
    void onSave();
  }

  function removePointerListeners() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    document.removeEventListener('keydown', onEscape);
  }

  function restoreOriginalOrder(items) {
    for (const tile of items) grid.appendChild(tile);
  }

  function finish(cancelled = false) {
    const drag = gesture;
    if (!drag) return;
    gesture = null;
    removePointerListeners();
    drag.tile.classList.remove('personal-tile-dragging');
    drag.handle.classList.remove('is-grabbing');
    drag.ghost?.remove();
    try {
      if (drag.handle.hasPointerCapture?.(drag.pointerId)) {
        drag.handle.releasePointerCapture(drag.pointerId);
      }
    } catch { /* browser already released capture */ }
    if (cancelled) {
      if (drag.dragged) restoreOriginalOrder(drag.originalOrder);
      return;
    }
    if (drag.dragged && tiles().some((item, i) => item !== drag.originalOrder[i])) {
      notifyAndSave();
    }
  }

  function onPointerMove(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const drag = gesture;
    const delta = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.dragged && delta < 6) return;
    if (!drag.dragged) {
      drag.dragged = true;
      const rect = drag.tile.getBoundingClientRect();
      drag.ghost = drag.tile.cloneNode(true);
      drag.ghost.className = drag.tile.className + ' personal-drag-ghost';
      drag.ghost.removeAttribute('data-personal-catalog');
      drag.ghost.setAttribute('aria-hidden', 'true');
      Object.assign(drag.ghost.style, {
        position: 'fixed', width: rect.width + 'px', height: rect.height + 'px',
        left: rect.left + 'px', top: rect.top + 'px',
        pointerEvents: 'none', zIndex: '1000'
      });
      document.body.appendChild(drag.ghost);
      drag.tile.classList.add('personal-tile-dragging');
      drag.handle.classList.add('is-grabbing');
    }
    event.preventDefault();
    drag.ghost.style.left = (event.clientX - drag.offsetX) + 'px';
    drag.ghost.style.top = (event.clientY - drag.offsetY) + 'px';

    // Hit-test the actual tiles, not the topmost DOM element. On touch screens
    // a captured pointer or an overlay can obscure elementFromPoint().
    const ordered = tiles();
    const target = ordered.find(tile => {
      const rect = tile.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!target || target === drag.tile) return;
    const from = ordered.indexOf(drag.tile);
    const to = ordered.indexOf(target);
    moveTile(from, to);
  }

  function onPointerUp(event) {
    if (gesture?.pointerId === event.pointerId) finish();
  }
  function onPointerCancel(event) {
    if (gesture?.pointerId === event.pointerId) finish(true);
  }
  function onEscape(event) {
    if (event.key === 'Escape' && gesture) {
      event.preventDefault();
      finish(true);
    }
  }
  function onPointerDown(event) {
    const handle = event.target.closest?.(handleSelector);
    if (!handle || !grid.contains(handle) || event.button !== 0 || event.isPrimary === false) return;
    if (gesture) return;
    const tile = handle.closest(tileSelector);
    if (!tile) return;
    event.preventDefault();
    const rect = tile.getBoundingClientRect();
    gesture = {
      pointerId: event.pointerId, tile, handle,
      startX: event.clientX, startY: event.clientY,
      offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      originalOrder: tiles(), dragged: false, ghost: null
    };
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('keydown', onEscape);
  }

  function onKeyDown(event) {
    const handle = event.target.closest?.(handleSelector);
    if (!handle || !grid.contains(handle)) return;
    const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const from = tiles().indexOf(handle.closest(tileSelector));
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tiles().length - 1 : from + keys[event.key];
    if (moveTile(from, to)) {
      handle.focus();
      notifyAndSave();
    }
  }

  grid.addEventListener('pointerdown', onPointerDown);
  grid.addEventListener('keydown', onKeyDown);
  return () => {
    finish(true);
    grid.removeEventListener('pointerdown', onPointerDown);
    grid.removeEventListener('keydown', onKeyDown);
  };
}
