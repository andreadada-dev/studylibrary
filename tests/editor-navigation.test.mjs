import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveEditorSelection } from '../js/catalog-editor.js';

const catalog = {
  libraries: [
    { slug:'intro-lib', id:'lib1', lessons: [
      { slug:'lesson-01', id:'lesson1', topics:[{ id:'pixels' }, { id:'colors' }] }
    ] },
    { slug:'advanced-lib', id:'lib2', lessons: [
      { slug:'lesson-02', id:'lesson2', topics:[{ id:'filtering' }] }
    ] }
  ]
};

test('contextual editor selects precisely the requested level', () => {
  assert.deepEqual(resolveEditorSelection(catalog), { type:'catalog', li:null, lj:null, ti:null });
  assert.deepEqual(resolveEditorSelection(catalog, {library:'advanced-lib'}),
    {type:'library',li:1,lj:null,ti:null});
  assert.deepEqual(resolveEditorSelection(catalog, {library:'intro-lib',lesson:'lesson-01'}),
    {type:'lesson',li:0,lj:0,ti:null});
  assert.deepEqual(resolveEditorSelection(catalog, {library:'intro-lib',lesson:'lesson-01',topic:'colors'}),
    {type:'topic',li:0,lj:0,ti:1});
});

test('invalid deep links fall back to the nearest existing parent', () => {
  assert.equal(resolveEditorSelection(catalog,{library:'nonexistent'}).type,'catalog');
  assert.deepEqual(resolveEditorSelection(catalog,{library:'intro-lib',lesson:'missing'}),
    {type:'library',li:0,lj:null,ti:null});
  assert.deepEqual(resolveEditorSelection(catalog,{library:'intro-lib',lesson:'lesson-01',topic:'missing'}),
    {type:'lesson',li:0,lj:0,ti:null});
});

test('navigation no longer exposes a global editor, new catalog has explicit route', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url),'utf8');
  const app = await readFile(new URL('../app.js', import.meta.url),'utf8');
  assert.doesNotMatch(index,/data-nav href="#\/studio"/);
  assert.match(index,/href="#\/mine"/);
  assert.match(app,/href="#\/studio\/new"/);
  assert.match(app,/parts\[1\] === 'new'/);
  assert.match(app,/editorActions/);
  assert.match(app,/studioHref\(catalog, library, lesson, topic\)/);
});
