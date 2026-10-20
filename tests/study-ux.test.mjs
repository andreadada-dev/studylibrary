import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorHistory, editorDraftKey, readEditorDraft, storeEditorDraft, clearEditorDraft
} from '../js/editor-drafts.js';
import { lessonCompletion, catalogCompletion } from '../js/progress.js';

test('undo/redo restores earlier states and discards redo branch after edit', () => {
  const initial = { title:'Original',nested:{description:'First'} };
  const history = createEditorHistory(initial);
  const change = { title:'Changed',nested:{description:'First'} };
  history.record(change,1000);
  history.record({title:'Changed!',nested:{description:'First'}},1050);
  assert.equal(history.canUndo,true);
  assert.equal(history.undo().title,'Original');
  assert.equal(history.redo().title,'Changed!');
  history.undo();
  history.record({title:'Another',nested:{description:'First'}},2000);
  assert.equal(history.canRedo,false);
  assert.equal(initial.title,'Original');
});

test('local drafts are scoped to user and catalog and can be cleared', () => {
  const memory = new Map();
  const storage = {
    getItem(key){ return memory.get(key) || null; },
    setItem(key,value){ memory.set(key,value); },
    removeItem(key){ memory.delete(key); }
  };
  const alice = editorDraftKey('alice','catalog/1');
  const bob = editorDraftKey('bob','catalog/1');
  assert.notEqual(alice,bob);
  assert.ok(storeEditorDraft(alice,{title:'Draft'},4,storage));
  assert.deepEqual(readEditorDraft(alice,storage).catalog,{title:'Draft'});
  assert.equal(readEditorDraft(alice,storage).baseVersion,4);
  assert.equal(readEditorDraft(bob,storage),null);
  clearEditorDraft(alice,storage);
  assert.equal(readEditorDraft(alice,storage),null);
});

test('completion counts only actual finished topics in the correct lesson', () => {
  const lesson={slug:'l1',topics:[{id:'a'},{id:'b'},{id:'c'}]};
  const library={slug:'lib',lessons:[lesson,{slug:'l2',topics:[{id:'d'}]}]};
  const catalog={_db:{id:'catalog'},libraries:[library]};
  const records=[
    {catalog_id:'catalog',library_key:'lib',lesson_key:'l1',topic_key:'a'},
    {catalog_id:'catalog',library_key:'lib',lesson_key:'l2',topic_key:'d'},
    {catalog_id:'other',library_key:'lib',lesson_key:'l1',topic_key:'c'},
    {catalog_id:'catalog',library_key:'lib',lesson_key:'l1',topic_key:'obsolete'}
  ];
  assert.deepEqual(lessonCompletion(records,'catalog',library,lesson),{completed:1,total:3,percent:33});
  assert.deepEqual(catalogCompletion(records,catalog),{completed:2,total:4,percent:50});
});

test('study UI references real progress and protects unsaved edits', async () => {
  const {readFile}=await import('node:fs/promises');
  const app=await readFile(new URL('../app.js', import.meta.url),'utf8');
  assert.match(app,/mountTopicProgress/);
  assert.match(app,/trackStudyVisit/);
  assert.match(app,/editorLeaveGuard/);
  assert.match(app,/createEditorHistory/);
  assert.match(app,/data-editor-undo/);
});
