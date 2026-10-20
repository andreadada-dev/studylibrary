import { paginateBook, bookCover, bookPaper } from './book-pagination.js';

/**
 * The lesson, not each individual topic, is one physical StPageFlip volume.
 * This returns the complete sequence of page elements and the first page of
 * each topic, allowing later navigation without regenerating a new book.
 */
export function lessonChapters(lesson) {
  const topics = new Map((lesson?.topics || []).filter(t => t?.id).map(t => [t.id,t]));
  const visited = new Set();
  const chapters = [];

  for (const module of lesson?.modules || []) {
    const entries = [];
    for (const id of module.topicIds || []) {
      const topic = topics.get(id);
      if (!topic || visited.has(id)) continue;
      visited.add(id);
      entries.push(topic);
    }
    if (entries.length) chapters.push({
      title: module.title || 'Capitolo ' + (chapters.length + 1),
      description: module.description || module.summary || '',
      topics: entries,
      id: module.id || module.slug || 'chapter-' + chapters.length
    });
  }
  const leftover = (lesson?.topics || []).filter(topic => topic?.id && !visited.has(topic.id));
  if (leftover.length) {
    chapters.push({title:chapters.length ? 'Altri argomenti' : 'Argomenti della lezione',
      description:'',topics:leftover,id:'additional-topics'});
  }
  return chapters;
}

function addText(parent,tag,className,value) {
  const element=document.createElement(tag);
  if(className) element.className=className;
  element.textContent=value || '';
  parent.appendChild(element);
  return element;
}

export function createLessonIntro({width,height},lesson,chapters,libraryTitle='') {
  const page=bookPaper({width,height,label:lesson.title});
  page.classList.add('book-lesson-intro');
  page.dataset.bookKind='lesson-intro';
  const body=page.querySelector('.book-paper-body');
  addText(body,'span','book-intro-overline',libraryTitle || 'STUDYLIBRARY');
  addText(body,'h2','book-intro-title',lesson.title || 'Lezione');
  if (lesson.description) addText(body,'p','book-intro-description',lesson.description);
  addText(body,'div','book-intro-chapter-count',
    chapters.length + (chapters.length === 1 ? ' capitolo' : ' capitoli') +
    ' · ' + chapters.reduce((sum,chapter)=>sum+chapter.topics.length,0) + ' argomenti');
  const list=body.appendChild(document.createElement('ol'));
  list.className='book-intro-chapters';
  for (const chapter of chapters) addText(list,'li','',chapter.title);
  return page;
}

export function createChapterPage({width,height},chapter,index,total) {
  const page=bookPaper({width,height,label:chapter.title});
  page.classList.add('book-chapter-page');
  page.dataset.bookKind='chapter';
  page.dataset.bookChapter=chapter.id;
  const body=page.querySelector('.book-paper-body');
  const badge=String(index+1).padStart(2,'0');
  addText(body,'span','book-chapter-overline','CAPITOLO ' + badge + ' / ' + String(total).padStart(2,'0'));
  addText(body,'span','book-chapter-number',badge);
  addText(body,'h2','book-chapter-title',chapter.title);
  if (chapter.description) {
    addText(body,'p','book-chapter-description',chapter.description);
  } else {
    addText(body,'p','book-chapter-description',
      'In questo capitolo approfondirai i seguenti argomenti:');
  }
  const list=body.appendChild(document.createElement('ol'));
  list.className='book-chapter-topics';
  for (const topic of chapter.topics) addText(list,'li','',topic.title || topic.id);
  return page;
}

export function buildLessonBook(reader,context,{width,height,renderTopic,maxPages=600}={}) {
  if (!reader || !context?.lesson || typeof renderTopic !== 'function') {
    throw new Error('Dati della lezione non disponibili per il libro.');
  }
  const {lesson,library}=context;
  const chapters=lessonChapters(lesson);
  const pages=[];
  const firstPageByTopic=new Map();
  const firstPageByChapter=new Map();
  const append=page=>{pages.push(page);return page;};
  append(bookCover({width,height,title:lesson.title || 'Lezione',subtitle:lesson.description || ''}));
  append(createLessonIntro({width,height},lesson,chapters,library?.title));
  const fontSize=getComputedStyle(reader).getPropertyValue('--reader-text-size').trim() || '18px';

  for (const [index,chapter] of chapters.entries()) {
    firstPageByChapter.set(chapter.id,pages.length);
    append(createChapterPage({width,height},chapter,index,chapters.length));
    for (const topic of chapter.topics) {
      const source=renderTopic(topic,context);
      source.style.setProperty('--reader-text-size',fontSize);
      firstPageByTopic.set(topic.id,pages.length);
      const mount=document.createDocumentFragment();
      const countRemaining=maxPages-pages.length-2;
      if(countRemaining <= 0) throw new Error('La lezione supera il numero massimo di pagine.');
      const topicPages=paginateBook(source,mount,{
        width,height,label:chapter.title,maxPages:countRemaining
      });
      for(const page of topicPages){
        page.dataset.bookKind='topic';
        page.dataset.bookTopic=topic.id;
        append(page);
      }
    }
  }
  // Complete the interior with a final leaf when necessary; StPageFlip uses
  // paired pages in landscape and needs an even number between hard covers.
  if ((pages.length-1)%2 === 1) {
    const closing=bookPaper({width,height,label:lesson.title});
    closing.classList.add('book-closing-page');
    closing.querySelector('.book-paper-body').innerHTML=
      '<div class="book-closing-message"><span>FINE LEZIONE</span>' +
      '<strong>Hai completato questo volume.</strong></div>';
    append(closing);
  }
  append(bookCover({width,height,title:lesson.title,back:true}));
  for(const [i,page] of pages.entries()){
    const number=page.querySelector('.book-paper-number');
    if(number) number.textContent=String(i).padStart(2,'0');
  }
  return {pages,chapters,firstPageByTopic,firstPageByChapter};
}
