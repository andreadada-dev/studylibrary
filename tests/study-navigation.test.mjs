import test from 'node:test';
import assert from 'node:assert/strict';
import { getLessonNeighbors } from '../js/study-navigation.js';

const topic = (id) => ({id,title:id});
const lesson = (slug,title,id) => ({
  slug,title,
  topics:id ? [topic(id)] : [],
  modules:id ? [{topicIds:[id]}] : []
});
const catalog = {
  slug:'computer-vision',
  libraries:[
    {slug:'fondamenti',title:'Fondamenti',lessons:[
      lesson('l1','Lezione 01','intro'),
      lesson('empty','Vuota',null),
      lesson('l2','Lezione 02','rgb')
    ]},
    {slug:'avanzato',title:'Avanzato',lessons:[
      lesson('l3','Lezione 03','filters')
    ]}
  ]
};

test('previous/next lesson paths point to the first topic and skip empty lessons',()=>{
  const n=getLessonNeighbors(catalog,catalog.libraries[0],catalog.libraries[0].lessons[0]);
  assert.equal(n.previous,null);
  assert.equal(n.next.title,'Lezione 02');
  assert.equal(n.next.href,'#/catalog/computer-vision/library/fondamenti/lesson/l2/topic/rgb');
});

test('moving between lessons also works across libraries',()=>{
  const n=getLessonNeighbors(catalog,catalog.libraries[0],catalog.libraries[0].lessons[2]);
  assert.equal(n.previous.title,'Lezione 01');
  assert.equal(n.next.title,'Lezione 03');
  assert.equal(n.next.href,'#/catalog/computer-vision/library/avanzato/lesson/l3/topic/filters');
  assert.equal(getLessonNeighbors(catalog,catalog.libraries[1],catalog.libraries[1].lessons[0]).next,null);
});

test('cloud catalog UUID and reserved text are escaped in links',()=>{
  const a={...catalog,_db:{id:'uuid 123'}};
  const n=getLessonNeighbors(a,a.libraries[0],a.libraries[0].lessons[0]);
  assert.ok(n.next.href.startsWith('#/catalog/uuid%20123/'));
});

test('unknown lessons do not create broken links',()=>{
  const n=getLessonNeighbors(catalog,catalog.libraries[0],{slug:'unknown'});
  assert.deepEqual(n,{previous:null,next:null});
});
