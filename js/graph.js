import { courseGraph } from './content.js';

export function renderUniverseGraph(container, courses, { compact = false } = {}) {
  if (!container || !window.d3) return;
  const d3 = window.d3;
  const width = container.clientWidth || 1000;
  const height = compact ? 360 : (container.clientHeight || 660);
  const graph = courseGraph(courses);

  const svg = d3.select(container)
    .attr('viewBox', [0, 0, width, height])
    .attr('preserveAspectRatio', 'xMidYMid meet');
  svg.selectAll('*').remove();

  const root = svg.append('g');
  const zoom = d3.zoom().scaleExtent([0.45, 3]).on('zoom', event => root.attr('transform', event.transform));
  svg.call(zoom);

  const courseCount = Math.max(1, courses.length);
  const color = d3.scaleOrdinal(d3.schemeTableau10).domain(courses.map(c => c.slug));

  const links = root.append('g')
    .selectAll('line')
    .data(graph.links)
    .join('line')
    .attr('class', 'graph-link')
    .attr('stroke-width', d => d.type === 'contains' ? .7 : 1.35)
    .attr('stroke-opacity', d => d.type === 'contains' ? .38 : .7);

  const node = root.append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .join('circle')
    .attr('class', 'graph-node')
    .attr('r', d => d.type === 'course' ? (compact ? 11 : 15) : (compact ? 4 : 5.2))
    .attr('fill', d => d.type === 'course' ? color(d.group) : '#d8dbea')
    .attr('stroke', d => d.type === 'course' ? 'rgba(255,255,255,.72)' : 'rgba(255,255,255,.28)')
    .attr('stroke-width', d => d.type === 'course' ? 1.4 : .6)
    .on('click', (_event, d) => {
      if (d.type === 'course') location.hash = `#/course/${encodeURIComponent(d.slug)}`;
      else location.hash = `#/course/${encodeURIComponent(d.slug)}/topic/${encodeURIComponent(d.topicId)}`;
    })
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

  const labels = root.append('g')
    .selectAll('text')
    .data(graph.nodes.filter(d => d.type === 'course' || (!compact && graph.nodes.length < 80)))
    .join('text')
    .attr('class', d => `graph-label ${d.type}`)
    .text(d => d.title.length > 34 ? `${d.title.slice(0, 33)}…` : d.title)
    .attr('dx', d => d.type === 'course' ? 20 : 9)
    .attr('dy', 4);

  const simulation = d3.forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.links).id(d => d.id).distance(d => d.type === 'contains' ? (compact ? 58 : 86) : (compact ? 74 : 110)).strength(d => d.type === 'contains' ? .72 : .36))
    .force('charge', d3.forceManyBody().strength(d => d.type === 'course' ? -250 : -48))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => d.type === 'course' ? 34 : 12))
    .alphaDecay(.035)
    .on('tick', () => {
      links.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      node.attr('cx', d => d.x).attr('cy', d => d.y);
      labels.attr('x', d => d.x).attr('y', d => d.y);
    });

  if (courseCount === 1 && !compact) {
    svg.call(zoom.transform, d3.zoomIdentity.translate(width * .08, height * .06).scale(.9));
  }

  return () => simulation.stop();
}
