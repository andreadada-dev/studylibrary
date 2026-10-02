import { state, isBackendConfigured } from './js/state.js';
import { initBackend, fetchPublicCourses, fetchMyCourses, saveCourse } from './js/api.js';
import { loadStaticCourses, allCourses, findCourse, findTopic, getOrderedTopics, validateCourse } from './js/content.js';
import { renderAccount, courseCard, readerRail, topicArticle, wireReaderInteractions, renderDiscussion, toast, escapeHtml } from './js/ui.js';
import { renderUniverseGraph } from './js/graph.js';

const app = document.getElementById('app');
let cleanupRoute = null;

async function bootstrap() {
  app.innerHTML = `<div class="page"><div class="skeleton" style="height:180px"></div></div>`;
  try {
    await Promise.all([loadStaticCourses(), initBackend()]);
    if (state.supabase) {
      try { await fetchPublicCourses(); } catch (err) { console.warn('Remote courses unavailable', err); }
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
  document.body.classList.toggle('universe-mode', parts[0] === 'universe');
  setActiveNav(parts[0] || 'home');

  if (!parts.length) return renderHome();
  if (parts[0] === 'universe') return renderUniverse();
  if (parts[0] === 'studio') return renderStudio();
  if (parts[0] === 'course' && parts[1]) {
    if (parts[2] === 'topic' && parts[3]) return renderCourse(parts[1], parts[3]);
    return renderCourse(parts[1]);
  }
  return renderNotFound();
}

function setActiveNav(routeName) {
  const map = { home: '#/', universe: '#/universe', studio: '#/studio', course: '#/' };
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.getAttribute('href') === (map[routeName] || '#/')));
}

function renderHome() {
  const courses = allCourses();
  app.innerHTML = `<div class="page">
    <section class="hero">
      <span class="eyebrow">Spazio Universo</span>
      <h1 class="display">Capire prima.<br/>Memorizzare dopo.</h1>
      <p class="lede">Trasforma slide sparse in percorsi leggibili, collegati e verificabili. Ogni concetto dice cosa richiede, cosa sblocca e dove viene usato.</p>
      <div class="hero-actions">
        <div class="searchbar"><input data-course-search type="search" placeholder="Cerca corso o argomento…" aria-label="Cerca"/><kbd>⌘K</kbd></div>
        <a class="button secondary" href="#/universe">Apri l'universo</a>
      </div>
    </section>

    <section>
      <div class="section-head"><div><h2>Biblioteca pubblica</h2><p>Corsi completi e mappe di argomenti pubblicati dalla community.</p></div><span class="tag">${courses.length} corsi</span></div>
      <div class="course-grid" data-course-grid>${courses.map(courseCard).join('')}</div>
      <div class="empty-state" data-no-results hidden><h2>Nessun risultato</h2><p>Prova con un altro termine.</p></div>
    </section>

    <hr class="section-rule" />
    <section class="micro-features">
      <div class="micro-feature"><span class="index">01</span><h3>JSON-first</h3><p>Il contenuto resta portabile. Puoi scriverlo a mano, generarlo, versionarlo su Git e pubblicarlo dal browser.</p></div>
      <div class="micro-feature"><span class="index">02</span><h3>Relazioni esplicite</h3><p>Prerequisiti, concetti collegati e applicazioni diventano archi dell'universo, non note perse tra pagine.</p></div>
      <div class="micro-feature"><span class="index">03</span><h3>Leggibilità prima della UI</h3><p>Una sola colonna di lettura, gerarchia tipografica forte e contenitori solo quando hanno significato.</p></div>
    </section>
  </div>`;

  const input = app.querySelector('[data-course-search]');
  const grid = app.querySelector('[data-course-grid]');
  const empty = app.querySelector('[data-no-results]');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = courses.filter(c => {
      const hay = [c.title, c.description, ...(c.tags || []), ...(c.topics || []).map(t => `${t.title} ${t.summary}`)].join(' ').toLowerCase();
      return hay.includes(q);
    });
    grid.innerHTML = filtered.map(courseCard).join('');
    empty.hidden = filtered.length > 0;
  });
}

async function renderCourse(slug, topicId = null) {
  const course = findCourse(slug);
  if (!course) return renderNotFound('Corso non trovato');
  const ordered = getOrderedTopics(course);
  const topic = topicId ? findTopic(course, topicId) : ordered[0];
  if (!topic) return renderNotFound('Argomento non trovato');
  state.activeCourse = course;
  state.activeTopic = topic;

  const minutes = course.estimatedMinutes || ordered.reduce((a, t) => a + (t.estimatedMinutes || 0), 0);
  const currentIndex = Math.max(0, ordered.findIndex(t => t.id === topic.id));
  const progress = ordered.length ? Math.round(((currentIndex + 1) / ordered.length) * 100) : 0;

  app.innerHTML = `<div class="page">
    <header class="course-hero">
      <div>
        <span class="eyebrow">${escapeHtml(course.university || 'Corso')}</span>
        <h1>${escapeHtml(course.title)}</h1>
        <p class="summary">${escapeHtml(course.description || '')}</p>
        <div class="progress-track" aria-label="Avanzamento nel corso"><span style="--progress:${progress}%"></span></div>
      </div>
      <div class="course-statline">
        <div class="stat"><strong>${ordered.length}</strong><span>argomenti</span></div>
        <div class="stat"><strong>${minutes || '—'}</strong><span>minuti stimati</span></div>
        <div class="stat"><strong>${(course.modules || []).length}</strong><span>moduli</span></div>
        <div class="stat"><strong>${escapeHtml(course.language?.toUpperCase() || 'IT')}</strong><span>lingua</span></div>
      </div>
    </header>

    <div class="course-layout">
      <aside class="topic-rail">${readerRail(course, topic.id)}</aside>
      ${topicArticle(course, topic)}
    </div>
  </div>`;

  wireReaderInteractions();
  await renderDiscussion('topic', `${course.slug}/${topic.id}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function renderUniverse() {
  let courses = allCourses();
  let ownershipNote = 'Corsi pubblici e contenuti locali';

  if (state.user && state.supabase) {
    try {
      const mine = await fetchMyCourses();
      const map = new Map(courses.map(c => [c.slug, c]));
      mine.forEach(c => map.set(c.slug, c));
      courses = [...map.values()];
      ownershipNote = 'Il tuo spazio personale + biblioteca pubblica';
    } catch (err) { console.warn(err); }
  }

  app.innerHTML = `<section class="universe-full">
    <div class="universe-canvas" data-universe-graph aria-label="Mappa interattiva dei corsi e degli argomenti"></div>

    <div class="universe-titlebar">
      <span class="universe-overline">Spazio Universo</span>
      <h1>Conoscenza, non cartelle.</h1>
      <p>${escapeHtml(ownershipNote)}</p>
      <span class="universe-stats" data-universe-stats></span>
    </div>

    <div class="universe-search-wrap">
      <div class="universe-searchbox">
        <span aria-hidden="true">⌕</span>
        <input data-universe-search type="search" placeholder="Cerca un corso o un argomento…" autocomplete="off" aria-label="Cerca nell'universo" />
        <kbd>Esc</kbd>
      </div>
      <div class="universe-search-results" data-universe-results hidden></div>
    </div>

    <div class="universe-actions" aria-label="Controlli mappa">
      <button type="button" class="universe-control" data-universe-fit title="Mostra tutta la mappa" aria-label="Mostra tutta la mappa">
        <span aria-hidden="true">⌗</span>
      </button>
      <button type="button" class="universe-control" data-universe-labels aria-pressed="true" title="Mostra o nascondi etichette" aria-label="Mostra o nascondi etichette">
        <span aria-hidden="true">Aa</span>
      </button>
    </div>

    <div class="universe-legend">
      <span><i class="legend-dot"></i> Corso</span>
      <span><i class="legend-dot topic"></i> Argomento</span>
      <span class="universe-legend-hint">trascina · rotella per zoom · clicca per esplorare</span>
    </div>

    <aside class="universe-inspector" data-universe-inspector hidden></aside>
  </section>`;

  const graphHost = app.querySelector('[data-universe-graph]');
  cleanupRoute = renderUniverseGraph(graphHost, courses) || null;

  requestAnimationFrame(() => {
    app.querySelector('[data-universe-search]')?.focus({ preventScroll: true });
  });
}

async function renderStudio() {
  let initial = state.activeCourse || allCourses()[0];
  if (!initial) initial = emptyCourseTemplate();
  app.innerHTML = `<div class="studio-layout">
    <section class="studio-editor">
      <div class="studio-toolbar"><h1>Studio JSON</h1><div class="toolbar-actions"><button class="button secondary" data-new>Nuovo</button><button class="button secondary" data-import>Importa</button><button class="button secondary" data-download>Scarica</button><button class="button" data-save>Salva</button><button class="button accent" data-publish>Pubblica</button></div></div>
      <textarea class="json-editor" spellcheck="false" aria-label="Editor JSON"></textarea>
      <input data-file type="file" accept="application/json,.json" hidden />
    </section>
    <aside class="studio-side">
      <div data-validation></div>
      <div data-preview></div>
      <div class="schema-list">
        <div class="schema-item"><strong>1. Perché serve</strong><span>Ogni topic deve spiegare il valore pratico prima della teoria.</span></div>
        <div class="schema-item"><strong>2. Prerequisiti</strong><span>Usa ID di altri topic. Diventeranno archi nella mappa.</span></div>
        <div class="schema-item"><strong>3. Intuizione → formalismo</strong><span>Prima una rappresentazione mentale, poi formule e definizioni.</span></div>
        <div class="schema-item"><strong>4. Visuale o esempio</strong><span>Diagrammi, immagini, confronti o un caso svolto. Mai solo testo lungo.</span></div>
        <div class="schema-item"><strong>5. Checkpoint + fonti</strong><span>Una domanda di verifica e almeno una fonte per ogni argomento.</span></div>
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
    const result = validateCourse(parsed);
    validationEl.innerHTML = result.ok ? `<div class="validation ok">● Schema valido</div>` : `<div class="validation error">● ${result.errors.length} problemi</div><p class="demo-note">${result.errors.slice(0,6).map(escapeHtml).join('<br>')}</p>`;
    previewEl.innerHTML = `<span class="eyebrow">Anteprima</span><h2 class="preview-title">${escapeHtml(parsed.title || 'Senza titolo')}</h2><p class="preview-description">${escapeHtml(parsed.description || '')}</p><div class="tags">${(parsed.tags || []).slice(0,4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div><p class="demo-note">${parsed.topics?.length || 0} argomenti · ${parsed.modules?.length || 0} moduli</p>`;
    return { parsed, result };
  };

  let timer;
  editor.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(updatePreview, 150); });
  updatePreview();

  app.querySelector('[data-new]').addEventListener('click', () => { editor.value = JSON.stringify(emptyCourseTemplate(), null, 2); updatePreview(); });
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
    a.download = `${checked.parsed.slug || 'course'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  app.querySelector('[data-save]').addEventListener('click', () => saveEditorCourse(false));
  app.querySelector('[data-publish]').addEventListener('click', () => saveEditorCourse(true));

  async function saveEditorCourse(publish) {
    const checked = updatePreview();
    if (!checked?.result.ok) return toast('Correggi prima gli errori nello schema');
    if (!state.user || !state.supabase) return toast(isBackendConfigured() ? 'Accedi con Google per salvare' : 'Configura Supabase per salvare online');
    try {
      await saveCourse(checked.parsed, publish);
      if (publish) await fetchPublicCourses();
      toast(publish ? 'Corso pubblicato' : 'Bozza salvata');
    } catch (err) { toast(err.message); }
  }
}

function emptyCourseTemplate() {
  const id = `course-${Date.now()}`;
  return {
    schemaVersion: 1,
    id,
    slug: id,
    title: 'Nuovo corso',
    description: 'Una frase che spiega cosa imparerai e perché conta.',
    language: 'it',
    visibility: 'private',
    tags: [],
    sources: [],
    modules: [{ id: 'fondamenti', title: 'Fondamenti', topicIds: ['primo-argomento'] }],
    topics: [{
      id: 'primo-argomento',
      title: 'Primo argomento',
      summary: 'Una spiegazione breve e concreta.',
      why: 'Spiega qui perché lo studente dovrebbe impararlo.',
      estimatedMinutes: 8,
      prerequisites: [],
      learningGoals: ['Capire l’idea centrale', 'Saperla collegare al resto del corso'],
      sections: [
        { type: 'lead', body: 'Parti da un’intuizione semplice.' },
        { type: 'concept', title: 'Idea chiave', body: 'Poi costruisci il concetto in modo progressivo.' },
        { type: 'checkpoint', question: 'Qual è l’idea centrale?', answer: 'Scrivi qui una risposta breve e verificabile.' }
      ],
      connections: [],
      sources: [{ ref: 'source-1', pages: '', note: 'Aggiungi una fonte reale.' }]
    }]
  };
}

function renderNotFound(message = 'Pagina non trovata') {
  app.innerHTML = `<div class="page empty-state"><span class="eyebrow">404</span><h2>${escapeHtml(message)}</h2><p><a class="button secondary" href="#/">Torna alla biblioteca</a></p></div>`;
}

bootstrap();
