// Pure, version-aware StudyLibrary update engine. No browser or network dependencies.
export const LEGACY_OPERATIONS = Object.freeze([
  'upsertLesson', 'removeLesson', 'upsertTopic', 'removeTopic', 'addConnection', 'removeConnection'
]);
export const GRANULAR_OPERATIONS = Object.freeze([
  'addTopic', 'patchTopic', 'addSection', 'updateSection', 'removeSection',
  'addMedia', 'updateMedia', 'removeMedia', 'addSource', 'updateLesson', 'moveTopic'
]);
export const SUPPORTED_OPERATIONS = Object.freeze([...LEGACY_OPERATIONS, ...GRANULAR_OPERATIONS]);

const TOPIC_PATCH_FIELDS = new Set([
  'title', 'summary', 'why', 'estimatedMinutes', 'learningGoals', 'prerequisites', 'api'
]);
const LESSON_PATCH_FIELDS = new Set([
  'title', 'description', 'estimatedMinutes', 'accent', 'api'
]);
const MEDIA_PATCH_FIELDS = new Set([
  'url', 'title', 'caption', 'alt', 'sourceUrl', 'credit', 'author', 'license', 'provider', 'thumbnailUrl'
]);

function fail(message) { throw new Error(message); }
function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(label + ' obbligatorio.');
  return value.trim();
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + ' deve essere un oggetto.');
  return value;
}
function key(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function patch(target, changes, allowed, opName) {
  object(changes, opName + '.changes');
  const entries = Object.entries(changes);
  if (!entries.length) fail(opName + '.changes non può essere vuoto.');
  for (const [field, value] of entries) {
    if (!allowed.has(field)) fail(opName + ': campo non modificabile: ' + field);
    target[field] = structuredClone(value);
  }
}
function moduleFor(lesson, moduleId, moduleTitle, { strict = false } = {}) {
  lesson.modules ||= [];
  let module = moduleId
    ? lesson.modules.find(item => item.id === moduleId)
    : lesson.modules[0];
  if (!module && moduleId && strict) {
    module = { id: moduleId, title: moduleTitle || moduleId, topicIds: [] };
    lesson.modules.push(module);
  }
  if (!module) module = lesson.modules[0];
  if (!module) {
    module = { id: moduleId || 'contenuti', title: moduleTitle || 'Contenuti', topicIds: [] };
    lesson.modules.push(module);
  }
  module.topicIds ||= [];
  return module;
}
function sectionPosition(sections, op, inserting) {
  const selectors = [op.sectionId !== undefined, op.sectionIndex !== undefined].filter(Boolean).length;
  if (!inserting && selectors !== 1) fail(op.op + ': usa esattamente uno tra sectionId e sectionIndex.');
  if (inserting) {
    const placement = [op.beforeSectionId !== undefined, op.afterSectionId !== undefined, op.index !== undefined].filter(Boolean).length;
    if (placement > 1) fail('addSection: usa al massimo una posizione (beforeSectionId, afterSectionId, index).');
    if (op.index !== undefined) {
      if (!Number.isInteger(op.index) || op.index < 0 || op.index > sections.length) fail('addSection: index non valido.');
      return op.index;
    }
    if (op.beforeSectionId !== undefined || op.afterSectionId !== undefined) {
      const before = op.beforeSectionId !== undefined;
      const id = nonempty(before ? op.beforeSectionId : op.afterSectionId, 'ID della sezione');
      const i = sections.findIndex(x => x.id === id);
      if (i < 0) fail('Sezione di riferimento non trovata: ' + id);
      return i + (before ? 0 : 1);
    }
    return sections.length;
  }
  if (op.sectionId !== undefined) {
    const id = nonempty(op.sectionId, 'sectionId');
    const i = sections.findIndex(x => x.id === id);
    if (i < 0) fail('Sezione non trovata: ' + id);
    return i;
  }
  if (!Number.isInteger(op.sectionIndex) || op.sectionIndex < 0 || op.sectionIndex >= sections.length) {
    fail('Sezione non trovata all’indice ' + op.sectionIndex);
  }
  return op.sectionIndex;
}
function isReferenced(catalog, id) {
  for (const library of catalog.libraries || []) {
    for (const lesson of library.lessons || []) {
      for (const topic of lesson.topics || []) {
        for (const section of topic.sections || []) {
          if (section.mediaRef === id) return true;
          if (section.type === 'gallery' && (section.items || []).some(item => item === id || item?.mediaRef === id)) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

// Never mutate the supplied catalog. v1 packages remain supported unchanged.
export function applyUpdatePackage(baseCatalog, update) {
  object(baseCatalog, 'Catalogo');
  object(update, 'Pacchetto');
  if (update.kind !== 'studylibrary.update') fail('kind deve essere studylibrary.update.');
  if (![1, 2].includes(update.schemaVersion)) fail('schemaVersion deve essere 1 o 2.');
  nonempty(update.catalog, 'catalog');
  if (!Number.isInteger(update.baseVersion) || update.baseVersion < 1) fail('baseVersion deve essere un intero positivo.');
  if (!Array.isArray(update.operations) || !update.operations.length) fail('Il pacchetto non contiene operazioni.');

  const catalog = structuredClone(baseCatalog);
  const findLibraryForOp = (op, ref = op.library) => {
    const libraries = catalog.libraries || [];
    const requested = nonempty(ref, 'library');
    let library = libraries.find(item => item.slug === requested || item.id === requested);
    if (!library) library = libraries.find(item =>
      key(item.slug) === key(requested) || key(item.id) === key(requested) || key(item.title) === key(requested)
    );
    // Retain the original v1 behavior for legacy importer packages.
    if (!library && update.schemaVersion === 1 && libraries.length === 1) library = libraries[0];
    if (!library) fail('Libreria non trovata: ' + requested);
    return library;
  };
  const findLessonForOp = (op, libRef = op.library, lessonRef = op.lesson) => {
    const library = findLibraryForOp(op, libRef);
    const requested = nonempty(lessonRef, 'lesson');
    const lesson = (library.lessons || []).find(item => item.slug === requested || item.id === requested);
    if (!lesson) fail('Lezione non trovata: ' + requested);
    return { library, lesson };
  };
  const findTopicForOp = op => {
    const { library, lesson } = findLessonForOp(op);
    const requested = nonempty(op.topic, 'topic');
    const topic = (lesson.topics || []).find(item => item.id === requested);
    if (!topic) fail('Argomento non trovato: ' + requested);
    return { library, lesson, topic };
  };

  for (const op of update.operations) {
    object(op, 'Operazione');
    if (!SUPPORTED_OPERATIONS.includes(op.op)) fail('Operazione non supportata: ' + op.op);
    if (update.schemaVersion === 1 && !LEGACY_OPERATIONS.includes(op.op)) {
      fail('L’operazione ' + op.op + ' richiede schemaVersion 2.');
    }
    if (op.op === 'upsertLesson') {
      const library = findLibraryForOp(op);
      const value = object(op.value, 'upsertLesson.value');
      nonempty(value.id || value.slug, 'id/slug lezione');
      library.lessons ||= [];
      const i = library.lessons.findIndex(item =>
        (value.slug && item.slug === value.slug) || (value.id && item.id === value.id));
      if (i >= 0) library.lessons[i] = structuredClone(value);
      else library.lessons.push(structuredClone(value));
      continue;
    }
    if (op.op === 'removeLesson') {
      const { library } = findLessonForOp(op);
      library.lessons = library.lessons.filter(item => item.slug !== op.lesson && item.id !== op.lesson);
      continue;
    }
    if (op.op === 'upsertTopic' || op.op === 'addTopic') {
      const { lesson } = findLessonForOp(op);
      const value = object(op.value, op.op + '.value');
      const id = nonempty(value.id, 'ID argomento');
      lesson.topics ||= [];
      const i = lesson.topics.findIndex(item => item.id === id);
      if (op.op === 'addTopic' && i >= 0) fail('L’argomento esiste già: ' + id);
      if (i >= 0) lesson.topics[i] = structuredClone(value);
      else lesson.topics.push(structuredClone(value));
      const module = moduleFor(lesson, op.module, op.moduleTitle, {strict: update.schemaVersion === 2});
      if (!module.topicIds.includes(id)) module.topicIds.push(id);
      continue;
    }
    if (op.op === 'removeTopic') {
      const { lesson, topic } = findTopicForOp(op);
      const id = topic.id;
      lesson.topics = lesson.topics.filter(x => x.id !== id);
      for (const module of lesson.modules || []) module.topicIds = (module.topicIds || []).filter(x => x !== id);
      for (const other of lesson.topics || []) {
        other.prerequisites = (other.prerequisites || []).filter(x => x !== id);
        other.connections = (other.connections || []).filter(x => x.target !== id);
      }
      continue;
    }
    if (op.op === 'addConnection') {
      const { lesson } = findLessonForOp(op);
      const topic = (lesson.topics || []).find(item => item.id === op.from);
      if (!topic) fail('Topic origine non trovato: ' + (op.from || ''));
      const connection = object(op.connection, 'addConnection.connection');
      nonempty(connection.target, 'connection.target');
      topic.connections ||= [];
      if (!topic.connections.some(x => x.target === connection.target && (x.type || 'related') === (connection.type || 'related'))) {
        topic.connections.push(structuredClone(connection));
      }
      continue;
    }
    if (op.op === 'removeConnection') {
      const { lesson } = findLessonForOp(op);
      const topic = (lesson.topics || []).find(item => item.id === op.from);
      if (!topic) fail('Topic origine non trovato: ' + (op.from || ''));
      topic.connections = (topic.connections || []).filter(x =>
        !(x.target === op.target && (!op.type || x.type === op.type)));
      continue;
    }
    if (op.op === 'patchTopic') {
      const { topic } = findTopicForOp(op);
      patch(topic, op.changes, TOPIC_PATCH_FIELDS, op.op);
      continue;
    }
    if (op.op === 'updateLesson') {
      const { lesson } = findLessonForOp(op);
      patch(lesson, op.changes, LESSON_PATCH_FIELDS, op.op);
      continue;
    }
    if (op.op === 'addSection') {
      const { topic } = findTopicForOp(op);
      const section = object(op.value, 'addSection.value');
      const id = nonempty(section.id, 'ID nuova sezione');
      nonempty(section.type, 'Tipo nuova sezione');
      topic.sections ||= [];
      if (topic.sections.some(x => x.id === id)) fail('ID sezione già presente: ' + id);
      const index = sectionPosition(topic.sections, op, true);
      topic.sections.splice(index, 0, structuredClone(section));
      continue;
    }
    if (op.op === 'updateSection' || op.op === 'removeSection') {
      const { topic } = findTopicForOp(op);
      const sections = topic.sections || [];
      const i = sectionPosition(sections, op, false);
      if (op.op === 'removeSection') sections.splice(i, 1);
      else {
        const changes = object(op.changes, 'updateSection.changes');
        const allowed = new Set(Object.keys(sections[i]).filter(k => !['id', 'type'].includes(k)));
        // Allow adding fields without allowing replacement of the stable identity or section kind.
        for (const k of ['title','body','note','latex','question','answer','url','src','mediaRef','alt','caption','items','sourceUrl','credit','author','license','provider','thumbnailUrl','label','steps','left','right']) allowed.add(k);
        patch(sections[i], changes, allowed, op.op);
      }
      continue;
    }
    if (op.op === 'addMedia') {
      const asset = object(op.value, 'addMedia.value');
      const id = nonempty(asset.id, 'ID media');
      nonempty(asset.type, 'Tipo media');
      nonempty(asset.url, 'URL media');
      catalog.media ||= [];
      const previous = catalog.media.find(x => x.id === id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(asset)) fail('ID media già occupato: ' + id);
      } else catalog.media.push(structuredClone(asset));
      continue;
    }
    if (op.op === 'updateMedia' || op.op === 'removeMedia') {
      const id = nonempty(op.media, 'media');
      const assetIndex = (catalog.media || []).findIndex(x => x.id === id);
      if (assetIndex < 0) fail('Media non trovato: ' + id);
      if (op.op === 'updateMedia') patch(catalog.media[assetIndex], op.changes, MEDIA_PATCH_FIELDS, op.op);
      else {
        if (isReferenced(catalog, id)) fail('Il media ' + id + ' è ancora usato: rimuovi prima i riferimenti.');
        catalog.media.splice(assetIndex, 1);
      }
      continue;
    }
    if (op.op === 'addSource') {
      const { lesson } = findLessonForOp(op);
      const source = object(op.value, 'addSource.value');
      const id = nonempty(source.id, 'ID fonte');
      lesson.sources ||= [];
      const previous = lesson.sources.find(x => x.id === id);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(source)) fail('Fonte con ID già presente: ' + id);
      } else lesson.sources.push(structuredClone(source));
      if (op.topic !== undefined) {
        const { topic } = findTopicForOp(op);
        topic.sources ||= [];
        if (!topic.sources.some(x => x.ref === id)) topic.sources.push({
          ref: id, pages: op.pages || '', note: op.note || ''
        });
      }
      continue;
    }
    if (op.op === 'moveTopic') {
      const { lesson: fromLesson, topic } = findTopicForOp(op);
      const { lesson: toLesson } = findLessonForOp(op, op.toLibrary || op.library, op.toLesson);
      if (fromLesson !== toLesson && (toLesson.topics || []).some(x => x.id === topic.id)) {
        fail('Il topic esiste già nella lezione destinazione: ' + topic.id);
      }
      fromLesson.topics = (fromLesson.topics || []).filter(x => x.id !== topic.id);
      for (const module of fromLesson.modules || []) {
        module.topicIds = (module.topicIds || []).filter(id => id !== topic.id);
      }
      toLesson.topics ||= [];
      if (!toLesson.topics.some(x => x.id === topic.id)) toLesson.topics.push(topic);
      const destinationModule = moduleFor(toLesson, op.module, op.moduleTitle, {strict:true});
      if (!destinationModule.topicIds.includes(topic.id)) destinationModule.topicIds.push(topic.id);
      continue;
    }
  }
  return catalog;
}
