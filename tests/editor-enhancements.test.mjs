import test from 'node:test';
import assert from 'node:assert/strict';
import {STUDY_BLOCK_TYPES,studyBlockTemplate} from '../js/editor-blocks.js';
import {validateStudyUpload,studyUploadPath,uploadStudyFile} from '../js/uploads.js';
import {readFile} from 'node:fs/promises';

test('palette blocks have unique types and stable section IDs',()=>{
  assert.equal(new Set(STUDY_BLOCK_TYPES.map(x=>x.type)).size,STUDY_BLOCK_TYPES.length);
  for(const item of STUDY_BLOCK_TYPES) {
    const block=studyBlockTemplate(item.type,'stable-1');
    assert.equal(block.id,'stable-1');
    assert.equal(block.type,item.type);
  }
  assert.deepEqual(studyBlockTemplate('list','x').items,['Primo punto','Secondo punto']);
  assert.ok(studyBlockTemplate('comparison','x').left.body);
  assert.ok(studyBlockTemplate('flow','x').nodes.length>0);
  assert.throws(()=>studyBlockTemplate('unknown','x'),/non supportato/);
});

test('upload validates sizes and rejects unsafe file formats',()=>{
  assert.equal(validateStudyUpload({type:'image/png',size:4096}).kind,'image');
  assert.equal(validateStudyUpload({type:'application/pdf',size:1024}).kind,'pdf');
  assert.throws(()=>validateStudyUpload({type:'image/svg+xml',size:500}),/non supportato/);
  assert.throws(()=>validateStudyUpload({type:'application/pdf',size:11*1024*1024}),/troppo grande/);
  assert.throws(()=>validateStudyUpload({type:'image/jpeg',size:0}),/troppo grande/);
});

test('uploads stay inside the user-scoped folder',()=>{
  const user='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const object='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(studyUploadPath(user,'catalog-1',object,'pdf'),
    user+'/catalog-1/'+object+'.pdf');
  assert.throws(()=>studyUploadPath('../../secret','catalog',object,'png'),/non validi/);
  assert.throws(()=>studyUploadPath(user,'../secret',object,'png'),/non validi/);
});

test('storage upload uses UUID path and public URL only after success',async()=>{
  let stored=null;
  const supabase={storage:{from(bucket) {
    assert.equal(bucket,'study-media');
    return {
      async upload(path,file,options) {stored={path,file,options};return {error:null};},
      getPublicUrl(path) {return {data:{publicUrl:'https://example.org/'+path}};}
    };
  }}};
  const file={name:'lecture.pdf',type:'application/pdf',size:501};
  const result=await uploadStudyFile(supabase,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','catalog-1',file);
  assert.equal(result.kind,'pdf');
  assert.equal(result.name,'lecture.pdf');
  assert.match(result.url,/^https:\/\/example.org\//);
  assert.equal(stored.options.contentType,'application/pdf');
  assert.equal(stored.options.upsert,false);
});

test('editor has visual block selection and PDF rendering with a fallback link',async()=>{
  const editor=await readFile(new URL('../js/catalog-editor.js',import.meta.url),'utf8');
  const reader=await readFile(new URL('../js/ui.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(editor,/data-add-block/);
  assert.match(editor,/data-upload-file/);
  assert.match(editor,/data-tree-move/);
  assert.match(reader,/lesson-pdf-preview/);
  assert.match(html,/styles-study.css/);
});
