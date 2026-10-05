-- StudyLibrary Knowledge API + catalog versioning
-- Adds independent API visibility, immutable catalog snapshots, restore support,
-- public read RPCs and authenticated optimistic-concurrency writes.

alter table public.catalogs
  add column if not exists api_public boolean not null default false,
  add column if not exists current_version integer not null default 0,
  add column if not exists version_message text not null default '';

create index if not exists catalogs_api_public_updated_idx
  on public.catalogs(api_public, updated_at desc);

create table if not exists public.catalog_versions (
  id bigint generated always as identity primary key,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  version integer not null check (version >= 1),
  message text not null default '',
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  is_public boolean not null default false,
  api_public boolean not null default false,
  catalog_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(catalog_id, version)
);

create index if not exists catalog_versions_catalog_idx
  on public.catalog_versions(catalog_id, version desc);
create index if not exists catalog_versions_owner_idx
  on public.catalog_versions(owner_id, created_at desc);

alter table public.catalog_versions enable row level security;

drop policy if exists "owners read catalog versions" on public.catalog_versions;
create policy "owners read catalog versions"
on public.catalog_versions for select
using (auth.uid() = owner_id);

-- Version rows are created only by trigger / RPC, never directly by clients.
drop policy if exists "owners insert catalog versions" on public.catalog_versions;
drop policy if exists "owners update catalog versions" on public.catalog_versions;
drop policy if exists "owners delete catalog versions" on public.catalog_versions;

-- Seed a v1 snapshot for catalogs that existed before this migration.
update public.catalogs
set
  api_public = case
    when jsonb_typeof(catalog_json #> '{api,publicRead}') = 'boolean'
      then (catalog_json #>> '{api,publicRead}')::boolean
    else false
  end,
  current_version = case when current_version < 1 then 1 else current_version end,
  version_message = case when version_message = '' then 'Snapshot iniziale' else version_message end
where current_version < 1;

insert into public.catalog_versions (
  catalog_id, owner_id, version, message, title, description, tags,
  is_public, api_public, catalog_json, created_at
)
select
  c.id, c.owner_id, 1, coalesce(nullif(c.version_message, ''), 'Snapshot iniziale'),
  c.title, c.description, c.tags, c.is_public, c.api_public, c.catalog_json, c.updated_at
from public.catalogs c
where not exists (
  select 1 from public.catalog_versions v
  where v.catalog_id = c.id and v.version = 1
);

create or replace function public.prepare_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.current_version := greatest(coalesce(new.current_version, 0), 0) + 1;
    if coalesce(new.version_message, '') = '' then
      new.version_message := 'Creazione catalogo';
    end if;
    return new;
  end if;

  if
    new.catalog_json is distinct from old.catalog_json
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.tags is distinct from old.tags
    or new.is_public is distinct from old.is_public
    or new.api_public is distinct from old.api_public
  then
    new.current_version := greatest(old.current_version, 0) + 1;
    if coalesce(new.version_message, '') = '' or new.version_message = old.version_message then
      new.version_message := 'Aggiornamento catalogo';
    end if;
  else
    new.current_version := old.current_version;
  end if;

  return new;
end;
$$;

create or replace function public.snapshot_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.current_version is distinct from old.current_version then
    insert into public.catalog_versions (
      catalog_id, owner_id, version, message, title, description, tags,
      is_public, api_public, catalog_json
    )
    values (
      new.id, new.owner_id, new.current_version,
      coalesce(nullif(new.version_message, ''), 'Aggiornamento catalogo'),
      new.title, new.description, new.tags,
      new.is_public, new.api_public, new.catalog_json
    )
    on conflict (catalog_id, version) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists catalogs_prepare_version on public.catalogs;
create trigger catalogs_prepare_version
before insert or update on public.catalogs
for each row execute function public.prepare_catalog_version();

drop trigger if exists catalogs_snapshot_version on public.catalogs;
create trigger catalogs_snapshot_version
after insert or update on public.catalogs
for each row execute function public.snapshot_catalog_version();

create or replace function public.restore_catalog_version(
  p_catalog_id uuid,
  p_version integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot public.catalog_versions%rowtype;
  new_version integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select v.*
  into snapshot
  from public.catalog_versions v
  join public.catalogs c on c.id = v.catalog_id
  where v.catalog_id = p_catalog_id
    and v.version = p_version
    and c.owner_id = auth.uid();

  if not found then
    raise exception 'version_not_found';
  end if;

  update public.catalogs
  set
    title = snapshot.title,
    description = snapshot.description,
    tags = snapshot.tags,
    is_public = snapshot.is_public,
    api_public = snapshot.api_public,
    catalog_json = snapshot.catalog_json,
    version_message = 'Ripristino versione ' || p_version
  where id = p_catalog_id
    and owner_id = auth.uid()
  returning current_version into new_version;

  return new_version;
end;
$$;

revoke all on function public.restore_catalog_version(uuid, integer) from public;
revoke all on function public.restore_catalog_version(uuid, integer) from anon;
grant execute on function public.restore_catalog_version(uuid, integer) to authenticated;

-- API visibility is inherited downward. A child can explicitly override
-- api.publicRead with true/false. Root catalog access still requires api_public.
create or replace function public.api_item_public(
  p_item jsonb,
  p_inherited boolean default true
)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(p_item #> '{api,publicRead}') = 'boolean'
      then (p_item #>> '{api,publicRead}')::boolean
    else p_inherited
  end;
$$;

create or replace function public.api_filter_lesson(
  p_lesson jsonb,
  p_inherited boolean default true
)
returns jsonb
language plpgsql
immutable
as $$
declare
  allowed boolean;
  topic jsonb;
  cleaned_topic jsonb;
  module jsonb;
  topics jsonb := '[]'::jsonb;
  modules jsonb := '[]'::jsonb;
  visible_ids text[] := '{}';
  all_ids text[] := '{}';
  cleaned_ids jsonb;
  cleaned_prereqs jsonb;
  cleaned_connections jsonb;
begin
  allowed := public.api_item_public(p_lesson, p_inherited);
  if not allowed then
    return null;
  end if;

  for topic in
    select value from jsonb_array_elements(coalesce(p_lesson->'topics', '[]'::jsonb))
  loop
    if topic ? 'id' then
      all_ids := array_append(all_ids, topic->>'id');
    end if;
    if public.api_item_public(topic, allowed) then
      visible_ids := array_append(visible_ids, topic->>'id');
    end if;
  end loop;

  for topic in
    select value from jsonb_array_elements(coalesce(p_lesson->'topics', '[]'::jsonb))
  loop
    if not public.api_item_public(topic, allowed) then
      continue;
    end if;

    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into cleaned_prereqs
    from jsonb_array_elements(coalesce(topic->'prerequisites', '[]'::jsonb))
    where
      (value #>> '{}') <> all(all_ids)
      or (value #>> '{}') = any(visible_ids);

    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into cleaned_connections
    from jsonb_array_elements(coalesce(topic->'connections', '[]'::jsonb))
    where
      coalesce(value->>'target', '') <> all(all_ids)
      or coalesce(value->>'target', '') = any(visible_ids);

    cleaned_topic := jsonb_set(topic, '{prerequisites}', cleaned_prereqs, true);
    cleaned_topic := jsonb_set(cleaned_topic, '{connections}', cleaned_connections, true);
    topics := topics || jsonb_build_array(cleaned_topic);
  end loop;

  for module in
    select value from jsonb_array_elements(coalesce(p_lesson->'modules', '[]'::jsonb))
  loop
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into cleaned_ids
    from jsonb_array_elements(coalesce(module->'topicIds', '[]'::jsonb))
    where (value #>> '{}') = any(visible_ids);

    modules := modules || jsonb_build_array(jsonb_set(module, '{topicIds}', cleaned_ids, true));
  end loop;

  return jsonb_set(
    jsonb_set(p_lesson, '{topics}', topics, true),
    '{modules}', modules, true
  );
end;
$$;

create or replace function public.api_filter_library(
  p_library jsonb,
  p_inherited boolean default true
)
returns jsonb
language plpgsql
immutable
as $$
declare
  allowed boolean;
  lesson jsonb;
  filtered jsonb;
  lessons jsonb := '[]'::jsonb;
begin
  allowed := public.api_item_public(p_library, p_inherited);
  if not allowed then
    return null;
  end if;

  for lesson in
    select value from jsonb_array_elements(coalesce(p_library->'lessons', '[]'::jsonb))
  loop
    filtered := public.api_filter_lesson(lesson, allowed);
    if filtered is not null then
      lessons := lessons || jsonb_build_array(filtered);
    end if;
  end loop;

  return jsonb_set(p_library, '{lessons}', lessons, true);
end;
$$;

create or replace function public.api_filter_catalog(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  filtered jsonb;
  libraries jsonb := '[]'::jsonb;
begin
  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    filtered := public.api_filter_library(library, true);
    if filtered is not null then
      libraries := libraries || jsonb_build_array(filtered);
    end if;
  end loop;

  return jsonb_set(p_catalog, '{libraries}', libraries, true);
end;
$$;

create or replace function public.api_context(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  filtered jsonb := public.api_filter_catalog(p_catalog);
  library jsonb;
  lesson jsonb;
  topic jsonb;
  libraries jsonb := '[]'::jsonb;
  lessons jsonb;
  topics jsonb;
begin
  for library in
    select value from jsonb_array_elements(coalesce(filtered->'libraries', '[]'::jsonb))
  loop
    lessons := '[]'::jsonb;
    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      topics := '[]'::jsonb;
      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        topics := topics || jsonb_build_array(
          jsonb_strip_nulls(jsonb_build_object(
            'id', topic->'id',
            'title', topic->'title',
            'summary', topic->'summary',
            'why', topic->'why',
            'estimatedMinutes', topic->'estimatedMinutes',
            'prerequisites', coalesce(topic->'prerequisites', '[]'::jsonb),
            'connections', coalesce(topic->'connections', '[]'::jsonb)
          ))
        );
      end loop;

      lessons := lessons || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'id', lesson->'id',
          'slug', lesson->'slug',
          'title', lesson->'title',
          'description', lesson->'description',
          'topics', topics
        ))
      );
    end loop;

    libraries := libraries || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'id', library->'id',
        'slug', library->'slug',
        'title', library->'title',
        'description', library->'description',
        'lessons', lessons
      ))
    );
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', filtered->'id',
    'slug', filtered->'slug',
    'title', filtered->'title',
    'description', filtered->'description',
    'tags', coalesce(filtered->'tags', '[]'::jsonb),
    'libraries', libraries
  ));
end;
$$;

create or replace function public.api_graph(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  filtered jsonb := public.api_filter_catalog(p_catalog);
  library jsonb;
  lesson jsonb;
  topic jsonb;
  connection jsonb;
  nodes jsonb := '[]'::jsonb;
  links jsonb := '[]'::jsonb;
  catalog_id text := coalesce(filtered->>'slug', filtered->>'id', 'catalog');
  library_id text;
  lesson_id text;
  topic_id text;
begin
  nodes := nodes || jsonb_build_array(jsonb_build_object(
    'id', 'catalog:' || catalog_id,
    'type', 'catalog',
    'label', coalesce(filtered->>'title', catalog_id)
  ));

  for library in
    select value from jsonb_array_elements(coalesce(filtered->'libraries', '[]'::jsonb))
  loop
    library_id := coalesce(library->>'slug', library->>'id');
    nodes := nodes || jsonb_build_array(jsonb_build_object(
      'id', 'library:' || library_id,
      'type', 'library',
      'label', coalesce(library->>'title', library_id)
    ));
    links := links || jsonb_build_array(jsonb_build_object(
      'source', 'catalog:' || catalog_id,
      'target', 'library:' || library_id,
      'type', 'contains'
    ));

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lesson_id := library_id || '/' || coalesce(lesson->>'slug', lesson->>'id');
      nodes := nodes || jsonb_build_array(jsonb_build_object(
        'id', 'lesson:' || lesson_id,
        'type', 'lesson',
        'label', coalesce(lesson->>'title', lesson_id)
      ));
      links := links || jsonb_build_array(jsonb_build_object(
        'source', 'library:' || library_id,
        'target', 'lesson:' || lesson_id,
        'type', 'contains'
      ));

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        topic_id := lesson_id || '/' || coalesce(topic->>'id', 'topic');
        nodes := nodes || jsonb_build_array(jsonb_build_object(
          'id', 'topic:' || topic_id,
          'type', 'topic',
          'label', coalesce(topic->>'title', topic->>'id'),
          'summary', topic->>'summary'
        ));
        links := links || jsonb_build_array(jsonb_build_object(
          'source', 'lesson:' || lesson_id,
          'target', 'topic:' || topic_id,
          'type', 'contains'
        ));

        for connection in
          select value from jsonb_array_elements(coalesce(topic->'connections', '[]'::jsonb))
        loop
          if connection ? 'target' then
            links := links || jsonb_build_array(jsonb_build_object(
              'source', 'topic:' || topic_id,
              'targetRef', connection->>'target',
              'type', coalesce(connection->>'type', 'related')
            ));
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('nodes', nodes, 'links', links);
end;
$$;

create or replace function public.api_changes(
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  before_context jsonb := public.api_context(p_before);
  after_context jsonb := public.api_context(p_after);
  before_topics jsonb := '{}'::jsonb;
  after_topics jsonb := '{}'::jsonb;
  library jsonb;
  lesson jsonb;
  topic jsonb;
  added jsonb := '[]'::jsonb;
  removed jsonb := '[]'::jsonb;
  changed jsonb := '[]'::jsonb;
  key text;
  value jsonb;
begin
  for library in select value from jsonb_array_elements(coalesce(before_context->'libraries', '[]'::jsonb)) loop
    for lesson in select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb)) loop
      for topic in select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb)) loop
        before_topics := before_topics || jsonb_build_object(
          (library->>'slug') || '/' || (lesson->>'slug') || '/' || (topic->>'id'),
          topic
        );
      end loop;
    end loop;
  end loop;

  for library in select value from jsonb_array_elements(coalesce(after_context->'libraries', '[]'::jsonb)) loop
    for lesson in select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb)) loop
      for topic in select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb)) loop
        after_topics := after_topics || jsonb_build_object(
          (library->>'slug') || '/' || (lesson->>'slug') || '/' || (topic->>'id'),
          topic
        );
      end loop;
    end loop;
  end loop;

  for key, value in select * from jsonb_each(after_topics) loop
    if not (before_topics ? key) then
      added := added || jsonb_build_array(key);
    elsif before_topics->key is distinct from value then
      changed := changed || jsonb_build_array(key);
    end if;
  end loop;

  for key, value in select * from jsonb_each(before_topics) loop
    if not (after_topics ? key) then
      removed := removed || jsonb_build_array(key);
    end if;
  end loop;

  return jsonb_build_object(
    'added', added,
    'changed', changed,
    'removed', removed
  );
end;
$$;

create or replace function public.studylibrary_api(path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  parts text[];
  count_parts integer;
  catalog_key text;
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
  library jsonb;
  lesson jsonb;
  topic jsonb;
  requested_version integer;
  since_version integer;
  version_row public.catalog_versions%rowtype;
  before_row public.catalog_versions%rowtype;
  result jsonb;
begin
  parts := regexp_split_to_array(trim(both '/' from coalesce(path, '')), '/');
  count_parts := coalesce(array_length(parts, 1), 0);

  if count_parts = 0 or parts[1] = '' then
    return jsonb_build_object(
      'name', 'StudyLibrary API',
      'version', 'v1',
      'endpoints', jsonb_build_array(
        '/api/v1/catalogs',
        '/api/v1/catalogs/{id-or-slug}',
        '/api/v1/catalogs/{id-or-slug}/context',
        '/api/v1/catalogs/{id-or-slug}/graph',
        '/api/v1/catalogs/{id-or-slug}/versions',
        '/api/v1/catalogs/{id-or-slug}/changes/{version}'
      )
    );
  end if;

  if parts[1] <> 'catalogs' then
    return jsonb_build_object('error', 'not_found');
  end if;

  if count_parts = 1 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'slug', c.slug,
      'title', c.title,
      'description', c.description,
      'tags', c.tags,
      'currentVersion', c.current_version,
      'updatedAt', c.updated_at
    ) order by c.updated_at desc), '[]'::jsonb)
    into result
    from public.catalogs c
    where c.api_public = true;

    return jsonb_build_object('data', result, 'count', jsonb_array_length(result));
  end if;

  catalog_key := parts[2];

  select c.*
  into row_catalog
  from public.catalogs c
  where c.api_public = true
    and (c.id::text = catalog_key or c.slug = catalog_key)
  order by (c.id::text = catalog_key) desc, c.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('error', 'catalog_not_found');
  end if;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);

  if count_parts = 2 or parts[3] = 'export' then
    return jsonb_build_object(
      'meta', jsonb_build_object(
        'catalogId', row_catalog.id,
        'version', row_catalog.current_version,
        'updatedAt', row_catalog.updated_at
      ),
      'data', filtered
    );
  end if;

  if parts[3] = 'context' then
    return jsonb_build_object(
      'meta', jsonb_build_object(
        'catalogId', row_catalog.id,
        'version', row_catalog.current_version,
        'updatedAt', row_catalog.updated_at
      ),
      'data', public.api_context(filtered)
    );
  end if;

  if parts[3] = 'graph' then
    return jsonb_build_object(
      'meta', jsonb_build_object(
        'catalogId', row_catalog.id,
        'version', row_catalog.current_version
      ),
      'data', public.api_graph(filtered)
    );
  end if;

  if parts[3] = 'versions' then
    if count_parts = 3 then
      select coalesce(jsonb_agg(jsonb_build_object(
        'version', v.version,
        'message', v.message,
        'createdAt', v.created_at
      ) order by v.version desc), '[]'::jsonb)
      into result
      from public.catalog_versions v
      where v.catalog_id = row_catalog.id;

      return jsonb_build_object(
        'catalogId', row_catalog.id,
        'currentVersion', row_catalog.current_version,
        'data', result
      );
    end if;

    begin
      requested_version := parts[4]::integer;
    exception when others then
      return jsonb_build_object('error', 'invalid_version');
    end;

    select v.* into version_row
    from public.catalog_versions v
    where v.catalog_id = row_catalog.id
      and v.version = requested_version;

    if not found then
      return jsonb_build_object('error', 'version_not_found');
    end if;

    return jsonb_build_object(
      'meta', jsonb_build_object(
        'catalogId', row_catalog.id,
        'version', version_row.version,
        'message', version_row.message,
        'createdAt', version_row.created_at
      ),
      'data', public.api_filter_catalog(version_row.catalog_json)
    );
  end if;

  if parts[3] = 'changes' and count_parts >= 4 then
    begin
      since_version := parts[4]::integer;
    exception when others then
      return jsonb_build_object('error', 'invalid_version');
    end;

    select v.* into before_row
    from public.catalog_versions v
    where v.catalog_id = row_catalog.id
      and v.version = since_version;

    if not found then
      return jsonb_build_object('error', 'version_not_found');
    end if;

    return jsonb_build_object(
      'fromVersion', since_version,
      'toVersion', row_catalog.current_version,
      'data', public.api_changes(before_row.catalog_json, row_catalog.catalog_json)
    );
  end if;

  if parts[3] <> 'libraries' then
    return jsonb_build_object('error', 'not_found');
  end if;

  if count_parts = 3 then
    return jsonb_build_object('data', coalesce(filtered->'libraries', '[]'::jsonb));
  end if;

  select value into library
  from jsonb_array_elements(coalesce(filtered->'libraries', '[]'::jsonb))
  where value->>'slug' = parts[4] or value->>'id' = parts[4]
  limit 1;

  if library is null then
    return jsonb_build_object('error', 'library_not_found');
  end if;

  if count_parts = 4 then
    return jsonb_build_object('data', library);
  end if;

  if parts[5] <> 'lessons' then
    return jsonb_build_object('error', 'not_found');
  end if;

  if count_parts = 5 then
    return jsonb_build_object('data', coalesce(library->'lessons', '[]'::jsonb));
  end if;

  select value into lesson
  from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
  where value->>'slug' = parts[6] or value->>'id' = parts[6]
  limit 1;

  if lesson is null then
    return jsonb_build_object('error', 'lesson_not_found');
  end if;

  if count_parts = 6 then
    return jsonb_build_object('data', lesson);
  end if;

  if parts[7] <> 'topics' then
    return jsonb_build_object('error', 'not_found');
  end if;

  if count_parts = 7 then
    return jsonb_build_object('data', coalesce(lesson->'topics', '[]'::jsonb));
  end if;

  select value into topic
  from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
  where value->>'id' = parts[8]
  limit 1;

  if topic is null then
    return jsonb_build_object('error', 'topic_not_found');
  end if;

  return jsonb_build_object('data', topic);
end;
$$;

revoke all on function public.studylibrary_api(text) from public;
grant execute on function public.studylibrary_api(text) to anon, authenticated;

create or replace function public.studylibrary_api_write(
  p_catalog_id uuid,
  p_base_version integer,
  p_message text,
  p_catalog jsonb,
  p_publish boolean default null,
  p_api_public boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.catalogs%rowtype;
  next_api_public boolean;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select c.* into current_row
  from public.catalogs c
  where c.id = p_catalog_id
    and c.owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'catalog_not_found';
  end if;

  if p_base_version is not null and p_base_version <> current_row.current_version then
    raise exception 'version_conflict: current version is %', current_row.current_version;
  end if;

  next_api_public := coalesce(
    p_api_public,
    case
      when jsonb_typeof(p_catalog #> '{api,publicRead}') = 'boolean'
        then (p_catalog #>> '{api,publicRead}')::boolean
      else current_row.api_public
    end
  );

  update public.catalogs
  set
    title = coalesce(nullif(p_catalog->>'title', ''), current_row.title),
    description = coalesce(p_catalog->>'description', ''),
    tags = coalesce(
      array(select jsonb_array_elements_text(coalesce(p_catalog->'tags', '[]'::jsonb))),
      '{}'::text[]
    ),
    is_public = coalesce(p_publish, current_row.is_public),
    api_public = next_api_public,
    catalog_json = p_catalog,
    version_message = left(coalesce(nullif(trim(p_message), ''), 'Aggiornamento API'), 240)
  where id = p_catalog_id;

  select c.* into current_row from public.catalogs c where c.id = p_catalog_id;

  return jsonb_build_object(
    'catalogId', current_row.id,
    'version', current_row.current_version,
    'updatedAt', current_row.updated_at,
    'apiPublic', current_row.api_public,
    'published', current_row.is_public
  );
end;
$$;

revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from public;
revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from anon;
grant execute on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) to authenticated;
