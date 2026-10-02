import { courseGraph } from './content.js';

const PALETTE = ['#8d82ff', '#37c9a7', '#ff9a62', '#e66cd8', '#62a8ff', '#d9c85f', '#ff6f85', '#67d4e5'];

export function renderUniverseGraph(container, courses) {
  if (!container || !window.ForceGraph) return () => {};

  const data = courseGraph(courses);
  const stage = container.closest('.universe-full');
  const searchInput = stage?.querySelector('[data-universe-search]');
  const searchResults = stage?.querySelector('[data-universe-results]');
  const inspector = stage?.querySelector('[data-universe-inspector]');
  const fitButton = stage?.querySelector('[data-universe-fit]');
  const labelsButton = stage?.querySelector('[data-universe-labels]');
  const statsEl = stage?.querySelector('[data-universe-stats]');

  const courseColors = new Map(courses.map((course, index) => [
    course.slug,
    course.accent || PALETTE[index % PALETTE.length]
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
      courses.length + ' corsi · ' +
      data.nodes.filter(n => n.type === 'topic').length + ' argomenti · ' +
      data.links.length + ' collegamenti';
  }

  const graph = window.ForceGraph(container)
    .graphData(data)
    .backgroundColor('#0b0d12')
    .nodeId('id')
    .nodeVal(node => node.type === 'course' ? 11 : 2.5)
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
  if (charge?.strength) charge.strength(node => node.type === 'course' ? -900 : -190);

  const linkForce = graph.d3Force('link');
  if (linkForce?.distance) {
    linkForce
      .distance(link => link.type === 'contains' ? 145 : 205)
      .strength(link => link.type === 'contains' ? 0.62 : 0.22);
  }

  if (window.d3?.forceCollide) {
    graph.d3Force(
      'collision',
      window.d3.forceCollide(node => node.type === 'course' ? 34 : 13).strength(0.72)
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
    const isCourse = node.type === 'course';
    const radius = isCourse ? 10 : 4.5;
    const color = nodeColor(node);

    ctx.save();
    ctx.globalAlpha = emphasized ? 1 : 0.11;

    if (active) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isCourse ? 9 : 7), 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, 0.14);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isCourse ? color : (active ? '#ffffff' : withAlpha(color, 0.86));
    ctx.fill();

    ctx.lineWidth = (active ? 2 : 1) / Math.max(scale, 0.65);
    ctx.strokeStyle = isCourse ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.34)';
    ctx.stroke();

    const showLabel = labelsEnabled && (
      isCourse ||
      active ||
      (selected && relatedTo(selected.id, node.id)) ||
      (hovered && relatedTo(hovered.id, node.id)) ||
      (query && searchMatches.has(node.id)) ||
      scale > 1.25
    );

    if (showLabel) {
      const fontSize = (isCourse ? 13 : 11) / Math.max(scale, 0.7);
      const label = truncate(node.title, isCourse ? 38 : 31);
      ctx.font = (isCourse ? '700 ' : '560 ') + fontSize + 'px Inter, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isCourse ? 'rgba(255,255,255,.96)' : 'rgba(237,239,247,.88)';
      ctx.fillText(label, node.x + radius + (6 / Math.max(scale, 0.8)), node.y);
    }

    ctx.restore();
  }

  function drawHitArea(node, color, ctx, scale) {
    ctx.beginPath();
    ctx.arc(
      node.x,
      node.y,
      (node.type === 'course' ? 15 : 9) / Math.max(Math.min(scale, 2), 0.7),
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

    const course = courses.find(item => item.slug === node.slug);
    const topic = node.type === 'topic'
      ? course?.topics?.find(item => item.id === node.topicId)
      : null;
    const neighborCount = adjacency.get(node.id)?.size || 0;
    const href = node.type === 'course'
      ? '#/course/' + encodeURIComponent(node.slug)
      : '#/course/' + encodeURIComponent(node.slug) + '/topic/' + encodeURIComponent(node.topicId);

    inspector.hidden = false;
    inspector.innerHTML =
      '<button class="universe-inspector-close" type="button" data-inspector-close aria-label="Chiudi">×</button>' +
      '<span class="universe-inspector-type">' + (node.type === 'course' ? 'Corso' : 'Argomento') + '</span>' +
      '<h2>' + escapeText(node.title) + '</h2>' +
      '<p>' + escapeText(topic?.summary || course?.description || '') + '</p>' +
      '<div class="universe-inspector-meta">' +
        neighborCount + ' collegamenti' +
        (topic?.estimatedMinutes ? ' · ' + topic.estimatedMinutes + ' min' : '') +
      '</div>' +
      '<a class="universe-open-button" href="' + href + '">Apri ' +
        (node.type === 'course' ? 'corso' : 'argomento') +
        ' <span>↗</span></a>';

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
      .sort((a, b) => Number(b.type === 'course') - Number(a.type === 'course'))
      .slice(0, 8);

    for (const match of matches) {
      searchMatches.add(match.id);
      for (const neighbor of adjacency.get(match.id) || []) searchMatches.add(neighbor);
    }

    searchResults.hidden = false;
    searchResults.innerHTML = matches.length
      ? matches.map(node =>
          '<button type="button" data-node-id="' + escapeAttr(node.id) + '">' +
            '<span>' + (node.type === 'course' ? 'Corso' : 'Argomento') + '</span>' +
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
  const type = node.type === 'course' ? 'Corso' : 'Argomento';
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
