import test from 'node:test';
import assert from 'node:assert/strict';
import { lessonChapters } from '../js/book-lesson.js';

const topics=['a','b','c','d','e'].map(id=>({id,title:'Argomento '+id}));
const lesson={
  title:'Lezione 01 — Introduzione',
  topics,
  modules:[
    {id:'fondamenti',title:'Fondamenti e contesto',description:'Nozioni iniziali',topicIds:['a','b','b']},
    {id:'visione',title:'Visione umana e percezione',topicIds:['c','d']},
    {id:'empty',title:'Senza argomenti',topicIds:[]}
  ]
};

test('every module becomes one chapter divider with its original heading',()=>{
  const chapters=lessonChapters(lesson);
  assert.deepEqual(chapters.map(c=>c.title),[
    'Fondamenti e contesto','Visione umana e percezione','Altri argomenti'
  ]);
  assert.equal(chapters[0].description,'Nozioni iniziali');
  assert.deepEqual(chapters[0].topics.map(t=>t.id),['a','b']);
  assert.deepEqual(chapters[1].topics.map(t=>t.id),['c','d']);
  assert.deepEqual(chapters[2].topics.map(t=>t.id),['e']);
});

test('chapters include every lesson topic exactly once, regardless of repeated module references',()=>{
  const chapters=lessonChapters(lesson);
  const all=chapters.flatMap(ch=>ch.topics.map(t=>t.id));
  assert.equal(all.length,topics.length);
  assert.deepEqual(new Set(all),new Set(topics.map(t=>t.id)));
});

test('lessons without modules still produce one readable chapter',()=>{
  const chapters=lessonChapters({topics:[{id:'x',title:'X'}]});
  assert.equal(chapters.length,1);
  assert.equal(chapters[0].title,'Argomenti della lezione');
  assert.equal(chapters[0].topics[0].id,'x');
});

test('empty modules and unresolved topic references do not insert empty separators',()=>{
  const chapters=lessonChapters({topics:[{id:'a',title:'A'}],
    modules:[{id:'broken',title:'Empty',topicIds:['unknown']},
      {id:'valid',title:'Chapter',topicIds:['a']}]});
  assert.deepEqual(chapters.map(ch=>ch.title),['Chapter']);
});
