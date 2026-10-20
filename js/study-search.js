import { catalogRef, lessonHref } from './content.js';

export function searchStudyCatalogs(catalogs, query, { limit = 12 } = {}) {
  const q = String(query || '').trim().toLocaleLowerCase('it');
  if (q.length < 2) return [];
  const results = [], known = new Set();
  const matches = (...values) => values.some(value => String(value || '').toLocaleLowerCase('it').includes(q));
  const add = (type, title, subtitle, href) => {
    if (known.has(href)) return;
    known.add(href);
    results.push({type,title,subtitle,href});
  };

  for (const catalog of catalogs || []) {
    const ref = encodeURIComponent(catalogRef(catalog));
    const catalogHref = '#/catalog/' + ref;
    if (matches(catalog.title, catalog.description, ...(catalog.tags || []))) {
      add('Catalogo',catalog.title,'Catalogo',catalogHref);
    }
    for (const library of catalog.libraries || []) {
      const libraryHref = catalogHref + '/library/' + encodeURIComponent(library.slug);
      if (matches(library.title,library.description)) {
        add('Libreria',library.title,catalog.title,libraryHref);
      }
      for (const lesson of library.lessons || []) {
        const lessonHrefValue = lessonHref(catalog, library.slug, lesson.slug);
        if (matches(lesson.title, lesson.description)) {
          add('Lezione',lesson.title,catalog.title+' · '+library.title,lessonHrefValue);
        }
        for (const topic of lesson.topics || []) {
          if (matches(topic.title,topic.summary,topic.why)) {
            add('Argomento',topic.title,lesson.title+' · '+catalog.title,
              lessonHrefValue+'/topic/'+encodeURIComponent(topic.id));
          }
        }
      }
    }
  }
  return results.slice(0, Math.max(1,limit));
}
