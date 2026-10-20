import test from 'node:test';
import assert from 'node:assert/strict';
import { getLessonNeighbors, getReadingNeighbors } from '../js/study-navigation.js';

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

test('reading sequence continues to the next topic then the next lesson',()=>{
  const lib=catalog.libraries[0], current=lib.lessons[0];
  current.topics=[topic('intro'),topic('extra')];
  current.modules=[{topicIds:['intro','extra']}];
  const first=getReadingNeighbors(catalog,lib,current,current.topics[0]);
  assert.equal(first.next.kind,'argomento');
  assert.match(first.next.href,/\/lesson\/l1\/topic\/extra$/);
  const last=getReadingNeighbors(catalog,lib,current,current.topics[1]);
  assert.equal(last.next.kind,'lezione');
  assert.equal(last.next.href,'#/catalog/computer-vision/library/fondamenti/lesson/l2/topic/rgb');
  assert.equal(first.previous,null);
});

test('final topic can move backward across a library boundary',()=>{
  const lib=catalog.libraries[1],last=lib.lessons[0];
  const result=getReadingNeighbors(catalog,lib,last,last.topics[0]);
  assert.equal(result.next,null);
  assert.equal(result.previous.kind,'lezione');
  assert.match(result.previous.href,/\/lesson\/l2\/topic\/rgb$/);
});
