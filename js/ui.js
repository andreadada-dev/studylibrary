import { state, isBackendConfigured } from './state.js';
import { signInWithGoogle, signOut, getDiscussion, addComment, setRating } from './api.js';
import { getOrderedTopics, topicNumber, findTopic, catalogStats, lessonHref, catalogRef } from './content.js';

export const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function toast(message) {
  const region = document.getElementById('toast-region');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  region.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

export function renderAccount() {
  const slot = document.getElementById('account-slot');
  if (!isBackendConfigured()) {
    slot.innerHTML = `<button class="account-button" data-auth-demo><span class="avatar">S</span><span class="account-name">Demo</span></button>`;
    slot.querySelector('button').addEventListener('click', () => showBackendHelp());
    return;
  }

  if (!state.user) {
    slot.innerHTML = `<button class="account-button" data-login><span class="avatar">G</span><span class="account-name">Accedi con Google</span></button>`;
    slot.querySelector('[data-login]').addEventListener('click', async () => {
      try { await signInWithGoogle(); } catch (err) { toast(err.message); }
    });
    return;
  }

  const name = state.profile?.display_name || state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'Account';
  const avatar = state.profile?.avatar_url || state.user.user_metadata?.avatar_url;
  slot.innerHTML = `<button class="account-button" data-account>${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" />` : `<span class="avatar">${escapeHtml(name[0] || 'U')}</span>`}<span class="account-name">${escapeHtml(name)}</span></button>`;
  slot.querySelector('[data-account]').addEventListener('click', () => showAccountModal(name));
}

function showBackendHelp() {
  showModal('Backend in modalità demo', `
    <p>Il sito funziona già con i cataloghi JSON locali. Per Google Login, pubblicazione, stelline e commenti configura Supabase in Coolify.</p>
    <p><code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> vengono trasformate in <code>config.js</code> all'avvio del container.</p>
  `);
}

function showAccountModal(name) {
  showModal(escapeHtml(name), `<p>Sei autenticato. Il tuo catalogo può contenere librerie e lezioni private o pubblicate.</p>`, [
    { label: 'Esci', className: 'button danger', action: async () => { await signOut(); closeModal(); } },
    { label: 'Chiudi', className: 'button secondary', action: closeModal }
  ]);
}

export function showModal(title, body, actions = [{ label: 'Chiudi', className: 'button', action: closeModal }]) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><h2>${title}</h2><div>${body}</div><div class="modal-actions"></div></div>`;
  const actionEl = backdrop.querySelector('.modal-actions');
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = action.className || 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', action.action);
    actionEl.appendChild(btn);
  }
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  document.body.appendChild(backdrop);
}

export function closeModal() { document.getElementById('modal-backdrop')?.remove(); }

function paragraphs(body) {
  if (Array.isArray(body)) return body.map(p => `<p>${escapeHtml(p)}</p>`).join('');
  return String(body || '').split(/\n\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

export function renderSection(section) {
  const title = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : '';
  switch (section.type) {
    case 'lead':
      return `<section class="lesson-section lesson-lead">${title}${paragraphs(section.body)}</section>`;
    case 'concept':
    case 'example':
    case 'text':
      return `<section class="lesson-section">${title}${paragraphs(section.body)}${section.items ? `<ul>${section.items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}</section>`;
    case 'callout':
      return `<aside class="callout" data-tone="${escapeHtml(section.tone || 'info')}">${title}${paragraphs(section.body)}</aside>`;
    case 'formula':
      return `<section class="lesson-section">${title}<div class="formula"><span class="math">${escapeHtml(section.latex || section.body || '')}</span></div>${section.note ? `<p>${escapeHtml(section.note)}</p>` : ''}</section>`;
    case 'image':
      return `<figure class="lesson-image"><img src="${escapeHtml(section.src)}" alt="${escapeHtml(section.alt || '')}" loading="lazy" />${section.caption ? `<figcaption>${escapeHtml(section.caption)}${section.credit ? ` · ${escapeHtml(section.credit)}` : ''}</figcaption>` : ''}</figure>`;
    case 'flow':
      return `<section class="lesson-section">${title}<div class="flow-diagram">${(section.nodes || []).map((n, idx) => `${idx ? '<span class="flow-arrow">→</span>' : ''}<div class="flow-node">${escapeHtml(typeof n === 'string' ? n : n.label)}</div>`).join('')}</div>${section.body ? paragraphs(section.body) : ''}</section>`;
    case 'comparison':
      return `<section class="lesson-section">${title}<div class="comparison"><div><h4>${escapeHtml(section.left?.title || '')}</h4><p>${escapeHtml(section.left?.body || '')}</p></div><div><h4>${escapeHtml(section.right?.title || '')}</h4><p>${escapeHtml(section.right?.body || '')}</p></div></div></section>`;
    case 'checkpoint':
      return `<section class="checkpoint"><span class="label">Checkpoint</span><h3>${escapeHtml(section.question)}</h3><button class="button secondary" data-reveal>Mostra risposta</button><div class="checkpoint-answer">${paragraphs(section.answer)}</div></section>`;
    case 'list':
      return `<section class="lesson-section">${title}<ul>${(section.items || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></section>`;
    default:
      return `<section class="lesson-section">${title}${paragraphs(section.body || '')}</section>`;
  }
}

export function wireReaderInteractions() {
  document.querySelectorAll('[data-reveal]').forEach(btn => btn.addEventListener('click', () => {
    const box = btn.closest('.checkpoint');
    box.classList.toggle('open');
    btn.textContent = box.classList.contains('open') ? 'Nascondi risposta' : 'Mostra risposta';
  }));
  if (window.renderMathInElement) {
    window.renderMathInElement(document.querySelector('.reader') || document.body, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false}
      ],
      throwOnError: false
    });
  }
}

export async function renderDiscussion(targetKind, targetKey, rootId = 'discussion-root') {
  const root = document.getElementById(rootId);
  if (!root) return;

  if (!isBackendConfigured()) {
    root.innerHTML = `<section class="discussion"><div class="discussion-head"><h3>Discussione</h3><span class="rating-inline"><span class="star">★</span> —</span></div><p class="demo-note">Commenti e stelline si attivano quando colleghi Supabase. Il corso e la navigazione JSON funzionano già in modalità demo.</p></section>`;
    return;
  }

  root.innerHTML = `<section class="discussion"><div class="skeleton" style="height:120px"></div></section>`;
  try {
    const data = await getDiscussion(targetKind, targetKey);
    const average = data.average ? data.average.toFixed(1) : '—';
    root.innerHTML = `<section class="discussion">
      <div class="discussion-head"><div><h3>Discussione</h3><div class="demo-note">${data.count} valutazioni · media ${average}</div></div><div class="stars-input" aria-label="Valuta da 1 a 5">${[1,2,3,4,5].map(n => `<button class="star-button ${data.mine >= n ? 'on' : ''}" data-rate="${n}" aria-label="${n} stelle">★</button>`).join('')}</div></div>
      ${state.user ? `<form class="comment-form"><input name="comment" maxlength="1200" placeholder="Lascia un commento utile…" autocomplete="off" /><button class="button" type="submit">Pubblica</button></form>` : `<p class="demo-note">Accedi con Google per valutare e commentare.</p>`}
      <div class="comments">${data.comments.length ? data.comments.map(renderComment).join('') : `<p class="demo-note">Nessun commento ancora.</p>`}</div>
    </section>`;

    root.querySelectorAll('[data-rate]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        if (!state.user) return signInWithGoogle();
        await setRating(targetKind, targetKey, Number(btn.dataset.rate));
        await renderDiscussion(targetKind, targetKey);
      } catch (err) { toast(err.message); }
    }));

    root.querySelector('.comment-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.currentTarget.elements.comment;
      try {
        await addComment(targetKind, targetKey, input.value);
        input.value = '';
        await renderDiscussion(targetKind, targetKey);
      } catch (err) { toast(err.message); }
    });
  } catch (err) {
    root.innerHTML = `<section class="discussion"><p class="demo-note">Impossibile caricare la discussione: ${escapeHtml(err.message)}</p></section>`;
  }
}

function renderComment(c) {
  const name = c.profiles?.display_name || 'Studente';
  const avatar = c.profiles?.avatar_url;
  const date = new Date(c.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  return `<div class="comment">${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" />` : `<span class="avatar">${escapeHtml(name[0] || 'S')}</span>`}<div><div class="comment-author">${escapeHtml(name)} <span class="comment-time">${escapeHtml(date)}</span></div><div class="comment-body">${escapeHtml(c.body)}</div></div></div>`;
}


export function catalogCard(catalog) {
  const stats = catalogStats(catalog);
  const author = catalog._author?.display_name || catalog.university || (catalog._static ? 'Catalogo demo' : 'Community');
  const visibility = catalog.visibility === 'private' ? 'Privato' : 'Pubblico';
  return '<a class="course-card catalog-card" href="#/catalog/' + encodeURIComponent(catalog.slug) + '" style="--card-accent:' + escapeHtml(catalog.accent || '#6157e7') + '">' +
    '<div class="course-meta"><strong>' + escapeHtml(author) + '</strong><span>' + stats.libraries + ' librerie</span><span>' + stats.lessons + ' lezioni</span></div>' +
    '<h3>' + escapeHtml(catalog.title) + '</h3>' +
    '<p>' + escapeHtml(catalog.description || '') + '</p>' +
    '<div class="course-footer">' +
      '<div class="tags">' + (catalog.tags || []).slice(0,3).map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join('') + '</div>' +
      '<span class="rating-inline">' + escapeHtml(visibility) + ' · ' + stats.topics + ' argomenti</span>' +
    '</div>' +
  '</a>';
}

export function libraryCard(catalog, library) {
  const lessonCount = library.lessons?.length || 0;
  const topicCount = (library.lessons || []).reduce((sum, lesson) => sum + (lesson.topics?.length || 0), 0);
  return '<a class="library-row" href="#/catalog/' + encodeURIComponent(catalog.slug) + '/library/' + encodeURIComponent(library.slug) + '">' +
    '<div><span class="eyebrow">Libreria</span><h3>' + escapeHtml(library.title) + '</h3><p>' + escapeHtml(library.description || '') + '</p></div>' +
    '<div class="library-row-meta"><strong>' + lessonCount + '</strong><span>lezioni</span><strong>' + topicCount + '</strong><span>argomenti</span><span class="library-row-arrow">→</span></div>' +
  '</a>';
}

export function lessonCard(catalog, library, lesson, index) {
  const topics = lesson.topics?.length || 0;
  const minutes = lesson.estimatedMinutes || (lesson.topics || []).reduce((sum, topic) => sum + (topic.estimatedMinutes || 0), 0);
  const href = lessonHref(catalog, library.slug, lesson.slug);
  return '<article class="lesson-row">' +
    '<a class="lesson-row-main" href="' + href + '">' +
      '<span class="lesson-index">' + String(index + 1).padStart(2, '0') + '</span>' +
      '<div><h3>' + escapeHtml(lesson.title) + '</h3><p>' + escapeHtml(lesson.description || '') + '</p></div>' +
      '<div class="lesson-meta"><strong>' + topics + '</strong><span>argomenti</span><strong>' + (minutes || '—') + '</strong><span>min</span></div>' +
    '</a>' +
    '<a class="lesson-universe-link" href="' + href + '/universe">Universo lezione ↗</a>' +
  '</article>';
}

export function lessonReaderRail(context, activeTopicId) {
  const lesson = context.lesson;
  let i = 0;
  const base = lessonHref(context.catalog, context.library.slug, lesson.slug);
  return (lesson.modules || []).map(module =>
    '<section class="module-group">' +
      '<p class="module-title">' + escapeHtml(module.title) + '</p>' +
      (module.topicIds || []).map(id => {
        const topic = findTopic(lesson, id);
        if (!topic) return '';
        i += 1;
        return '<a class="topic-link ' + (id === activeTopicId ? 'active' : '') + '" href="' + base + '/topic/' + encodeURIComponent(id) + '">' +
          '<span class="topic-num">' + String(i).padStart(2,'0') + '</span><span>' + escapeHtml(topic.title) + '</span>' +
        '</a>';
      }).join('') +
    '</section>'
  ).join('');
}

export function lessonTopicArticle(context, topic) {
  const lesson = context.lesson;
  const ordered = getOrderedTopics(lesson);
  const index = ordered.findIndex(item => item.id === topic.id);
  const prev = ordered[index - 1];
  const next = ordered[index + 1];
  const number = topicNumber(lesson, topic.id);
  const base = lessonHref(context.catalog, context.library.slug, lesson.slug);

  return '<article class="reader">' +
    '<header class="reader-header">' +
      '<div class="reader-kicker">' +
        '<a href="#/catalog/' + encodeURIComponent(context.catalog.slug) + '">' + escapeHtml(context.catalog.title) + '</a>' +
        '<span>·</span>' +
        '<a href="#/catalog/' + encodeURIComponent(context.catalog.slug) + '/library/' + encodeURIComponent(context.library.slug) + '">' + escapeHtml(context.library.title) + '</a>' +
        '<span>·</span><span>' + escapeHtml(lesson.title) + '</span>' +
      '</div>' +
      '<h2 class="topic-title">' + escapeHtml(topic.title) + '</h2>' +
      '<p class="topic-summary">' + escapeHtml(topic.summary || '') + '</p>' +
      ((topic.learningGoals || []).length ? '<ul class="learning-goals">' + topic.learningGoals.map(goal => '<li>' + escapeHtml(goal) + '</li>').join('') + '</ul>' : '') +
    '</header>' +
    (topic.why ? '<aside class="callout"><h4>Perché ti serve</h4>' + paragraphs(topic.why) + '</aside>' : '') +
    (topic.sections || []).map(renderSection).join('') +
    renderLessonConnections(context, topic) +
    '<nav class="lesson-nav">' +
      (prev ? '<a href="' + base + '/topic/' + encodeURIComponent(prev.id) + '">← Prima<strong>' + escapeHtml(prev.title) + '</strong></a>' : '<span></span>') +
      (next ? '<a href="' + base + '/topic/' + encodeURIComponent(next.id) + '" style="text-align:right">Dopo →<strong>' + escapeHtml(next.title) + '</strong></a>' : '<span></span>') +
    '</nav>' +
    '<div id="discussion-root"></div>' +
  '</article>';
}

function renderLessonConnections(context, topic) {
  const items = [];
  for (const prerequisite of topic.prerequisites || []) {
    if (prerequisite.includes('/')) continue;
    const target = findTopic(context.lesson, prerequisite);
    if (target) items.push({ type: 'richiede', label: target.title, target: target.id });
  }

  for (const connection of topic.connections || []) {
    if (connection.target.includes('/')) continue;
    const target = findTopic(context.lesson, connection.target);
    if (target) {
      items.push({
        type: connection.type || 'collegato',
        label: connection.label || target.title,
        target: target.id
      });
    }
  }

  if (!items.length) return '';
  const base = lessonHref(context.catalog, context.library.slug, context.lesson.slug);
  return '<section class="topic-connections"><h3>Collegamenti nella lezione</h3><div class="connection-list">' +
    items.map(item =>
      '<a class="connection" href="' + base + '/topic/' + encodeURIComponent(item.target) + '">' +
        '<span class="connection-type">' + escapeHtml(item.type) + '</span>' +
        '<span class="connection-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="connection-arrow">→</span>' +
      '</a>'
    ).join('') +
  '</div></section>';
}
