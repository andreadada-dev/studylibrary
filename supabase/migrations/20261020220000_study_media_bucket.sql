-- Files have publicly accessible URLs. Users must be warned before upload.
-- Owner-scoped write policies prevent other people modifying user files.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'study-media','study-media',true,10485760,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','application/pdf']
)
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "study media owner insert" on storage.objects;
create policy "study media owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id='study-media' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "study media owner update" on storage.objects;
create policy "study media owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id='study-media' and
    (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id='study-media' and
    (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "study media owner delete" on storage.objects;
create policy "study media owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id='study-media' and
    (storage.foldername(name))[1] = auth.uid()::text
  );
