-- StudyLibrary schema for Supabase/Postgres
-- Hierarchy: User -> Catalog -> Libraries -> Lessons -> Topics
-- Run in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalogs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  is_public boolean not null default false,
  catalog_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug)
);

create index if not exists catalogs_public_updated_idx
  on public.catalogs(is_public, updated_at desc);
create index if not exists catalogs_owner_idx
  on public.catalogs(owner_id, updated_at desc);
create index if not exists catalogs_tags_gin_idx
  on public.catalogs using gin(tags);
create index if not exists catalogs_json_gin_idx
  on public.catalogs using gin(catalog_json);

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('catalog', 'library', 'lesson', 'topic')),
  target_key text not null,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, target_kind, target_key)
);

create index if not exists ratings_target_idx
  on public.ratings(target_kind, target_key);

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('catalog', 'library', 'lesson', 'topic')),
  target_key text not null,
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_target_created_idx
  on public.comments(target_kind, target_key, created_at desc);

-- Keep reruns compatible with the previous course/topic-only schema.
alter table public.ratings
  drop constraint if exists ratings_target_kind_check;
alter table public.ratings
  add constraint ratings_target_kind_check
  check (target_kind in ('catalog', 'library', 'lesson', 'topic'));

alter table public.comments
  drop constraint if exists comments_target_kind_check;
alter table public.comments
  add constraint comments_target_kind_check
  check (target_kind in ('catalog', 'library', 'lesson', 'topic'));

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists catalogs_set_updated_at on public.catalogs;
create trigger catalogs_set_updated_at
before update on public.catalogs
for each row execute function public.set_updated_at();

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at
before update on public.ratings
for each row execute function public.set_updated_at();

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

-- Backfill profiles for users that existed before this schema was installed.
insert into public.profiles (id, display_name, avatar_url)
select
  id,
  coalesce(
    raw_user_meta_data->>'full_name',
    raw_user_meta_data->>'name',
    split_part(email, '@', 1)
  ),
  coalesce(
    raw_user_meta_data->>'avatar_url',
    raw_user_meta_data->>'picture'
  )
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.catalogs enable row level security;
alter table public.ratings enable row level security;
alter table public.comments enable row level security;

-- Profiles are public only for community attribution.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable"
on public.profiles for select
using (
  auth.uid() = id
  or exists (
    select 1 from public.catalogs
    where catalogs.owner_id = profiles.id
      and catalogs.is_public = true
  )
  or exists (
    select 1 from public.comments
    where comments.user_id = profiles.id
  )
);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- A catalog is the publication unit.
-- Public catalogs appear in Home; private catalogs are visible only to their owner.
drop policy if exists "public catalogs and own drafts readable" on public.catalogs;
create policy "public catalogs and own drafts readable"
on public.catalogs for select
using (is_public or auth.uid() = owner_id);

drop policy if exists "users create own catalogs" on public.catalogs;
create policy "users create own catalogs"
on public.catalogs for insert
with check (auth.uid() = owner_id);

drop policy if exists "users update own catalogs" on public.catalogs;
create policy "users update own catalogs"
on public.catalogs for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "users delete own catalogs" on public.catalogs;
create policy "users delete own catalogs"
on public.catalogs for delete
using (auth.uid() = owner_id);

-- Ratings are readable by everyone; users manage only their own vote.
drop policy if exists "ratings readable" on public.ratings;
create policy "ratings readable"
on public.ratings for select
using (true);

drop policy if exists "users create own ratings" on public.ratings;
create policy "users create own ratings"
on public.ratings for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own ratings" on public.ratings;
create policy "users update own ratings"
on public.ratings for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users delete own ratings" on public.ratings;
create policy "users delete own ratings"
on public.ratings for delete
using (auth.uid() = user_id);

-- Comments are readable by everyone; users manage only their own comments.
drop policy if exists "comments readable" on public.comments;
create policy "comments readable"
on public.comments for select
using (true);

drop policy if exists "users create own comments" on public.comments;
create policy "users create own comments"
on public.comments for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own comments" on public.comments;
create policy "users update own comments"
on public.comments for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users delete own comments" on public.comments;
create policy "users delete own comments"
on public.comments for delete
using (auth.uid() = user_id);


-- Production hardening: reports, basic abuse throttling and stricter comments.
alter table public.comments
  drop constraint if exists comments_body_check;
alter table public.comments
  add constraint comments_body_check
  check (char_length(trim(body)) between 1 and 1200);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('catalog', 'library', 'lesson', 'topic')),
  target_key text not null,
  comment_id bigint references public.comments(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now()
);

create index if not exists reports_status_created_idx
  on public.reports(status, created_at desc);
create index if not exists reports_reporter_created_idx
  on public.reports(reporter_id, created_at desc);
create unique index if not exists reports_open_unique_idx
  on public.reports(reporter_id, target_kind, target_key, coalesce(comment_id, 0))
  where status = 'open';

alter table public.reports enable row level security;

drop policy if exists "users create own reports" on public.reports;
create policy "users create own reports"
on public.reports for insert
with check (auth.uid() = reporter_id);

drop policy if exists "users read own reports" on public.reports;
create policy "users read own reports"
on public.reports for select
using (auth.uid() = reporter_id);

create or replace function public.enforce_comment_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  last_comment timestamptz;
  recent_count integer;
begin
  select max(created_at), count(*)
  into last_comment, recent_count
  from public.comments
  where user_id = new.user_id
    and created_at > now() - interval '5 minutes';

  if last_comment is not null and last_comment > now() - interval '12 seconds' then
    raise exception 'comment_rate_limit: wait before posting another comment';
  end if;

  if recent_count >= 12 then
    raise exception 'comment_rate_limit: too many comments in five minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_rate_limit on public.comments;
create trigger comments_rate_limit
before insert on public.comments
for each row execute function public.enforce_comment_rate_limit();

create or replace function public.enforce_report_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  recent_count integer;
begin
  select count(*)
  into recent_count
  from public.reports
  where reporter_id = new.reporter_id
    and created_at > now() - interval '10 minutes';

  if recent_count >= 8 then
    raise exception 'report_rate_limit: too many reports in ten minutes';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_rate_limit on public.reports;
create trigger reports_rate_limit
before insert on public.reports
for each row execute function public.enforce_report_rate_limit();


create or replace function public.cleanup_catalog_community_data()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.ratings
  where target_key = old.id::text
     or target_key like old.id::text || '/%';

  delete from public.comments
  where target_key = old.id::text
     or target_key like old.id::text || '/%';

  delete from public.reports
  where target_key = old.id::text
     or target_key like old.id::text || '/%';

  return old;
end;
$$;

drop trigger if exists catalogs_cleanup_community_data on public.catalogs;
create trigger catalogs_cleanup_community_data
after delete on public.catalogs
for each row execute function public.cleanup_catalog_community_data();


-- Self-service account deletion. The SECURITY DEFINER function can delete only auth.uid().
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'not_authenticated';
  end if;

  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;


-- Bound user-controlled payload sizes so one catalog cannot exhaust browser/database resources.
alter table public.catalogs
  drop constraint if exists catalogs_title_length_check;
alter table public.catalogs
  add constraint catalogs_title_length_check
  check (char_length(title) between 1 and 160);

alter table public.catalogs
  drop constraint if exists catalogs_description_length_check;
alter table public.catalogs
  add constraint catalogs_description_length_check
  check (char_length(description) <= 4000);

alter table public.catalogs
  drop constraint if exists catalogs_tags_count_check;
alter table public.catalogs
  add constraint catalogs_tags_count_check
  check (cardinality(tags) <= 20);

alter table public.catalogs
  drop constraint if exists catalogs_json_size_check;
alter table public.catalogs
  add constraint catalogs_json_size_check
  check (octet_length(catalog_json::text) <= 5242880);


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

revoke all on table public.catalog_versions from anon;
revoke all on table public.catalog_versions from authenticated;
grant select on table public.catalog_versions to authenticated;

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
  if tg_op = 'INSERT' then
    insert into public.catalog_versions (
      catalog_id, owner_id, version, message, title, description, tags,
      is_public, api_public, catalog_json
    )
    values (
      new.id, new.owner_id, new.current_version,
      coalesce(nullif(new.version_message, ''), 'Creazione catalogo'),
      new.title, new.description, new.tags,
      new.is_public, new.api_public, new.catalog_json
    )
    on conflict (catalog_id, version) do nothing;
  elsif new.current_version is distinct from old.current_version then
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
      where v.catalog_id = row_catalog.id
        and v.api_public = true;

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

    if not found or version_row.api_public is not true then
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

    if not found or before_row.api_public is not true then
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

revoke all on function public.api_item_public(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.api_filter_lesson(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.api_filter_library(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.api_filter_catalog(jsonb) from public, anon, authenticated;
revoke all on function public.api_context(jsonb) from public, anon, authenticated;
revoke all on function public.api_graph(jsonb) from public, anon, authenticated;
revoke all on function public.api_changes(jsonb, jsonb) from public, anon, authenticated;

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

  p_catalog := p_catalog || jsonb_build_object(
    'api',
    coalesce(p_catalog->'api', '{}'::jsonb) || jsonb_build_object('publicRead', next_api_public)
  );

  if p_publish is not null then
    p_catalog := p_catalog || jsonb_build_object(
      'visibility',
      case when p_publish then 'public' else 'private' end
    );
  end if;

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


-- StudyLibrary Agent Protocol, media-aware API filtering and catalog quality audit.
-- This migration supersedes the failed draft with a clean, idempotent definition.

-- Keep catalog-level media private when every reference lives inside hidden content.
create or replace function public.api_filter_catalog(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  filtered_library jsonb;
  lesson jsonb;
  topic jsonb;
  section jsonb;
  gallery_item jsonb;
  media_asset jsonb;
  libraries jsonb := '[]'::jsonb;
  filtered_media jsonb := '[]'::jsonb;
  visible_media_refs text[] := '{}';
begin
  for library in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    filtered_library := public.api_filter_library(library, true);
    if filtered_library is not null then
      libraries := libraries || jsonb_build_array(filtered_library);

      for lesson in
        select value
        from jsonb_array_elements(coalesce(filtered_library->'lessons', '[]'::jsonb))
      loop
        for topic in
          select value
          from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
        loop
          for section in
            select value
            from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
          loop
            if btrim(coalesce(section->>'mediaRef', '')) <> '' then
              visible_media_refs := array_append(visible_media_refs, section->>'mediaRef');
            end if;

            if section->>'type' = 'gallery' then
              for gallery_item in
                select value
                from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
              loop
                if jsonb_typeof(gallery_item) = 'string' then
                  visible_media_refs := array_append(visible_media_refs, gallery_item #>> '{}');
                elsif btrim(coalesce(gallery_item->>'mediaRef', '')) <> '' then
                  visible_media_refs := array_append(visible_media_refs, gallery_item->>'mediaRef');
                end if;
              end loop;
            end if;
          end loop;
        end loop;
      end loop;
    end if;
  end loop;

  for media_asset in
    select value
    from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    if media_asset->>'id' = any(visible_media_refs) then
      filtered_media := filtered_media || jsonb_build_array(media_asset);
    end if;
  end loop;

  return jsonb_set(
    jsonb_set(p_catalog, '{libraries}', libraries, true),
    '{media}', filtered_media, true
  );
end;
$$;

create or replace function public.api_context(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $
declare
  filtered jsonb := public.api_filter_catalog(p_catalog);
  library jsonb;
  lesson jsonb;
  topic jsonb;
  media_asset jsonb;
  libraries jsonb := '[]'::jsonb;
  lessons jsonb;
  topics jsonb;
  media jsonb := '[]'::jsonb;
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
            'connections', coalesce(topic->'connections', '[]'::jsonb),
            'mediaRefs', coalesce((
              select jsonb_agg(distinct ref)
              from (
                select sec.value->>'mediaRef' as ref
                from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
                where btrim(coalesce(sec.value->>'mediaRef', '')) <> ''
              ) refs
            ), '[]'::jsonb)
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

  for media_asset in
    select value from jsonb_array_elements(coalesce(filtered->'media', '[]'::jsonb))
  loop
    media := media || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'id', media_asset->'id',
        'type', media_asset->'type',
        'title', media_asset->'title',
        'caption', media_asset->'caption',
        'url', media_asset->'url',
        'sourceUrl', media_asset->'sourceUrl',
        'author', media_asset->'author',
        'credit', media_asset->'credit',
        'license', media_asset->'license',
        'provider', media_asset->'provider'
      ))
    );
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', filtered->'id',
    'slug', filtered->'slug',
    'title', filtered->'title',
    'description', filtered->'description',
    'tags', coalesce(filtered->'tags', '[]'::jsonb),
    'libraries', libraries,
    'media', media
  ));
end;
$;

create or replace function public.studylibrary_catalog_stats(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  lesson jsonb;
  topic jsonb;
  libraries_count integer := 0;
  lessons_count integer := 0;
  topics_count integer := 0;
  minutes_count integer := 0;
begin
  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    libraries_count := libraries_count + 1;

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lessons_count := lessons_count + 1;

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        topics_count := topics_count + 1;
        if jsonb_typeof(topic->'estimatedMinutes') = 'number' then
          minutes_count := minutes_count + greatest(0, (topic->>'estimatedMinutes')::integer);
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'libraries', libraries_count,
    'lessons', lessons_count,
    'topics', topics_count,
    'estimatedMinutes', minutes_count,
    'media', jsonb_array_length(coalesce(p_catalog->'media', '[]'::jsonb))
  );
end;
$$;

create or replace function public.studylibrary_catalog_audit_json(p_catalog jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  library jsonb;
  lesson jsonb;
  topic jsonb;
  section jsonb;
  source jsonb;
  connection jsonb;
  module jsonb;
  media_asset jsonb;
  gallery_item jsonb;
  prerequisite text;
  module_topic_id text;

  library_key text;
  lesson_key text;
  topic_key text;
  topic_path text;

  topic_ids text[];
  source_ids text[];
  module_topic_ids text[];
  media_ids text[] := '{}';

  issues jsonb := '[]'::jsonb;
  errors_count integer := 0;
  warnings_count integer := 0;
  suggestions_count integer := 0;
  total_topics integer := 0;
  complete_topics integer := 0;
  total_media integer := 0;
  topic_has_problem boolean;
  has_checkpoint boolean;
  has_rich_explanation boolean;
begin
  for media_asset in
    select value from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    total_media := total_media + 1;

    if btrim(coalesce(media_asset->>'id', '')) = '' then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'missing-media-id',
        'path', 'media',
        'message', 'Un media non ha un id.'
      ));
    else
      media_ids := array_append(media_ids, media_asset->>'id');
    end if;

    if coalesce(media_asset->>'type', '') not in ('image', 'video') then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'invalid-media-type',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Il media deve essere image o video.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'url', '')) = '' then
      errors_count := errors_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'type', 'missing-media-url',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Il media non ha un URL.'
      ));
    end if;

    if media_asset->>'type' = 'image'
       and btrim(coalesce(media_asset->>'alt', '')) = '' then
      warnings_count := warnings_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'warning',
        'type', 'missing-image-alt',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'L’immagine non ha alt text.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'sourceUrl', '')) = '' then
      suggestions_count := suggestions_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'suggestion',
        'type', 'missing-media-source',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'Aggiungi la pagina originale della fonte quando disponibile.'
      ));
    end if;

    if btrim(coalesce(media_asset->>'license', '')) = '' then
      suggestions_count := suggestions_count + 1;
      issues := issues || jsonb_build_array(jsonb_build_object(
        'severity', 'suggestion',
        'type', 'missing-media-license',
        'path', 'media/' || coalesce(media_asset->>'id', '?'),
        'message', 'La licenza del media non è indicata.'
      ));
    end if;
  end loop;

  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    library_key := coalesce(library->>'slug', library->>'id', 'library');

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      lesson_key := coalesce(lesson->>'slug', lesson->>'id', 'lesson');

      select coalesce(array_agg(t.value), '{}'::text[])
      into topic_ids
      from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb)) as t(value)
      where btrim(coalesce(t.value->>'id', '')) <> '';

      select coalesce(array_agg(s.value), '{}'::text[])
      into source_ids
      from jsonb_array_elements(coalesce(lesson->'sources', '[]'::jsonb)) as s(value)
      where btrim(coalesce(s.value->>'id', '')) <> '';

      select coalesce(array_agg(topic_ref.value), '{}'::text[])
      into module_topic_ids
      from jsonb_array_elements(coalesce(lesson->'modules', '[]'::jsonb)) as m(value)
      cross join lateral jsonb_array_elements_text(coalesce(m.value->'topicIds', '[]'::jsonb)) as topic_ref(value);

      for module in
        select value from jsonb_array_elements(coalesce(lesson->'modules', '[]'::jsonb))
      loop
        for module_topic_id in
          select value from jsonb_array_elements_text(coalesce(module->'topicIds', '[]'::jsonb))
        loop
          if not (module_topic_id = any(topic_ids)) then
            errors_count := errors_count + 1;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error',
              'type', 'broken-module-topic',
              'path', library_key || '/' || lesson_key,
              'message', 'Il modulo ' || coalesce(module->>'id', '?') || ' riferisce il topic inesistente ' || module_topic_id || '.'
            ));
          end if;
        end loop;
      end loop;

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        total_topics := total_topics + 1;
        topic_has_problem := false;
        topic_key := coalesce(topic->>'id', 'topic-' || total_topics);
        topic_path := library_key || '/' || lesson_key || '/' || topic_key;

        if btrim(coalesce(topic->>'summary', '')) = '' then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-summary', 'path', topic_path,
            'message', 'Manca il riassunto del topic.'
          ));
        end if;

        if btrim(coalesce(topic->>'why', '')) = '' then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-why', 'path', topic_path,
            'message', 'Manca la spiegazione del perché questo argomento serve.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'learningGoals', '[]'::jsonb)) = 0 then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-learning-goals', 'path', topic_path,
            'message', 'Aggiungi almeno un obiettivo di apprendimento.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
          where sec.value->>'type' = 'checkpoint'
        )
        into has_checkpoint;

        if not has_checkpoint then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-checkpoint', 'path', topic_path,
            'message', 'Il topic non contiene un checkpoint.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'sources', '[]'::jsonb)) = 0 then
          errors_count := errors_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'error', 'type', 'missing-sources', 'path', topic_path,
            'message', 'Il topic non contiene fonti.'
          ));
        end if;

        if not (topic_key = any(module_topic_ids)) then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'orphan-topic', 'path', topic_path,
            'message', 'Il topic non appartiene a nessun modulo.'
          ));
        end if;

        if jsonb_array_length(coalesce(topic->'connections', '[]'::jsonb)) = 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-connections', 'path', topic_path,
            'message', 'Il topic non ha collegamenti espliciti.'
          ));
        end if;

        if jsonb_typeof(topic->'estimatedMinutes') <> 'number'
           or (topic->>'estimatedMinutes')::numeric <= 0 then
          warnings_count := warnings_count + 1;
          topic_has_problem := true;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'warning', 'type', 'missing-estimated-time', 'path', topic_path,
            'message', 'Manca una stima di tempo utile per il topic.'
          ));
        end if;

        select exists(
          select 1
          from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
          where sec.value->>'type' in ('example', 'image', 'video', 'gallery', 'formula', 'flow', 'comparison', 'list')
        )
        into has_rich_explanation;

        if not has_rich_explanation then
          suggestions_count := suggestions_count + 1;
          issues := issues || jsonb_build_array(jsonb_build_object(
            'severity', 'suggestion', 'type', 'add-example-or-media', 'path', topic_path,
            'message', 'Valuta un esempio, immagine, video, formula, confronto o flow se migliora la comprensione.'
          ));
        end if;

        for section in
          select value from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
        loop
          if section->>'type' in ('image', 'video') then
            if btrim(coalesce(section->>'mediaRef', '')) = ''
               and btrim(coalesce(section->>'url', section->>'src', '')) = '' then
              errors_count := errors_count + 1;
              topic_has_problem := true;
              issues := issues || jsonb_build_array(jsonb_build_object(
                'severity', 'error', 'type', 'missing-section-media', 'path', topic_path,
                'message', 'Una sezione media non ha mediaRef né URL.'
              ));
            elsif btrim(coalesce(section->>'mediaRef', '')) <> ''
               and not ((section->>'mediaRef') = any(media_ids)) then
              errors_count := errors_count + 1;
              topic_has_problem := true;
              issues := issues || jsonb_build_array(jsonb_build_object(
                'severity', 'error', 'type', 'broken-media-ref', 'path', topic_path,
                'message', 'MediaRef inesistente: ' || (section->>'mediaRef') || '.'
              ));
            end if;
          elsif section->>'type' = 'gallery' then
            for gallery_item in
              select value from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
            loop
              if jsonb_typeof(gallery_item) = 'string'
                 and not ((gallery_item #>> '{}') = any(media_ids)) then
                errors_count := errors_count + 1;
                topic_has_problem := true;
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'severity', 'error', 'type', 'broken-gallery-media-ref', 'path', topic_path,
                  'message', 'La galleria usa un mediaRef inesistente: ' || (gallery_item #>> '{}') || '.'
                ));
              end if;
            end loop;
          end if;
        end loop;

        for source in
          select value from jsonb_array_elements(coalesce(topic->'sources', '[]'::jsonb))
        loop
          if btrim(coalesce(source->>'ref', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-source-ref', 'path', topic_path,
              'message', 'Una fonte non ha ref.'
            ));
          elsif cardinality(source_ids) > 0
             and not ((source->>'ref') = any(source_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'unknown-source-ref', 'path', topic_path,
              'message', 'Fonte non trovata nella lezione: ' || (source->>'ref') || '.'
            ));
          end if;

          if btrim(coalesce(source->>'pages', '')) = '' then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'weak-source-location', 'path', topic_path,
              'message', 'Una fonte non specifica slide/pagine.'
            ));
          end if;
        end loop;

        for prerequisite in
          select value from jsonb_array_elements_text(coalesce(topic->'prerequisites', '[]'::jsonb))
        loop
          if position('/' in prerequisite) = 0
             and not (prerequisite = any(topic_ids)) then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'broken-prerequisite', 'path', topic_path,
              'message', 'Prerequisito locale inesistente: ' || prerequisite || '.'
            ));
          end if;
        end loop;

        for connection in
          select value from jsonb_array_elements(coalesce(topic->'connections', '[]'::jsonb))
        loop
          if btrim(coalesce(connection->>'target', '')) = '' then
            errors_count := errors_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'error', 'type', 'missing-connection-target', 'path', topic_path,
              'message', 'Una connessione non ha target.'
            ));
          elsif position('/' in (connection->>'target')) = 0
             and not ((connection->>'target') = any(topic_ids)) then
            warnings_count := warnings_count + 1;
            topic_has_problem := true;
            issues := issues || jsonb_build_array(jsonb_build_object(
              'severity', 'warning', 'type', 'unresolved-local-connection', 'path', topic_path,
              'message', 'Target locale non trovato: ' || (connection->>'target') || '.'
            ));
          end if;
        end loop;

        if not topic_has_problem then
          complete_topics := complete_topics + 1;
        end if;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'errors', errors_count,
      'warnings', warnings_count,
      'suggestions', suggestions_count,
      'completeTopics', complete_topics,
      'totalTopics', total_topics,
      'media', total_media
    ),
    'issues', issues
  );
end;
$$;

create or replace function public.studylibrary_api_catalog_id(p_catalog_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  candidate uuid;
  matches integer;
begin
  if p_catalog_key is null or btrim(p_catalog_key) = '' then
    return null;
  end if;

  begin
    candidate := p_catalog_key::uuid;
    if exists (
      select 1 from public.catalogs c
      where c.id = candidate and c.api_public = true
    ) then
      return candidate;
    end if;
  exception when invalid_text_representation then
    null;
  end;

  select count(*), min(c.id)
  into matches, candidate
  from public.catalogs c
  where c.api_public = true
    and c.slug = p_catalog_key;

  if matches = 1 then
    return candidate;
  end if;

  return null;
end;
$$;

create or replace function public.studylibrary_catalog_audit(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  catalog_id uuid;
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
begin
  catalog_id := public.studylibrary_api_catalog_id(catalog_key);
  if catalog_id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID for a stable lookup.'
    );
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.id = catalog_id;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);

  return jsonb_build_object(
    'catalogId', row_catalog.id,
    'slug', row_catalog.slug,
    'title', row_catalog.title,
    'version', row_catalog.current_version,
    'auditedAt', now(),
    'data', public.studylibrary_catalog_audit_json(filtered)
  );
end;
$$;

create or replace function public.studylibrary_catalog_agent(catalog_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  catalog_id uuid;
  row_catalog public.catalogs%rowtype;
  filtered jsonb;
  audit jsonb;
  stable_key text;
begin
  catalog_id := public.studylibrary_api_catalog_id(catalog_key);
  if catalog_id is null then
    return jsonb_build_object(
      'error', 'catalog_not_found_or_ambiguous',
      'hint', 'Use the API-public catalog UUID. Slugs are accepted only when unique.'
    );
  end if;

  select c.* into row_catalog
  from public.catalogs c
  where c.id = catalog_id;

  filtered := public.api_filter_catalog(row_catalog.catalog_json);
  audit := public.studylibrary_catalog_audit_json(filtered);
  stable_key := row_catalog.id::text;

  return jsonb_build_object(
    'protocol', 'studylibrary',
    'protocolVersion', '1.1',
    'instructions', '/api/v1/agent',
    'schemas', jsonb_build_object(
      'catalog', '/api/v1/schema/catalog',
      'lesson', '/api/v1/schema/lesson',
      'topic', '/api/v1/schema/topic',
      'updatePackage', '/api/v1/schema/update-package'
    ),
    'catalog', jsonb_build_object(
      'id', row_catalog.id,
      'slug', row_catalog.slug,
      'title', row_catalog.title,
      'currentVersion', row_catalog.current_version,
      'updatedAt', row_catalog.updated_at,
      'apiPublic', row_catalog.api_public,
      'homePublic', row_catalog.is_public
    ),
    'stats', public.studylibrary_catalog_stats(filtered),
    'auditSummary', audit->'summary',
    'endpoints', jsonb_build_object(
      'self', '/api/v1/catalogs/' || stable_key || '/agent',
      'catalog', '/api/v1/catalogs/' || stable_key,
      'context', '/api/v1/catalogs/' || stable_key || '/context',
      'audit', '/api/v1/catalogs/' || stable_key || '/audit',
      'graph', '/api/v1/catalogs/' || stable_key || '/graph',
      'versions', '/api/v1/catalogs/' || stable_key || '/versions',
      'changes', '/api/v1/catalogs/' || stable_key || '/changes/{version}',
      'libraries', '/api/v1/catalogs/' || stable_key || '/libraries',
      'write', '/api/v1/write'
    ),
    'recommendedReadOrder', jsonb_build_array(
      '/api/v1/agent',
      '/api/v1/catalogs/' || stable_key || '/agent',
      '/api/v1/catalogs/' || stable_key || '/context',
      '/api/v1/catalogs/' || stable_key || '/audit',
      '/api/v1/catalogs/' || stable_key || '/graph'
    ),
    'update', jsonb_build_object(
      'preferredFormat', 'studylibrary.update',
      'baseVersion', row_catalog.current_version,
      'schema', '/api/v1/schema/update-package',
      'rule', 'Do not generate an update against a different baseVersion.'
    ),
    'media', jsonb_build_object(
      'supported', jsonb_build_array('image', 'video', 'gallery', 'embed'),
      'registry', 'catalog.media',
      'rule', 'Prefer mediaRef. External media must preserve sourceUrl, attribution and license when known.'
    )
  );
end;
$$;

create or replace function public.studylibrary_catalog_json_errors(p_catalog jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  errors text[] := '{}';
  library jsonb;
  lesson jsonb;
  topic jsonb;
  section jsonb;
  media_asset jsonb;
  gallery_item jsonb;
  media_ids text[] := '{}';
begin
  if p_catalog is null or jsonb_typeof(p_catalog) <> 'object' then
    return array['Catalog must be a JSON object'];
  end if;

  if btrim(coalesce(p_catalog->>'slug', '')) = '' then
    errors := array_append(errors, 'Catalog slug is required');
  end if;
  if btrim(coalesce(p_catalog->>'title', '')) = '' then
    errors := array_append(errors, 'Catalog title is required');
  end if;
  if char_length(coalesce(p_catalog->>'title', '')) > 160 then
    errors := array_append(errors, 'Catalog title exceeds 160 characters');
  end if;
  if char_length(coalesce(p_catalog->>'description', '')) > 4000 then
    errors := array_append(errors, 'Catalog description exceeds 4000 characters');
  end if;
  if octet_length(p_catalog::text) > 5242880 then
    errors := array_append(errors, 'Catalog JSON exceeds 5 MB');
  end if;

  for media_asset in
    select value from jsonb_array_elements(coalesce(p_catalog->'media', '[]'::jsonb))
  loop
    if btrim(coalesce(media_asset->>'id', '')) = '' then
      errors := array_append(errors, 'Media id is required');
    elsif (media_asset->>'id') = any(media_ids) then
      errors := array_append(errors, 'Duplicate media id ' || (media_asset->>'id'));
    else
      media_ids := array_append(media_ids, media_asset->>'id');
    end if;

    if coalesce(media_asset->>'type', '') not in ('image', 'video') then
      errors := array_append(errors, 'Media type must be image or video');
    end if;

    if btrim(coalesce(media_asset->>'url', '')) = '' then
      errors := array_append(errors, 'Media URL is required');
    elsif not (
      left(lower(media_asset->>'url'), 8) = 'https://'
      or left(media_asset->>'url', 1) = '/'
      or left(lower(media_asset->>'url'), 11) = 'data:image/'
    ) then
      errors := array_append(errors, 'Media URL must use HTTPS, a relative path, or a data:image URL');
    end if;

    if btrim(coalesce(media_asset->>'sourceUrl', '')) <> ''
       and left(lower(media_asset->>'sourceUrl'), 8) <> 'https://' then
      errors := array_append(errors, 'Media sourceUrl must use HTTPS');
    end if;
  end loop;

  if jsonb_typeof(p_catalog->'libraries') <> 'array'
     or jsonb_array_length(coalesce(p_catalog->'libraries', '[]'::jsonb)) = 0 then
    errors := array_append(errors, 'Catalog must contain at least one library');
    return errors;
  end if;

  for library in
    select value from jsonb_array_elements(coalesce(p_catalog->'libraries', '[]'::jsonb))
  loop
    if btrim(coalesce(library->>'slug', '')) = '' then
      errors := array_append(errors, 'Library slug is required');
    end if;
    if btrim(coalesce(library->>'title', '')) = '' then
      errors := array_append(errors, 'Library title is required');
    end if;

    if jsonb_typeof(library->'lessons') <> 'array'
       or jsonb_array_length(coalesce(library->'lessons', '[]'::jsonb)) = 0 then
      errors := array_append(errors, 'Library ' || coalesce(library->>'slug', '?') || ' must contain at least one lesson');
      continue;
    end if;

    for lesson in
      select value from jsonb_array_elements(coalesce(library->'lessons', '[]'::jsonb))
    loop
      if btrim(coalesce(lesson->>'slug', '')) = '' then
        errors := array_append(errors, 'Lesson slug is required');
      end if;
      if btrim(coalesce(lesson->>'title', '')) = '' then
        errors := array_append(errors, 'Lesson title is required');
      end if;
      if jsonb_typeof(lesson->'modules') <> 'array'
         or jsonb_array_length(coalesce(lesson->'modules', '[]'::jsonb)) = 0 then
        errors := array_append(errors, 'Lesson ' || coalesce(lesson->>'slug', '?') || ' must contain modules');
      end if;
      if jsonb_typeof(lesson->'topics') <> 'array'
         or jsonb_array_length(coalesce(lesson->'topics', '[]'::jsonb)) = 0 then
        errors := array_append(errors, 'Lesson ' || coalesce(lesson->>'slug', '?') || ' must contain topics');
        continue;
      end if;

      for topic in
        select value from jsonb_array_elements(coalesce(lesson->'topics', '[]'::jsonb))
      loop
        if btrim(coalesce(topic->>'id', '')) = '' then
          errors := array_append(errors, 'Topic id is required');
        end if;
        if btrim(coalesce(topic->>'title', '')) = '' then
          errors := array_append(errors, 'Topic title is required');
        end if;
        if btrim(coalesce(topic->>'summary', '')) = '' then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' summary is required');
        end if;
        if btrim(coalesce(topic->>'why', '')) = '' then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' why is required');
        end if;
        if jsonb_typeof(topic->'sources') <> 'array'
           or jsonb_array_length(coalesce(topic->'sources', '[]'::jsonb)) = 0 then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' must contain at least one source');
        end if;
        if jsonb_typeof(topic->'sections') <> 'array'
           or not exists (
             select 1
             from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb)) as sec(value)
             where sec.value->>'type' = 'checkpoint'
           ) then
          errors := array_append(errors, 'Topic ' || coalesce(topic->>'id', '?') || ' must contain a checkpoint');
        end if;

        for section in
          select value from jsonb_array_elements(coalesce(topic->'sections', '[]'::jsonb))
        loop
          if section->>'type' in ('image', 'video') then
            if btrim(coalesce(section->>'mediaRef', '')) <> ''
               and not ((section->>'mediaRef') = any(media_ids)) then
              errors := array_append(errors, 'Unknown mediaRef ' || (section->>'mediaRef'));
            elsif btrim(coalesce(section->>'mediaRef', '')) = ''
               and btrim(coalesce(section->>'url', section->>'src', '')) = '' then
              errors := array_append(errors, 'Media section requires mediaRef or URL');
            elsif btrim(coalesce(section->>'mediaRef', '')) = ''
               and not (
                 left(lower(coalesce(section->>'url', section->>'src', '')), 8) = 'https://'
                 or left(coalesce(section->>'url', section->>'src', ''), 1) = '/'
                 or left(lower(coalesce(section->>'url', section->>'src', '')), 11) = 'data:image/'
               ) then
              errors := array_append(errors, 'Inline media URL is not allowed');
            end if;
          elsif section->>'type' = 'embed' then
            if left(lower(coalesce(section->>'url', '')), 8) <> 'https://' then
              errors := array_append(errors, 'Embed URL must use HTTPS');
            end if;
          elsif section->>'type' = 'gallery' then
            for gallery_item in
              select value from jsonb_array_elements(coalesce(section->'items', '[]'::jsonb))
            loop
              if jsonb_typeof(gallery_item) = 'string'
                 and not ((gallery_item #>> '{}') = any(media_ids)) then
                errors := array_append(errors, 'Unknown gallery mediaRef ' || (gallery_item #>> '{}'));
              end if;
            end loop;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  return errors;
end;
$$;

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
  next_publish boolean;
  validation_errors text[];
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

  if p_base_version is not null
     and p_base_version <> current_row.current_version then
    raise exception 'version_conflict: current version is %', current_row.current_version;
  end if;

  validation_errors := public.studylibrary_catalog_json_errors(p_catalog);
  if cardinality(validation_errors) > 0 then
    raise exception 'invalid_catalog: %',
      array_to_string(validation_errors[1:least(cardinality(validation_errors), 12)], '; ');
  end if;

  if p_catalog->>'slug' is distinct from current_row.slug then
    raise exception 'slug_mismatch: expected %', current_row.slug;
  end if;

  next_publish := coalesce(p_publish, current_row.is_public);
  next_api_public := coalesce(
    p_api_public,
    case
      when jsonb_typeof(p_catalog #> '{api,publicRead}') = 'boolean'
        then (p_catalog #>> '{api,publicRead}')::boolean
      else current_row.api_public
    end
  );

  p_catalog := p_catalog || jsonb_build_object(
    'visibility', case when next_publish then 'public' else 'private' end,
    'api', coalesce(p_catalog->'api', '{}'::jsonb) || jsonb_build_object('publicRead', next_api_public)
  );

  update public.catalogs
  set
    title = p_catalog->>'title',
    description = coalesce(p_catalog->>'description', ''),
    tags = coalesce(
      array(select jsonb_array_elements_text(coalesce(p_catalog->'tags', '[]'::jsonb))),
      '{}'::text[]
    ),
    is_public = next_publish,
    api_public = next_api_public,
    catalog_json = p_catalog,
    version_message = left(coalesce(nullif(trim(p_message), ''), 'Aggiornamento API'), 240)
  where id = p_catalog_id;

  select c.* into current_row
  from public.catalogs c
  where c.id = p_catalog_id;

  return jsonb_build_object(
    'catalogId', current_row.id,
    'version', current_row.current_version,
    'updatedAt', current_row.updated_at,
    'apiPublic', current_row.api_public,
    'published', current_row.is_public
  );
end;
$$;

-- Only the intended public wrapper RPCs are executable by API roles.
revoke all on function public.studylibrary_catalog_stats(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_audit_json(jsonb) from public, anon, authenticated;
revoke all on function public.studylibrary_api_catalog_id(text) from public, anon, authenticated;
revoke all on function public.studylibrary_catalog_json_errors(jsonb) from public, anon, authenticated;

revoke all on function public.studylibrary_catalog_audit(text) from public;
grant execute on function public.studylibrary_catalog_audit(text) to anon, authenticated;

revoke all on function public.studylibrary_catalog_agent(text) from public;
grant execute on function public.studylibrary_catalog_agent(text) to anon, authenticated;

revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from public;
revoke all on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) from anon;
grant execute on function public.studylibrary_api_write(uuid, integer, text, jsonb, boolean, boolean) to authenticated;
