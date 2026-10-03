import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, catalogStats, catalogGraph } from '../js/content.js';

function fixtureCatalog() {
  return {
    schemaVersion: 2,
    id: 'fixture-catalog',
    slug: 'fixture-catalog',
    title: 'Fixture Catalog',
    description: 'Catalog used only by automated tests.',
    language: 'it',
    visibility: 'private',
    tags: ['test'],
    libraries: [
      {
        id: 'fixture-library',
        slug: 'fixture-library',
        title: 'Fixture Library',
        description: 'Test library.',
        lessons: [
          {
            schemaVersion: 1,
            id: 'fixture-lesson',
            slug: 'fixture-lesson',
            title: 'Fixture Lesson',
            description: 'Test lesson.',
            modules: [
              { id: 'core', title: 'Core', topicIds: ['topic-a', 'topic-b'] }
            ],
            topics: [
              {
                id: 'topic-a',
                title: 'Topic A',
                summary: 'Summary A',
                why: 'Why A',
                estimatedMinutes: 8,
                prerequisites: [],
                learningGoals: ['Understand A'],
                sections: [
                  { type: 'concept', title: 'Concept A', body: 'Body A' },
                  { type: 'checkpoint', question: 'Question A?', answer: 'Answer A' }
                ],
                connections: [{ target: 'topic-b', type: 'enables' }],
                sources: [{ ref: 'source-1', pages: '1', note: 'Test' }]
              },
              {
                id: 'topic-b',
                title: 'Topic B',
                summary: 'Summary B',
                why: 'Why B',
                estimatedMinutes: 12,
                prerequisites: ['topic-a'],
                learningGoals: ['Understand B'],
                sections: [
                  { type: 'concept', title: 'Concept B', body: 'Body B' },
                  { type: 'checkpoint', question: 'Question B?', answer: 'Answer B' }
                ],
                connections: [],
                sources: [{ ref: 'source-1', pages: '2', note: 'Test' }]
              }
            ],
            sources: [{ id: 'source-1', type: 'slides', label: 'Fixture source' }]
          }
        ]
      }
    ]
  };
}

test('fixture catalog validates', () => {
  const catalog = fixtureCatalog();
  const result = validateCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(catalogStats(catalog), {
    libraries: 1,
    lessons: 1,
    topics: 2,
    minutes: 20
  });
});

test('lesson universe contains lesson and topic nodes', () => {
  const catalog = fixtureCatalog();
  const graph = catalogGraph([catalog], {
    catalogSlug: catalog.slug,
    librarySlug: catalog.libraries[0].slug,
    lessonSlug: catalog.libraries[0].lessons[0].slug
  });

  assert.equal(graph.nodes.filter(node => node.type === 'lesson').length, 1);
  assert.equal(graph.nodes.filter(node => node.type === 'topic').length, 2);
  assert.ok(graph.links.length >= 2);
});

test('validator rejects a topic without checkpoint', () => {
  const catalog = fixtureCatalog();
  catalog.libraries[0].lessons[0].topics[0].sections =
    catalog.libraries[0].lessons[0].topics[0].sections.filter(section => section.type !== 'checkpoint');

  const result = validateCatalog(catalog);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('checkpoint')));
});
