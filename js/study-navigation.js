// Reading order follows catalog > library > lesson. An empty lesson has
// nothing to open; skip it rather than generating a broken reader link.
export function getLessonNeighbors(catalog, currentLibrary, currentLesson) {
  const entries = [];
  for (const library of catalog?.libraries || []) {
    for (const lesson of library?.lessons || []) {
      const ids = new Set();
      const topics = [];
      const byId = new Map((lesson.topics || []).filter(item => item?.id)
        .map(item => [item.id, item]));
      for (const module of lesson.modules || []) {
        for (const id of module.topicIds || []) {
          const topic = byId.get(id);
          if (topic && !ids.has(id)) { ids.add(id); topics.push(topic); }
        }
      }
      for (const topic of lesson.topics || []) {
        if (topic?.id && !ids.has(topic.id)) { ids.add(topic.id); topics.push(topic); }
      }
      if (topics.length) entries.push({ library, lesson, firstTopic: topics[0] });
    }
  }
  const current = entries.findIndex(item =>
    (item.library === currentLibrary || item.library.slug === currentLibrary?.slug) &&
    (item.lesson === currentLesson || item.lesson.slug === currentLesson?.slug));
  if (current < 0) return { previous: null, next: null };
  const ref = catalog?._db?.id || catalog?.slug || catalog?.id;
  const link = item => item ? {
    title: item.lesson.title,
    library: item.library.title,
    href: '#/catalog/' + encodeURIComponent(ref) +
      '/library/' + encodeURIComponent(item.library.slug) +
      '/lesson/' + encodeURIComponent(item.lesson.slug) +
      '/topic/' + encodeURIComponent(item.firstTopic.id)
  } : null;
  return {
    previous:link(entries[current-1]),
    next:link(entries[current+1])
  };
}
