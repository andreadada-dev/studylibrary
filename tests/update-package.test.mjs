import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUpdatePackage, GRANULAR_OPERATIONS, LEGACY_OPERATIONS } from '../js/update-package.js';

const base = () => ({
  schemaVersion:1, id:'cv', slug:'cv', title:'Computer Vision', description:'Study',
  media:[{id:'existing-image',type:'image',url:'https://example.org/existing.png',alt:'Old illustration'}],
  libraries:[{
    id:'first-lib',slug:'prima-libreria',title:'Prima libreria',
    lessons:[{
      id:'l1',slug:'intro',title:'Introduction',description:'Original description',
      sources:[{id:'slides-01',type:'slides',label:'Slides 1'}],
      modules:[{id:'module-one',title:'Module 1',topicIds:['spatial-resolution','color-depth']}],
      topics:[
        {
          id:'spatial-resolution',title:'Spatial resolution',summary:'Old summary',why:'Existing explanation',
          estimatedMinutes:10, learningGoals:['Understand pixels'],prerequisites:[],
          sources:[{ref:'slides-01',pages:'3'}],connections:[],
          sections:[{type:'concept',title:'Pixels',body:'Original pixels explanation'},
            {id:'checkpoint-one',type:'checkpoint',question:'What is a pixel?',answer:'A picture element'}]
        },
        {
          id:'color-depth',title:'Color depth',summary:'Colors',why:'Color matters',
          estimatedMinutes:8,learningGoals:['Depth'],prerequisites:[],sources:[{ref:'slides-01',pages:'8'}],
          connections:[], sections:[{id:'checkpoint-two',type:'checkpoint',question:'Bits?',answer:'Bits'}]
        }
      ]
    },{
      id:'l2',slug:'advanced',title:'Advanced',description:'Continue',
      sources:[{id:'slides-02',type:'slides',label:'Slides 2'}],
      modules:[{id:'other-module',title:'Other',topicIds:['filtering']}],
      topics:[{id:'filtering',title:'Filtering',summary:'Filter',why:'Useful',estimatedMinutes:10,
        learningGoals:['Filter'],prerequisites:[],sources:[{ref:'slides-02',pages:'1'}],connections:[],
        sections:[{id:'checkpoint-3',type:'checkpoint',question:'Why?',answer:'Because'}]}]
    }]
  }]
});
const pkg = operations => ({
  kind:'studylibrary.update',schemaVersion:2,catalog:'cv',baseVersion:7,operations
});
const getTopic = (catalog,id='spatial-resolution')=>catalog.libraries[0].lessons[0].topics.find(x=>x.id===id);

test('v2 patchTopic changes only requested property and never mutates input',()=>{
  const original=base();
  const next=applyUpdatePackage(original,pkg([{op:'patchTopic',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',changes:{summary:'Better explanation'}}]));
  assert.equal(getTopic(next).summary,'Better explanation');
  assert.equal(getTopic(next).why,'Existing explanation');
  assert.equal(getTopic(next).sections.length,2);
  assert.equal(original.libraries[0].lessons[0].topics[0].summary,'Old summary');
});

test('addSection, updateSection by legacy index, and removeSection by ID keep unrelated content',()=>{
  const next=applyUpdatePackage(base(),pkg([
    {op:'addSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',
      value:{id:'figure-01',type:'image',url:'https://example.org/new.png',alt:'Example'},beforeSectionId:'checkpoint-one'},
    {op:'updateSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',
      sectionIndex:0,changes:{body:'Updated original concept'}},
    {op:'removeSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',sectionId:'figure-01'}
  ]));
  assert.deepEqual(getTopic(next).sections,[{type:'concept',title:'Pixels',body:'Updated original concept'},
    {id:'checkpoint-one',type:'checkpoint',question:'What is a pixel?',answer:'A picture element'}]);
});

test('addTopic chooses a named module and does not replace an existing topic',()=>{
  const value={id:'new-topic',title:'New',summary:'Summary',why:'Why',estimatedMinutes:5,
    learningGoals:['Learn'],prerequisites:[],sources:[{ref:'slides-01'}],connections:[],
    sections:[{id:'new-checkpoint',type:'checkpoint',question:'Question',answer:'Answer'}]};
  const ops=[{op:'addTopic',library:'prima-libreria',lesson:'intro',module:'new-module',moduleTitle:'A new module',value}];
  const changed=applyUpdatePackage(base(),pkg(ops));
  assert.ok(changed.libraries[0].lessons[0].modules.some(m=>m.id==='new-module'&&m.topicIds.includes('new-topic')));
  assert.equal(changed.libraries[0].lessons[0].topics.length,3);
  assert.throws(()=>applyUpdatePackage(changed,pkg(ops)),/esiste già/);
});

test('addMedia, updateMedia, and removeMedia protect referenced assets',()=>{
  const next=applyUpdatePackage(base(),pkg([
    {op:'addMedia',value:{id:'new-image',type:'image',url:'https://example.org/new.png',alt:'New'}},
    {op:'updateMedia',media:'new-image',changes:{caption:'Image caption'}}
  ]));
  assert.equal(next.media[1].caption,'Image caption');
  assert.throws(()=>applyUpdatePackage(next,pkg([
    {op:'addSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',
      value:{id:'new-figure',type:'image',mediaRef:'new-image',alt:'Description'}},
    {op:'removeMedia',media:'new-image'}
  ])),/ancora usato/);
  assert.equal(applyUpdatePackage(next,pkg([{op:'removeMedia',media:'new-image'}])).media.length,1);
});

test('addSource attaches to lesson and optionally topic without duplicating references',()=>{
  const next=applyUpdatePackage(base(),pkg([
    {op:'addSource',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',
      value:{id:'slides-02',type:'slides',label:'Lecture two'},pages:'4–6',note:'Supporting slides'}
  ]));
  assert.equal(next.libraries[0].lessons[0].sources.length,2);
  assert.equal(getTopic(next).sources[1].ref,'slides-02');
});

test('updateLesson preserves its module and topic arrays, moveTopic preserves topic data',()=>{
  const next=applyUpdatePackage(base(),pkg([
    {op:'updateLesson',library:'prima-libreria',lesson:'intro',changes:{title:'Updated Introduction'}},
    {op:'moveTopic',library:'prima-libreria',lesson:'intro',topic:'color-depth',
      toLibrary:'prima-libreria',toLesson:'advanced',module:'other-module'}
  ]));
  const [intro,advanced]=next.libraries[0].lessons;
  assert.equal(intro.title,'Updated Introduction');
  assert.equal(intro.topics.length,1);
  assert.deepEqual(intro.modules[0].topicIds,['spatial-resolution']);
  assert.equal(advanced.topics.find(x=>x.id==='color-depth').summary,'Colors');
  assert.ok(advanced.modules[0].topicIds.includes('color-depth'));
});

test('v1 backward compatibility and rejection of granular operations with old schema',()=>{
  const old={...pkg([{op:'addConnection',library:'prima-libreria',lesson:'intro',from:'spatial-resolution',
    connection:{target:'color-depth',type:'related'}}]),schemaVersion:1};
  assert.equal(getTopic(applyUpdatePackage(base(),old)).connections.length,1);
  assert.throws(()=>applyUpdatePackage(base(),{...pkg([{op:'patchTopic',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',changes:{summary:'x'}}]),schemaVersion:1}),/schemaVersion 2/);
  assert.equal(LEGACY_OPERATIONS.length,6);
  assert.ok(GRANULAR_OPERATIONS.length>=11);
});

test('invalid or ambiguous destructive operations cannot succeed silently',()=>{
  assert.throws(()=>applyUpdatePackage(base(),pkg([{op:'removeSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution'}])),/esattamente uno/);
  assert.throws(()=>applyUpdatePackage(base(),pkg([{op:'patchTopic',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',changes:{id:'corrupted'}}])),/non modificabile/);
  assert.throws(()=>applyUpdatePackage(base(),pkg([{op:'updateLesson',library:'prima-libreria',lesson:'intro',changes:{topics:[]}}])),/non modificabile/);
  assert.throws(()=>applyUpdatePackage(base(),pkg([{op:'addSection',library:'prima-libreria',lesson:'intro',topic:'spatial-resolution',value:{id:'checkpoint-one',type:'concept'}}])),/già presente/);
  assert.throws(()=>applyUpdatePackage(base(),{...pkg([]),baseVersion:null}),/baseVersion/);
});
