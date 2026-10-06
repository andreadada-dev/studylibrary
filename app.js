import { state, isBackendConfigured } from './js/state.js';
import { initBackend, fetchPublicCatalogs, fetchMyCatalogs, saveCatalog, fetchCatalogVersions, restoreCatalogVersion, deleteCatalog, reportContent } from './js/api.js';
import { loadStaticCatalogs, allCatalogs, findCatalog, findLibrary, findLesson, findTopic, getOrderedTopics, catalogStats, validateCatalog, lessonHref, catalogRef } from './js/content.js';
import { renderAccount, catalogCard, libraryCard, lessonCard, lessonReaderRail, lessonTopicArticle, wireReaderInteractions, renderDiscussion, toast, escapeHtml, showModal, closeModal } from './js/ui.js';
import { renderUniverseGraph } from './js/graph.js';
import { mountCatalogEditor } from './js/catalog-editor.js';

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
  window.addEventListener('hashchange', safeRoute);
  window.addEventListener('studylibrary:auth-changed', async () => {
    renderAccount();
    await safeRoute();
  });
  window.addEventListener('offline', () => toast('Sei offline. I contenuti locali restano disponibili.'));
  window.addEventListener('online', () => toast('Connessione ripristinata.'));
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
  await safeRoute();
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return parts;
}

async function safeRoute() {
  try {
    await route();
    if (!document.body.classList.contains('universe-mode')) {
      app.focus({ preventScroll: true });
    }
  } catch (err) {
    console.error(err);
    renderRouteError(err);
  }
}

async function route() {
  if (cleanupRoute) { cleanupRoute(); cleanupRoute = null; }
  const parts = parseRoute();
  const universeMode = parts.includes('universe');
  document.body.classList.toggle('universe-mode', universeMode);
  setActiveNav(parts[0] || 'home', universeMode);

  if (!parts.length) return renderHome();
  if (parts[0] === 'universe') return renderUniverse({});
  if (parts[0] === 'mine' && parts[1] === 'universe') return renderUniverse({ mineOnly: true });
  if (parts[0] === 'mine') return renderMyCatalogs();
  if (parts[0] === 'studio') return renderStudio();
  if (parts[0] === 'privacy') return renderLegalPage('privacy');
  if (parts[0] === 'terms') return renderLegalPage('terms');

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
  const activeHref = routeName === 'mine' ? '#/mine' : (universeMode ? '#/universe' : (map[routeName] || '#/'));
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === activeHref);
  });
}

function setPageMeta(title, description) {
  const fullTitle = title ? title + ' · StudyLibrary' : 'StudyLibrary';
  document.title = fullTitle;
  const update = (selector, value) => {
    const el = document.querySelector(selector);
    if (el && value) el.setAttribute('content', value);
  };
  update('meta[name="description"]', description);
  update('meta[property="og:title"]', fullTitle);
  update('meta[property="og:description"]', description);
  update('meta[name="twitter:title"]', fullTitle);
  update('meta[name="twitter:description"]', description);
}

function renderHome() {
  setPageMeta('Esplora', 'Cataloghi pubblici, librerie, lezioni e argomenti collegati.');
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
  setPageMeta('Il mio catalogo', 'Gestisci cataloghi, librerie e lezioni nel tuo spazio personale.');
  let catalogs = [];

  if (state.user && state.supabase) {
    try {
      catalogs = await fetchMyCatalogs();
    } catch (err) {
      console.warn(err);
      return renderNotFound('Impossibile caricare i tuoi cataloghi');
    }
  }

  app.innerHTML =
    '<div class="page">' +
      '<section class="collection-hero personal-hero">' +
        '<div><span class="eyebrow">Spazio personale</span><h1>Il mio catalogo</h1><p class="lede">Qui trovi tutta la tua struttura: cataloghi, librerie, lezioni e argomenti. Importa un JSON oppure apri l’editor visuale.</p></div>' +
        '<div class="hero-actions"><a class="button accent" href="#/studio">＋ Nuovo / Editor</a><a class="button secondary" href="#/mine/universe">Universo personale</a></div>' +
      '</section>' +
      (!state.supabase
        ? '<aside class="catalog-notice"><strong>Backend non configurato</strong><p>Collega Supabase per salvare il tuo spazio personale.</p></aside>'
        : !state.user
          ? '<aside class="catalog-notice"><strong>Accedi con Google</strong><p>Accedi per importare e gestire i tuoi cataloghi.</p></aside>'
          : '<section class="json-drop-zone" data-json-drop tabindex="0" role="button" aria-label="Importa file JSON"><div class="json-drop-icon">↓</div><div><strong>Trascina qui un file JSON</strong><span>oppure clicca per selezionarlo · catalogo singolo o export StudyLibrary</span></div><button class="button secondary" type="button" data-json-browse>Scegli file</button><input data-json-file type="file" accept="application/json,.json" multiple hidden></section>') +
      (state.user && catalogs.length
        ? '<section class="personal-catalog-list"><div class="section-head"><div><h2>I tuoi cataloghi</h2><p>Apri direttamente librerie, lezioni o l’universo del singolo catalogo.</p></div><span class="tag">' + catalogs.length + ' cataloghi</span></div>' + catalogs.map(renderPersonalCatalogTree).join('') + '</section>'
        : state.user
          ? '<div class="empty-state personal-empty"><h2>Il tuo spazio è vuoto</h2><p>Trascina qui sopra il primo JSON oppure crea un catalogo con l’editor.</p><a class="button accent" href="#/studio">Crea il primo catalogo</a></div>'
          : '') +
    '</div>';

  const dropZone = app.querySelector('[data-json-drop]');
  const fileInput = app.querySelector('[data-json-file]');
  const browse = app.querySelector('[data-json-browse]');

  browse?.addEventListener('click', event => {
    event.stopPropagation();
    fileInput?.click();
  });
  dropZone?.addEventListener('click', event => {
    if (event.target.closest('button')) return;
    fileInput?.click();
  });
  dropZone?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput?.click();
    }
  });
  ['dragenter','dragover'].forEach(type => dropZone?.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  }));
  ['dragleave','drop'].forEach(type => dropZone?.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  }));
  dropZone?.addEventListener('drop', event => importPersonalFiles([...event.dataTransfer.files]));
  fileInput?.addEventListener('change', async () => {
    await importPersonalFiles([...fileInput.files]);
    fileInput.value = '';
  });

  app.querySelectorAll('[data-edit-personal]').forEach(button => button.addEventListener('click', () => {
    const catalog = catalogs.find(item => catalogRef(item) === button.dataset.editPersonal);
    if (!catalog) return;
    state.activeCatalog = catalog;
    location.hash = '#/studio';
  }));
}

function renderPersonalCatalogTree(catalog) {
  const ref = catalogRef(catalog);
  const stats = catalogStats(catalog);
  return '<article class="personal-catalog">' +
    '<header class="personal-catalog-head">' +
      '<div><span class="eyebrow">' + escapeHtml(catalog.visibility === 'private' ? 'Privato' : 'Pubblico') + '</span><h3>' + escapeHtml(catalog.title) + '</h3><p>' + escapeHtml(catalog.description || '') + '</p></div>' +
      '<div class="personal-catalog-actions"><a href="#/catalog/' + encodeURIComponent(ref) + '">Apri</a><a href="#/catalog/' + encodeURIComponent(ref) + '/universe">Universo</a><button type="button" data-edit-personal="' + escapeHtml(ref) + '">Modifica</button></div>' +
    '</header>' +
    '<div class="personal-catalog-stats"><span>' + stats.libraries + ' librerie</span><span>' + stats.lessons + ' lezioni</span><span>' + stats.topics + ' argomenti</span><span>' + stats.media + ' media</span><span>v' + (catalog._db?.current_version || 1) + '</span><span>API ' + (catalog._db?.api_public ? 'pubblica' : 'privata') + '</span></div>' +
    '<div class="personal-library-tree">' +
      (catalog.libraries || []).map(library =>
        '<section class="personal-library">' +
          '<a class="personal-library-title" href="#/catalog/' + encodeURIComponent(ref) + '/library/' + encodeURIComponent(library.slug) + '"><i></i><strong>' + escapeHtml(library.title) + '</strong><span>' + (library.lessons?.length || 0) + ' lezioni</span></a>' +
          '<div class="personal-lessons">' +
            (library.lessons || []).map((lesson, index) =>
              '<a href="' + lessonHref(catalog, library.slug, lesson.slug) + '"><span>' + String(index + 1).padStart(2, '0') + '</span><strong>' + escapeHtml(lesson.title) + '</strong><em>' + (lesson.topics?.length || 0) + ' argomenti</em></a>'
            ).join('') +
          '</div>' +
        '</section>'
      ).join('') +
    '</div>' +
  '</article>';
}

async function importPersonalFiles(files) {
  if (!state.user || !state.supabase) return toast('Accedi con Google per importare');
  const jsonFiles = files.filter(file => file.name.toLowerCase().endsWith('.json') || file.type === 'application/json');
  if (!jsonFiles.length) return toast('Seleziona almeno un file JSON');

  let imported = 0;
  for (const file of jsonFiles) {
    if (file.size > 5 * 1024 * 1024) {
      toast(file.name + ': supera il limite di 5 MB');
      continue;
    }

    try {
      const parsed = JSON.parse(await file.text());

      if (parsed?.kind === 'studylibrary.update') {
        imported += await importUpdatePackage(parsed, file.name);
        continue;
      }

      const candidates = Array.isArray(parsed?.catalogs) ? parsed.catalogs : [normalizeImportedCatalog(parsed, file.name)];

      for (const candidate of candidates) {
        const validation = validateCatalog(candidate);
        if (!validation.ok) {
          showModal(
            'JSON non valido',
            '<p><strong>' + escapeHtml(file.name) + '</strong> non rispetta lo schema.</p><p class="demo-note">' + validation.errors.slice(0, 8).map(escapeHtml).join('<br>') + '</p>',
            [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
          );
          continue;
        }
        const existing = state.remoteCatalogs.find(item =>
          item?._db?.owner_id === state.user.id &&
          (item.slug === candidate.slug || item.id === candidate.id)
        );

        if (existing) {
          const approved = await confirmCatalogImport(existing, candidate, file.name);
          if (!approved) continue;
        }

        await saveCatalog(candidate, false, 'Importazione JSON: ' + file.name);
        imported += 1;
      }
    } catch (err) {
      toast(file.name + ': ' + err.message);
    }
  }

  if (imported) {
    await fetchMyCatalogs();
    toast(imported === 1 ? 'Catalogo importato come privato' : imported + ' cataloghi importati come privati');
    await renderMyCatalogs();
  }
}

async function prepareUpdatePackageCandidate(update, filename) {
  if (!state.user || !state.supabase) {
    toast(isBackendConfigured() ? 'Accedi con Google per applicare un aggiornamento' : 'Configura Supabase per applicare un aggiornamento');
    return null;
  }

  const findTarget = catalogs => (catalogs || []).find(item =>
    item?._db?.owner_id === state.user.id &&
    (
      item._db?.id === update.catalog ||
      item.slug === update.catalog ||
      item.id === update.catalog
    )
  );

  let target = findTarget(state.remoteCatalogs);
  if (!target) {
    const mine = await fetchMyCatalogs();
    target = findTarget(mine);
  }

  if (!target) {
    showModal(
      'Catalogo destinazione non trovato',
      '<p>Il pacchetto <strong>' + escapeHtml(filename) + '</strong> richiede il catalogo <code>' + escapeHtml(update.catalog || '') + '</code>.</p>',
      [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
    );
    return null;
  }

  if (update.baseVersion != null && Number(update.baseVersion) !== Number(target._db?.current_version || 1)) {
    showModal(
      'Conflitto di versione',
      '<p>Il pacchetto è basato sulla versione <strong>v' + escapeHtml(update.baseVersion) + '</strong>, ma il catalogo è già alla <strong>v' + escapeHtml(target._db?.current_version || 1) + '</strong>.</p><p class="demo-note">Rigenera l’aggiornamento partendo dalla versione corrente per evitare di sovrascrivere modifiche recenti.</p>',
      [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
    );
    return null;
  }

  let candidate;
  try {
    candidate = applyUpdatePackage(stripRuntimeForEditor(target), update);
  } catch (err) {
    showModal(
      'Pacchetto non applicabile',
      '<p>' + escapeHtml(err.message) + '</p>',
      [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
    );
    return null;
  }

  const validation = validateCatalog(candidate);
  if (!validation.ok) {
    showModal(
      'Aggiornamento non valido',
      '<p>Il risultato non rispetta lo schema StudyLibrary.</p><p class="demo-note">' + validation.errors.slice(0, 10).map(escapeHtml).join('<br>') + '</p>',
      [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
    );
    return null;
  }

  return { target, candidate };
}

async function importUpdatePackage(update, filename) {
  const prepared = await prepareUpdatePackageCandidate(update, filename);
  if (!prepared) return 0;

  const { target, candidate } = prepared;
  const approved = await confirmCatalogImport(target, candidate, filename);
  if (!approved) return 0;

  const publish = target.visibility === 'public';
  await saveCatalog(candidate, publish, update.message || ('Pacchetto aggiornamento: ' + filename));
  return 1;
}

function applyUpdatePackage(baseCatalog, update) {
  const catalog = structuredClone(baseCatalog);
  const operations = Array.isArray(update.operations) ? update.operations : [];
  if (!operations.length) throw new Error('Il pacchetto non contiene operazioni.');

  const findLibraryForOp = op => {
    const libraries = catalog.libraries || [];
    const requested = String(op.library || '').trim();

    let library = libraries.find(item => item.slug === requested || item.id === requested);
    if (library) return library;

    const normalizeKey = value => String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const normalizedRequested = normalizeKey(requested);
    if (normalizedRequested) {
      library = libraries.find(item =>
        normalizeKey(item.slug) === normalizedRequested ||
        normalizeKey(item.id) === normalizedRequested ||
        normalizeKey(item.title) === normalizedRequested
      );
      if (library) return library;
    }

    // Update package generated for a catalog with a single library:
    // if the human-readable library name changed, the target is still unambiguous.
    if (libraries.length === 1) return libraries[0];

    const available = libraries
      .map(item => item.slug || item.id || item.title)
      .filter(Boolean)
      .join(', ');
    throw new Error(
      'Libreria non trovata: ' + requested +
      (available ? '. Disponibili: ' + available : '')
    );
  };

  const findLessonForOp = op => {
    const library = findLibraryForOp(op);
    const lesson = (library.lessons || []).find(item => item.slug === op.lesson || item.id === op.lesson);
    if (!lesson) throw new Error('Lezione non trovata: ' + (op.lesson || ''));
    return { library, lesson };
  };

  for (const op of operations) {
    if (!op || !op.op) throw new Error('Operazione senza campo op.');

    if (op.op === 'upsertLesson') {
      const library = findLibraryForOp(op);
      if (!op.value || typeof op.value !== 'object') throw new Error('upsertLesson richiede value.');
      library.lessons ||= [];
      const index = library.lessons.findIndex(item =>
        item.slug === op.value.slug ||
        item.id === op.value.id
      );
      if (index >= 0) library.lessons[index] = structuredClone(op.value);
      else library.lessons.push(structuredClone(op.value));
      continue;
    }

    if (op.op === 'removeLesson') {
      const library = findLibraryForOp(op);
      const before = library.lessons?.length || 0;
      library.lessons = (library.lessons || []).filter(item => item.slug !== op.lesson && item.id !== op.lesson);
      if ((library.lessons?.length || 0) === before) throw new Error('Lezione non trovata: ' + (op.lesson || ''));
      continue;
    }

    if (op.op === 'upsertTopic') {
      const { lesson } = findLessonForOp(op);
      if (!op.value || typeof op.value !== 'object' || !op.value.id) throw new Error('upsertTopic richiede value.id.');
      lesson.topics ||= [];
      const index = lesson.topics.findIndex(item => item.id === op.value.id);
      if (index >= 0) lesson.topics[index] = structuredClone(op.value);
      else lesson.topics.push(structuredClone(op.value));

      lesson.modules ||= [];
      let module = null;
      if (op.module) module = lesson.modules.find(item => item.id === op.module);
      if (!module) module = lesson.modules[0];
      if (!module) {
        module = { id: op.module || 'contenuti', title: op.moduleTitle || 'Contenuti', topicIds: [] };
        lesson.modules.push(module);
      }
      module.topicIds ||= [];
      if (!module.topicIds.includes(op.value.id)) module.topicIds.push(op.value.id);
      continue;
    }

    if (op.op === 'removeTopic') {
      const { lesson } = findLessonForOp(op);
      const topicId = op.topic;
      const before = lesson.topics?.length || 0;
      lesson.topics = (lesson.topics || []).filter(item => item.id !== topicId);
      if ((lesson.topics?.length || 0) === before) throw new Error('Topic non trovato: ' + (topicId || ''));
      (lesson.modules || []).forEach(module => {
        module.topicIds = (module.topicIds || []).filter(id => id !== topicId);
      });
      (lesson.topics || []).forEach(topic => {
        topic.prerequisites = (topic.prerequisites || []).filter(id => id !== topicId);
        topic.connections = (topic.connections || []).filter(connection => connection.target !== topicId);
      });
      continue;
    }

    if (op.op === 'addConnection') {
      const { lesson } = findLessonForOp(op);
      const topic = (lesson.topics || []).find(item => item.id === op.from);
      if (!topic) throw new Error('Topic origine non trovato: ' + (op.from || ''));
      if (!op.connection?.target) throw new Error('addConnection richiede connection.target.');
      topic.connections ||= [];
      const duplicate = topic.connections.some(connection =>
        connection.target === op.connection.target &&
        (connection.type || 'related') === (op.connection.type || 'related')
      );
      if (!duplicate) topic.connections.push(structuredClone(op.connection));
      continue;
    }

    if (op.op === 'removeConnection') {
      const { lesson } = findLessonForOp(op);
      const topic = (lesson.topics || []).find(item => item.id === op.from);
      if (!topic) throw new Error('Topic origine non trovato: ' + (op.from || ''));
      topic.connections = (topic.connections || []).filter(connection =>
        !(connection.target === op.target && (!op.type || connection.type === op.type))
      );
      continue;
    }

    throw new Error('Operazione non supportata: ' + op.op);
  }

  return catalog;
}

function confirmCatalogImport(existing, candidate, filename) {
  const diff = summarizeCatalogDiff(existing, candidate);
  return new Promise(resolve => {
    showModal(
      'Aggiornare ' + escapeHtml(existing.title || candidate.title || 'catalogo') + '?',
      '<div class="import-diff">' +
        '<p><strong>' + escapeHtml(filename) + '</strong> aggiornerà un catalogo già esistente. Prima del salvataggio verrà mantenuto automaticamente lo snapshot attuale.</p>' +
        '<div class="diff-stats">' +
          '<span><strong>+' + diff.added + '</strong> aggiunti</span>' +
          '<span><strong>~' + diff.changed + '</strong> modificati</span>' +
          '<span><strong>−' + diff.removed + '</strong> rimossi</span>' +
        '</div>' +
        (diff.samples.length ? '<div class="diff-samples">' + diff.samples.slice(0, 8).map(item => '<code>' + escapeHtml(item) + '</code>').join('') + '</div>' : '') +
        '<p class="demo-note">Versione corrente: v' + (existing._db?.current_version || 1) + '. L’import creerà automaticamente la versione successiva.</p>' +
      '</div>',
      [
        {
          label: 'Applica aggiornamento',
          className: 'button',
          action: () => { closeModal(); resolve(true); }
        },
        {
          label: 'Annulla',
          className: 'button secondary',
          action: () => { closeModal(); resolve(false); }
        }
      ]
    );
  });
}

function summarizeCatalogDiff(before, after) {
  const flatten = catalog => {
    const map = new Map();
    for (const library of catalog?.libraries || []) {
      const libraryKey = 'library:' + (library.slug || library.id || 'library');
      map.set(libraryKey, library);
      for (const lesson of library.lessons || []) {
        const lessonKey = libraryKey + '/lesson:' + (lesson.slug || lesson.id || 'lesson');
        map.set(lessonKey, lesson);
        for (const topic of lesson.topics || []) {
          map.set(lessonKey + '/topic:' + (topic.id || 'topic'), topic);
        }
      }
    }
    return map;
  };

  const beforeMap = flatten(before);
  const afterMap = flatten(after);
  let added = 0;
  let changed = 0;
  let removed = 0;
  const samples = [];

  for (const [key, value] of afterMap) {
    if (!beforeMap.has(key)) {
      added += 1;
      samples.push('+ ' + key);
    } else if (JSON.stringify(stripRuntimeForEditor(beforeMap.get(key))) !== JSON.stringify(stripRuntimeForEditor(value))) {
      changed += 1;
      samples.push('~ ' + key);
    }
  }

  for (const key of beforeMap.keys()) {
    if (!afterMap.has(key)) {
      removed += 1;
      samples.push('− ' + key);
    }
  }

  return { added, changed, removed, samples };
}

function normalizeImportedCatalog(value, filename = 'catalogo.json') {
  if (value?.libraries && Array.isArray(value.libraries)) return stripRuntimeForEditor(value);

  if (Array.isArray(value?.topics) && Array.isArray(value?.modules)) {
    const base = filename.replace(/\.json$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'catalogo-importato';
    const lesson = stripRuntimeForEditor(value);
    lesson.slug ||= base + '-lezione';
    lesson.id ||= lesson.slug;
    return {
      schemaVersion: 2,
      id: base,
      slug: base,
      title: value.courseTitle || value.title || 'Catalogo importato',
      description: value.description || 'Importato da una singola lezione JSON.',
      language: 'it',
      visibility: 'private',
      tags: [],
    media: [],
      libraries: [{
        id: base + '-library',
        slug: base,
        title: value.courseTitle || 'Libreria importata',
        description: value.description || '',
        lessons: [lesson]
      }]
    };
  }

  return value;
}

async function renderCatalog(catalogSlug) {
  let catalog = findCatalog(catalogSlug);
  if (!catalog && state.user && state.supabase) {
    await fetchMyCatalogs();
    catalog = findCatalog(catalogSlug);
  }
  if (!catalog) return renderNotFound('Catalogo non trovato');

  setPageMeta(catalog.title, catalog.description || 'Catalogo StudyLibrary');
  state.activeCatalog = catalog;
  state.activeLibrary = null;
  state.activeLesson = null;
  state.activeTopic = null;

  const stats = catalogStats(catalog);
  const universe = '#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '/universe';
  const ownsCloudCatalog = Boolean(
    state.user &&
    catalog._db?.owner_id === state.user.id
  );
  const ownsCatalog = Boolean(catalog._static || ownsCloudCatalog);
  const editLabel = ownsCatalog ? 'Modifica' : 'Apri copia nell’editor';
  const publishButton = ownsCloudCatalog
    ? '<button class="button ' + (catalog.visibility === 'private' ? 'accent' : 'secondary') + '" type="button" data-toggle-publish>' +
        (catalog.visibility === 'private' ? 'Pubblica in Home' : 'Rendi privato') +
      '</button>'
    : '';
  const deleteButton = ownsCloudCatalog
    ? '<button class="button danger" type="button" data-delete-catalog>Elimina</button>'
    : '';
  const reportButton = catalog._db?.id && !ownsCloudCatalog
    ? '<button class="button ghost" type="button" data-report-catalog>Segnala</button>'
    : '';
  const apiButton = catalog._db?.id && (ownsCloudCatalog || catalog._db?.api_public)
    ? '<button class="button secondary" type="button" data-api-catalog>API</button>'
    : '';
  const versionsButton = ownsCloudCatalog
    ? '<button class="button secondary" type="button" data-version-history>Cronologia</button>'
    : '';

  app.innerHTML =
    '<div class="page">' +
      '<header class="collection-hero">' +
        '<div><span class="eyebrow">Catalogo</span><h1>' + escapeHtml(catalog.title) + '</h1><p class="lede">' + escapeHtml(catalog.description || '') + '</p></div>' +
        '<div class="collection-actions"><a class="button accent" href="' + universe + '">Universo catalogo</a>' + publishButton + apiButton + versionsButton + reportButton + '<button class="button secondary" type="button" data-edit-catalog>' + editLabel + '</button>' + deleteButton + '</div>' +
      '</header>' +
      '<div class="catalog-stats">' +
        '<div><strong>' + stats.libraries + '</strong><span>librerie</span></div>' +
        '<div><strong>' + stats.lessons + '</strong><span>lezioni</span></div>' +
        '<div><strong>' + stats.topics + '</strong><span>argomenti</span></div>' +
        '<div><strong>' + stats.media + '</strong><span>media</span></div>' +
        '<div><strong>' + (catalog.visibility === 'private' ? 'Privato' : 'Pubblico') + '</strong><span>Home</span></div>' +
        '<div><strong>' + (catalog._db?.api_public ? 'Pubblica' : 'Privata') + '</strong><span>API</span></div>' +
        '<div><strong>v' + (catalog._db?.current_version || 1) + '</strong><span>versione</span></div>' +
      '</div>' +
      '<section class="collection-list">' +
        '<div class="section-head"><div><h2>Librerie</h2><p>Ogni libreria raccoglie le lezioni di un corso o di un’area di studio.</p></div></div>' +
        (catalog.libraries || []).map(library => libraryCard(catalog, library)).join('') +
      '</section>' +
      '<div id="discussion-root"></div>' +
    '</div>';

  app.querySelector('[data-edit-catalog]')?.addEventListener('click', () => {
    state.activeCatalog = catalog;
    location.hash = '#/studio';
  });

  app.querySelector('[data-toggle-publish]')?.addEventListener('click', async () => {
    const makePublic = catalog.visibility === 'private';
    try {
      await saveCatalog(catalog, makePublic, makePublic ? 'Pubblicazione in Home' : 'Catalogo reso privato');
      await fetchPublicCatalogs();
      await fetchMyCatalogs();
      toast(makePublic ? 'Catalogo pubblicato nella Home' : 'Catalogo reso privato');
      await renderCatalog(catalogRef(catalog));
    } catch (err) {
      toast(err.message);
    }
  });

  app.querySelector('[data-api-catalog]')?.addEventListener('click', () => {
    openCatalogApiModal(catalog, ownsCloudCatalog);
  });

  app.querySelector('[data-version-history]')?.addEventListener('click', async () => {
    try {
      await openVersionHistory(catalog);
    } catch (err) {
      toast(err.message);
    }
  });

  app.querySelector('[data-delete-catalog]')?.addEventListener('click', () => {
    showModal('Eliminare il catalogo?', '<p>Verranno eliminati il catalogo cloud e i relativi contenuti salvati. Questa operazione non può essere annullata.</p>', [
      {
        label: 'Elimina catalogo',
        className: 'button danger',
        action: async () => {
          try {
            await deleteCatalog(catalog);
            closeModal();
            toast('Catalogo eliminato');
            location.hash = '#/mine';
          } catch (err) { toast(err.message); }
        }
      },
      { label: 'Annulla', className: 'button secondary', action: closeModal }
    ]);
  });

  app.querySelector('[data-report-catalog]')?.addEventListener('click', async () => {
    if (!state.user) {
      toast('Accedi con Google per inviare una segnalazione');
      return;
    }
    showModal('Segnala catalogo', '<p>Indica brevemente il problema.</p><textarea class="modal-textarea" data-catalog-report maxlength="500" placeholder="Spam, contenuto offensivo, violazione della privacy…"></textarea>', [
      {
        label: 'Invia segnalazione',
        className: 'button danger',
        action: async () => {
          const reason = document.querySelector('[data-catalog-report]')?.value || '';
          try {
            await reportContent('catalog', catalogRef(catalog), reason);
            closeModal();
            toast('Segnalazione inviata');
          } catch (err) { toast(err.message); }
        }
      },
      { label: 'Annulla', className: 'button secondary', action: closeModal }
    ]);
  });

  await renderDiscussion('catalog', catalogRef(catalog));
}

function openCatalogApiModal(catalog, owner = false) {
  const catalogId = catalog?._db?.id;
  if (!catalogId) return toast('Salva prima il catalogo nel cloud');

  const base = location.origin + '/api/v1/catalogs/' + encodeURIComponent(catalogId);
  const currentVersion = catalog._db?.current_version || 1;
  const writeUrl = location.origin + '/api/v1/write';

  const groups = [
    {
      title: 'Per agent / AI',
      note: 'Da qui un agente capisce protocollo, stato del catalogo e cosa manca.',
      endpoints: [
        {
          icon: '✦',
          label: 'Istruzioni agent/AI',
          description: 'Protocollo e regole StudyLibrary',
          url: location.origin + '/api/v1/agent'
        },
        {
          icon: '◎',
          label: 'Agent del catalogo',
          description: 'Versione, statistiche ed endpoint',
          url: base + '/agent'
        },
        {
          icon: '✓',
          label: 'Audit qualità',
          description: 'Problemi, warning e contenuti mancanti',
          url: base + '/audit'
        }
      ]
    },
    {
      title: 'Lettura',
      note: 'Contenuto pubblico del catalogo, contesto compatto e grafo.',
      endpoints: [
        {
          icon: 'C',
          label: 'Catalogo filtrato',
          description: 'JSON completo consentito dall’API',
          url: base
        },
        {
          icon: 'AI',
          label: 'Context compatto',
          description: 'Vista leggera pensata per modelli AI',
          url: base + '/context'
        },
        {
          icon: '⌘',
          label: 'Grafo',
          description: 'Nodi, prerequisiti e connessioni',
          url: base + '/graph'
        }
      ]
    },
    {
      title: 'Versioni',
      note: 'Cronologia e differenze rispetto alla versione corrente.',
      endpoints: [
        {
          icon: 'v',
          label: 'Cronologia versioni',
          description: 'Snapshot pubblici del catalogo',
          url: base + '/versions'
        },
        {
          icon: 'Δ',
          label: 'Cambiamenti da v' + currentVersion,
          description: 'Diff strutturale dalla versione corrente',
          url: base + '/changes/' + currentVersion
        }
      ]
    }
  ];

  const allEndpoints = groups.flatMap(group => group.endpoints);
  const status = catalog._db?.api_public
    ? '<span class="api-status on"><i></i>API pubblica attiva</span>'
    : '<span class="api-status off"><i></i>API pubblica disattivata</span>';

  const groupHtml = groups.map(group =>
    '<section class="api-group">' +
      '<div class="api-group-head"><div><h3>' + escapeHtml(group.title) + '</h3><p>' + escapeHtml(group.note) + '</p></div></div>' +
      '<div class="api-endpoint-grid">' +
        group.endpoints.map(endpoint =>
          '<article class="api-endpoint-card">' +
            '<div class="api-endpoint-icon" aria-hidden="true">' + escapeHtml(endpoint.icon) + '</div>' +
            '<div class="api-endpoint-main">' +
              '<div class="api-endpoint-title"><strong>' + escapeHtml(endpoint.label) + '</strong><span>' + escapeHtml(endpoint.description) + '</span></div>' +
              '<a class="api-endpoint-url" href="' + escapeHtml(endpoint.url) + '" target="_blank" rel="noopener noreferrer">' +
                '<code>' + escapeHtml(endpoint.url) + '</code>' +
              '</a>' +
            '</div>' +
            '<button class="api-copy-one" type="button" data-copy-api="' + escapeHtml(endpoint.url) + '" aria-label="Copia ' + escapeHtml(endpoint.label) + '">Copia</button>' +
          '</article>'
        ).join('') +
      '</div>' +
    '</section>'
  ).join('');

  const disabledNotice = owner && !catalog._db?.api_public
    ? '<div class="api-disabled-notice"><strong>API non ancora esposta</strong><span>Apri Modifica → Catalogo → API pubblica per rendere leggibili questi endpoint.</span></div>'
    : '';

  const copyAllText = [
    'StudyLibrary Knowledge API',
    'Catalogo: ' + (catalog.title || catalog.slug || catalogId),
    'Catalog ID: ' + catalogId,
    'Versione corrente: v' + currentVersion,
    'API pubblica: ' + (catalog._db?.api_public ? 'attiva' : 'disattivata'),
    '',
    ...groups.flatMap(group => [
      '[' + group.title + ']',
      ...group.endpoints.map(endpoint => endpoint.label + ': ' + endpoint.url),
      ''
    ]),
    '[Scrittura autenticata]',
    'POST ' + writeUrl,
    'Richiede Supabase access token e baseVersion.'
  ].join('\n');

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(copyAllText);
      toast('Tutti gli endpoint copiati');
    } catch {
      toast('Copia non disponibile nel browser');
    }
  };

  showModal(
    'Knowledge API',
    '<div class="api-modal">' +
      '<header class="api-modal-intro">' +
        '<div class="api-modal-title-row">' +
          '<div><span class="eyebrow">Developer access</span><h3>' + escapeHtml(catalog.title || 'Catalogo') + '</h3></div>' +
          '<div class="api-status-stack">' + status + '<span class="api-version-pill">v' + currentVersion + '</span></div>' +
        '</div>' +
        '<p>Usa questi endpoint per leggere il catalogo, controllarne la qualità e preparare aggiornamenti versionati. Per un agente, parti da <strong>Istruzioni agent/AI</strong>.</p>' +
        disabledNotice +
      '</header>' +
      '<div class="api-groups">' + groupHtml + '</div>' +
      '<section class="api-write-note">' +
        '<div class="api-write-icon" aria-hidden="true">⌁</div>' +
        '<div><strong>Scrittura autenticata</strong><code>POST ' + escapeHtml(writeUrl) + '</code><span>Richiede un Supabase access token e <code>baseVersion</code>; non è un endpoint pubblico anonimo.</span></div>' +
      '</section>' +
    '</div>',
    [
      { label: 'Chiudi', className: 'button secondary', action: closeModal },
      { label: 'Copia tutto', className: 'button accent api-copy-all', action: copyAll }
    ]
  );

  const shell = document.querySelector('#modal-backdrop .modal');
  shell?.classList.add('api-modal-shell');

  document.querySelectorAll('[data-copy-api]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyApi);
      const old = button.textContent;
      button.textContent = 'Copiato';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = old;
        button.classList.remove('copied');
      }, 1200);
    } catch {
      toast('Copia non disponibile nel browser');
    }
  }));
}

async function openVersionHistory(catalog) {
  if (!catalog?._db?.id) throw new Error('Catalogo non salvato nel cloud');
  const versions = await fetchCatalogVersions(catalog._db.id);

  const list = versions.length
    ? versions.map(version =>
        '<article class="version-row' + (version.version === catalog._db.current_version ? ' current' : '') + '">' +
          '<div><strong>v' + version.version + '</strong><span>' + escapeHtml(version.message || 'Aggiornamento') + '</span><time>' + escapeHtml(new Date(version.created_at).toLocaleString('it-IT')) + '</time></div>' +
          (version.version === catalog._db.current_version
            ? '<span class="version-current">Attuale</span>'
            : '<button type="button" data-restore-version="' + version.version + '">Ripristina</button>') +
        '</article>'
      ).join('')
    : '<p class="demo-note">Nessuna versione disponibile.</p>';

  showModal(
    'Cronologia versioni',
    '<div class="version-list">' + list + '</div><p class="demo-note">Il ripristino non cancella la cronologia: crea una nuova versione contenente lo snapshot scelto.</p>',
    [{ label: 'Chiudi', className: 'button secondary', action: closeModal }]
  );

  document.querySelectorAll('[data-restore-version]').forEach(button => button.addEventListener('click', async () => {
    const version = Number(button.dataset.restoreVersion);
    showModal(
      'Ripristinare v' + version + '?',
      '<p>Verrà creato un nuovo snapshot usando il contenuto della versione ' + version + '.</p>',
      [
        {
          label: 'Ripristina',
          className: 'button',
          action: async () => {
            try {
              await restoreCatalogVersion(catalog._db.id, version);
              await fetchMyCatalogs();
              closeModal();
              toast('Versione ' + version + ' ripristinata');
              await renderCatalog(catalogRef(catalog));
            } catch (err) {
              toast(err.message);
            }
          }
        },
        { label: 'Annulla', className: 'button secondary', action: closeModal }
      ]
    );
  }));
}

async function renderLibrary(catalogSlug, librarySlug) {
  let catalog = findCatalog(catalogSlug);
  if (!catalog && state.user && state.supabase) {
    await fetchMyCatalogs();
    catalog = findCatalog(catalogSlug);
  }
  const library = findLibrary(catalog, librarySlug);
  if (!catalog || !library) return renderNotFound('Libreria non trovata');

  setPageMeta(library.title, library.description || 'Libreria StudyLibrary');
  state.activeCatalog = catalog;
  state.activeLibrary = library;
  state.activeLesson = null;
  state.activeTopic = null;

  const universe =
    '#/catalog/' + encodeURIComponent(catalogRef(catalog)) +
    '/library/' + encodeURIComponent(library.slug) +
    '/universe';

  app.innerHTML =
    '<div class="page">' +
      '<div class="breadcrumb"><a href="#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '">' + escapeHtml(catalog.title) + '</a><span>→</span><strong>' + escapeHtml(library.title) + '</strong></div>' +
      '<header class="collection-hero compact">' +
        '<div><span class="eyebrow">Libreria</span><h1>' + escapeHtml(library.title) + '</h1><p class="lede">' + escapeHtml(library.description || '') + '</p></div>' +
        '<div class="collection-actions"><a class="button accent" href="' + universe + '">Universo libreria</a></div>' +
      '</header>' +
      '<section class="lesson-list">' +
        '<div class="section-head"><div><h2>Lezioni</h2><p>Ordinate come il materiale del corso.</p></div><span class="tag">' + (library.lessons?.length || 0) + ' lezioni</span></div>' +
        (library.lessons || []).map((lesson, index) => lessonCard(catalog, library, lesson, index)).join('') +
      '</section>' +
      '<div id="discussion-root"></div>' +
    '</div>';

  await renderDiscussion('library', catalogRef(catalog) + '/' + library.slug);
}

async function renderLesson(catalogSlug, librarySlug, lessonSlug, topicId = null) {
  let catalog = findCatalog(catalogSlug);
  if (!catalog && state.user && state.supabase) {
    await fetchMyCatalogs();
    catalog = findCatalog(catalogSlug);
  }
  const library = findLibrary(catalog, librarySlug);
  const lesson = findLesson(library, lessonSlug);
  if (!catalog || !library || !lesson) return renderNotFound('Lezione non trovata');

  setPageMeta(lesson.title, lesson.description || 'Lezione StudyLibrary');
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
  const universe = lessonHref(catalog, library.slug, lesson.slug) + '/universe';

  app.innerHTML =
    '<div class="page">' +
      '<header class="course-hero lesson-hero">' +
        '<div>' +
          '<div class="breadcrumb"><a href="#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '">' + escapeHtml(catalog.title) + '</a><span>→</span><a href="#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '/library/' + encodeURIComponent(library.slug) + '">' + escapeHtml(library.title) + '</a></div>' +
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
    catalogRef(catalog) + '/' + library.slug + '/' + lesson.slug + '/' + topic.id
  );
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function renderUniverse(options = {}) {
  const personal = Boolean(options.mineOnly);
  setPageMeta(personal ? 'Universo personale' : 'Universo', personal ? 'Esplora soltanto i tuoi cataloghi e collegamenti.' : 'Esplora visualmente cataloghi, librerie, lezioni e argomenti collegati.');

  let catalogs = personal ? [] : allCatalogs();
  let ownershipNote = personal ? 'Solo i tuoi cataloghi' : 'Cataloghi pubblici';

  if (state.user && state.supabase) {
    try {
      const mine = await fetchMyCatalogs();
      if (personal) {
        catalogs = mine;
      } else {
        const map = new Map(catalogs.map(catalog => [catalogRef(catalog), catalog]));
        mine.forEach(catalog => map.set(catalogRef(catalog), catalog));
        catalogs = [...map.values()];
        ownershipNote = 'Il tuo spazio personale + cataloghi pubblici';
      }
    } catch (err) {
      console.warn(err);
    }
  } else if (personal) {
    document.body.classList.remove('universe-mode');
    app.innerHTML = '<div class="page empty-state"><span class="eyebrow">Universo personale</span><h2>Accedi per vedere il tuo universo</h2><p>Il tuo universo comprende soltanto cataloghi, librerie, lezioni e argomenti che appartengono al tuo account.</p><a class="button secondary" href="#/mine">Torna al catalogo</a></div>';
    return;
  }

  let scopeTitle = personal ? 'Universo personale' : 'Universo totale';
  let scopeSubtitle = personal ? 'Tutto il tuo spazio di studio in una sola mappa.' : 'Cataloghi, librerie, lezioni e argomenti in un’unica mappa.';

  if (personal && !catalogs.length) {
    document.body.classList.remove('universe-mode');
    app.innerHTML = '<div class="page empty-state"><span class="eyebrow">Universo personale</span><h2>Ancora nessun nodo</h2><p>Importa o crea il tuo primo catalogo per costruire l’universo personale.</p><a class="button accent" href="#/mine">Importa un JSON</a></div>';
    return;
  }

  if (options.catalogSlug) {
    const catalog = catalogs.find(item => catalogRef(item) === options.catalogSlug || item.slug === options.catalogSlug || item.id === options.catalogSlug);
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
        '<button type="button" class="universe-control active" data-universe-lines data-mode="always" aria-pressed="true" title="Linee sempre visibili" aria-label="Linee sempre visibili"><span aria-hidden="true">→</span></button>' +
      '</div>' +

      '<div class="universe-legend">' +
        '<span><i class="legend-dot catalog"></i> Catalogo</span>' +
        '<span><i class="legend-dot library"></i> Libreria</span>' +
        '<span><i class="legend-dot lesson"></i> Lezione</span>' +
        '<span><i class="legend-dot topic"></i> Argomento</span>' +
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
  setPageMeta('Editor', 'Modifica cataloghi, librerie, lezioni e argomenti con un editor visuale Markdown.');
  let draft = stripRuntimeForEditor(state.activeCatalog || emptyCatalogTemplate());
  let visualEditor = null;
  let pendingUpdate = null;

  app.innerHTML = '<div class="studio-page">' +
    '<section class="studio-topbar">' +
      '<div><span class="eyebrow">Editor</span><h1>Modifica il catalogo</h1><p class="demo-note">Clicca direttamente su titoli, descrizioni e contenuti per modificarli. Slug, ID e impostazioni tecniche restano raccolti nei pannelli avanzati.</p></div>' +
      '<div class="toolbar-actions studio-save-actions"><input class="version-message-input" data-version-message maxlength="240" placeholder="Nota versione (opzionale)" aria-label="Nota versione"><button class="button secondary" data-new>Nuovo</button><button class="button secondary" data-import>Importa JSON</button><button class="button secondary" data-download>Scarica</button><button class="button" data-save>Salva privato</button><button class="button accent" data-publish>Pubblica</button></div>' +
    '</section>' +
    '<div class="studio-tabs" role="tablist"><button class="active" type="button" data-studio-tab="visual">Visuale</button><button type="button" data-studio-tab="json">JSON avanzato</button></div>' +
    '<div class="studio-workspace">' +
      '<section class="studio-main">' +
        '<div data-visual-editor></div>' +
        '<textarea class="json-editor studio-json-advanced" data-json-editor spellcheck="false" aria-label="Editor JSON" hidden></textarea>' +
        '<input data-file type="file" accept="application/json,.json" hidden />' +
      '</section>' +
      '<aside class="studio-side"><div data-validation></div><div data-preview></div><div class="schema-list"><div class="schema-item"><strong>Markdown</strong><span>Descrizioni, riassunti, spiegazioni e risposte supportano formattazione Markdown.</span></div><div class="schema-item"><strong>Media</strong><span>Immagini e video via URL vengono registrati automaticamente nel catalogo e riutilizzati con mediaRef.</span></div><div class="schema-item"><strong>Struttura</strong><span>Usa la colonna a sinistra per spostarti tra catalogo, librerie, lezioni e argomenti.</span></div><div class="schema-item"><strong>JSON avanzato</strong><span>Per proprietà speciali puoi sempre intervenire sul JSON completo.</span></div></div></aside>' +
    '</div>' +
  '</div>';

  const visualHost = app.querySelector('[data-visual-editor]');
  const rawEditor = app.querySelector('[data-json-editor]');
  const validationEl = app.querySelector('[data-validation]');
  const previewEl = app.querySelector('[data-preview]');
  const fileInput = app.querySelector('[data-file]');
  const versionMessageInput = app.querySelector('[data-version-message]');

  function validateAndPreview(value = draft) {
    const result = validateCatalog(value);
    validationEl.innerHTML = result.ok
      ? '<div class="validation ok">● Schema valido</div>'
      : '<div class="validation error">● ' + result.errors.length + ' problemi</div><p class="demo-note">' + result.errors.slice(0, 8).map(escapeHtml).join('<br>') + '</p>';
    const stats = catalogStats(value);
    previewEl.innerHTML = '<span class="eyebrow">Anteprima</span><h2 class="preview-title">' + escapeHtml(value.title || 'Senza titolo') + '</h2><p class="preview-description">' + escapeHtml(value.description || '') + '</p><div class="tags">' + (value.tags || []).slice(0, 4).map(tag => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div><p class="demo-note">' + stats.libraries + ' librerie · ' + stats.lessons + ' lezioni · ' + stats.topics + ' argomenti · ' + stats.media + ' media</p>';
    return result;
  }

  function mountVisual() {
    visualEditor?.destroy();
    visualEditor = mountCatalogEditor(visualHost, draft, {
      onChange(next) {
        draft = next;
        validateAndPreview();
      }
    });
  }

  mountVisual();
  validateAndPreview();

  app.querySelectorAll('[data-studio-tab]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.studioTab;
    if (mode === 'json') {
      rawEditor.value = JSON.stringify(draft, null, 2);
      rawEditor.hidden = false;
      visualHost.hidden = true;
    } else {
      try {
        if (!rawEditor.hidden) draft = JSON.parse(rawEditor.value);
      } catch (err) {
        toast('Il JSON contiene errori: ' + err.message);
        return;
      }
      rawEditor.hidden = true;
      visualHost.hidden = false;
      mountVisual();
      validateAndPreview();
    }
    app.querySelectorAll('[data-studio-tab]').forEach(tab => tab.classList.toggle('active', tab === button));
  }));

  let rawTimer;
  rawEditor.addEventListener('input', () => {
    clearTimeout(rawTimer);
    rawTimer = setTimeout(() => {
      try {
        draft = JSON.parse(rawEditor.value);
        validateAndPreview();
      } catch (err) {
        validationEl.innerHTML = '<div class="validation error">● JSON non valido</div><p class="demo-note">' + escapeHtml(err.message) + '</p>';
      }
    }, 180);
  });

  app.querySelector('[data-new]').addEventListener('click', () => {
    draft = emptyCatalogTemplate();
    state.activeCatalog = null;
    pendingUpdate = null;
    rawEditor.value = JSON.stringify(draft, null, 2);
    mountVisual();
    validateAndPreview();
  });

  app.querySelector('[data-import]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());

      if (parsed?.kind === 'studylibrary.update') {
        const prepared = await prepareUpdatePackageCandidate(parsed, file.name);
        if (!prepared) return;

        const { target, candidate } = prepared;
        draft = candidate;
        state.activeCatalog = target;
        pendingUpdate = {
          catalogId: target._db?.id || parsed.catalog,
          baseVersion: Number(target._db?.current_version || parsed.baseVersion || 1)
        };

        rawEditor.value = JSON.stringify(draft, null, 2);
        mountVisual();
        validateAndPreview();

        if (versionMessageInput) {
          versionMessageInput.value = String(parsed.message || ('Pacchetto aggiornamento: ' + file.name)).slice(0, 240);
        }

        const diff = summarizeCatalogDiff(target, candidate);
        showModal(
          'Aggiornamento caricato nell’editor',
          '<div class="import-diff">' +
            '<p><strong>' + escapeHtml(file.name) + '</strong> è stato riconosciuto come pacchetto <code>studylibrary.update</code> per <strong>' + escapeHtml(target.title || 'catalogo') + '</strong>.</p>' +
            '<div class="diff-stats">' +
              '<span><strong>+' + diff.added + '</strong> aggiunti</span>' +
              '<span><strong>~' + diff.changed + '</strong> modificati</span>' +
              '<span><strong>−' + diff.removed + '</strong> rimossi</span>' +
            '</div>' +
            (diff.samples.length ? '<div class="diff-samples">' + diff.samples.slice(0, 8).map(item => '<code>' + escapeHtml(item) + '</code>').join('') + '</div>' : '') +
            '<p class="demo-note">L’aggiornamento è solo caricato nell’editor: controllalo e poi usa Salva privato o Pubblica. Prima del salvataggio verrà ricontrollata la versione del catalogo.</p>' +
          '</div>',
          [{ label: 'Continua nell’editor', className: 'button', action: closeModal }]
        );
        return;
      }

      pendingUpdate = null;
      draft = normalizeImportedCatalog(parsed, file.name);
      rawEditor.value = JSON.stringify(draft, null, 2);
      mountVisual();
      validateAndPreview();
      toast('JSON caricato nell’editor');
    } catch (err) {
      toast(err.message);
    } finally {
      fileInput.value = '';
    }
  });

  app.querySelector('[data-download]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (draft.slug || 'catalog') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  app.querySelector('[data-save]').addEventListener('click', () => saveDraft(false));
  app.querySelector('[data-publish]').addEventListener('click', () => saveDraft(true));

  async function saveDraft(publish) {
    const result = validateAndPreview();
    if (!result.ok) return toast('Correggi prima gli errori nello schema');
    if (!state.user || !state.supabase) return toast(isBackendConfigured() ? 'Accedi con Google per salvare' : 'Configura Supabase per salvare online');
    try {
      if (pendingUpdate) {
        const mineBeforeSave = await fetchMyCatalogs();
        const current = mineBeforeSave.find(item =>
          item?._db?.id === pendingUpdate.catalogId ||
          item.slug === draft.slug ||
          item.id === draft.id
        );
        if (!current) throw new Error('Catalogo destinazione non trovato prima del salvataggio');

        const currentVersion = Number(current._db?.current_version || 1);
        if (currentVersion !== Number(pendingUpdate.baseVersion)) {
          throw new Error('Conflitto di versione: il catalogo è passato da v' + pendingUpdate.baseVersion + ' a v' + currentVersion + '. Ricarica il pacchetto prima di salvare.');
        }
      }

      const versionMessage = versionMessageInput?.value.trim() || (publish ? 'Pubblicazione dall’editor' : 'Salvataggio editor');
      await saveCatalog(draft, publish, versionMessage);
      pendingUpdate = null;
      if (publish) await fetchPublicCatalogs();
      const mine = await fetchMyCatalogs();
      state.activeCatalog = mine.find(item => item.slug === draft.slug) || null;
      if (versionMessageInput) versionMessageInput.value = '';
      toast(publish ? 'Catalogo pubblicato nella Home' : 'Catalogo salvato come privato');
    } catch (err) {
      toast(err.message);
    }
  }

  cleanupRoute = () => visualEditor?.destroy();
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
    api: { publicRead: false },
    tags: [],
    media: [],
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

function stripRuntimeForEditor(value) {
  if (Array.isArray(value)) return value.map(stripRuntimeForEditor);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    output[key] = stripRuntimeForEditor(item);
  }
  return output;
}

function renderLegalPage(kind) {
  const privacy = kind === 'privacy';
  setPageMeta(
    privacy ? 'Privacy' : 'Termini',
    privacy ? 'Informativa privacy di StudyLibrary.' : 'Termini di utilizzo di StudyLibrary.'
  );

  const content = privacy
    ? `<h1>Privacy</h1>
       <p>StudyLibrary può usare Google tramite Supabase Auth per identificare l'account. L'applicazione salva il profilo pubblico minimo fornito dal provider, i cataloghi creati, valutazioni, commenti e segnalazioni.</p>
       <h2>Contenuti pubblici e privati</h2>
       <p>I cataloghi privati sono accessibili al proprietario secondo le policy Row Level Security. I cataloghi pubblicati, i commenti e le valutazioni sono visibili agli altri utenti.</p>
       <h2>Dati tecnici</h2>
       <p>Il provider di hosting, il browser e i servizi collegati possono generare log tecnici secondo la loro configurazione. StudyLibrary non inserisce tracker pubblicitari nel codice dell'applicazione.</p>
       <h2>Controllo dei dati</h2>
       <p>Puoi esportare i tuoi cataloghi, eliminare i tuoi contenuti oppure eliminare definitivamente l’account dall’interfaccia. La cancellazione dell’account rimuove anche i dati applicativi associati tramite le relazioni del database.</p>`
    : `<h1>Termini di utilizzo</h1>
       <p>StudyLibrary è uno strumento per creare e condividere materiale di studio. Chi pubblica un catalogo resta responsabile del contenuto che carica e delle fonti che utilizza.</p>
       <h2>Contenuti</h2>
       <p>Non pubblicare materiale illecito, dati personali di terzi senza autorizzazione, spam o contenuti per i quali non possiedi i necessari diritti di utilizzo.</p>
       <h2>Community</h2>
       <p>Commenti e cataloghi possono essere segnalati. I contenuti segnalati possono essere rimossi dal gestore dell'istanza.</p>
       <h2>Disponibilità</h2>
       <p>Il servizio può cambiare durante lo sviluppo e non garantisce disponibilità continua o conservazione indefinita dei contenuti. Mantieni una copia dei JSON importanti.</p>`;

  app.innerHTML = '<div class="page page-narrow legal-page"><span class="eyebrow">StudyLibrary</span>' + content + '<p class="legal-updated">Versione: ottobre 2026</p></div>';
}

function renderRouteError(err) {
  document.body.classList.remove('universe-mode');
  setPageMeta('Errore', 'Si è verificato un errore durante il caricamento della pagina.');
  app.innerHTML = `<div class="page empty-state route-error"><span class="eyebrow">Errore</span><h2>Qualcosa non ha funzionato</h2><p>${escapeHtml(err?.message || 'Errore imprevisto')}</p><div class="hero-actions" style="justify-content:center"><button class="button" type="button" data-route-retry>Riprova</button><a class="button secondary" href="#/">Torna alla Home</a></div></div>`;
  app.querySelector('[data-route-retry]')?.addEventListener('click', safeRoute);
}

function renderNotFound(message = 'Pagina non trovata') {
  setPageMeta('Pagina non trovata', message);
  app.innerHTML = `<div class="page empty-state"><span class="eyebrow">404</span><h2>${escapeHtml(message)}</h2><p>Il contenuto potrebbe essere stato spostato, reso privato o eliminato.</p><div class="hero-actions" style="justify-content:center"><a class="button" href="#/">Esplora i cataloghi</a><a class="button secondary" href="#/mine">Il mio catalogo</a></div></div>`;
}

bootstrap();
