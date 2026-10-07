-- Personal study bookmarks and favorites.
create table if not exists public.study_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  library_key text not null check (length(btrim(library_key)) between 1 and 240),
  lesson_key text not null check (length(btrim(lesson_key)) between 1 and 240),
  topic_key text not null check (length(btrim(topic_key)) between 1 and 240),
  title_snapshot text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, catalog_id)
);

create table if not exists public.study_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  entity_type text not null check (entity_type in ('catalog','library','lesson','topic')),
  entity_key text not null check (length(btrim(entity_key)) between 1 and 240),
  library_key text,
  lesson_key text,
  title_snapshot text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, catalog_id, entity_type, entity_key)
);

create index if not exists study_bookmarks_user_updated_idx on public.study_bookmarks(user_id, updated_at desc);
create index if not exists study_favorites_user_created_idx on public.study_favorites(user_id, created_at desc);

alter table public.study_bookmarks enable row level security;
alter table public.study_favorites enable row level security;

drop policy if exists "study_bookmarks_select_own" on public.study_bookmarks;
create policy "study_bookmarks_select_own" on public.study_bookmarks for select to authenticated using (auth.uid() = user_id);
drop policy if exists "study_bookmarks_insert_own" on public.study_bookmarks;
create policy "study_bookmarks_insert_own" on public.study_bookmarks for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "study_bookmarks_update_own" on public.study_bookmarks;
create policy "study_bookmarks_update_own" on public.study_bookmarks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "study_bookmarks_delete_own" on public.study_bookmarks;
create policy "study_bookmarks_delete_own" on public.study_bookmarks for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "study_favorites_select_own" on public.study_favorites;
create policy "study_favorites_select_own" on public.study_favorites for select to authenticated using (auth.uid() = user_id);
drop policy if exists "study_favorites_insert_own" on public.study_favorites;
create policy "study_favorites_insert_own" on public.study_favorites for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "study_favorites_delete_own" on public.study_favorites;
create policy "study_favorites_delete_own" on public.study_favorites for delete to authenticated using (auth.uid() = user_id);

create or replace function public.touch_study_bookmark_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.touch_study_bookmark_updated_at() from public, anon, authenticated;

drop trigger if exists study_bookmarks_touch_updated_at on public.study_bookmarks;
create trigger study_bookmarks_touch_updated_at before update on public.study_bookmarks
for each row execute function public.touch_study_bookmark_updated_at();

grant select, insert, update, delete on public.study_bookmarks to authenticated;
grant select, insert, delete on public.study_favorites to authenticated;
