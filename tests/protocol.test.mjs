import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
}

test('agent protocol is self-describing and version-aware', async () => {
  const agent = await readJson('protocol/agent.json');

  assert.equal(agent.protocol, 'studylibrary');
  assert.equal(agent.protocolVersion, '1.0');
  assert.equal(agent.endpoints.bootstrap, '/api/v1/agent');
  assert.equal(agent.endpoints.catalogAgent, '/api/v1/catalogs/{catalog}/agent');
  assert.equal(agent.endpoints.audit, '/api/v1/catalogs/{catalog}/audit');
  assert.equal(agent.updateStrategy.preferred, 'studylibrary.update');
  assert.ok(agent.canonicalWorkflow.some(step => step.includes('/context')));
  assert.ok(agent.canonicalWorkflow.some(step => step.includes('/audit')));
  assert.ok(agent.topicRequirements.mustContainCheckpoint);
  assert.ok(agent.sourcePolicy.doNotInventSourceClaims);
});

test('machine schemas referenced by the agent exist and parse', async () => {
  const files = ['catalog', 'lesson', 'topic', 'update-package'];

  for (const name of files) {
    const schema = await readJson('protocol/schemas/' + name + '.json');
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.ok(schema.$id);
    assert.equal(schema.type, 'object');
  }
});

test('update package schema matches supported importer operations', async () => {
  const schema = await readJson('protocol/schemas/update-package.json');
  const operations = schema.properties.operations.items.properties.op.enum;

  assert.deepEqual(operations, [
    'upsertLesson',
    'removeLesson',
    'upsertTopic',
    'removeTopic',
    'addConnection',
    'removeConnection'
  ]);
});
