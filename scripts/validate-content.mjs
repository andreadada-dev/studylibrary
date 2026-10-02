import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../js/content.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  const fullPath = resolve(root, relativePath.replace(/^\//, ''));
  const raw = await readFile(fullPath, 'utf8');
  return JSON.parse(raw);
}

const registry = await readJson('data/catalog.json');
const failures = [];
let catalogCount = 0;
let lessonCount = 0;
let topicCount = 0;

for (const entry of registry.catalogs || []) {
  catalogCount += 1;
  const manifest = await readJson(entry.src);

  const libraries = [];
  for (const library of manifest.libraries || []) {
    const lessons = [];
    for (const lessonRef of library.lessons || []) {
      lessonCount += 1;
      let lesson = { ...lessonRef };
      if (lessonRef.src) {
        const source = await readJson(lessonRef.src);
        lesson = { ...source, ...lessonRef, src: undefined };
        delete lesson.src;
      }
      topicCount += lesson.topics?.length || 0;
      lessons.push(lesson);

      const sourceIds = new Set([
        ...(manifest.sources || []).map(source => source.id),
        ...(lesson.sources || []).map(source => source.id)
      ].filter(Boolean));

      for (const topic of lesson.topics || []) {
        for (const sourceRef of topic.sources || []) {
          if (sourceRef.ref && !sourceIds.has(sourceRef.ref)) {
            failures.push(`${manifest.slug}/${library.slug}/${lesson.slug}/${topic.id}: fonte sconosciuta ${sourceRef.ref}`);
          }
        }
      }
    }
    libraries.push({ ...library, lessons });
  }

  const catalog = { ...manifest, libraries };
  const validation = validateCatalog(catalog);
  if (!validation.ok) {
    failures.push(...validation.errors.map(error => `${manifest.slug}: ${error}`));
  }
}

if (failures.length) {
  console.error('Content validation failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}

console.log(`Validated ${catalogCount} catalog(s), ${lessonCount} lesson(s), ${topicCount} topic(s).`);
