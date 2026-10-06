import { mediaAssetId, detectMediaType, detectVideoProvider, videoThumbnailUrl } from './media.js';

export function mountCatalogEditor(container, initialCatalog, options = {}) {
  let catalog = structuredClone(initialCatalog);
  let selection = { type: 'catalog', li: null, lj: null, ti: null };
  let editors = [];

  render();

  return {
    getCatalog: () => structuredClone(catalog),
    setCatalog(next) {
      catalog = structuredClone(next);
      selection = { type: 'catalog', li: null, lj: null, ti: null };
      render();
    },
    destroy() {
      destroyEditors();
      container.innerHTML = '';
    }
  };

  function emit() {
    if (options.onChange) options.onChange(structuredClone(catalog));
  }

  function selected() {
    if (selection.type === 'catalog') return catalog;
    const lib = catalog.libraries?.[selection.li];
    if (selection.type === 'library') return lib;
    const lesson = lib?.lessons?.[selection.lj];
    if (selection.type === 'lesson') return lesson;
    return lesson?.topics?.[selection.ti];
  }

  function render() {
    destroyEditors();
    container.innerHTML =
      '<div class="catalog-editor">' +
        '<aside class="catalog-editor-tree">' +
          '<div class="catalog-editor-tree-head"><div><span class="eyebrow">Struttura</span><strong>' + esc(catalog.title || 'Catalogo') + '</strong></div>' +
          '<button class="editor-icon-button" type="button" data-add-library title="Aggiungi libreria">＋</button></div>' +
          '<div class="catalog-tree-scroll">' + renderTree() + '</div>' +
        '</aside>' +
        '<section class="catalog-editor-panel">' + renderPanel() + '</section>' +
      '</div>';
    bind();
    requestAnimationFrame(initEditors);
  }

  function renderTree() {
    let html = treeButton('catalog', null, null, null, catalog.title || 'Catalogo', 'catalog', selection.type === 'catalog', 0);
    (catalog.libraries || []).forEach((lib, li) => {
      html += treeButton('library', li, null, null, lib.title || 'Libreria', 'library', selection.type === 'library' && selection.li === li, 1);
      (lib.lessons || []).forEach((lesson, lj) => {
        html += treeButton('lesson', li, lj, null, lesson.title || 'Lezione', 'lesson', selection.type === 'lesson' && selection.li === li && selection.lj === lj, 2);
        (lesson.topics || []).forEach((topic, ti) => {
          html += treeButton('topic', li, lj, ti, topic.title || 'Argomento', 'topic', selection.type === 'topic' && selection.li === li && selection.lj === lj && selection.ti === ti, 3);
        });
      });
    });
    return html;
  }

  function treeButton(type, li, lj, ti, label, dot, active, level) {
    return '<button class="catalog-tree-item level-' + level + (active ? ' active' : '') + '" type="button" data-select="' + type + '"' +
      (li === null ? '' : ' data-li="' + li + '"') +
      (lj === null ? '' : ' data-lj="' + lj + '"') +
      (ti === null ? '' : ' data-ti="' + ti + '"') +
      '><span class="tree-dot ' + dot + '"></span><span>' + esc(label) + '</span></button>';
  }

  function renderPanel() {
    const item = selected();
    if (!item) return '<div class="empty-state"><h2>Elemento non trovato</h2></div>';

    const labels = { catalog: 'Catalogo', library: 'Libreria', lesson: 'Lezione', topic: 'Argomento' };
    let add = '';
    if (selection.type === 'catalog') add = '<button class="button secondary" type="button" data-add-library>＋ Libreria</button>';
    if (selection.type === 'library') add = '<button class="button secondary" type="button" data-add-lesson>＋ Lezione</button>';
    if (selection.type === 'lesson') add = '<button class="button secondary" type="button" data-add-topic>＋ Argomento</button>';
    if (selection.type === 'topic') add = '<button class="button secondary" type="button" data-add-section>＋ Sezione</button>';
    const del = selection.type === 'catalog' ? '' : '<button class="button danger ghost" type="button" data-delete-selected>Elimina</button>';

    return '<header class="catalog-editor-panel-head direct-editor-head">' +
        '<div class="direct-editor-copy">' +
          '<span class="eyebrow">' + labels[selection.type] + '</span>' +
          inlineText('title', item.title || item.id || labels[selection.type], 'direct-editor-title', 'Titolo', true) +
          inlineText('description', item.description || '', 'direct-editor-description', 'Aggiungi una descrizione…') +
        '</div>' +
        '<div class="toolbar-actions">' + add + del + '</div>' +
      '</header>' +
      '<div class="direct-editor-body">' + fields(item) + '</div>';
  }

  function fields(item) {
    if (selection.type === 'catalog') {
      return compactSettings(
        'Impostazioni catalogo',
        text('Slug', 'slug', item.slug) +
        text('Tag', 'tags', (item.tags || []).join(', '), 'Separati da virgola') +
        toggle('API pubblica', 'api.publicRead', item.api?.publicRead === true, 'Indipendente dalla pubblicazione in Home.')
      ) + mediaLibrary();
    }

    if (selection.type === 'library') {
      return compactSettings(
        'Impostazioni libreria',
        text('Slug', 'slug', item.slug) + apiPolicy(item)
      );
    }

    if (selection.type === 'lesson') {
      return compactSettings(
        'Impostazioni lezione',
        text('Slug', 'slug', item.slug) + apiPolicy(item)
      ) + lessonSources(item);
    }

    return '<section class="direct-topic-intro">' +
        '<div class="direct-content-block">' +
          '<span class="direct-content-label">Riassunto</span>' +
          inlineText('summary', item.summary || '', 'direct-prose direct-summary', 'Scrivi un riassunto breve…') +
        '</div>' +
        '<div class="direct-content-block">' +
          '<span class="direct-content-label">Perché serve</span>' +
          inlineText('why', item.why || '', 'direct-prose', 'Spiega perché questo argomento è utile…') +
        '</div>' +
      '</section>' +
      compactSettings(
        'Dettagli argomento',
        text('ID', 'id', item.id) +
        '<label class="editor-field"><span>Minuti stimati</span><input type="number" min="0" data-field="estimatedMinutes" value="' + (Number(item.estimatedMinutes) || 0) + '"></label>' +
        textarea('Obiettivi', 'learningGoals', (item.learningGoals || []).join('\n'), 'Uno per riga') +
        textarea('Prerequisiti', 'prerequisites', (item.prerequisites || []).join('\n'), 'ID, uno per riga') +
        textarea('Fonti del topic', 'topicSources', (item.sources || []).map(source => [source.ref || '', source.pages || '', source.note || ''].join(' | ')).join('\n'), 'source-id | pagine/slide | nota') +
        apiPolicy(item)
      ) +
      sections(item);
  }

  function inlineText(key, value, className, placeholder, singleLine = false) {
    return '<div class="' + className + ' direct-editable' + (!String(value || '').trim() ? ' is-empty' : '') + '"' +
      ' contenteditable="plaintext-only"' +
      ' spellcheck="true"' +
      ' data-inline-field="' + attr(key) + '"' +
      (singleLine ? ' data-inline-single="true"' : '') +
      ' data-placeholder="' + attr(placeholder || 'Scrivi qui…') + '">' +
      esc(value || '') +
      '</div>';
  }

  function inlineSectionText(index, key, value, className, placeholder, singleLine = false) {
    return '<div class="' + className + ' direct-editable' + (!String(value || '').trim() ? ' is-empty' : '') + '"' +
      ' contenteditable="plaintext-only"' +
      ' spellcheck="true"' +
      ' data-inline-field="section:' + index + ':' + attr(key) + '"' +
      (singleLine ? ' data-inline-single="true"' : '') +
      ' data-placeholder="' + attr(placeholder || 'Scrivi qui…') + '">' +
      esc(value || '') +
      '</div>';
  }

  function compactSettings(title, body) {
    return '<details class="editor-compact-settings">' +
      '<summary><span>⚙</span><strong>' + esc(title) + '</strong><small>slug, ID, API e metadati</small></summary>' +
      '<div class="catalog-editor-fields compact">' + body + '</div>' +
    '</details>';
  }

  function text(label, key, value, hint) {
    return '<label class="editor-field"><span>' + esc(label) + '</span><input data-field="' + attr(key) + '" value="' + attr(value || '') + '">' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }

  function textarea(label, key, value, hint) {
    return '<label class="editor-field"><span>' + esc(label) + '</span><textarea rows="4" data-field="' + attr(key) + '">' + esc(value || '') + '</textarea>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }

  function md(label, key, value) {
    return '<label class="editor-field editor-field-wide markdown-field"><span>' + esc(label) + ' <em>Markdown</em></span><textarea data-markdown="' + attr(key) + '">' + esc(value || '') + '</textarea></label>';
  }

  function toggle(label, key, checked, hint) {
    return '<label class="editor-field editor-field-wide editor-toggle"><span>' + esc(label) + '</span><span class="toggle-row"><input type="checkbox" data-toggle-field="' + attr(key) + '"' + (checked ? ' checked' : '') + '><i aria-hidden="true"></i><strong>' + (checked ? 'Attiva' : 'Disattiva') + '</strong></span>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</label>';
  }

  function apiPolicy(item) {
    const raw = item.api && typeof item.api.publicRead === 'boolean' ? String(item.api.publicRead) : 'inherit';
    return '<label class="editor-field"><span>Accesso API</span><select data-api-policy><option value="inherit"' + (raw === 'inherit' ? ' selected' : '') + '>Eredita</option><option value="true"' + (raw === 'true' ? ' selected' : '') + '>Pubblico</option><option value="false"' + (raw === 'false' ? ' selected' : '') + '>Privato</option></select><small>Eredita dal genitore oppure restringe questo livello.</small></label>';
  }

  function lessonSources(lesson) {
    const sources = lesson.sources || [];
    let html = '<div class="editor-field editor-field-wide lesson-sources-editor">' +
      '<div class="field-heading"><label>Fonti della lezione</label><span>' + sources.length + '</span></div>' +
      '<div class="media-library-actions"><button class="button secondary" type="button" data-add-source>＋ Fonte</button></div>' +
      '<div class="lesson-source-list">';

    sources.forEach((source, index) => {
      html += '<article class="lesson-source-row">' +
        '<label><span>ID</span><input data-source-field="' + index + ':id" value="' + attr(source.id || '') + '"></label>' +
        '<label><span>Tipo</span><input data-source-field="' + index + ':type" value="' + attr(source.type || '') + '" placeholder="slides, book, web, video..."></label>' +
        '<label class="wide"><span>Etichetta</span><input data-source-field="' + index + ':label" value="' + attr(source.label || '') + '"></label>' +
        '<label class="wide"><span>URL</span><input data-source-field="' + index + ':url" value="' + attr(source.url || '') + '" placeholder="https://..."></label>' +
        '<button type="button" data-delete-source="' + index + '">Elimina</button>' +
      '</article>';
    });

    return html + '</div></div>';
  }

  function mediaLibrary() {
    const assets = catalog.media || [];
    let html = '<div class="editor-field editor-field-wide media-library-editor">' +
      '<div class="field-heading"><label>Libreria media</label><span>' + assets.length + '</span></div>' +
      '<p class="editor-help">Immagini e video inseriti nei topic vengono normalizzati qui al salvataggio. Puoi anche registrarli manualmente e poi usare il mediaRef nelle sezioni.</p>' +
      '<div class="media-library-actions"><button class="button secondary" type="button" data-add-media="image">＋ Immagine</button><button class="button secondary" type="button" data-add-media="video">＋ Video</button></div>' +
      '<div class="media-library-grid">';

    assets.forEach((asset, index) => {
      html += '<article class="media-editor-card">' +
        '<div class="media-editor-card-head"><strong>' + esc(asset.title || asset.id || ('Media ' + (index + 1))) + '</strong><button type="button" data-delete-media="' + index + '">Elimina</button></div>' +
        '<div class="media-editor-fields">' +
          '<label><span>Tipo</span><select data-media-field="' + index + ':type"><option value="image"' + (asset.type === 'image' ? ' selected' : '') + '>Immagine</option><option value="video"' + (asset.type === 'video' ? ' selected' : '') + '>Video</option></select></label>' +
          '<label><span>ID</span><input data-media-field="' + index + ':id" value="' + attr(asset.id || '') + '"></label>' +
          '<label class="wide"><span>URL media</span><input data-media-field="' + index + ':url" value="' + attr(asset.url || '') + '" placeholder="https://..."></label>' +
          '<label><span>Titolo</span><input data-media-field="' + index + ':title" value="' + attr(asset.title || '') + '"></label>' +
          '<label><span>Provider</span><input data-media-field="' + index + ':provider" value="' + attr(asset.provider || '') + '" placeholder="youtube, vimeo, wikipedia..."></label>' +
          '<label class="wide"><span>Didascalia</span><input data-media-field="' + index + ':caption" value="' + attr(asset.caption || '') + '"></label>' +
          '<label class="wide"><span>Alt text</span><input data-media-field="' + index + ':alt" value="' + attr(asset.alt || '') + '" placeholder="Descrizione accessibile dell’immagine"></label>' +
          '<label class="wide"><span>Fonte originale</span><input data-media-field="' + index + ':sourceUrl" value="' + attr(asset.sourceUrl || '') + '" placeholder="https://pagina-della-fonte..."></label>' +
          '<label><span>Autore / credito</span><input data-media-field="' + index + ':author" value="' + attr(asset.author || asset.credit || '') + '"></label>' +
          '<label><span>Licenza</span><input data-media-field="' + index + ':license" value="' + attr(asset.license || '') + '" placeholder="CC BY 4.0, unknown..."></label>' +
          '<label class="wide"><span>Thumbnail video</span><input data-media-field="' + index + ':thumbnailUrl" value="' + attr(asset.thumbnailUrl || '') + '" placeholder="opzionale"></label>' +
        '</div>' +
      '</article>';
    });

    return html + '</div></div>';
  }

  function mediaRefSelect(section, index, expectedType) {
    const assets = (catalog.media || []).filter(asset => !expectedType || asset.type === expectedType);
    const current = section.mediaRef || '';
    return '<label class="editor-field"><span>Media del catalogo</span><select data-field="section:' + index + ':mediaRef">' +
      '<option value="">URL diretto / auto-registra</option>' +
      assets.map(asset => '<option value="' + attr(asset.id) + '"' + (current === asset.id ? ' selected' : '') + '>' + esc(asset.title || asset.id) + '</option>').join('') +
      '</select><small>Se lasci vuoto e incolli un URL, al salvataggio viene creato automaticamente un mediaRef riutilizzabile.</small></label>';
  }

  function sections(topic) {
    const list = topic.sections || [];
    let html = '<section class="direct-sections"><div class="direct-sections-head"><div><span class="eyebrow">Contenuto</span><h3>Sezioni</h3></div><span>' + list.length + '</span></div><div class="editor-sections direct">';

    list.forEach((section, i) => {
      html += '<article class="editor-section-card direct-section-card">' +
        '<div class="direct-section-toolbar">' +
          '<span class="direct-section-kind">' + esc(section.type || 'section') + '</span>' +
          '<details class="section-options"><summary aria-label="Opzioni sezione">•••</summary><div class="section-options-popover">' +
            '<label><span>Tipo</span><select data-section-type="' + i + '">';

      ['lead','concept','text','example','callout','formula','image','video','gallery','embed','flow','comparison','list','checkpoint'].forEach(type => {
        html += '<option value="' + type + '"' + (section.type === type ? ' selected' : '') + '>' + type + '</option>';
      });

      html += '</select></label><button class="editor-mini-danger" type="button" data-delete-section="' + i + '">Elimina sezione</button></div></details></div>';

      if (section.type === 'checkpoint') {
        html += '<div class="direct-checkpoint"><span class="direct-content-label">Checkpoint</span>' +
          inlineSectionText(i, 'question', section.question || '', 'direct-section-question', 'Scrivi la domanda…') +
          '<span class="direct-content-label answer">Risposta</span>' +
          inlineSectionText(i, 'answer', section.answer || '', 'direct-section-body', 'Scrivi la risposta…') +
        '</div>';
      } else if (section.type === 'formula') {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo della formula', true) +
          '<div class="formula-inline-settings">' + text('LaTeX', 'section:' + i + ':latex', section.latex || section.body || '') + '</div>' +
          inlineSectionText(i, 'note', section.note || '', 'direct-section-body', 'Spiega la formula…');
      } else if (section.type === 'image') {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo immagine', true) +
          '<div class="media-direct-preview">' + mediaRefSelect(section, i, 'image') +
            text('URL immagine', 'section:' + i + ':url', section.url || section.src || '', 'Oppure incolla un URL HTTPS') +
          '</div>' +
          inlineSectionText(i, 'caption', section.caption || '', 'direct-section-body', 'Didascalia…') +
          compactSectionMeta(i, section, 'image');
      } else if (section.type === 'video') {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo video', true) +
          '<div class="media-direct-preview">' + mediaRefSelect(section, i, 'video') +
            text('URL video', 'section:' + i + ':url', section.url || '', 'YouTube, Vimeo o video HTTPS') +
          '</div>' +
          inlineSectionText(i, 'caption', section.caption || '', 'direct-section-body', 'Didascalia…') +
          compactSectionMeta(i, section, 'video');
      } else if (section.type === 'gallery') {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo galleria', true) +
          '<details class="inline-meta-details"><summary>Media della galleria</summary>' +
            textarea('MediaRef / URL', 'section:' + i + ':items', Array.isArray(section.items) ? section.items.map(item => typeof item === 'string' ? item : (item.mediaRef || item.url || '')).join('\n') : '', 'Uno per riga') +
          '</details>' +
          inlineSectionText(i, 'caption', section.caption || '', 'direct-section-body', 'Didascalia…');
      } else if (section.type === 'embed') {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo risorsa', true) +
          '<details class="inline-meta-details"><summary>Link della risorsa</summary>' + text('URL', 'section:' + i + ':url', section.url || '') + '</details>' +
          inlineSectionText(i, 'body', section.body || '', 'direct-section-body', 'Nota sulla risorsa…');
      } else {
        html += inlineSectionText(i, 'title', section.title || '', 'direct-section-title', 'Titolo sezione', true) +
          inlineSectionText(i, 'body', section.body || '', 'direct-section-body', 'Scrivi direttamente il contenuto…');
      }

      html += '</article>';
    });

    return html + '</div></section>';
  }

  function compactSectionMeta(index, section, type) {
    return '<details class="inline-meta-details"><summary>Crediti e metadati</summary><div class="catalog-editor-fields compact">' +
      (type === 'image' ? text('Alt text', 'section:' + index + ':alt', section.alt || '') : text('Thumbnail', 'section:' + index + ':thumbnailUrl', section.thumbnailUrl || '')) +
      text('Fonte originale', 'section:' + index + ':sourceUrl', section.sourceUrl || '') +
      text('Credito', 'section:' + index + ':credit', section.credit || '') +
      text('Licenza', 'section:' + index + ':license', section.license || '') +
    '</div></details>';
  }

  function bind() {
    container.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => {
      selection = {
        type: button.dataset.select,
        li: num(button.dataset.li),
        lj: num(button.dataset.lj),
        ti: num(button.dataset.ti)
      };
      render();
    }));

    container.querySelectorAll('[data-inline-field]').forEach(editable => {
      const sync = () => {
        const value = editable.innerText.replace(/\u00a0/g, ' ');
        set(editable.dataset.inlineField, value);
        editable.classList.toggle('is-empty', !value.trim());

        if (editable.dataset.inlineField === 'title') {
          const activeLabel = container.querySelector('.catalog-tree-item.active span:last-child');
          if (activeLabel) activeLabel.textContent = value.trim() || 'Senza titolo';
          const treeHeading = container.querySelector('.catalog-editor-tree-head strong');
          if (selection.type === 'catalog' && treeHeading) treeHeading.textContent = value.trim() || 'Catalogo';
        }

        emit();
      };

      editable.addEventListener('input', sync);
      editable.addEventListener('blur', sync);
      editable.addEventListener('keydown', event => {
        if (editable.dataset.inlineSingle === 'true' && event.key === 'Enter') {
          event.preventDefault();
          editable.blur();
        }
      });
      editable.addEventListener('paste', event => {
        event.preventDefault();
        const plain = event.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, plain);
      });
    });

    container.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', () => {
      set(input.dataset.field, input.value);
      emit();
    }));

    container.querySelectorAll('[data-toggle-field]').forEach(input => input.addEventListener('change', () => {
      catalog.api ||= {};
      catalog.api.publicRead = input.checked;
      const strong = input.closest('.toggle-row')?.querySelector('strong');
      if (strong) strong.textContent = input.checked ? 'Attiva' : 'Disattiva';
      emit();
    }));

    container.querySelector('[data-api-policy]')?.addEventListener('change', event => {
      const item = selected();
      item.api ||= {};
      if (event.target.value === 'inherit') delete item.api.publicRead;
      else item.api.publicRead = event.target.value === 'true';
      if (!Object.keys(item.api).length) delete item.api;
      emit();
    });

    container.querySelector('[data-add-source]')?.addEventListener('click', () => {
      const lesson = selected();
      lesson.sources ||= [];
      let next = lesson.sources.length + 1;
      let id = 'source-' + next;
      while (lesson.sources.some(source => source.id === id)) {
        next += 1;
        id = 'source-' + next;
      }
      lesson.sources.push({ id, type: 'web', label: 'Nuova fonte', url: '' });
      emit();
      render();
    });

    container.querySelectorAll('[data-source-field]').forEach(input => input.addEventListener('input', () => {
      const [indexText, field] = input.dataset.sourceField.split(':');
      const lesson = selected();
      const source = lesson?.sources?.[Number(indexText)];
      if (!source) return;
      const oldId = source.id;
      source[field] = input.value;
      if (field === 'id' && oldId !== input.value) {
        for (const topic of lesson.topics || []) {
          for (const ref of topic.sources || []) {
            if (ref.ref === oldId) ref.ref = input.value;
          }
        }
      }
      emit();
    }));

    container.querySelectorAll('[data-delete-source]').forEach(button => button.addEventListener('click', () => {
      const lesson = selected();
      const index = Number(button.dataset.deleteSource);
      const source = lesson?.sources?.[index];
      if (!source) return;
      const sourceId = source.id;
      lesson.sources.splice(index, 1);
      for (const topic of lesson.topics || []) {
        topic.sources = (topic.sources || []).filter(ref => ref.ref !== sourceId);
      }
      emit();
      render();
    }));

    container.querySelectorAll('[data-add-media]').forEach(button => button.addEventListener('click', () => {
      catalog.media ||= [];
      const type = button.dataset.addMedia === 'video' ? 'video' : 'image';
      const id = type + '-' + (catalog.media.length + 1);
      catalog.media.push({
        id,
        type,
        url: '',
        title: type === 'video' ? 'Nuovo video' : 'Nuova immagine',
        caption: '',
        alt: '',
        sourceUrl: '',
        credit: '',
        author: '',
        license: '',
        provider: '',
        thumbnailUrl: ''
      });
      emit();
      render();
    }));

    container.querySelectorAll('[data-media-field]').forEach(input => {
      const eventName = input.tagName === 'SELECT' ? 'change' : 'input';
      input.addEventListener(eventName, () => {
        const [indexText, field] = input.dataset.mediaField.split(':');
        const asset = catalog.media?.[Number(indexText)];
        if (!asset) return;
        asset[field] = input.value;
        if (field === 'url' && input.value) {
          const inferred = detectMediaType(input.value, asset.type);
          if (inferred) asset.type = inferred;
          if (asset.type === 'video') {
            asset.provider = asset.provider || detectVideoProvider(input.value);
            asset.thumbnailUrl = asset.thumbnailUrl || videoThumbnailUrl(input.value);
          }
          if (!asset.id || /^media-\d+$/.test(asset.id) || /^(image|video)-\d+$/.test(asset.id)) {
            asset.id = mediaAssetId(asset.type, input.value);
          }
        }
        emit();
      });
    });

    container.querySelectorAll('[data-delete-media]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.deleteMedia);
      const asset = catalog.media?.[index];
      if (!asset) return;
      const ref = asset.id;
      catalog.media.splice(index, 1);
      for (const library of catalog.libraries || []) {
        for (const lesson of library.lessons || []) {
          for (const topic of lesson.topics || []) {
            for (const section of topic.sections || []) {
              if (section.mediaRef === ref) section.mediaRef = '';
              if (section.type === 'gallery' && Array.isArray(section.items)) {
                section.items = section.items.filter(item => item !== ref && item?.mediaRef !== ref);
              }
            }
          }
        }
      }
      emit();
      render();
    }));

    container.querySelectorAll('[data-section-type]').forEach(select => select.addEventListener('change', () => {
      const topic = selected();
      const section = topic?.sections?.[Number(select.dataset.sectionType)];
      if (!section) return;
      const next = { type: select.value };
      if (select.value === 'checkpoint') Object.assign(next, { question: 'Domanda di verifica', answer: 'Risposta.' });
      else if (select.value === 'formula') Object.assign(next, { title: '', latex: '', note: '' });
      else if (select.value === 'image') Object.assign(next, { mediaRef: '', url: '', alt: '', caption: '', sourceUrl: '', credit: '', license: '' });
      else if (select.value === 'video') Object.assign(next, { mediaRef: '', url: '', title: '', caption: '', thumbnailUrl: '', sourceUrl: '', credit: '', license: '' });
      else if (select.value === 'gallery') Object.assign(next, { title: '', items: [], caption: '' });
      else if (select.value === 'embed') Object.assign(next, { title: '', url: '', body: '' });
      else Object.assign(next, { title: '', body: '' });
      Object.keys(section).forEach(key => delete section[key]);
      Object.assign(section, next);
      emit();
      render();
    }));

    container.querySelectorAll('[data-add-library]').forEach(button => button.addEventListener('click', () => {
      catalog.libraries ||= [];
      catalog.libraries.push(newLibrary(catalog.libraries.length + 1));
      selection = { type: 'library', li: catalog.libraries.length - 1, lj: null, ti: null };
      emit(); render();
    }));

    container.querySelector('[data-add-lesson]')?.addEventListener('click', () => {
      const lib = selected(); lib.lessons ||= []; lib.lessons.push(newLesson(lib.lessons.length + 1));
      selection = { type: 'lesson', li: selection.li, lj: lib.lessons.length - 1, ti: null };
      emit(); render();
    });

    container.querySelector('[data-add-topic]')?.addEventListener('click', () => {
      const lesson = selected(); lesson.topics ||= [];
      const topic = newTopic(lesson.topics.length + 1);
      lesson.topics.push(topic);
      lesson.modules ||= [];
      if (!lesson.modules.length) lesson.modules.push({ id: 'contenuti', title: 'Contenuti', topicIds: [] });
      lesson.modules[0].topicIds ||= [];
      lesson.modules[0].topicIds.push(topic.id);
      selection = { type: 'topic', li: selection.li, lj: selection.lj, ti: lesson.topics.length - 1 };
      emit(); render();
    });

    container.querySelector('[data-add-section]')?.addEventListener('click', () => {
      const topic = selected(); topic.sections ||= [];
      topic.sections.push({ type: 'concept', title: 'Nuova sezione', body: 'Scrivi qui il contenuto in **Markdown**.' });
      emit(); render();
    });

    container.querySelector('[data-delete-selected]')?.addEventListener('click', () => {
      if (selection.type === 'library') {
        catalog.libraries.splice(selection.li, 1);
        selection = { type: 'catalog', li: null, lj: null, ti: null };
      } else if (selection.type === 'lesson') {
        catalog.libraries[selection.li].lessons.splice(selection.lj, 1);
        selection = { type: 'library', li: selection.li, lj: null, ti: null };
      } else if (selection.type === 'topic') {
        const lesson = catalog.libraries[selection.li].lessons[selection.lj];
        const topic = lesson.topics[selection.ti];
        lesson.topics.splice(selection.ti, 1);
        (lesson.modules || []).forEach(module => module.topicIds = (module.topicIds || []).filter(id => id !== topic.id));
        (lesson.topics || []).forEach(other => {
          other.prerequisites = (other.prerequisites || []).filter(id => id !== topic.id);
          other.connections = (other.connections || []).filter(connection => connection.target !== topic.id);
        });
        selection = { type: 'lesson', li: selection.li, lj: selection.lj, ti: null };
      }
      emit(); render();
    });

    container.querySelectorAll('[data-delete-section]').forEach(button => button.addEventListener('click', () => {
      const topic = selected();
      topic.sections.splice(Number(button.dataset.deleteSection), 1);
      emit(); render();
    }));
  }

  function initEditors() {
    if (!window.EasyMDE) return;
    container.querySelectorAll('[data-markdown]').forEach(textarea => {
      const instance = new window.EasyMDE({
        element: textarea,
        initialValue: textarea.value,
        autofocus: false,
        spellChecker: false,
        status: false,
        minHeight: '105px',
        maxHeight: '260px',
        toolbar: ['bold','italic','heading-2','|','unordered-list','ordered-list','link']
      });
      instance.codemirror.on('change', () => {
        set(textarea.dataset.markdown, instance.value());
        emit();
      });
      editors.push(instance);
    });
  }

  function destroyEditors() {
    editors.forEach(editor => { try { editor.toTextArea(); } catch {} });
    editors = [];
  }

  function set(key, value) {
    const item = selected();
    if (!item) return;
    if (key.startsWith('section:')) {
      const parts = key.split(':');
      const section = item.sections?.[Number(parts[1])];
      if (section) {
        if (parts[2] === 'items') {
          section.items = value.split(/\n+/).map(v => v.trim()).filter(Boolean);
        } else {
          section[parts[2]] = value;
          if ((section.type === 'image' || section.type === 'video') && parts[2] === 'url' && value) {
            if (section.type === 'video') {
              section.provider ||= detectVideoProvider(value);
              section.thumbnailUrl ||= videoThumbnailUrl(value);
            }
          }
        }
      }
      return;
    }
    if (selection.type === 'topic' && key === 'id') {
      const oldId = item.id;
      item.id = value;
      const lesson = catalog.libraries[selection.li].lessons[selection.lj];
      (lesson.modules || []).forEach(module => {
        module.topicIds = (module.topicIds || []).map(id => id === oldId ? value : id);
      });
      (lesson.topics || []).forEach(topic => {
        topic.prerequisites = (topic.prerequisites || []).map(id => id === oldId ? value : id);
        topic.connections = (topic.connections || []).map(connection => connection.target === oldId ? { ...connection, target: value } : connection);
      });
    } else if (key === 'tags') item.tags = value.split(',').map(v => v.trim()).filter(Boolean);
    else if (key === 'learningGoals' || key === 'prerequisites') item[key] = value.split(/\n+/).map(v => v.trim()).filter(Boolean);
    else if (key === 'topicSources') {
      item.sources = value.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
        const [ref = '', pages = '', ...noteParts] = line.split('|').map(part => part.trim());
        return { ref, pages, note: noteParts.join(' | ') };
      }).filter(source => source.ref);
    }
    else if (key === 'estimatedMinutes') item[key] = Math.max(0, Number(value) || 0);
    else item[key] = value;
  }
}

function newLibrary(i) {
  return { id: 'library-' + i, slug: 'libreria-' + i, title: 'Libreria ' + i, description: 'Descrivi questa libreria in **Markdown**.', lessons: [] };
}
function newLesson(i) {
  return { schemaVersion: 1, id: 'lesson-' + i, slug: 'lezione-' + i, title: 'Lezione ' + String(i).padStart(2, '0'), description: 'Descrivi questa lezione in **Markdown**.', modules: [], topics: [], sources: [{ id: 'source-1', type: 'notes', label: 'Appunti personali' }] };
}
function newTopic(i) {
  return {
    id: 'argomento-' + i, title: 'Argomento ' + i, summary: 'Riassunto breve in **Markdown**.', why: 'Perché questo argomento è utile.',
    estimatedMinutes: 8, prerequisites: [], learningGoals: ['Capire il concetto principale'],
    sections: [{ type: 'concept', title: 'Idea chiave', body: 'Scrivi qui il contenuto in **Markdown**.' }, { type: 'checkpoint', question: 'Qual è l’idea principale?', answer: 'Scrivi qui la risposta.' }],
    connections: [], sources: [{ ref: 'source-1', pages: '', note: 'Fonte modificabile dal JSON avanzato.' }]
  };
}
function num(value) { return value === undefined ? null : Number(value); }
function esc(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function attr(value) { return esc(value); }
