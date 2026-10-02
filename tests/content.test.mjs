import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, catalogStats, catalogGraph } from '../js/content.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

async function actualCatalog() {
  const manifest = await json('data/catalogs/computer-vision.json');
  const libraries = [];
  for (const library of manifest.libraries) {
    const lessons = [];
    for (const ref of library.lessons) {
      const source = await json(ref.src.replace(/^\//, ''));
      lessons.push({ ...source, ...ref, src: undefined });
      delete lessons.at(-1).src;
    }
    libraries.push({ ...library, lessons });
  }
  return { ...manifest, libraries };
}

test('bundled Computer Vision catalog validates', async () => {
  const catalog = await actualCatalog();
  const result = validateCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(catalogStats(catalog), {
    libraries: 1,
    lessons: 1,
    topics: 12,
    minutes: 165
  });
});

test('lesson universe contains lesson and topic nodes', async () => {
  const catalog = await actualCatalog();
  const graph = catalogGraph([catalog], {
    catalogSlug: catalog.slug,
    librarySlug: catalog.libraries[0].slug,
    lessonSlug: catalog.libraries[0].lessons[0].slug
  });

  assert.equal(graph.nodes.filter(node => node.type === 'lesson').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'topic').length, 12);
  assert.ok(graph.links.length >= 12);
});

test('validator rejects a topic without checkpoint', async () => {
  const catalog = await actualCatalog();
  const copy = structuredClone(catalog);
  copy.libraries[0].lessons[0].topics[0].sections =
    copy.libraries[0].lessons[0].topics[0].sections.filter(section => section.type !== 'checkpoint');

  const result = validateCatalog(copy);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('checkpoint')));
});
