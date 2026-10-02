import { catalogGraph } from './content.js';

const PALETTE = ['#8d82ff', '#37c9a7', '#ff9a62', '#e66cd8', '#62a8ff', '#d9c85f', '#ff6f85', '#67d4e5'];

export function renderUniverseGraph(container, catalogs, options = {}) {
  if (!container || !window.ForceGraph) return () => {};

  const data = catalogGraph(catalogs, options);
  const stage = container.closest('.universe-full');
  const searchInput = stage?.querySelector('[data-universe-search]');
  const searchResults = stage?.querySelector('[data-universe-results]');
  const inspector = stage?.querySelector('[data-universe-inspector]');
  const fitButton = stage?.querySelector('[data-universe-fit]');
  const labelsButton = stage?.querySelector('[data-universe-labels]');
  const statsEl = stage?.querySelector('[data-universe-stats]');

  const courseColors = new Map(catalogs.map((catalog, index) => [
    catalog.slug,
    catalog.accent || PALETTE[index % PALETTE.length]
  ]));
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const adjacency = new Map(data.nodes.map(node => [node.id, new Set()]));

  for (const link of data.links) {
    const source = typeof link.source === 'object' ? link.source.id : link.source;
    const target = typeof link.target === 'object' ? link.target.id : link.target;
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  let hovered = null;
  let selected = null;
  let query = '';
  let searchMatches = new Set();
  let labelsEnabled = true;
  let destroyed = false;

  if (statsEl) {
    statsEl.textContent =
      catalogs.length + ' cataloghi · ' +
      data.nodes.filter(n => n.type === 'library').length + ' librerie · ' +
      data.nodes.filter(n => n.type === 'lesson').length + ' lezioni · ' +
      data.nodes.filter(n => n.type === 'topic').length + ' argomenti';
  }

  const graph = new window.ForceGraph(container)
    .graphData(data)
    .backgroundColor('#0b0d12')
    .nodeId('id')
    .nodeVal(node => node.type === 'catalog' ? 14 : node.type === 'library' ? 9 : node.type === 'lesson' ? 6 : 2.5)
    .nodeLabel(node => tooltip(node))
    .nodeCanvasObject((node, ctx, scale) => drawNode(node, ctx, scale))
    .nodePointerAreaPaint((node, color, ctx, scale) => drawHitArea(node, color, ctx, scale))
    .linkColor(link => linkColor(link))
    .linkWidth(link => linkWidth(link))
    .linkDirectionalArrowLength(link => ['requires', 'enables', 'uses'].includes(link.type) ? 3.2 : 0)
    .linkDirectionalArrowRelPos(0.9)
    .linkDirectionalArrowColor(link => linkColor(link))
    .linkCurvature(link => link.type === 'contains' ? 0 : 0.08)
    .warmupTicks(90)
    .cooldownTicks(240)
    .d3AlphaDecay(0.035)
    .d3VelocityDecay(0.34)
    .minZoom(0.18)
    .maxZoom(7)
    .onNodeHover(node => {
      hovered = node || null;
      container.style.cursor = node ? 'pointer' : 'grab';
      refresh();
    })
    .onNodeClick(node => {
      selectNode(node);
      focusNode(node, 1.9);
    })
    .onBackgroundClick(() => {
      selected = null;
      if (inspector) inspector.hidden = true;
      refresh();
    })
    .onNodeDragEnd(node => {
      node.fx = node.x;
      node.fy = node.y;
    })
    .onEngineStop(() => {
      if (!destroyed && !selected && !query) graph.zoomToFit(650, 110);
    });

  const charge = graph.d3Force('charge');
  if (charge?.strength) charge.strength(node => node.type === 'catalog' ? -1050 : node.type === 'library' ? -650 : node.type === 'lesson' ? -380 : -180);

  const linkForce = graph.d3Force('link');
  if (linkForce?.distance) {
    linkForce
      .distance(link => link.type === 'contains' ? 145 : 205)
      .strength(link => link.type === 'contains' ? 0.62 : 0.22);
  }

  if (window.d3?.forceCollide) {
    graph.d3Force(
      'collision',
      window.d3.forceCollide(node => node.type === 'catalog' ? 40 : node.type === 'library' ? 30 : node.type === 'lesson' ? 22 : 13).strength(0.72)
    );
  }

  function resize() {
    if (destroyed) return;
    graph.width(container.clientWidth || window.innerWidth);
    graph.height(container.clientHeight || Math.max(500, window.innerHeight - 68));
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const firstFit = window.setTimeout(() => {
    if (!destroyed) graph.zoomToFit(800, 120);
  }, 650);

  function nodeColor(node) {
    return courseColors.get(node.group) || '#8d82ff';
  }

  function relatedTo(nodeId, otherId) {
    return adjacency.get(nodeId)?.has(otherId);
  }

  function isEmphasized(node) {
    if (selected) return node.id === selected.id || relatedTo(selected.id, node.id);
    if (hovered) return node.id === hovered.id || relatedTo(hovered.id, node.id);
    if (query) return searchMatches.has(node.id);
    return true;
  }

  function linkTouches(link, node) {
    const source = typeof link.source === 'object' ? link.source.id : link.source;
    const target = typeof link.target === 'object' ? link.target.id : link.target;
    return source === node.id || target === node.id;
  }

  function linkColor(link) {
    if (selected) {
      return linkTouches(link, selected)
        ? 'rgba(173,166,255,.82)'
        : 'rgba(255,255,255,.035)';
    }
    if (hovered) {
      return linkTouches(link, hovered)
        ? 'rgba(173,166,255,.72)'
        : 'rgba(255,255,255,.045)';
    }
    if (query) {
      const source = typeof link.source === 'object' ? link.source.id : link.source;
      const target = typeof link.target === 'object' ? link.target.id : link.target;
      return searchMatches.has(source) || searchMatches.has(target)
        ? 'rgba(173,166,255,.55)'
        : 'rgba(255,255,255,.035)';
    }
    if (link.type === 'contains') return 'rgba(255,255,255,.105)';
    if (link.type === 'requires') return 'rgba(141,130,255,.36)';
    return 'rgba(255,255,255,.18)';
  }

  function linkWidth(link) {
    if ((selected && linkTouches(link, selected)) || (hovered && linkTouches(link, hovered))) {
      return 1.7;
    }
    return link.type === 'contains' ? 0.55 : 0.9;
  }

  function drawNode(node, ctx, scale) {
    const emphasized = isEmphasized(node);
    const active = selected?.id === node.id || hovered?.id === node.id;
    const isCatalog = node.type === 'catalog';
    const isLibrary = node.type === 'library';
    const isLesson = node.type === 'lesson';
    const radius = isCatalog ? 12 : isLibrary ? 9 : isLesson ? 7 : 4.5;
    const color = nodeColor(node);

    ctx.save();
    ctx.globalAlpha = emphasized ? 1 : 0.11;

    if (active) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isCatalog ? 10 : isLibrary ? 8 : 7), 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, 0.14);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isCatalog ? color : isLibrary ? withAlpha(color, 0.95) : isLesson ? withAlpha(color, 0.88) : (active ? '#ffffff' : withAlpha(color, 0.78));
    ctx.fill();

    ctx.lineWidth = (active ? 2 : 1) / Math.max(scale, 0.65);
    ctx.strokeStyle = isCatalog ? 'rgba(255,255,255,.88)' : isLibrary ? 'rgba(255,255,255,.58)' : 'rgba(255,255,255,.34)';
    ctx.stroke();

    const showLabel = labelsEnabled && (
      isCatalog || isLibrary || isLesson ||
      active ||
      (selected && relatedTo(selected.id, node.id)) ||
      (hovered && relatedTo(hovered.id, node.id)) ||
      (query && searchMatches.has(node.id)) ||
      scale > 1.25
    );

    if (showLabel) {
      const fontSize = (isCatalog ? 14 : isLibrary ? 12.5 : isLesson ? 11.5 : 11) / Math.max(scale, 0.7);
      const label = truncate(node.title, isCatalog ? 42 : isLibrary ? 36 : 31);
      ctx.font = (isCatalog ? '760 ' : isLibrary ? '700 ' : isLesson ? '640 ' : '560 ') + fontSize + 'px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isCatalog ? 'rgba(255,255,255,.98)' : isLibrary ? 'rgba(255,255,255,.94)' : 'rgba(237,239,247,.88)';
      ctx.fillText(label, node.x + radius + (6 / Math.max(scale, 0.8)), node.y);
    }

    ctx.restore();
  }

  function drawHitArea(node, color, ctx, scale) {
    ctx.beginPath();
    ctx.arc(
      node.x,
      node.y,
      (node.type === 'catalog' ? 18 : node.type === 'library' ? 14 : node.type === 'lesson' ? 11 : 9) / Math.max(Math.min(scale, 2), 0.7),
      0,
      Math.PI * 2
    );
    ctx.fillStyle = color;
    ctx.fill();
  }

  function refresh() {
    graph
      .nodeCanvasObject((node, ctx, scale) => drawNode(node, ctx, scale))
      .linkColor(link => linkColor(link))
      .linkWidth(link => linkWidth(link))
      .linkDirectionalArrowColor(link => linkColor(link));
  }

  function focusNode(node, zoom) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    graph.centerAt(node.x, node.y, 650);
    graph.zoom(zoom || 2.1, 650);
  }

  function selectNode(node) {
    selected = node;
    if (!inspector) return;

    const neighborCount = adjacency.get(node.id)?.size || 0;
    inspector.hidden = false;
    inspector.innerHTML =
      '<button class="universe-inspector-close" type="button" data-inspector-close aria-label="Chiudi">×</button>' +
      '<span class="universe-inspector-type">' + typeLabel(node.type) + '</span>' +
      '<h2>' + escapeText(node.title) + '</h2>' +
      '<p>' + escapeText(node.description || '') + '</p>' +
      '<div class="universe-inspector-meta">' +
        neighborCount + ' collegamenti' +
        (node.estimatedMinutes ? ' · ' + node.estimatedMinutes + ' min' : '') +
      '</div>' +
      '<a class="universe-open-button" href="' + escapeAttr(node.href || '#/universe') + '">Apri ' +
        typeLabel(node.type).toLowerCase() + ' <span>↗</span></a>';

    inspector.querySelector('[data-inspector-close]')?.addEventListener('click', event => {
      event.stopPropagation();
      selected = null;
      inspector.hidden = true;
      refresh();
    });

    refresh();
  }

  function buildSearchResults() {
    if (!searchInput || !searchResults) return;
    query = searchInput.value.trim().toLowerCase();
    searchMatches = new Set();

    if (!query) {
      searchResults.hidden = true;
      searchResults.innerHTML = '';
      refresh();
      return;
    }

    const matches = data.nodes
      .filter(node => node.title.toLowerCase().includes(query))
      .sort((a, b) => nodeRank(b.type) - nodeRank(a.type))
      .slice(0, 8);

    for (const match of matches) {
      searchMatches.add(match.id);
      for (const neighbor of adjacency.get(match.id) || []) searchMatches.add(neighbor);
    }

    searchResults.hidden = false;
    searchResults.innerHTML = matches.length
      ? matches.map(node =>
          '<button type="button" data-node-id="' + escapeAttr(node.id) + '">' +
            '<span>' + (typeLabel(node.type)) + '</span>' +
            '<strong>' + escapeText(node.title) + '</strong>' +
          '</button>'
        ).join('')
      : '<div class="universe-search-empty">Nessun nodo trovato</div>';

    searchResults.querySelectorAll('[data-node-id]').forEach(button => {
      button.addEventListener('click', () => {
        const node = byId.get(button.dataset.nodeId);
        if (!node) return;
        selectNode(node);
        focusNode(node, 2.5);
        searchResults.hidden = true;
      });
    });

    refresh();
  }

  searchInput?.addEventListener('input', buildSearchResults);
  searchInput?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      searchInput.value = '';
      buildSearchResults();
      searchInput.blur();
    }
    if (event.key === 'Enter') {
      const first = data.nodes.find(node => node.title.toLowerCase().includes(query));
      if (first) {
        selectNode(first);
        focusNode(first, 2.5);
        searchResults.hidden = true;
      }
    }
  });

  fitButton?.addEventListener('click', () => {
    selected = null;
    if (inspector) inspector.hidden = true;
    graph.zoomToFit(700, 120);
    refresh();
  });

  labelsButton?.addEventListener('click', () => {
    labelsEnabled = !labelsEnabled;
    labelsButton.classList.toggle('active', labelsEnabled);
    labelsButton.setAttribute('aria-pressed', String(labelsEnabled));
    refresh();
  });

  labelsButton?.classList.add('active');

  return () => {
    destroyed = true;
    window.clearTimeout(firstFit);
    resizeObserver.disconnect();
    try { graph.pauseAnimation(); } catch {}
    container.innerHTML = '';
  };
}

function tooltip(node) {
  const type = typeLabel(node.type);
  return '<div style="padding:4px 2px"><b>' + escapeText(type) + '</b><br>' + escapeText(node.title) + '</div>';
}

function truncate(value, max) {
  const text = String(value || '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function withAlpha(hex, alpha) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return 'rgba(141,130,255,' + alpha + ')';
  const value = Number.parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeText(value);
}

function typeLabel(type) {
  if (type === 'catalog') return 'Catalogo';
  if (type === 'library') return 'Libreria';
  if (type === 'lesson') return 'Lezione';
  return 'Argomento';
}

function nodeRank(type) {
  if (type === 'catalog') return 4;
  if (type === 'library') return 3;
  if (type === 'lesson') return 2;
  return 1;
}
