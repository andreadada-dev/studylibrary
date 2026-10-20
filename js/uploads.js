// Browser-side upload validation is intentionally pure and unit-testable.
export const STUDY_UPLOAD_BUCKET = 'study-media';
export const STUDY_UPLOAD_TYPES = Object.freeze({
  'image/jpeg':{extension:'jpg',kind:'image',max:6*1024*1024},
  'image/png':{extension:'png',kind:'image',max:6*1024*1024},
  'image/webp':{extension:'webp',kind:'image',max:6*1024*1024},
  'image/gif':{extension:'gif',kind:'image',max:6*1024*1024},
  'image/avif':{extension:'avif',kind:'image',max:6*1024*1024},
  'application/pdf':{extension:'pdf',kind:'pdf',max:10*1024*1024}
});

export function validateStudyUpload(file) {
  if (!file || typeof file !== 'object') throw new Error('Seleziona un file valido.');
  const type = STUDY_UPLOAD_TYPES[file.type];
  if (!type) throw new Error('Formato non supportato. Usa JPG, PNG, WebP, GIF, AVIF o PDF.');
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > type.max) {
    throw new Error('File troppo grande o vuoto: massimo ' + (type.max / 1024 / 1024) + ' MB.');
  }
  return type;
}

export function studyUploadPath(userId, catalogId, uuid, extension) {
  if (!/^[0-9a-f-]{16,64}$/i.test(String(userId)) ||
      !/^[0-9a-z-]{1,100}$/i.test(String(catalogId)) ||
      !/^[0-9a-f-]{16,64}$/i.test(String(uuid)) ||
      !/^(jpg|png|webp|gif|avif|pdf)$/.test(extension)) {
    throw new Error('Identificativi di upload non validi.');
  }
  return userId + '/' + catalogId + '/' + uuid + '.' + extension;
}

export async function uploadStudyFile(supabase, userId, catalogId, file) {
  const kind = validateStudyUpload(file);
  if (!supabase || !userId || !catalogId) throw new Error('Accedi prima di caricare il file.');
  const path = studyUploadPath(userId, catalogId, crypto.randomUUID(), kind.extension);
  const { error } = await supabase.storage.from(STUDY_UPLOAD_BUCKET).upload(path, file, {
    contentType:file.type,cacheControl:'3600',upsert:false
  });
  if (error) throw new Error('Caricamento non riuscito: ' + error.message +
    '. Controlla che la migrazione Storage sia stata applicata.');
  const { data } = supabase.storage.from(STUDY_UPLOAD_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl?.startsWith('https://')) throw new Error('Impossibile ottenere il link del file.');
  return {url:data.publicUrl,path,kind:kind.kind,name:file.name,bytes:file.size};
}
