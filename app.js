import { state, isBackendConfigured } from './js/state.js';
import { initBackend, fetchPublicCatalogs, fetchMyCatalogs, saveCatalog } from './js/api.js';
import { loadStaticCatalogs, allCatalogs, findCatalog, findLibrary, findLesson, findTopic, getOrderedTopics, catalogStats, validateCatalog, lessonHref } from './js/content.js';
import { renderAccount, catalogCard, libraryCard, lessonCard, lessonReaderRail, lessonTopicArticle, wireReaderInteractions, renderDiscussion, toast, escapeHtml } from './js/ui.js';
import { renderUniverseGraph } from './js/graph.js';

const app = document.getElementById('app');
let cleanupRoute = null;

async function bootstrap() {
  app.innerHTML = `<div class="page"><div class="skeleton" style="height:180px"></div></div>`;
  try {
    await Promise.all([loadStaticCatalogs(), initBackend()]);
    if (state.supabase) {
      try { await fetchPublicCatalogs(); } catch (err) { console.warn('Remote catalogs unavailable', err); }
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="page empty-state"><h2>Errore di avvio</h2><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }
  renderAccount();
  window.addEventListener('hashchange', route);
  window.addEventListener('studylibrary:auth-changed', async () => {
    renderAccount();
    await route();
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const universeSearch = document.querySelector('[data-universe-search]');
      if (universeSearch) {
        universeSearch.focus();
        universeSearch.select();
        return;
      }
      location.hash = '#/';
      requestAnimationFrame(() => document.querySelector('[data-course-search]')?.focus());
    }
  });
  await route();
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return parts;
}

async function route() {
  if (cleanupRoute) { cleanupRoute(); cleanupRoute = null; }
  const parts = parseRoute();
  const universeMode = parts.includes('universe');
  document.body.classList.toggle('universe-mode', universeMode);
  setActiveNav(parts[0] || 'home', universeMode);

  if (!parts.length) return renderHome();
  if (parts[0] === 'universe') return renderUniverse({});
  if (parts[0] === 'mine') return renderMyCatalogs();
  if (parts[0] === 'studio') return renderStudio();

  if (parts[0] === 'catalog' && parts[1]) {
    const catalogSlug = parts[1];

    if (parts[2] === 'universe') {
      return renderUniverse({ catalogSlug });
    }

    if (!parts[2]) return renderCatalog(catalogSlug);

    if (parts[2] === 'library' && parts[3]) {
      const librarySlug = parts[3];

      if (parts[4] === 'universe') {
        return renderUniverse({ catalogSlug, librarySlug });
      }

      if (!parts[4]) return renderLibrary(catalogSlug, librarySlug);

      if (parts[4] === 'lesson' && parts[5]) {
        const lessonSlug = parts[5];

        if (parts[6] === 'universe') {
          return renderUniverse({ catalogSlug, librarySlug, lessonSlug });
        }

        if (parts[6] === 'topic' && parts[7]) {
          return renderLesson(catalogSlug, librarySlug, lessonSlug, parts[7]);
        }

        return renderLesson(catalogSlug, librarySlug, lessonSlug);
      }
    }
  }

  return renderNotFound();
}

function setActiveNav(routeName, universeMode = false) {
  const map = {
    home: '#/',
    mine: '#/mine',
    universe: '#/universe',
    studio: '#/studio',
    catalog: '#/'
  };
  const activeHref = universeMode ? '#/universe' : (map[routeName] || '#/');
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === activeHref);
  });
}

function renderHome() {
  const catalogs = allCatalogs().filter(catalog => catalog.visibility !== 'private');

  app.innerHTML =
    '<div class="page">' +
      '<section class="hero">' +
        '<span class="eyebrow">Cataloghi pubblici</span>' +
        '<h1 class="display">Studia per lezioni.<br/>Collega tutto.</h1>' +
        '<p class="lede">Ogni persona costruisce il proprio catalogo. Dentro ci sono librerie, lezioni e argomenti collegati. Quando vuoi puoi pubblicarlo e renderlo visibile qui.</p>' +
        '<div class="hero-actions">' +
          '<div class="searchbar"><input data-course-search type="search" placeholder="Cerca catalogo, libreria, lezione o argomento…" aria-label="Cerca"/><kbd>⌘K</kbd></div>' +
          '<a class="button secondary" href="#/universe">Universo pubblico</a>' +
          '<a class="button secondary" href="#/mine">Il mio catalogo</a>' +
        '</div>' +
      '</section>' +

      '<section>' +
        '<div class="section-head"><div><h2>Pubblicati dalla community</h2><p>Apri un catalogo per vedere le sue librerie e le lezioni che contiene.</p></div><span class="tag">' + catalogs.length + ' cataloghi</span></div>' +
        '<div class="course-grid" data-course-grid>' + catalogs.map(catalogCard).join('') + '</div>' +
        '<div class="empty-state" data-no-results hidden><h2>Nessun risultato</h2><p>Prova con un altro termine.</p></div>' +
      '</section>' +

      '<hr class="section-rule" />' +
      '<section class="micro-features">' +
        '<div class="micro-feature"><span class="index">01</span><h3>Catalogo personale</h3><p>È il tuo spazio. Può restare privato oppure essere pubblicato nella home.</p></div>' +
        '<div class="micro-feature"><span class="index">02</span><h3>Librerie → lezioni</h3><p>Una libreria può contenere una o più lezioni, così il materiale segue davvero il corso del docente.</p></div>' +
        '<div class="micro-feature"><span class="index">03</span><h3>Universo a più scale</h3><p>Puoi guardare una singola lezione, una libreria, un catalogo intero oppure tutto lo spazio pubblico.</p></div>' +
      '</section>' +
    '</div>';

  const input = app.querySelector('[data-course-search]');
  const grid = app.querySelector('[data-course-grid]');
  const empty = app.querySelector('[data-no-results]');

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    const filtered = catalogs.filter(catalog => catalogSearchText(catalog).includes(query));
    grid.innerHTML = filtered.map(catalogCard).join('');
    empty.hidden = filtered.length > 0;
  });
}

function catalogSearchText(catalog) {
  const parts = [catalog.title, catalog.description, ...(catalog.tags || [])];
  for (const library of catalog.libraries || []) {
    parts.push(library.title, library.description);
    for (const lesson of library.lessons || []) {
      parts.push(lesson.title, lesson.description);
      for (const topic of lesson.topics || []) parts.push(topic.title, topic.summary);
    }
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

async function renderMyCatalogs() {
  let catalogs = [];

  if (state.user && state.supabase) {
    try {
      catalogs = await fetchMyCatalogs();
    } catch (err) {
      console.warn(err);
      return renderNotFound('Impossibile caricare i tuoi cataloghi');
    }
  }

  const demoCatalogs = state.staticCatalogs || [];
  app.innerHTML =
    '<div class="page">' +
      '<section class="collection-hero">' +
        '<div><span class="eyebrow">Spazio personale</span><h1>Il mio catalogo</h1><p class="lede">Organizza le tue librerie per corso e spezza il materiale in lezioni. La pubblicazione è una scelta del proprietario.</p></div>' +
        '<div class="hero-actions"><a class="button accent" href="#/studio">Crea o modifica JSON</a><a class="button secondary" href="#/universe">Universo totale</a></div>' +
      '</section>' +
      (!state.supabase
        ? '<aside class="catalog-notice"><strong>Modalità demo</strong><p>Il backend non è ancora configurato. Puoi usare il catalogo locale e preparare i JSON; login, salvataggio personale e pubblicazione si attiveranno con Supabase.</p></aside>'
        : !state.user
          ? '<aside class="catalog-notice"><strong>Accedi con Google</strong><p>Usa il pulsante in alto a destra per vedere e gestire i tuoi cataloghi privati.</p></aside>'
          : '') +
      (catalogs.length
        ? '<div class="section-head"><div><h2>I tuoi cataloghi</h2><p>Privati e pubblicati.</p></div><span class="tag">' + catalogs.length + '</span></div><div class="course-grid">' + catalogs.map(catalogCard).join('') + '</div>'
        : state.user
          ? '<div class="empty-state"><h2>Nessun catalogo cloud</h2><p>Apri Studio JSON, crea il primo catalogo e salvalo come privato oppure pubblicalo.</p></div>'
          : '') +
      (demoCatalogs.length
        ? '<hr class="section-rule"/><div class="section-head"><div><h2>Cataloghi locali</h2><p>Contenuti presenti nella repository.</p></div></div><div class="course-grid">' + demoCatalogs.map(catalogCard).join('') + '</div>'
        : '') +
    '</div>';
}

function renderCatalog(catalogSlug) {
  const catalog = findCatalog(catalogSlug);
  if (!catalog) return renderNotFound('Catalogo non trovato');

  state.activeCatalog = catalog;
  state.activeLibrary = null;
  state.activeLesson = null;
  state.activeTopic = null;

  const stats = catalogStats(catalog);
  const universe = '#/catalog/' + encodeURIComponent(catalog.slug) + '/universe';

  app.innerHTML =
    '<div class="page">' +
      '<header class="collection-hero">' +
        '<div><span class="eyebrow">Catalogo</span><h1>' + escapeHtml(catalog.title) + '</h1><p class="lede">' + escapeHtml(catalog.description || '') + '</p></div>' +
        '<div class="collection-actions"><a class="button accent" href="' + universe + '">Universo catalogo</a><button class="button secondary" type="button" data-edit-catalog>Modifica JSON</button></div>' +
      '</header>' +
      '<div class="catalog-stats">' +
        '<div><strong>' + stats.libraries + '</strong><span>librerie</span></div>' +
        '<div><strong>' + stats.lessons + '</strong><span>lezioni</span></div>' +
        '<div><strong>' + stats.topics + '</strong><span>argomenti</span></div>' +
        '<div><strong>' + (catalog.visibility === 'private' ? 'Privato' : 'Pubblico') + '</strong><span>visibilità</span></div>' +
      '</div>' +
      '<section class="collection-list">' +
        '<div class="section-head"><div><h2>Librerie</h2><p>Ogni libreria raccoglie le lezioni di un corso o di un’area di studio.</p></div></div>' +
        (catalog.libraries || []).map(library => libraryCard(catalog, library)).join('') +
      '</section>' +
    '</div>';

  app.querySelector('[data-edit-catalog]')?.addEventListener('click', () => {
    state.activeCatalog = catalog;
    location.hash = '#/studio';
  });
}

function renderLibrary(catalogSlug, librarySlug) {
  const catalog = findCatalog(catalogSlug);
  const library = findLibrary(catalog, librarySlug);
  if (!catalog || !library) return renderNotFound('Libreria non trovata');

  state.activeCatalog = catalog;
  state.activeLibrary = library;
  state.activeLesson = null;
  state.activeTopic = null;

  const universe =
    '#/catalog/' + encodeURIComponent(catalog.slug) +
    '/library/' + encodeURIComponent(library.slug) +
    '/universe';

  app.innerHTML =
    '<div class="page">' +
      '<div class="breadcrumb"><a href="#/catalog/' + encodeURIComponent(catalog.slug) + '">' + escapeHtml(catalog.title) + '</a><span>→</span><strong>' + escapeHtml(library.title) + '</strong></div>' +
      '<header class="collection-hero compact">' +
        '<div><span class="eyebrow">Libreria</span><h1>' + escapeHtml(library.title) + '</h1><p class="lede">' + escapeHtml(library.description || '') + '</p></div>' +
        '<div class="collection-actions"><a class="button accent" href="' + universe + '">Universo libreria</a></div>' +
      '</header>' +
      '<section class="lesson-list">' +
        '<div class="section-head"><div><h2>Lezioni</h2><p>Ordinate come il materiale del corso.</p></div><span class="tag">' + (library.lessons?.length || 0) + ' lezioni</span></div>' +
        (library.lessons || []).map((lesson, index) => lessonCard(catalog, library, lesson, index)).join('') +
      '</section>' +
    '</div>';
}

async function renderLesson(catalogSlug, librarySlug, lessonSlug, topicId = null) {
  const catalog = findCatalog(catalogSlug);
  const library = findLibrary(catalog, librarySlug);
  const lesson = findLesson(library, lessonSlug);
  if (!catalog || !library || !lesson) return renderNotFound('Lezione non trovata');

  const ordered = getOrderedTopics(lesson);
  const topic = topicId ? findTopic(lesson, topicId) : ordered[0];
  if (!topic) return renderNotFound('Argomento non trovato');

  const context = { catalog, library, lesson };
  state.activeCatalog = catalog;
  state.activeLibrary = library;
  state.activeLesson = lesson;
  state.activeTopic = topic;

  const minutes = lesson.estimatedMinutes || ordered.reduce((sum, item) => sum + (item.estimatedMinutes || 0), 0);
  const currentIndex = Math.max(0, ordered.findIndex(item => item.id === topic.id));
  const progress = ordered.length ? Math.round(((currentIndex + 1) / ordered.length) * 100) : 0;
  const universe = lessonHref(catalog.slug, library.slug, lesson.slug) + '/universe';

  app.innerHTML =
    '<div class="page">' +
      '<header class="course-hero lesson-hero">' +
        '<div>' +
          '<div class="breadcrumb"><a href="#/catalog/' + encodeURIComponent(catalog.slug) + '">' + escapeHtml(catalog.title) + '</a><span>→</span><a href="#/catalog/' + encodeURIComponent(catalog.slug) + '/library/' + encodeURIComponent(library.slug) + '">' + escapeHtml(library.title) + '</a></div>' +
          '<span class="eyebrow">Lezione</span>' +
          '<h1>' + escapeHtml(lesson.title) + '</h1>' +
          '<p class="summary">' + escapeHtml(lesson.description || '') + '</p>' +
          '<div class="progress-track" aria-label="Avanzamento nella lezione"><span style="--progress:' + progress + '%"></span></div>' +
        '</div>' +
        '<div class="course-statline">' +
          '<div class="stat"><strong>' + ordered.length + '</strong><span>argomenti</span></div>' +
          '<div class="stat"><strong>' + (minutes || '—') + '</strong><span>minuti stimati</span></div>' +
          '<div class="stat"><strong>' + (lesson.modules?.length || 0) + '</strong><span>moduli</span></div>' +
          '<div class="stat"><a class="button secondary" href="' + universe + '">Universo lezione</a></div>' +
        '</div>' +
      '</header>' +
      '<div class="course-layout">' +
        '<aside class="topic-rail">' + lessonReaderRail(context, topic.id) + '</aside>' +
        lessonTopicArticle(context, topic) +
      '</div>' +
    '</div>';

  wireReaderInteractions();
  await renderDiscussion(
    'topic',
    catalog.slug + '/' + library.slug + '/' + lesson.slug + '/' + topic.id
  );
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function renderUniverse(options = {}) {
  let catalogs = allCatalogs();
  let ownershipNote = 'Cataloghi pubblici e contenuti locali';

  if (state.user && state.supabase) {
    try {
      const mine = await fetchMyCatalogs();
      const map = new Map(catalogs.map(catalog => [catalog.slug, catalog]));
      mine.forEach(catalog => map.set(catalog.slug, catalog));
      catalogs = [...map.values()];
      ownershipNote = 'Il tuo spazio personale + cataloghi pubblici';
    } catch (err) {
      console.warn(err);
    }
  }

  let scopeTitle = 'Universo totale';
  let scopeSubtitle = 'Cataloghi, librerie, lezioni e argomenti in un’unica mappa.';

  if (options.catalogSlug) {
    const catalog = catalogs.find(item => item.slug === options.catalogSlug);
    if (!catalog) return renderNotFound('Catalogo non trovato');
    scopeTitle = catalog.title;
    scopeSubtitle = 'Universo del catalogo';

    if (options.librarySlug) {
      const library = findLibrary(catalog, options.librarySlug);
      if (!library) return renderNotFound('Libreria non trovata');
      scopeTitle = library.title;
      scopeSubtitle = 'Universo della libreria';

      if (options.lessonSlug) {
        const lesson = findLesson(library, options.lessonSlug);
        if (!lesson) return renderNotFound('Lezione non trovata');
        scopeTitle = lesson.title;
        scopeSubtitle = 'Universo della singola lezione';
      }
    }
  }

  app.innerHTML =
    '<section class="universe-full">' +
      '<div class="universe-canvas" data-universe-graph aria-label="Mappa interattiva della conoscenza"></div>' +

      '<div class="universe-titlebar">' +
        '<span class="universe-overline">' + escapeHtml(scopeSubtitle) + '</span>' +
        '<h1>' + escapeHtml(scopeTitle) + '</h1>' +
        '<p>' + escapeHtml(ownershipNote) + '</p>' +
        '<span class="universe-stats" data-universe-stats></span>' +
      '</div>' +

      '<div class="universe-search-wrap">' +
        '<div class="universe-searchbox">' +
          '<span aria-hidden="true">⌕</span>' +
          '<input data-universe-search type="search" placeholder="Cerca catalogo, libreria, lezione o argomento…" autocomplete="off" aria-label="Cerca nell’universo" />' +
          '<kbd>Esc</kbd>' +
        '</div>' +
        '<div class="universe-search-results" data-universe-results hidden></div>' +
      '</div>' +

      '<div class="universe-actions" aria-label="Controlli mappa">' +
        '<button type="button" class="universe-control" data-universe-fit title="Mostra tutta la mappa" aria-label="Mostra tutta la mappa"><span aria-hidden="true">⌗</span></button>' +
        '<button type="button" class="universe-control" data-universe-labels aria-pressed="true" title="Mostra o nascondi etichette" aria-label="Mostra o nascondi etichette"><span aria-hidden="true">Aa</span></button>' +
      '</div>' +

      '<div class="universe-legend">' +
        '<span><i class="legend-dot catalog"></i> Catalogo</span>' +
        '<span><i class="legend-dot library"></i> Libreria</span>' +
        '<span><i class="legend-dot lesson"></i> Lezione</span>' +
        '<span><i class="legend-dot topic"></i> Argomento</span>' +
        '<span class="universe-legend-hint">trascina · rotella per zoom · clicca per esplorare</span>' +
      '</div>' +

      '<aside class="universe-inspector" data-universe-inspector hidden></aside>' +
    '</section>';

  const graphHost = app.querySelector('[data-universe-graph]');
  cleanupRoute = renderUniverseGraph(graphHost, catalogs, options) || null;

  requestAnimationFrame(() => {
    app.querySelector('[data-universe-search]')?.focus({ preventScroll: true });
  });
}

async function renderStudio() {
  let initial = state.activeCatalog || allCatalogs()[0];
  if (!initial) initial = emptyCatalogTemplate();
  app.innerHTML = `<div class="studio-layout">
    <section class="studio-editor">
      <div class="studio-toolbar"><div><h1>Studio JSON</h1><p class="demo-note">Catalogo → Librerie → Lezioni → Argomenti</p></div><div class="toolbar-actions"><button class="button secondary" data-new>Nuovo</button><button class="button secondary" data-import>Importa</button><button class="button secondary" data-download>Scarica</button><button class="button" data-save>Salva</button><button class="button accent" data-publish>Pubblica</button></div></div>
      <textarea class="json-editor" spellcheck="false" aria-label="Editor JSON"></textarea>
      <input data-file type="file" accept="application/json,.json" hidden />
    </section>
    <aside class="studio-side">
      <div data-validation></div>
      <div data-preview></div>
      <div class="schema-list">
        <div class="schema-item"><strong>1. Catalogo</strong><span>Lo spazio dell’utente. Può restare privato o essere pubblicato nella home.</span></div>
        <div class="schema-item"><strong>2. Librerie</strong><span>Ogni catalogo contiene una o più librerie, per esempio Computer Vision.</span></div>
        <div class="schema-item"><strong>3. Lezioni</strong><span>Ogni libreria contiene una o più lezioni, idealmente una per blocco di slide del docente.</span></div>
        <div class="schema-item"><strong>4. Argomenti</strong><span>Ogni lezione contiene topic con intuizione, esempi, checkpoint, fonti e connessioni.</span></div>
        <div class="schema-item"><strong>5. Universi</strong><span>Le relazioni diventano navigabili a livello di lezione, libreria, catalogo o spazio totale.</span></div>
      </div>
      <p class="demo-note">Schema completo: <code>docs/CONTENT-SCHEMA.md</code></p>
    </aside>
  </div>`;

  const editor = app.querySelector('.json-editor');
  const validationEl = app.querySelector('[data-validation]');
  const previewEl = app.querySelector('[data-preview]');
  const fileInput = app.querySelector('[data-file]');
  editor.value = JSON.stringify(initial, null, 2);

  const updatePreview = () => {
    let parsed;
    try { parsed = JSON.parse(editor.value); }
    catch (err) {
      validationEl.innerHTML = `<div class="validation error">● JSON non valido</div><p class="demo-note">${escapeHtml(err.message)}</p>`;
      previewEl.innerHTML = '';
      return null;
    }
    const result = validateCatalog(parsed);
    validationEl.innerHTML = result.ok ? `<div class="validation ok">● Schema valido</div>` : `<div class="validation error">● ${result.errors.length} problemi</div><p class="demo-note">${result.errors.slice(0,6).map(escapeHtml).join('<br>')}</p>`;
    const stats = catalogStats(parsed);
    previewEl.innerHTML = `<span class="eyebrow">Anteprima catalogo</span><h2 class="preview-title">${escapeHtml(parsed.title || 'Senza titolo')}</h2><p class="preview-description">${escapeHtml(parsed.description || '')}</p><div class="tags">${(parsed.tags || []).slice(0,4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div><p class="demo-note">${stats.libraries} librerie · ${stats.lessons} lezioni · ${stats.topics} argomenti</p>`;
    return { parsed, result };
  };

  let timer;
  editor.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(updatePreview, 150); });
  updatePreview();

  app.querySelector('[data-new]').addEventListener('click', () => { editor.value = JSON.stringify(emptyCatalogTemplate(), null, 2); updatePreview(); });
  app.querySelector('[data-import]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    editor.value = await file.text();
    updatePreview();
    fileInput.value = '';
  });
  app.querySelector('[data-download]').addEventListener('click', () => {
    const checked = updatePreview();
    if (!checked) return;
    const blob = new Blob([JSON.stringify(checked.parsed, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${checked.parsed.slug || 'catalog'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  app.querySelector('[data-save]').addEventListener('click', () => saveEditorCatalog(false));
  app.querySelector('[data-publish]').addEventListener('click', () => saveEditorCatalog(true));

  async function saveEditorCatalog(publish) {
    const checked = updatePreview();
    if (!checked?.result.ok) return toast('Correggi prima gli errori nello schema');
    if (!state.user || !state.supabase) return toast(isBackendConfigured() ? 'Accedi con Google per salvare' : 'Configura Supabase per salvare online');
    try {
      await saveCatalog(checked.parsed, publish);
      if (publish) await fetchPublicCatalogs();
      toast(publish ? 'Catalogo pubblicato nella home' : 'Catalogo salvato come privato');
    } catch (err) { toast(err.message); }
  }
}

function emptyCatalogTemplate() {
  const stamp = Date.now();
  const catalogSlug = 'catalog-' + stamp;
  return {
    schemaVersion: 2,
    id: catalogSlug,
    slug: catalogSlug,
    title: 'Nuovo catalogo',
    description: 'Descrivi il tuo spazio di studio.',
    language: 'it',
    visibility: 'private',
    tags: [],
    libraries: [
      {
        id: 'library-1',
        slug: 'prima-libreria',
        title: 'Prima libreria',
        description: 'Per esempio: Computer Vision.',
        lessons: [
          {
            schemaVersion: 1,
            id: 'lesson-01',
            slug: 'lezione-01',
            title: 'Lezione 01',
            description: 'Una lezione può corrispondere a una lezione del docente o a un gruppo di slide.',
            modules: [
              {
                id: 'fondamenti',
                title: 'Fondamenti',
                topicIds: ['primo-argomento']
              }
            ],
            topics: [
              {
                id: 'primo-argomento',
                title: 'Primo argomento',
                summary: 'Una spiegazione breve e concreta.',
                why: 'Spiega perché serve.',
                estimatedMinutes: 8,
                prerequisites: [],
                learningGoals: ['Capire l’idea centrale'],
                sections: [
                  { type: 'lead', body: 'Parti da un’intuizione semplice.' },
                  { type: 'concept', title: 'Idea chiave', body: 'Costruisci il concetto progressivamente.' },
                  { type: 'checkpoint', question: 'Qual è l’idea centrale?', answer: 'Scrivi una risposta verificabile.' }
                ],
                connections: [],
                sources: [
                  {
                    ref: 'source-1',
                    pages: '',
                    note: 'Aggiungi una fonte reale.'
                  }
                ]
              }
            ],
            sources: [
              {
                id: 'source-1',
                type: 'slides',
                label: 'Materiale della lezione'
              }
            ]
          }
        ]
      }
    ]
  };
}

function renderNotFound(message = 'Pagina non trovata') {
  app.innerHTML = `<div class="page empty-state"><span class="eyebrow">404</span><h2>${escapeHtml(message)}</h2><p><a class="button secondary" href="#/">Torna alla biblioteca</a></p></div>`;
}

bootstrap();
