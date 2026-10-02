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

export function allCatalogs() {
  const map = new Map();
  for (const catalog of state.staticCatalogs) map.set(catalog.slug, catalog);
  for (const catalog of state.remoteCatalogs) map.set(catalog.slug, catalog);
  return [...map.values()];
}

export function findCatalog(slug) {
  return allCatalogs().find(c => c.slug === slug) || null;
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
    if (catalogSlug && catalog.slug !== catalogSlug) continue;

    const catalogId = 'catalog:' + catalog.slug;
    if (includeCatalogNode) {
      addNode({
        id: catalogId,
        type: 'catalog',
        title: catalog.title,
        description: catalog.description || '',
        catalogSlug: catalog.slug,
        group: catalog.slug,
        href: '#/catalog/' + encodeURIComponent(catalog.slug)
      });
    }

    for (const library of catalog.libraries || []) {
      if (librarySlug && library.slug !== librarySlug) continue;

      const libraryId = catalog.slug + '/' + library.slug;
      if (includeLibraryNode) {
        addNode({
          id: libraryId,
          type: 'library',
          title: library.title,
          description: library.description || '',
          catalogSlug: catalog.slug,
          librarySlug: library.slug,
          group: catalog.slug,
          href: '#/catalog/' + encodeURIComponent(catalog.slug) + '/library/' + encodeURIComponent(library.slug)
        });
        if (includeCatalogNode) links.push({ source: catalogId, target: libraryId, type: 'contains' });
      }

      for (const lesson of library.lessons || []) {
        if (lessonSlug && lesson.slug !== lessonSlug) continue;

        const lessonId = catalog.slug + '/' + library.slug + '/' + lesson.slug;
        addNode({
          id: lessonId,
          type: 'lesson',
          title: lesson.title,
          description: lesson.description || '',
          catalogSlug: catalog.slug,
          librarySlug: library.slug,
          lessonSlug: lesson.slug,
          group: catalog.slug,
          href: lessonHref(catalog.slug, library.slug, lesson.slug)
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
            catalogSlug: catalog.slug,
            librarySlug: library.slug,
            lessonSlug: lesson.slug,
            topicId: topic.id,
            group: catalog.slug,
            href: lessonHref(catalog.slug, library.slug, lesson.slug) + '/topic/' + encodeURIComponent(topic.id)
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
      const target = resolveTopicTarget(prerequisite, catalog, library, lesson);
      if (known.has(target)) links.push({ source: target, target: sourceId, type: 'requires' });
    }

    for (const connection of topic.connections || []) {
      const target = resolveTopicTarget(connection.target, catalog, library, lesson);
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

function resolveTopicTarget(target, catalog, library, lesson) {
  const parts = String(target || '').split('/').filter(Boolean);
  if (parts.length === 1) {
    return catalog.slug + '/' + library.slug + '/' + lesson.slug + '/' + parts[0];
  }
  if (parts.length === 2) {
    return catalog.slug + '/' + library.slug + '/' + parts[0] + '/' + parts[1];
  }
  if (parts.length === 3) {
    return catalog.slug + '/' + parts[0] + '/' + parts[1] + '/' + parts[2];
  }
  return parts.slice(0, 4).join('/');
}

export function lessonHref(catalogSlug, librarySlug, lessonSlug) {
  return '#/catalog/' + encodeURIComponent(catalogSlug) +
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
