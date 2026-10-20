// Paginate existing, already-rendered lesson HTML at actual paper dimensions.
// Prefer whole sections; split at child blocks and, when needed, text ranges.
// Unsplittable media is scrollable rather than cropped or omitted.
const SKIP_CLASSES = ['reader-view-controls','reader-book-view','topic-sources','topic-connections','lesson-nav','topic-progress-actions'];
const ATOMIC_SELECTOR = 'img, iframe, video, svg, table, .katex, .math, button, input, canvas';

export function bookSourceBlocks(reader) {
  return [...reader.children].filter(node =>
    node.nodeType === 1 && !SKIP_CLASSES.some(name => node.classList.contains(name)) &&
    node.id !== 'discussion-root' && node.tagName !== 'NAV'
  );
}

export function bookPaper({ width, height, number = 0, label = '' }) {
  const page = document.createElement('div');
  page.className = 'book-paper';
  page.style.width = width + 'px';
  page.style.height = height + 'px';
  page.setAttribute('data-density', 'soft');
  page.innerHTML = '<div class="book-paper-running-head">STUDYLIBRARY <span>·</span> ' +
    escapeBook(label) + '</div><div class="book-paper-body"></div>' +
    '<div class="book-paper-running-foot"><span>LEGGI · IMPARA · COLLEGA</span>' +
    '<span class="book-paper-number">' + (number || '') + '</span></div>';
  return page;
}

function escapeBook(text) {
  return String(text || '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])
  );
}

function textOffsets(root) {
  const texts = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0, node;
  while ((node = walk.nextNode())) {
    if (!node.textContent.length) continue;
    texts.push({node,start:total,end:total + node.textContent.length});
    total += node.textContent.length;
  }
  return {texts,total};
}

function textChunk(node, map, start, end) {
  const clone = node.cloneNode(false);
  const from = map.texts.find(record => record.end > start);
  const to = map.texts.find(record => record.end >= end && record.start < end);
  if (!from || !to) return clone;
  const range = document.createRange();
  range.setStart(from.node,start - from.start);
  range.setEnd(to.node,end - to.start);
  clone.appendChild(range.cloneContents());
  return clone;
}

export function paginateBook(reader, mount, {width,height,label = '',maxPages = 220} = {}) {
  if (!reader || !mount || !(width > 100) || !(height > 180)) throw new Error('Dimensioni del libro non valide.');
  const source = bookSourceBlocks(reader);
  const papers = [];
  const measuring = document.createElement('div');
  measuring.className = 'book-measure';
  measuring.style.setProperty('--reader-text-size',
    getComputedStyle(reader).getPropertyValue('--reader-text-size').trim() || '18px');
  measuring.setAttribute('aria-hidden','true');
  document.body.appendChild(measuring);

  let paper, body, items = 0;
  const begin = () => {
    if (papers.length >= maxPages) throw new Error('La lezione è troppo lunga per essere impaginata in questa modalità.');
    paper = bookPaper({width,height,number:papers.length+1,label});
    measuring.appendChild(paper);
    body = paper.querySelector('.book-paper-body');
    papers.push(paper);
    items = 0;
  };
  const fits = node => {
    body.appendChild(node);
    const ok = body.scrollHeight <= body.clientHeight + 2;
    if (!ok) body.removeChild(node);
    return ok;
  };
  const commit = node => { body.appendChild(node); items += 1; };
  const next = () => begin();

  function placeAtomic(node) {
    if (fits(node)) { items += 1; return; }
    if (items) {
      next();
      if (fits(node)) { items += 1; return; }
    }
    node.classList.add('book-oversize');
    commit(node); // last-resort internal scrolling; never discard content
  }

  function splitText(node, wrapper = null) {
    if (node.querySelector?.(ATOMIC_SELECTOR)) {
      placeAtomic(wrap(wrapper,node.cloneNode(true)));
      return;
    }
    const map = textOffsets(node);
    if (!map.total) {
      placeAtomic(wrap(wrapper,node.cloneNode(true)));
      return;
    }
    let offset = 0, guard = 0;
    while (offset < map.total && guard++ < maxPages * 20) {
      const candidate = end => wrap(wrapper,textChunk(node,map,offset,end));
      let left = offset+1, right = map.total, best=offset;
      while (left <= right) {
        const mid = (left+right) >>> 1;
        const attempt=candidate(mid);
        if (fits(attempt)) {
          body.removeChild(attempt);
          best=mid;
          left=mid+1;
        } else right=mid-1;
      }
      if (best === offset) {
        if (items) { next(); continue; }
        // A single unbreakable item is still displayed with a scroll fallback.
        placeAtomic(wrap(wrapper,textChunk(node,map,offset,map.total)));
        return;
      }
      // Prefer breaking at a whitespace boundary near the best available point.
      if (best < map.total && best-offset > 14) {
        const full=node.textContent;
        let cut=best;
        while (cut > Math.max(offset+1,best-35) && !/\s/.test(full[cut-1])) cut--;
        if (cut > offset+1) best=cut;
      }
      placeAtomic(candidate(best));
      offset=best;
      if (offset < map.total) next();
    }
  }

  function wrap(wrapper, child) {
    if (!wrapper) return child;
    const outer=wrapper.cloneNode(false);
    outer.classList.add('book-fragment');
    outer.appendChild(child);
    return outer;
  }

  function placeBlock(original) {
    let whole=original.cloneNode(true);
    if (fits(whole)) { items++; return; }
    if (items) {
      next();
      whole=original.cloneNode(true);
      if (fits(whole)) { items++; return; }
    }
    if (original.matches('p,li,blockquote,h2,h3,h4') && !original.querySelector(ATOMIC_SELECTOR)) {
      splitText(original);
      return;
    }
    const children=[...original.childNodes].filter(node=>node.nodeType===1 ||
      (node.nodeType===3 && node.textContent.trim()));
    // Do not break illustration/formula/table/interactive components in half.
    if (!children.length || original.matches('figure,iframe,img,video,table') || original.querySelector(ATOMIC_SELECTOR) && children.length === 1) {
      if (original.matches('p,li,blockquote,h2,h3,h4')) splitText(original);
      else placeAtomic(original.cloneNode(true));
      return;
    }
    for (const child of children) {
      if (child.nodeType === 3) {
        const paragraph=document.createElement('p');
        paragraph.textContent=child.textContent;
        splitText(paragraph,original);
        continue;
      }
      const candidate=wrap(original,child.cloneNode(true));
      if (fits(candidate)) { items++; continue; }
      if (items) {
        next();
        if (fits(wrap(original,child.cloneNode(true)))) { items++; continue; }
      }
      if (child.matches('p,li,blockquote,h2,h3,h4') && !child.querySelector(ATOMIC_SELECTOR)) {
        splitText(child,original);
      } else {
        placeAtomic(wrap(original,child.cloneNode(true)));
      }
    }
  }
  try {
    begin();
    for (const original of source) placeBlock(original);
    if (!items && papers.length>1) papers.pop();
    if (!source.length) {
      const placeholder=document.createElement('p');
      placeholder.textContent='Nessun contenuto disponibile per questo argomento.';
      paper.querySelector('.book-paper-body').appendChild(placeholder);
    }
    for (const item of papers) mount.appendChild(item);
    return papers;
  } finally {
    measuring.remove();
  }
}

export function bookCover({width,height,title,subtitle = '',back = false}) {
  const page=document.createElement('div');
  page.className='book-paper book-hard-cover' + (back ? ' book-back-cover':'');
  page.setAttribute('data-density','hard');
  page.style.width=width+'px';
  page.style.height=height+'px';
  page.innerHTML='<div class="book-cover-pattern" aria-hidden="true"></div>' +
    '<div class="book-cover-monogram" aria-hidden="true">S<span>·</span>L</div>' +
    '<div class="book-cover-copy"><span class="book-cover-overline">STUDYLIBRARY / ' +
    (back ? 'FINE':'LETTURA') + '</span><h2>' + escapeBook(back?'Continua a esplorare':title) +
    '</h2><p>' + escapeBook(back?'Hai terminato questo argomento.':subtitle) + '</p></div>' +
    '<div class="book-cover-foot">STUDYLIBRARY<span>®</span></div>';
  return page;
}
