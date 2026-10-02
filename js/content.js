import { state } from './state.js';

const REGISTRY_URL = '/data/catalog.json';

export async function loadStaticCatalogs() {
  const registry = await fetch(REGISTRY_URL).then(r => {
    if (!r.ok) throw new Error('Impossibile caricare il catalogo locale');
    return r.json();
  });

  const catalogs = await Promise.all((registry.catalogs || []).map(async item => {
    const manifest = await fetch(item.src).then(r => {
      if (!r.ok) throw new Error('Impossibile caricare ' + item.src);
      return r.json();
    });
    return hydrateCatalog({ ...manifest, _static: true, _manifestSrc: item.src });
  }));

  state.staticCatalogs = catalogs;
  return catalogs;
}

async function hydrateCatalog(catalog) {
  const libraries = await Promise.all((catalog.libraries || []).map(async library => {
    const lessons = await Promise.all((library.lessons || []).map(async lesson => {
      if (!lesson.src) return normalizeLesson(lesson);
      const source = await fetch(lesson.src).then(r => {
        if (!r.ok) throw new Error('Impossibile caricare la lezione ' + lesson.src);
        return r.json();
      });
      const hydrated = normalizeLesson({
        ...source,
        ...lesson,
        id: lesson.id || source.id,
        slug: lesson.slug || source.slug,
        title: lesson.title || source.title,
        description: lesson.description || source.description,
        accent: lesson.accent || source.accent,
        _lessonSrc: lesson.src
      });
      delete hydrated.src;
      return hydrated;
    }));
    return { ...library, lessons };
  }));

  return { ...catalog, libraries };
}

function normalizeLesson(lesson) {
  return {
    schemaVersion: lesson.schemaVersion || 1,
    ...lesson,
    modules: lesson.modules || [],
    topics: lesson.topics || [],
    sources: lesson.sources || []
  };
}

export function catalogRef(catalog) {
  if (!catalog) return '';
  return catalog._db?.id || catalog.slug || catalog.id;
}

function catalogMapKey(catalog) {
  if (catalog?._db?.id) return 'db:' + catalog._db.id;
  if (catalog?._static) return 'static:' + (catalog.slug || catalog.id);
  return 'json:' + (catalog.id || catalog.slug);
}

export function allCatalogs() {
  const map = new Map();
  for (const catalog of state.staticCatalogs) map.set(catalogMapKey(catalog), catalog);
  for (const catalog of state.remoteCatalogs) map.set(catalogMapKey(catalog), catalog);
  return [...map.values()];
}

export function findCatalog(identifier) {
  return allCatalogs().find(catalog =>
    catalogRef(catalog) === identifier ||
    catalog.slug === identifier ||
    catalog.id === identifier
  ) || null;
}

export function findLibrary(catalog, librarySlug) {
  return catalog?.libraries?.find(l => l.slug === librarySlug || l.id === librarySlug) || null;
}

export function findLesson(library, lessonSlug) {
  return library?.lessons?.find(l => l.slug === lessonSlug || l.id === lessonSlug) || null;
}

export function findTopic(lesson, topicId) {
  return lesson?.topics?.find(t => t.id === topicId) || null;
}

export function topicNumber(lesson, topicId) {
  const ordered = getOrderedTopics(lesson);
  const i = ordered.findIndex(t => t.id === topicId);
  return i < 0 ? null : i + 1;
}

export function getOrderedTopics(lesson) {
  const topicById = new Map((lesson?.topics || []).map(t => [t.id, t]));
  const ordered = [];
  for (const module of lesson?.modules || []) {
    for (const id of module.topicIds || []) {
      const topic = topicById.get(id);
      if (topic && !ordered.includes(topic)) ordered.push(topic);
    }
  }
  for (const topic of lesson?.topics || []) if (!ordered.includes(topic)) ordered.push(topic);
  return ordered;
}

export function catalogStats(catalog) {
  let libraries = 0;
  let lessons = 0;
  let topics = 0;
  let minutes = 0;

  for (const library of catalog?.libraries || []) {
    libraries += 1;
    for (const lesson of library.lessons || []) {
      lessons += 1;
      topics += lesson.topics?.length || 0;
      minutes += lesson.estimatedMinutes ||
        (lesson.topics || []).reduce((sum, topic) => sum + (topic.estimatedMinutes || 0), 0);
    }
  }

  return { libraries, lessons, topics, minutes };
}

export function validateCatalog(catalog) {
  const errors = [];
  const required = ['schemaVersion', 'id', 'slug', 'title', 'description', 'libraries'];
  required.forEach(key => {
    if (catalog?.[key] === undefined || catalog?.[key] === null || catalog?.[key] === '') {
      errors.push('Catalogo: manca ' + key);
    }
  });

  if (String(catalog?.title || '').length > 160) errors.push('Catalogo: title supera 160 caratteri');
  if (String(catalog?.description || '').length > 4000) errors.push('Catalogo: description supera 4000 caratteri');
  if (Array.isArray(catalog?.tags) && catalog.tags.length > 20) errors.push('Catalogo: massimo 20 tag');

  try {
    const bytes = new TextEncoder().encode(JSON.stringify(catalog)).length;
    if (bytes > 5 * 1024 * 1024) errors.push('Catalogo: il JSON supera il limite di 5 MB');
  } catch {
    errors.push('Catalogo: impossibile serializzare il JSON');
  }

  if (!Array.isArray(catalog?.libraries) || !catalog.libraries.length) {
    errors.push('Il catalogo deve contenere almeno una libreria');
    return { ok: false, errors };
  }

  const librarySlugs = new Set();
  for (const [libraryIndex, library] of catalog.libraries.entries()) {
    if (!library.slug) errors.push('Libreria ' + (libraryIndex + 1) + ': manca slug');
    if (!library.title) errors.push('Libreria ' + (libraryIndex + 1) + ': manca title');
    if (library.slug && librarySlugs.has(library.slug)) errors.push('Libreria duplicata: ' + library.slug);
    librarySlugs.add(library.slug);

    if (!Array.isArray(library.lessons) || !library.lessons.length) {
      errors.push('Libreria ' + (library.slug || libraryIndex + 1) + ': aggiungi almeno una lezione');
      continue;
    }

    const lessonSlugs = new Set();
    for (const [lessonIndex, lesson] of library.lessons.entries()) {
      const label = 'Libreria ' + (library.slug || libraryIndex + 1) + ', lezione ' + (lesson.slug || lessonIndex + 1);
      if (!lesson.slug) errors.push(label + ': manca slug');
      if (!lesson.title) errors.push(label + ': manca title');
      if (lesson.slug && lessonSlugs.has(lesson.slug)) errors.push(label + ': slug duplicato');
      lessonSlugs.add(lesson.slug);

      const lessonValidation = validateLesson(lesson);
      errors.push(...lessonValidation.errors.map(error => label + ': ' + error));
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateLesson(lesson) {
  const errors = [];
  if (!Array.isArray(lesson?.topics) || !lesson.topics.length) errors.push('topics deve contenere almeno un argomento');
  if (!Array.isArray(lesson?.modules) || !lesson.modules.length) errors.push('modules deve contenere almeno un modulo');

  const ids = new Set();
  for (const [index, topic] of (lesson?.topics || []).entries()) {
    if (!topic.id) errors.push('Topic ' + (index + 1) + ': manca id');
    if (topic.id && ids.has(topic.id)) errors.push('Topic id duplicato: ' + topic.id);
    ids.add(topic.id);

    for (const key of ['title', 'summary', 'why', 'sections']) {
      if (topic?.[key] === undefined || topic?.[key] === null || topic?.[key] === '') {
        errors.push('Topic ' + (topic.id || index + 1) + ': manca ' + key);
      }
    }

    if (!Array.isArray(topic.sections) || !topic.sections.some(section => section.type === 'checkpoint')) {
      errors.push('Topic ' + (topic.id || index + 1) + ': aggiungi almeno un checkpoint');
    }

    if (!Array.isArray(topic.sources) || !topic.sources.length) {
      errors.push('Topic ' + (topic.id || index + 1) + ': aggiungi almeno una fonte');
    }
  }

  for (const module of lesson?.modules || []) {
    for (const id of module.topicIds || []) {
      if (!ids.has(id)) errors.push('Modulo ' + module.id + ': topic sconosciuto ' + id);
    }
  }

  for (const topic of lesson?.topics || []) {
    for (const prerequisite of topic.prerequisites || []) {
      if (!prerequisite.includes('/') && !ids.has(prerequisite)) {
        errors.push('Topic ' + topic.id + ': prerequisito sconosciuto ' + prerequisite);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function catalogGraph(catalogs = allCatalogs(), options = {}) {
  const {
    catalogSlug = null,
    librarySlug = null,
    lessonSlug = null
  } = options;

  const nodes = [];
  const links = [];
  const known = new Set();
  const topicContext = new Map();

  const includeCatalogNode = !librarySlug && !lessonSlug;
  const includeLibraryNode = !lessonSlug;

  for (const catalog of catalogs) {
    if (catalogSlug && !catalogMatches(catalog, catalogSlug)) continue;

    const catalogKey = catalogRef(catalog);
    const catalogId = 'catalog:' + catalogKey;
    if (includeCatalogNode) {
      addNode({
        id: catalogId,
        type: 'catalog',
        title: catalog.title,
        description: catalog.description || '',
        catalogSlug: catalogKey,
        group: catalogKey,
        href: '#/catalog/' + encodeURIComponent(catalogKey)
      });
    }

    for (const library of catalog.libraries || []) {
      if (librarySlug && library.slug !== librarySlug) continue;

      const libraryId = catalogKey + '/' + library.slug;
      if (includeLibraryNode) {
        addNode({
          id: libraryId,
          type: 'library',
          title: library.title,
          description: library.description || '',
          catalogSlug: catalogKey,
          librarySlug: library.slug,
          group: catalogKey,
          href: '#/catalog/' + encodeURIComponent(catalogKey) + '/library/' + encodeURIComponent(library.slug)
        });
        if (includeCatalogNode) links.push({ source: catalogId, target: libraryId, type: 'contains' });
      }

      for (const lesson of library.lessons || []) {
        if (lessonSlug && lesson.slug !== lessonSlug) continue;

        const lessonId = catalogKey + '/' + library.slug + '/' + lesson.slug;
        addNode({
          id: lessonId,
          type: 'lesson',
          title: lesson.title,
          description: lesson.description || '',
          catalogSlug: catalogKey,
          librarySlug: library.slug,
          lessonSlug: lesson.slug,
          group: catalogKey,
          href: lessonHref(catalog, library.slug, lesson.slug)
        });

        if (includeLibraryNode) links.push({ source: libraryId, target: lessonId, type: 'contains' });

        for (const topic of lesson.topics || []) {
          const topicId = lessonId + '/' + topic.id;
          addNode({
            id: topicId,
            type: 'topic',
            title: topic.title,
            description: topic.summary || '',
            estimatedMinutes: topic.estimatedMinutes || null,
            catalogSlug: catalogKey,
            librarySlug: library.slug,
            lessonSlug: lesson.slug,
            topicId: topic.id,
            group: catalogKey,
            href: lessonHref(catalog, library.slug, lesson.slug) + '/topic/' + encodeURIComponent(topic.id)
          });
          links.push({ source: lessonId, target: topicId, type: 'contains' });
          topicContext.set(topicId, { catalog, library, lesson, topic });
        }
      }
    }
  }

  for (const [sourceId, context] of topicContext.entries()) {
    const { catalog, library, lesson, topic } = context;

    for (const prerequisite of topic.prerequisites || []) {
      const target = resolveTopicTarget(prerequisite, catalog, library, lesson, catalogs);
      if (known.has(target)) links.push({ source: target, target: sourceId, type: 'requires' });
    }

    for (const connection of topic.connections || []) {
      const target = resolveTopicTarget(connection.target, catalog, library, lesson, catalogs);
      if (known.has(target)) {
        links.push({
          source: sourceId,
          target,
          type: connection.type || 'related',
          label: connection.label || ''
        });
      }
    }
  }

  return { nodes, links };

  function addNode(node) {
    if (known.has(node.id)) return;
    known.add(node.id);
    nodes.push(node);
  }
}

function catalogMatches(catalog, identifier) {
  return catalogRef(catalog) === identifier ||
    catalog.slug === identifier ||
    catalog.id === identifier;
}

function resolveTopicTarget(target, catalog, library, lesson, catalogs) {
  const parts = String(target || '').split('/').filter(Boolean);
  const currentCatalog = catalogRef(catalog);

  if (parts.length === 1) {
    return currentCatalog + '/' + library.slug + '/' + lesson.slug + '/' + parts[0];
  }
  if (parts.length === 2) {
    return currentCatalog + '/' + library.slug + '/' + parts[0] + '/' + parts[1];
  }
  if (parts.length === 3) {
    return currentCatalog + '/' + parts[0] + '/' + parts[1] + '/' + parts[2];
  }
  if (parts.length >= 4) {
    const externalCatalog = (catalogs || []).find(item => catalogMatches(item, parts[0]));
    const externalRef = externalCatalog ? catalogRef(externalCatalog) : parts[0];
    return externalRef + '/' + parts[1] + '/' + parts[2] + '/' + parts[3];
  }

  return '';
}

export function lessonHref(catalogOrRef, librarySlug, lessonSlug) {
  const ref = typeof catalogOrRef === 'object' ? catalogRef(catalogOrRef) : catalogOrRef;
  return '#/catalog/' + encodeURIComponent(ref) +
    '/library/' + encodeURIComponent(librarySlug) +
    '/lesson/' + encodeURIComponent(lessonSlug);
}

export function universeHref({ catalogSlug = null, librarySlug = null, lessonSlug = null } = {}) {
  if (!catalogSlug) return '#/universe';
  let href = '#/catalog/' + encodeURIComponent(catalogSlug);
  if (librarySlug) href += '/library/' + encodeURIComponent(librarySlug);
  if (lessonSlug) href += '/lesson/' + encodeURIComponent(lessonSlug);
  return href + '/universe';
}
