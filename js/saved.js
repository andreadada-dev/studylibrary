import { state } from './state.js';
import { allCatalogs, catalogRef, findLibrary, findLesson, findTopic, lessonHref } from './content.js';
import { escapeHtml, toast } from './ui.js';

const TYPES = new Set(['catalog', 'library', 'lesson', 'topic']);

function cloudCatalogId(catalog) { return catalog?._db?.id || null; }
function requireAccount() {
  if (!state.supabase || !state.user) {
    toast('Accedi con Google per usare Salvati');
    return false;
  }
  return true;
}
function savedKey(type, catalogId, entityKey) { return type + ':' + catalogId + ':' + entityKey; }

export async function loadSaved({ force = false } = {}) {
  if (!state.supabase || !state.user) {
    state.bookmarks = [];
    state.favorites = [];
    state.savedLoadedFor = null;
    return { bookmarks: [], favorites: [] };
  }
  if (!force && state.savedLoadedFor === state.user.id) {
    return { bookmarks: state.bookmarks || [], favorites: state.favorites || [] };
  }
  const [bookmarks, favorites] = await Promise.all([
    state.supabase.from('study_bookmarks').select('*').order('updated_at', { ascending: false }),
    state.supabase.from('study_favorites').select('*').order('created_at', { ascending: false })
  ]);
  if (bookmarks.error) throw bookmarks.error;
  if (favorites.error) throw favorites.error;
  state.bookmarks = bookmarks.data || [];
  state.favorites = favorites.data || [];
  state.savedLoadedFor = state.user.id;
  return { bookmarks: state.bookmarks, favorites: state.favorites };
}

function favoriteExists(type, catalogId, entityKey) {
  return (state.favorites || []).some(item =>
    item.entity_type === type && item.catalog_id === catalogId && item.entity_key === entityKey
  );
}

function bookmarkFor(catalogId) {
  return (state.bookmarks || []).find(item => item.catalog_id === catalogId) || null;
}

async function toggleFavorite(meta, button) {
  if (!requireAccount()) return;
  const catalogId = cloudCatalogId(meta.catalog);
  if (!catalogId) return toast('Salva prima il catalogo nel cloud per aggiungerlo ai preferiti');
  if (!TYPES.has(meta.type)) return;

  await loadSaved();
  const existed = favoriteExists(meta.type, catalogId, meta.entityKey);
  button?.classList.toggle('busy', true);
  try {
    if (existed) {
      const { error } = await state.supabase.from('study_favorites').delete()
        .eq('user_id', state.user.id).eq('catalog_id', catalogId)
        .eq('entity_type', meta.type).eq('entity_key', meta.entityKey);
      if (error) throw error;
      state.favorites = state.favorites.filter(item =>
        savedKey(item.entity_type, item.catalog_id, item.entity_key) !== savedKey(meta.type, catalogId, meta.entityKey)
      );
      toast('Rimosso dai preferiti');
    } else {
      const payload = {
        user_id: state.user.id,
        catalog_id: catalogId,
        entity_type: meta.type,
        entity_key: meta.entityKey,
        library_key: meta.library?.slug || null,
        lesson_key: meta.lesson?.slug || null,
        title_snapshot: meta.title || ''
      };
      const { data, error } = await state.supabase.from('study_favorites').insert(payload).select('*').single();
      if (error) throw error;
      state.favorites = [data, ...(state.favorites || [])];
      toast('Aggiunto ai preferiti');
    }
    updateSaveButtons();
  } catch (err) { toast(err.message); }
  finally { button?.classList.remove('busy'); }
}

async function setBookmark(meta, button) {
  if (!requireAccount()) return;
  const catalogId = cloudCatalogId(meta.catalog);
  if (!catalogId) return toast('Il segnalibro è disponibile sui cataloghi cloud');
  await loadSaved();

  const previous = bookmarkFor(catalogId);
  const same = previous?.topic_key === meta.topic.id &&
    previous?.library_key === meta.library.slug &&
    previous?.lesson_key === meta.lesson.slug;

  button?.classList.toggle('busy', true);
  try {
    if (same) {
      const { error } = await state.supabase.from('study_bookmarks').delete()
        .eq('user_id', state.user.id).eq('catalog_id', catalogId);
      if (error) throw error;
      state.bookmarks = state.bookmarks.filter(item => item.catalog_id !== catalogId);
      toast('Punto di ripresa rimosso');
    } else {
      const payload = {
        user_id: state.user.id,
        catalog_id: catalogId,
        library_key: meta.library.slug,
        lesson_key: meta.lesson.slug,
        topic_key: meta.topic.id,
        title_snapshot: meta.topic.title || ''
      };
      const { data, error } = await state.supabase.from('study_bookmarks')
        .upsert(payload, { onConflict: 'user_id,catalog_id' }).select('*').single();
      if (error) throw error;
      state.bookmarks = [data, ...(state.bookmarks || []).filter(item => item.catalog_id !== catalogId)];
      toast(previous ? 'Punto di ripresa spostato' : 'Punto di ripresa salvato');
    }
    updateSaveButtons();
  } catch (err) { toast(err.message); }
  finally { button?.classList.remove('busy'); }
}

function favoriteButton(meta) {
  const catalogId = cloudCatalogId(meta.catalog);
  if (!catalogId) return '';
  const active = favoriteExists(meta.type, catalogId, meta.entityKey);
  return '<button type="button" class="save-action favorite' + (active ? ' active' : '') +
    '" data-save-favorite aria-pressed="' + active + '" title="' + (active ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti') + '">' +
    '<span aria-hidden="true">' + (active ? '♥' : '♡') + '</span><span>' + (active ? 'Nei preferiti' : 'Preferito') + '</span></button>';
}

function bookmarkButton(meta) {
  const catalogId = cloudCatalogId(meta.catalog);
  if (!catalogId || !meta.topic) return '';
  const active = bookmarkFor(catalogId)?.topic_key === meta.topic.id &&
    bookmarkFor(catalogId)?.lesson_key === meta.lesson.slug &&
    bookmarkFor(catalogId)?.library_key === meta.library.slug;
  return '<button type="button" class="save-action bookmark' + (active ? ' active' : '') +
    '" data-save-bookmark aria-pressed="' + active + '" title="Usa come punto di ripresa">' +
    '<span aria-hidden="true">🔖</span><span>' + (active ? 'Punto di ripresa' : 'Riprendi da qui') + '</span></button>';
}

export async function mountSaveControls(context) {
  const catalog = context?.catalog;
  if (!catalog || !cloudCatalogId(catalog) || !state.user || !state.supabase) return;
  try { await loadSaved(); } catch (err) { console.warn(err); return; }

  let meta;
  if (context.topic) meta = { ...context, type: 'topic', entityKey: context.topic.id, title: context.topic.title };
  else if (context.lesson) meta = { ...context, type: 'lesson', entityKey: context.lesson.slug, title: context.lesson.title };
  else if (context.library) meta = { ...context, type: 'library', entityKey: context.library.slug, title: context.library.title };
  else meta = { ...context, type: 'catalog', entityKey: cloudCatalogId(catalog), title: catalog.title };

  const host = document.querySelector('.collection-actions') ||
    document.querySelector('.course-statline') ||
    document.querySelector('.reader-header') ||
    document.querySelector('.course-hero > div:last-child');
  if (!host || host.querySelector('[data-save-controls]')) return;

  const wrap = document.createElement('div');
  wrap.className = 'save-actions';
  wrap.dataset.saveControls = '';
  const lessonMeta = meta.type === 'topic'
    ? { ...context, type: 'lesson', entityKey: context.lesson.slug, title: context.lesson.title }
    : null;
  wrap.innerHTML =
    (lessonMeta ? '<span class="save-scope">Lezione</span>' + favoriteButton(lessonMeta) + '<span class="save-scope">Argomento</span>' : '') +
    favoriteButton(meta) +
    (meta.type === 'topic' ? bookmarkButton(meta) : '');
  host.appendChild(wrap);

  const favoriteButtons = wrap.querySelectorAll('[data-save-favorite]');
  if (lessonMeta && favoriteButtons[0]) favoriteButtons[0].addEventListener('click', event => toggleFavorite(lessonMeta, event.currentTarget));
  const topicFavorite = lessonMeta ? favoriteButtons[1] : favoriteButtons[0];
  topicFavorite?.addEventListener('click', event => toggleFavorite(meta, event.currentTarget));
  wrap.querySelector('[data-save-bookmark]')?.addEventListener('click', event => setBookmark(meta, event.currentTarget));
}

function updateSaveButtons() {
  document.querySelectorAll('[data-save-controls]').forEach(el => el.remove());
  const c = state.activeCatalog;
  if (!c) return;
  mountSaveControls({
    catalog: c,
    library: state.activeLibrary,
    lesson: state.activeLesson,
    topic: state.activeTopic
  });
}

function resolveCatalog(catalogId) {
  return allCatalogs().find(c => cloudCatalogId(c) === catalogId) || null;
}

function resolveSaved(item) {
  const catalog = resolveCatalog(item.catalog_id);
  if (!catalog) return null;
  if (item.entity_type === 'catalog') return {
    type: 'Catalogo', title: catalog.title, subtitle: 'Catalogo', href: '#/catalog/' + encodeURIComponent(catalogRef(catalog))
  };
  const library = findLibrary(catalog, item.library_key || item.entity_key);
  if (!library) return null;
  if (item.entity_type === 'library') return {
    type: 'Libreria', title: library.title, subtitle: catalog.title,
    href: '#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '/library/' + encodeURIComponent(library.slug)
  };
  const lesson = findLesson(library, item.lesson_key || item.entity_key);
  if (!lesson) return null;
  if (item.entity_type === 'lesson') return {
    type: 'Lezione', title: lesson.title, subtitle: catalog.title + ' · ' + library.title,
    href: lessonHref(catalog, library.slug, lesson.slug)
  };
  const topic = findTopic(lesson, item.entity_key);
  if (!topic) return null;
  return {
    type: 'Argomento', title: topic.title, subtitle: catalog.title + ' · ' + lesson.title,
    href: lessonHref(catalog, library.slug, lesson.slug) + '/topic/' + encodeURIComponent(topic.id)
  };
}

function resolveBookmark(item) {
  const catalog = resolveCatalog(item.catalog_id);
  if (!catalog) return null;
  const library = findLibrary(catalog, item.library_key);
  const lesson = findLesson(library, item.lesson_key);
  const topic = findTopic(lesson, item.topic_key);
  if (!library || !lesson || !topic) return null;
  return {
    catalog: catalog.title, title: topic.title, subtitle: library.title + ' · ' + lesson.title,
    href: lessonHref(catalog, library.slug, lesson.slug) + '/topic/' + encodeURIComponent(topic.id)
  };
}

function resumeCard(item) {
  const x = resolveBookmark(item);
  if (!x) return '';
  return '<a class="resume-card" href="' + x.href + '"><span class="saved-kind">Punto di ripresa</span><strong>' +
    escapeHtml(x.title) + '</strong><span>' + escapeHtml(x.catalog) + ' · ' + escapeHtml(x.subtitle) +
    '</span><em>Continua →</em></a>';
}
function favoriteCard(item) {
  const x = resolveSaved(item);
  if (!x) return '';
  return '<a class="saved-card" href="' + x.href + '"><span class="saved-kind">' + escapeHtml(x.type) +
    '</span><strong>' + escapeHtml(x.title) + '</strong><span>' + escapeHtml(x.subtitle) + '</span></a>';
}

export async function renderHomeSavedSection(root) {
  if (!state.user || !state.supabase || !root) return;
  try {
    await loadSaved({ force: true });
    const resumes = (state.bookmarks || []).map(resumeCard).filter(Boolean).slice(0, 3);
    const favorites = (state.favorites || []).map(favoriteCard).filter(Boolean).slice(0, 6);
    if (!resumes.length && !favorites.length) return;

    const section = document.createElement('section');
    section.className = 'home-saved';
    section.innerHTML =
      (resumes.length ? '<div class="section-head"><div><h2>Continua a studiare</h2><p>I tuoi punti di ripresa, uno per catalogo.</p></div><a class="text-link" href="#/saved">Vedi tutti</a></div><div class="resume-grid">' + resumes.join('') + '</div>' : '') +
      (favorites.length ? '<div class="section-head saved-favorites-head"><div><h2>I tuoi preferiti</h2><p>Contenuti che hai scelto di tenere a portata di mano.</p></div><a class="text-link" href="#/saved">Vedi tutti</a></div><div class="saved-grid">' + favorites.join('') + '</div>' : '');
    const hero = root.querySelector('.hero');
    hero?.insertAdjacentElement('afterend', section);
  } catch (err) { console.warn('Saved content unavailable', err); }
}

export async function renderSavedPage(root) {
  if (!root) return;
  if (!state.user || !state.supabase) {
    root.innerHTML = '<div class="page empty-state"><span class="eyebrow">Salvati</span><h2>Accedi per ritrovare il tuo studio</h2><p>Segnalibri e preferiti vengono sincronizzati sul tuo account.</p></div>';
    return;
  }
  root.innerHTML = '<div class="page"><div class="skeleton" style="height:180px"></div></div>';
  try {
    await loadSaved({ force: true });
    const resumes = (state.bookmarks || []).map(resumeCard).filter(Boolean);
    const favorites = (state.favorites || []).map(favoriteCard).filter(Boolean);
    root.innerHTML = '<div class="page saved-page">' +
      '<header class="collection-hero compact"><div><span class="eyebrow">Il tuo spazio</span><h1>Salvati</h1><p class="lede">Riprendi esattamente da dove hai deciso oppure apri la tua raccolta personale.</p></div></header>' +
      '<section><div class="section-head"><div><h2>Riprendi</h2><p>Un punto attivo per ogni catalogo.</p></div><span class="tag">' + resumes.length + '</span></div>' +
      (resumes.length ? '<div class="resume-grid">' + resumes.join('') + '</div>' : '<div class="saved-empty">Nessun punto di ripresa ancora.</div>') + '</section>' +
      '<section class="saved-library"><div class="section-head"><div><h2>Preferiti</h2><p>Cataloghi, librerie, lezioni e argomenti.</p></div><span class="tag">' + favorites.length + '</span></div>' +
      '<div class="saved-filter" role="group" aria-label="Filtra preferiti"><button class="active" data-saved-filter="all">Tutti</button><button data-saved-filter="catalog">Cataloghi</button><button data-saved-filter="library">Librerie</button><button data-saved-filter="lesson">Lezioni</button><button data-saved-filter="topic">Argomenti</button></div>' +
      (favorites.length ? '<div class="saved-grid" data-saved-grid>' + (state.favorites || []).map(item => '<div data-saved-type="' + item.entity_type + '">' + favoriteCard(item) + '</div>').join('') + '</div>' : '<div class="saved-empty">Non hai ancora aggiunto preferiti.</div>') +
      '</section></div>';
    root.querySelectorAll('[data-saved-filter]').forEach(btn => btn.addEventListener('click', () => {
      root.querySelectorAll('[data-saved-filter]').forEach(x => x.classList.toggle('active', x === btn));
      root.querySelectorAll('[data-saved-type]').forEach(card => { card.hidden = btn.dataset.savedFilter !== 'all' && card.dataset.savedType !== btn.dataset.savedFilter; });
    }));
  } catch (err) {
    root.innerHTML = '<div class="page empty-state"><h2>Impossibile caricare i salvati</h2><p>' + escapeHtml(err.message) + '</p></div>';
  }
}
