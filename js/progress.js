import { state } from './state.js';
import { allCatalogs, findLibrary, findLesson, findTopic, lessonHref } from './content.js';
import { escapeHtml, toast } from './ui.js';

export function lessonCompletion(records, catalogId, library, lesson) {
  const ids = new Set((lesson?.topics || []).map(topic => topic.id));
  const completed = records.filter(row => row.catalog_id === catalogId &&
    row.library_key === library?.slug && row.lesson_key === lesson?.slug && ids.has(row.topic_key)).length;
  return { completed, total: ids.size, percent: ids.size ? Math.round(completed / ids.size * 100) : 0 };
}

export function catalogCompletion(records, catalog) {
  let completed = 0, total = 0;
  for (const library of catalog.libraries || []) {
    for (const lesson of library.lessons || []) {
      const result = lessonCompletion(records, catalog._db?.id, library, lesson);
      completed += result.completed;
      total += result.total;
    }
  }
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 0 };
}

export async function loadStudyActivity({ force = false } = {}) {
  if (!state.user || !state.supabase) {
    state.topicProgress = [];
    state.recentStudy = [];
    state.studyLoadedFor = null;
    return { progress: [], recent: [] };
  }
  if (!force && state.studyLoadedFor === state.user.id) {
    return { progress: state.topicProgress || [], recent: state.recentStudy || [] };
  }
  const [progress, recent] = await Promise.all([
    state.supabase.from('study_topic_progress').select('*'),
    state.supabase.from('study_recent_topics').select('*').order('visited_at', { ascending:false }).limit(12)
  ]);
  if (progress.error) throw progress.error;
  if (recent.error) throw recent.error;
  state.topicProgress = progress.data || [];
  state.recentStudy = recent.data || [];
  state.studyLoadedFor = state.user.id;
  return { progress: state.topicProgress, recent: state.recentStudy };
}

export async function trackStudyVisit({ catalog, library, lesson, topic }) {
  const userId = state.user?.id, catalogId = catalog?._db?.id;
  if (!userId || !catalogId || !library || !lesson || !topic || !state.supabase) return;
  const now = new Date().toISOString();
  const payload = {
    user_id:userId,catalog_id:catalogId,library_key:library.slug,
    lesson_key:lesson.slug,topic_key:topic.id,visited_at:now
  };
  try {
    const { error } = await state.supabase.from('study_recent_topics')
      .upsert(payload,{onConflict:'user_id,catalog_id'});
    if (error) throw error;
    state.recentStudy = [payload, ...(state.recentStudy || []).filter(item =>
      item.catalog_id !== catalogId)].slice(0,12);
  } catch (err) { console.warn('Recent study tracking unavailable',err); }
}

export function resolveRecentStudy(items) {
  return (items || []).map(row => {
    const catalog = allCatalogs().find(c => c._db?.id === row.catalog_id);
    const library = findLibrary(catalog,row.library_key);
    const lesson = findLesson(library,row.lesson_key);
    const topic = findTopic(lesson,row.topic_key);
    if (!topic) return null;
    return {
      catalog:catalog.title,lesson:lesson.title,topic:topic.title,
      href:lessonHref(catalog,library.slug,lesson.slug) + '/topic/' + encodeURIComponent(topic.id)
    };
  }).filter(Boolean);
}

export async function mountTopicProgress(context) {
  const { catalog, library, lesson, topic } = context;
  const userId = state.user?.id, catalogId = catalog?._db?.id;
  const reader = document.querySelector('.reader-header');
  const track = document.querySelector('.progress-track');
  if (!reader || !userId || !catalogId || !state.supabase) {
    if (track) track.hidden = true;
    return;
  }
  const box = document.createElement('div');
  box.className = 'topic-progress-actions';
  box.innerHTML = '<button type="button" class="button secondary" data-complete-topic disabled>Caricamento progresso…</button>' +
    '<span class="topic-progress-status" role="status"></span>';
  reader.appendChild(box);
  const button=box.querySelector('[data-complete-topic]');
  const status=box.querySelector('.topic-progress-status');
  let busy=false;

  function isComplete() {
    return (state.topicProgress || []).some(row=>row.catalog_id===catalogId &&
      row.library_key===library.slug && row.lesson_key===lesson.slug && row.topic_key===topic.id);
  }
  function draw() {
    const complete=isComplete();
    const progress=lessonCompletion(state.topicProgress || [],catalogId,library,lesson);
    button.disabled=busy;
    button.classList.toggle('completed',complete);
    button.setAttribute('aria-pressed',String(complete));
    button.textContent=complete ? '✓ Argomento completato' : '○ Segna come completato';
    status.textContent=progress.completed+' di '+progress.total+' argomenti completati';
    if (track) {
      track.hidden=false;
      track.setAttribute('aria-label',progress.percent+'% di argomenti completati');
      track.title=progress.completed+' / '+progress.total+' completati';
      const fill=track.querySelector('span');
      if (fill) fill.style.setProperty('--progress',progress.percent+'%');
    }
  }
  try {
    await loadStudyActivity();
    if (!reader.isConnected) return;
    draw();
  } catch (err) {
    button.textContent='Progresso non disponibile';
    status.textContent='Verifica che la migrazione database sia stata eseguita';
    if (track) track.hidden=true;
    console.warn('Topic progress unavailable',err);
    return;
  }
  button.addEventListener('click',async () => {
    if (busy) return;
    busy=true;
    button.disabled=true;
    const complete=isComplete();
    const payload={user_id:userId,catalog_id:catalogId,library_key:library.slug,lesson_key:lesson.slug,topic_key:topic.id};
    try {
      if (complete) {
        const {error}=await state.supabase.from('study_topic_progress').delete().match(payload);
        if(error) throw error;
        state.topicProgress=state.topicProgress.filter(row => !(row.catalog_id===catalogId &&
          row.library_key===library.slug && row.lesson_key===lesson.slug && row.topic_key===topic.id));
      } else {
        const {data,error}=await state.supabase.from('study_topic_progress')
          .upsert(payload,{onConflict:'user_id,catalog_id,library_key,lesson_key,topic_key'}).select('*').single();
        if(error) throw error;
        state.topicProgress=[...(state.topicProgress||[]),data];
      }
    } catch (err) { toast('Impossibile aggiornare il progresso: '+err.message); }
    finally { busy=false; if(box.isConnected) draw(); }
  });
}
