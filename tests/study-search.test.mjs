import test from 'node:test';
import assert from 'node:assert/strict';
import { searchStudyCatalogs } from '../js/study-search.js';

const catalog = {
  id:'cv',slug:'computer-vision',title:'Computer Vision',description:'Visione artificiale',
  libraries:[{
    slug:'lezioni',title:'Lezioni',
    lessons:[{slug:'lezione-01',title:'Lezione 01',description:'Acquisizione digitale',
      topics:[
        {id:'pixels',title:'Pixel e risoluzione',summary:'Quanti pixel ha una fotografia?',why:'Per misurare i dettagli'},
        {id:'gaussian',title:'Filtraggio gaussiano',summary:'Convoluzione con kernel gaussiano',why:'Riduzione del rumore'}
      ]
    }]
  }]
};

test('global search navigates to the precise matching topic',()=>{
  const matches=searchStudyCatalogs([catalog],'gaussiano');
  assert.equal(matches.length,1);
  assert.equal(matches[0].type,'Argomento');
  assert.equal(matches[0].href,'#/catalog/computer-vision/library/lezioni/lesson/lezione-01/topic/gaussian');
});

test('global search includes topic summaries and library names',()=>{
  const summaries=searchStudyCatalogs([catalog],'fotografia');
  assert.equal(summaries[0].title,'Pixel e risoluzione');
  const libs=searchStudyCatalogs([catalog],'Lezioni');
  assert.ok(libs.some(item=>item.type==='Libreria'));
});

test('empty and short queries do not flood results',()=>{
  assert.deepEqual(searchStudyCatalogs([catalog],''),[]);
  assert.deepEqual(searchStudyCatalogs([catalog],'a'),[]);
});

test('results can be limited without duplicates',()=>{
  const matches=searchStudyCatalogs([catalog,catalog],'vision',{limit:2});
  assert.ok(matches.length<=2);
  assert.equal(new Set(matches.map(item=>item.href)).size,matches.length);
});
