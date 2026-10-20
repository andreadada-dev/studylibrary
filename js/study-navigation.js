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

/** Linear reading sequence: topics in module order, then the next lesson. */
export function getReadingNeighbors(catalog, currentLibrary, currentLesson, currentTopic) {
  const entries = [];
  for (const library of catalog?.libraries || []) {
    for (const lesson of library.lessons || []) {
      const topics = new Map((lesson.topics || []).filter(t=>t?.id).map(t=>[t.id,t]));
      const sorted = [];
      const seen = new Set();
      for (const module of lesson.modules || []) {
        for (const id of module.topicIds || []) {
          if (topics.has(id) && !seen.has(id)) { seen.add(id); sorted.push(topics.get(id)); }
        }
      }
      for (const topic of lesson.topics || []) {
        if (topic?.id && !seen.has(topic.id)) { seen.add(topic.id); sorted.push(topic); }
      }
      for (const topic of sorted) entries.push({library,lesson,topic});
    }
  }
  const at = entries.findIndex(item=>
    item.library.slug===currentLibrary?.slug && item.lesson.slug===currentLesson?.slug &&
    item.topic.id === currentTopic?.id);
  if(at<0) return {previous:null,next:null};
  const ref=catalog?._db?.id || catalog?.slug || catalog?.id;
  const link=entry=>entry ? ({
    title:entry.topic.title,
    lessonTitle:entry.lesson.title,
    kind:entry.lesson.slug===currentLesson.slug && entry.library.slug===currentLibrary.slug
      ? 'argomento' : 'lezione',
    href:'#/catalog/'+encodeURIComponent(ref)+
      '/library/'+encodeURIComponent(entry.library.slug)+
      '/lesson/'+encodeURIComponent(entry.lesson.slug)+
      '/topic/'+encodeURIComponent(entry.topic.id)
  }):null;
  return {previous:link(entries[at-1]),next:link(entries[at+1])};
}
