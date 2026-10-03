-- StudyLibrary initial migration
-- Generated from the production schema snapshot on 2026-10-03.
-- Future database changes must be added as new timestamped migrations.

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
