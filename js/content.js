import { state } from './state.js';

const CATALOG_URL = '/data/catalog.json';

export async function loadStaticCourses() {
  const catalog = await fetch(CATALOG_URL).then(r => {
    if (!r.ok) throw new Error('Impossibile caricare il catalogo locale');
    return r.json();
  });

  const courses = await Promise.all((catalog.courses || []).map(async item => {
    const course = await fetch(item.src).then(r => r.json());
    return { ...course, _static: true };
  }));

  state.staticCourses = courses;
  return courses;
}

export function allCourses() {
  const map = new Map();
  for (const course of state.staticCourses) map.set(course.slug, course);
  for (const course of state.remoteCourses) map.set(course.slug, course);
  return [...map.values()];
}

export function findCourse(slug) {
  return allCourses().find(c => c.slug === slug) || null;
}

export function findTopic(course, topicId) {
  return course?.topics?.find(t => t.id === topicId) || null;
}

export function topicNumber(course, topicId) {
  const i = (course?.topics || []).findIndex(t => t.id === topicId);
  return i < 0 ? null : i + 1;
}

export function getOrderedTopics(course) {
  const topicById = new Map((course.topics || []).map(t => [t.id, t]));
  const ordered = [];
  for (const module of course.modules || []) {
    for (const id of module.topicIds || []) {
      const topic = topicById.get(id);
      if (topic && !ordered.includes(topic)) ordered.push(topic);
    }
  }
  for (const topic of course.topics || []) if (!ordered.includes(topic)) ordered.push(topic);
  return ordered;
}

export function validateCourse(course) {
  const errors = [];
  const requiredRoot = ['schemaVersion', 'id', 'slug', 'title', 'description', 'modules', 'topics'];
  requiredRoot.forEach(k => { if (course?.[k] === undefined || course?.[k] === null || course?.[k] === '') errors.push(`Manca \`${k}\``); });

  if (!Array.isArray(course?.topics) || !course.topics.length) errors.push('`topics` deve contenere almeno un argomento');
  if (!Array.isArray(course?.modules) || !course.modules.length) errors.push('`modules` deve contenere almeno un modulo');

  const ids = new Set();
  for (const [index, topic] of (course?.topics || []).entries()) {
    if (!topic.id) errors.push(`Topic ${index + 1}: manca \`id\``);
    if (topic.id && ids.has(topic.id)) errors.push(`Topic id duplicato: ${topic.id}`);
    ids.add(topic.id);
    ['title', 'summary', 'why', 'sections'].forEach(k => {
      if (topic?.[k] === undefined || topic?.[k] === null || topic?.[k] === '') errors.push(`Topic ${topic.id || index + 1}: manca \`${k}\``);
    });
    if (!Array.isArray(topic.sections) || !topic.sections.some(s => s.type === 'checkpoint')) {
      errors.push(`Topic ${topic.id || index + 1}: aggiungi almeno un checkpoint`);
    }
    if (!Array.isArray(topic.sources) || !topic.sources.length) {
      errors.push(`Topic ${topic.id || index + 1}: aggiungi almeno una fonte`);
    }
  }

  for (const module of course?.modules || []) {
    for (const id of module.topicIds || []) if (!ids.has(id)) errors.push(`Modulo ${module.id}: topic sconosciuto \`${id}\``);
  }

  for (const topic of course?.topics || []) {
    for (const prerequisite of topic.prerequisites || []) if (!ids.has(prerequisite)) errors.push(`Topic ${topic.id}: prerequisito sconosciuto \`${prerequisite}\``);
    for (const connection of topic.connections || []) {
      if (!connection.target.includes('/') && !ids.has(connection.target)) errors.push(`Topic ${topic.id}: connessione sconosciuta \`${connection.target}\``);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function courseGraph(courses = allCourses()) {
  const nodes = [];
  const links = [];
  const known = new Set();

  for (const course of courses) {
    const courseId = `course:${course.slug}`;
    nodes.push({ id: courseId, type: 'course', title: course.title, slug: course.slug, group: course.slug });
    known.add(courseId);
    for (const topic of course.topics || []) {
      const id = `${course.slug}/${topic.id}`;
      nodes.push({ id, type: 'topic', title: topic.title, slug: course.slug, topicId: topic.id, group: course.slug });
      known.add(id);
      links.push({ source: courseId, target: id, type: 'contains' });
    }
  }

  for (const course of courses) {
    for (const topic of course.topics || []) {
      const source = `${course.slug}/${topic.id}`;
      for (const connection of topic.connections || []) {
        const target = connection.target.includes('/') ? connection.target : `${course.slug}/${connection.target}`;
        if (known.has(target)) links.push({ source, target, type: connection.type || 'related' });
      }
      for (const prerequisite of topic.prerequisites || []) {
        const target = `${course.slug}/${prerequisite}`;
        if (known.has(target)) links.push({ source: target, target: source, type: 'requires' });
      }
    }
  }

  return { nodes, links };
}
