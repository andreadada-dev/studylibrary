-- StudyLibrary schema for Supabase/Postgres
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

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  title text not null,
  description text not null default '',
  tags text[] not null default '{}',
  is_public boolean not null default false,
  course_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug)
);

create index if not exists courses_public_updated_idx on public.courses(is_public, updated_at desc);
create index if not exists courses_owner_idx on public.courses(owner_id, updated_at desc);
create index if not exists courses_tags_gin_idx on public.courses using gin(tags);
create index if not exists courses_json_gin_idx on public.courses using gin(course_json);

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('course', 'topic')),
  target_key text not null,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, target_kind, target_key)
);

create index if not exists ratings_target_idx on public.ratings(target_kind, target_key);

create table if not exists public.comments (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('course', 'topic')),
  target_key text not null,
  body text not null check (char_length(body) between 1 and 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_target_created_idx on public.comments(target_kind, target_key, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at before update on public.courses
for each row execute function public.set_updated_at();

drop trigger if exists ratings_set_updated_at on public.ratings;
create trigger ratings_set_updated_at before update on public.ratings
for each row execute function public.set_updated_at();

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at before update on public.comments
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
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
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

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.ratings enable row level security;
alter table public.comments enable row level security;

-- Public profile data is intentionally minimal: display name, avatar and bio.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

-- Public courses are readable by everyone; owners can also read their drafts.
drop policy if exists "public courses and own drafts readable" on public.courses;
create policy "public courses and own drafts readable" on public.courses
for select using (is_public or auth.uid() = owner_id);

drop policy if exists "users create own courses" on public.courses;
create policy "users create own courses" on public.courses
for insert with check (auth.uid() = owner_id);

drop policy if exists "users update own courses" on public.courses;
create policy "users update own courses" on public.courses
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "users delete own courses" on public.courses;
create policy "users delete own courses" on public.courses
for delete using (auth.uid() = owner_id);

-- Ratings are public to read; signed-in users can manage only their own rating.
drop policy if exists "ratings readable" on public.ratings;
create policy "ratings readable" on public.ratings for select using (true);

drop policy if exists "users create own ratings" on public.ratings;
create policy "users create own ratings" on public.ratings
for insert with check (auth.uid() = user_id);

drop policy if exists "users update own ratings" on public.ratings;
create policy "users update own ratings" on public.ratings
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete own ratings" on public.ratings;
create policy "users delete own ratings" on public.ratings
for delete using (auth.uid() = user_id);

-- Comments are public to read; signed-in users can manage their own comments.
drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select using (true);

drop policy if exists "users create own comments" on public.comments;
create policy "users create own comments" on public.comments
for insert with check (auth.uid() = user_id);

drop policy if exists "users update own comments" on public.comments;
create policy "users update own comments" on public.comments
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete own comments" on public.comments;
create policy "users delete own comments" on public.comments
for delete using (auth.uid() = user_id);
