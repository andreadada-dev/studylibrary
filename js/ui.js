import { state, isBackendConfigured } from './state.js';
import { signInWithGoogle, signOut, fetchMyCatalogs, deleteAllMyContent, deleteAccount, getDiscussion, addComment, updateComment, deleteComment, reportContent, setRating } from './api.js';
import { getOrderedTopics, topicNumber, findTopic, catalogStats, lessonHref, catalogRef } from './content.js';
import { resolveMediaAsset, detectVideoProvider, videoEmbedUrl } from './media.js';

export const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export function safeUrl(value, { image = false } = {}) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/(?!\/)/.test(text) || /^\.\.?\//.test(text)) return text;
  if (image && /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)[;,]/i.test(text)) return text;
  return '';
}

function safeColor(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) || /^#[0-9a-f]{3}$/i.test(text) ? text : '#6157e7';
}

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
  const avatar = safeUrl(state.profile?.avatar_url || state.user.user_metadata?.avatar_url, { image: true });
  slot.innerHTML = `<button class="account-button" data-account>${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" />` : `<span class="avatar">${escapeHtml(name[0] || 'U')}</span>`}<span class="account-name">${escapeHtml(name)}</span></button>`;
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
    {
      label: 'Esporta cataloghi',
      className: 'button secondary',
      action: async () => {
        try {
          const catalogs = await fetchMyCatalogs();
          const clean = catalogs.map(stripRuntimeForExport);
          const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), catalogs: clean }, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'studylibrary-export.json';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Esportazione pronta');
        } catch (err) { toast(err.message); }
      }
    },
    {
      label: 'Elimina i miei contenuti',
      className: 'button danger',
      action: () => {
        showModal('Eliminare tutti i tuoi contenuti?', '<p>Verranno eliminati cataloghi cloud, commenti, valutazioni e segnalazioni creati da questo account. L’account di autenticazione resterà attivo.</p>', [
          {
            label: 'Elimina contenuti',
            className: 'button danger',
            action: async () => {
              try {
                await deleteAllMyContent();
                closeModal();
                toast('Contenuti eliminati');
                location.hash = '#/mine';
              } catch (err) { toast(err.message); }
            }
          },
          { label: 'Annulla', className: 'button secondary', action: closeModal }
        ]);
      }
    },
    {
      label: 'Elimina account',
      className: 'button danger',
      action: () => {
        showModal('Eliminare definitivamente l’account?', '<p>Verranno eliminati l’account StudyLibrary e tutti i contenuti associati. Questa operazione non può essere annullata.</p>', [
          {
            label: 'Elimina account',
            className: 'button danger',
            action: async () => {
              try {
                await deleteAccount();
                closeModal();
                toast('Account eliminato');
                location.hash = '#/';
              } catch (err) { toast(err.message); }
            }
          },
          { label: 'Annulla', className: 'button secondary', action: closeModal }
        ]);
      }
    },
    { label: 'Esci', className: 'button secondary', action: async () => { await signOut(); closeModal(); } },
    { label: 'Chiudi', className: 'button ghost', action: closeModal }
  ]);
}

function stripRuntimeForExport(value) {
  if (Array.isArray(value)) return value.map(stripRuntimeForExport);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.startsWith('_')) continue;
    output[key] = stripRuntimeForExport(item);
  }
  return output;
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
  const source = Array.isArray(body) ? body.join('\n\n') : String(body || '');
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(source, { gfm: true, breaks: false });
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  return source.split(/\n\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

export function renderSection(section, context = null) {
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
    case 'image': {
      const asset = resolveMediaAsset(context?.catalog, section);
      const src = safeUrl(asset?.url || section.url || section.src, { image: true });
      if (!src) return `<figure class="lesson-image"><div class="image-fallback"><strong>Immagine non valida</strong><span>Media mancante oppure URL non consentito.</span></div></figure>`;
      const alt = section.alt || asset?.alt || section.title || asset?.title || '';
      const caption = section.caption || asset?.caption || '';
      const credit = section.credit || asset?.credit || asset?.author || '';
      const sourceUrl = safeUrl(section.sourceUrl || asset?.sourceUrl || '');
      const source = sourceUrl
        ? ` <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">fonte ↗</a>`
        : '';
      return `<figure class="lesson-image media-block">${section.title || asset?.title ? `<h3>${escapeHtml(section.title || asset?.title || '')}</h3>` : ''}<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer" />${caption || credit || source ? `<figcaption>${escapeHtml(caption)}${credit ? ` · ${escapeHtml(credit)}` : ''}${source}</figcaption>` : ''}</figure>`;
    }
    case 'video': {
      const asset = resolveMediaAsset(context?.catalog, section);
      const url = safeUrl(asset?.url || section.url || '');
      if (!url) return `<section class="lesson-section media-block"><div class="image-fallback"><strong>Video non valido</strong><span>Media mancante oppure URL non consentito.</span></div></section>`;

      const titleText = section.title || asset?.title || 'Video';
      const caption = section.caption || asset?.caption || '';
      const credit = section.credit || asset?.credit || asset?.author || '';
      const sourceUrl = safeUrl(section.sourceUrl || asset?.sourceUrl || '');
      const provider = asset?.provider || section.provider || detectVideoProvider(url);
      const embed = videoEmbedUrl(url);
      const thumbnail = safeUrl(section.thumbnailUrl || asset?.thumbnailUrl || '', { image: true });

      let player = '';
      if (embed) {
        player = `<div class="lesson-video-frame"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(titleText)}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
      } else if (provider === 'direct') {
        player = `<video class="lesson-video-direct" controls preload="metadata" playsinline${thumbnail ? ` poster="${escapeHtml(thumbnail)}"` : ''}><source src="${escapeHtml(url)}"></video>`;
      } else {
        player = `<a class="video-link-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${thumbnail ? `<img src="${escapeHtml(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="video-link-icon">▶</span>'}<strong>Apri video ↗</strong></a>`;
      }

      const source = sourceUrl
        ? ` · <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">fonte ↗</a>`
        : '';
      return `<figure class="lesson-video media-block"><h3>${escapeHtml(titleText)}</h3>${player}${caption || credit || source ? `<figcaption>${escapeHtml(caption)}${credit ? ` · ${escapeHtml(credit)}` : ''}${source}</figcaption>` : ''}</figure>`;
    }
    case 'gallery': {
      const items = (section.items || []).map(item => resolveMediaAsset(context?.catalog, item)).filter(Boolean);
      if (!items.length) return `<section class="lesson-section media-block"><div class="image-fallback"><strong>Galleria vuota</strong><span>Aggiungi mediaRef validi alla galleria.</span></div></section>`;
      return `<section class="lesson-section media-gallery">${title}<div class="media-gallery-grid">${items.map(asset => {
        if (asset.type === 'video') {
          const url = safeUrl(asset.url);
          const thumb = safeUrl(asset.thumbnailUrl || '', { image: true });
          return url ? `<a class="media-gallery-item video" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="video-link-icon">▶</span>'}<strong>${escapeHtml(asset.title || 'Video')}</strong></a>` : '';
        }
        const src = safeUrl(asset.url, { image: true });
        return src ? `<figure class="media-gallery-item"><img src="${escapeHtml(src)}" alt="${escapeHtml(asset.alt || asset.title || '')}" loading="lazy" referrerpolicy="no-referrer">${asset.caption ? `<figcaption>${escapeHtml(asset.caption)}</figcaption>` : ''}</figure>` : '';
      }).join('')}</div>${section.caption ? `<p class="media-gallery-caption">${escapeHtml(section.caption)}</p>` : ''}</section>`;
    }
    case 'embed': {
      const url = safeUrl(section.url);
      if (!url) return `<section class="lesson-section media-block">${title}<div class="image-fallback"><strong>Risorsa non valida</strong><span>URL non consentito.</span></div></section>`;
      return `<section class="lesson-section external-resource">${title}${section.body ? paragraphs(section.body) : ''}<a class="external-resource-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer nofollow">Apri risorsa esterna ↗</a></section>`;
    }
    case 'flow':
      return `<section class="lesson-section">${title}<div class="flow-diagram">${(section.nodes || []).map((n, idx) => `${idx ? '<span class="flow-arrow">→</span>' : ''}<div class="flow-node">${escapeHtml(typeof n === 'string' ? n : n.label)}</div>`).join('')}</div>${section.body ? paragraphs(section.body) : ''}</section>`;
    case 'comparison': {
      const hasStructuredSides = Boolean(
        section.left?.title || section.left?.body ||
        section.right?.title || section.right?.body
      );

      if (!hasStructuredSides && section.body) {
        return `<section class="lesson-section">${title}<div class="comparison comparison-body"><div>${paragraphs(section.body)}</div></div></section>`;
      }

      return `<section class="lesson-section">${title}<div class="comparison"><div><h4>${escapeHtml(section.left?.title || '')}</h4>${paragraphs(section.left?.body || '')}</div><div><h4>${escapeHtml(section.right?.title || '')}</h4>${paragraphs(section.right?.body || '')}</div></div></section>`;
    }
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

  document.querySelectorAll('.lesson-image img').forEach(img => {
    img.addEventListener('error', () => {
      const figure = img.closest('.lesson-image');
      if (!figure || figure.dataset.failed === 'true') return;
      figure.dataset.failed = 'true';
      figure.innerHTML = '<div class="image-fallback"><strong>Immagine non disponibile</strong><span>La fonte esterna non è raggiungibile in questo momento.</span></div>';
    }, { once: true });
  });

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
    root.innerHTML = `<section class="discussion"><div class="discussion-head"><h3>Discussione</h3><span class="rating-inline"><span class="star">★</span> —</span></div><p class="demo-note">Commenti e stelline si attivano quando colleghi Supabase. Il contenuto e la navigazione JSON funzionano già in modalità demo.</p></section>`;
    return;
  }

  root.innerHTML = `<section class="discussion"><div class="skeleton" style="height:120px"></div></section>`;
  try {
    const data = await getDiscussion(targetKind, targetKey);
    const average = data.average ? data.average.toFixed(1) : '—';
    root.innerHTML = `<section class="discussion">
      <div class="discussion-head"><div><h3>Discussione</h3><div class="demo-note">${data.count} valutazioni · media ${average}</div></div><div class="stars-input" aria-label="Valuta da 1 a 5">${[1,2,3,4,5].map(n => `<button class="star-button ${data.mine >= n ? 'on' : ''}" data-rate="${n}" aria-label="${n} stelle">★</button>`).join('')}</div></div>
      ${state.user ? `<form class="comment-form"><input name="comment" maxlength="1200" placeholder="Lascia un commento utile…" autocomplete="off" /><button class="button" type="submit">Pubblica</button></form>` : `<p class="demo-note">Accedi con Google per valutare e commentare.</p>`}
      <div class="comments">${data.comments.length ? data.comments.map(c => renderComment(c, targetKind, targetKey)).join('') : `<p class="demo-note">Nessun commento ancora.</p>`}</div>
    </section>`;

    root.querySelectorAll('[data-rate]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        if (!state.user) return signInWithGoogle();
        await setRating(targetKind, targetKey, Number(btn.dataset.rate));
        await renderDiscussion(targetKind, targetKey, rootId);
      } catch (err) { toast(err.message); }
    }));

    root.querySelector('.comment-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.currentTarget.elements.comment;
      const submit = e.currentTarget.querySelector('button[type="submit"]');
      try {
        submit.disabled = true;
        await addComment(targetKind, targetKey, input.value);
        input.value = '';
        await renderDiscussion(targetKind, targetKey, rootId);
      } catch (err) {
        toast(err.message);
        submit.disabled = false;
      }
    });

    root.querySelectorAll('[data-comment-edit]').forEach(btn => btn.addEventListener('click', () => {
      const comment = data.comments.find(item => String(item.id) === btn.dataset.commentEdit);
      if (!comment) return;
      showModal('Modifica commento', `<textarea class="modal-textarea" data-edit-body maxlength="1200">${escapeHtml(comment.body)}</textarea>`, [
        {
          label: 'Salva',
          className: 'button',
          action: async () => {
            const body = document.querySelector('[data-edit-body]')?.value || '';
            try {
              await updateComment(comment.id, body);
              closeModal();
              toast('Commento aggiornato');
              await renderDiscussion(targetKind, targetKey, rootId);
            } catch (err) { toast(err.message); }
          }
        },
        { label: 'Annulla', className: 'button secondary', action: closeModal }
      ]);
    }));

    root.querySelectorAll('[data-comment-delete]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.commentDelete;
      showModal('Eliminare il commento?', '<p>Questa operazione non può essere annullata.</p>', [
        {
          label: 'Elimina',
          className: 'button danger',
          action: async () => {
            try {
              await deleteComment(id);
              closeModal();
              toast('Commento eliminato');
              await renderDiscussion(targetKind, targetKey, rootId);
            } catch (err) { toast(err.message); }
          }
        },
        { label: 'Annulla', className: 'button secondary', action: closeModal }
      ]);
    }));

    root.querySelectorAll('[data-comment-report]').forEach(btn => btn.addEventListener('click', async () => {
      if (!state.user) {
        try { await signInWithGoogle(); } catch (err) { toast(err.message); }
        return;
      }
      const id = btn.dataset.commentReport;
      showReportModal(targetKind, targetKey, id);
    }));
  } catch (err) {
    root.innerHTML = `<section class="discussion"><p class="demo-note">Impossibile caricare la discussione: ${escapeHtml(err.message)}</p><button class="button secondary" type="button" data-retry-discussion>Riprova</button></section>`;
    root.querySelector('[data-retry-discussion]')?.addEventListener('click', () => renderDiscussion(targetKind, targetKey, rootId));
  }
}

function renderComment(c, targetKind, targetKey) {
  const name = c.profiles?.display_name || 'Studente';
  const avatar = safeUrl(c.profiles?.avatar_url, { image: true });
  const date = new Date(c.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  const mine = Boolean(state.user && c.user_id === state.user.id);
  const actions = mine
    ? `<div class="comment-actions"><button type="button" data-comment-edit="${c.id}">Modifica</button><button type="button" data-comment-delete="${c.id}">Elimina</button></div>`
    : `<div class="comment-actions"><button type="button" data-comment-report="${c.id}">Segnala</button></div>`;

  return `<div class="comment">${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" referrerpolicy="no-referrer" />` : `<span class="avatar">${escapeHtml(name[0] || 'S')}</span>`}<div><div class="comment-author">${escapeHtml(name)} <span class="comment-time">${escapeHtml(date)}</span></div><div class="comment-body">${escapeHtml(c.body)}</div>${actions}</div></div>`;
}

function showReportModal(targetKind, targetKey, commentId = null) {
  showModal('Segnala contenuto', '<p class="modal-copy">Indica brevemente il problema. La segnalazione verrà registrata per la moderazione.</p><textarea class="modal-textarea" data-report-reason maxlength="500" placeholder="Spam, contenuto offensivo, informazioni personali…"></textarea>', [
    {
      label: 'Invia segnalazione',
      className: 'button danger',
      action: async () => {
        const reason = document.querySelector('[data-report-reason]')?.value || '';
        try {
          await reportContent(targetKind, targetKey, reason, commentId);
          closeModal();
          toast('Segnalazione inviata');
        } catch (err) { toast(err.message); }
      }
    },
    { label: 'Annulla', className: 'button secondary', action: closeModal }
  ]);
}

function lessonPreviewImage(catalog, lesson) {
  const direct = safeUrl(
    lesson?.coverImage || lesson?.coverUrl || lesson?.thumbnailUrl || lesson?.image || '',
    { image: true }
  );
  if (direct) return direct;

  for (const topic of lesson?.topics || []) {
    for (const section of topic.sections || []) {
      if (section?.type === 'image') {
        const asset = resolveMediaAsset(catalog, section);
        const src = safeUrl(asset?.url || section.url || section.src || '', { image: true });
        if (src) return src;
      }

      if (section?.type === 'video') {
        const asset = resolveMediaAsset(catalog, section);
        const src = safeUrl(asset?.thumbnailUrl || section.thumbnailUrl || '', { image: true });
        if (src) return src;
      }

      if (section?.type === 'gallery') {
        for (const item of section.items || []) {
          const asset = resolveMediaAsset(catalog, item);
          const src = safeUrl(
            asset?.type === 'video' ? asset?.thumbnailUrl : asset?.url,
            { image: true }
          );
          if (src) return src;
        }
      }
    }
  }

  return '';
}

function catalogPreviewLessons(catalog, limit = 5) {
  const previews = [];
  for (const library of catalog?.libraries || []) {
    for (const lesson of library.lessons || []) {
      previews.push({
        title: lesson.title || 'Lezione',
        library: library.title || '',
        image: lessonPreviewImage(catalog, lesson)
      });
      if (previews.length >= limit) return previews;
    }
  }
  return previews;
}

function catalogPreviewCard(item, index) {
  const media = item.image
    ? '<img src="' + escapeHtml(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />'
    : '<div class="catalog-folder-preview-fallback"><span>' + escapeHtml(String(index + 1).padStart(2, '0')) + '</span></div>';

  return '<div class="catalog-folder-preview-card" style="--preview-index:' + index + '">' +
    media +
    '<span class="catalog-folder-preview-title">' + escapeHtml(item.title) + '</span>' +
  '</div>';
}

export function catalogCard(catalog) {
  const stats = catalogStats(catalog);
  const author = catalog._author?.display_name || (state.user && catalog._db?.owner_id === state.user.id ? 'Tu' : null) || catalog.university || (catalog._static ? 'Catalogo demo' : 'Community');
  const visibility = catalog.visibility === 'private' ? 'Privato' : 'Pubblico';
  const previews = catalogPreviewLessons(catalog);
  const accent = safeColor(catalog.accent);
  const href = '#/catalog/' + encodeURIComponent(catalogRef(catalog));

  return '<a class="catalog-folder-card" href="' + href + '" style="--folder-accent:' + accent + '" aria-label="Apri il catalogo ' + escapeHtml(catalog.title) + '">' +
    '<div class="catalog-folder-visual" aria-hidden="true">' +
      '<div class="catalog-folder-back"></div>' +
      '<div class="catalog-folder-preview-stack">' +
        previews.map(catalogPreviewCard).join('') +
      '</div>' +
      '<div class="catalog-folder-front"></div>' +
    '</div>' +
    '<div class="catalog-folder-caption">' +
      '<h3>' + escapeHtml(catalog.title) + '</h3>' +
      '<p><span>' + escapeHtml(author) + '</span><span>' + stats.lessons + ' lezioni</span><span>' + stats.topics + ' argomenti</span></p>' +
      '<span class="catalog-folder-visibility">' + escapeHtml(visibility) + '</span>' +
    '</div>' +
  '</a>';
}

export function libraryCard(catalog, library) {
  const lessonCount = library.lessons?.length || 0;
  const topicCount = (library.lessons || []).reduce((sum, lesson) => sum + (lesson.topics?.length || 0), 0);
  return '<a class="library-row" href="#/catalog/' + encodeURIComponent(catalogRef(catalog)) + '/library/' + encodeURIComponent(library.slug) + '">' +
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
        '<a href="#/catalog/' + encodeURIComponent(catalogRef(context.catalog)) + '">' + escapeHtml(context.catalog.title) + '</a>' +
        '<span>·</span>' +
        '<a href="#/catalog/' + encodeURIComponent(catalogRef(context.catalog)) + '/library/' + encodeURIComponent(context.library.slug) + '">' + escapeHtml(context.library.title) + '</a>' +
        '<span>·</span><span>' + escapeHtml(lesson.title) + '</span>' +
      '</div>' +
      '<h2 class="topic-title">' + escapeHtml(topic.title) + '</h2>' +
      '<div class="topic-summary markdown-content">' + paragraphs(topic.summary || '') + '</div>' +
      ((topic.learningGoals || []).length ? '<ul class="learning-goals">' + topic.learningGoals.map(goal => '<li>' + escapeHtml(goal) + '</li>').join('') + '</ul>' : '') +
    '</header>' +
    (topic.why ? '<aside class="callout"><h4>Perché ti serve</h4>' + paragraphs(topic.why) + '</aside>' : '') +
    (topic.sections || []).map(section => renderSection(section, context)).join('') +
    renderTopicSources(context, topic) +
    renderLessonConnections(context, topic) +
    '<nav class="lesson-nav">' +
      (prev ? '<a href="' + base + '/topic/' + encodeURIComponent(prev.id) + '">← Prima<strong>' + escapeHtml(prev.title) + '</strong></a>' : '<span></span>') +
      (next ? '<a href="' + base + '/topic/' + encodeURIComponent(next.id) + '" style="text-align:right">Dopo →<strong>' + escapeHtml(next.title) + '</strong></a>' : '<span></span>') +
    '</nav>' +
    '<div id="discussion-root"></div>' +
  '</article>';
}

function renderTopicSources(context, topic) {
  const lessonSources = new Map((context.lesson.sources || []).map(source => [source.id, source]));
  const catalogSources = new Map((context.catalog.sources || []).map(source => [source.id, source]));
  const refs = topic.sources || [];
  if (!refs.length) return '';

  const rows = refs.map(ref => {
    const source = lessonSources.get(ref.ref) || catalogSources.get(ref.ref) || {};
    const label = source.label || ref.ref || 'Fonte';
    const sourceUrl = safeUrl(source.url);
    const link = sourceUrl
      ? '<a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer nofollow">' + escapeHtml(label) + ' ↗</a>'
      : '<strong>' + escapeHtml(label) + '</strong>';
    const meta = [ref.pages ? 'pp. ' + ref.pages : '', ref.note || ''].filter(Boolean).join(' · ');
    return '<li><div>' + link + '</div>' + (meta ? '<span>' + escapeHtml(meta) + '</span>' : '') + '</li>';
  }).join('');

  return '<section class="topic-sources"><h3>Fonti</h3><ol>' + rows + '</ol></section>';
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
