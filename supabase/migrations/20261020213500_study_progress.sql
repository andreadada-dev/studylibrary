-- User-owned study progress and recent reading position; no public exposure.
create table if not exists public.study_topic_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  library_key text not null check (length(btrim(library_key)) between 1 and 240),
  lesson_key text not null check (length(btrim(lesson_key)) between 1 and 240),
  topic_key text not null check (length(btrim(topic_key)) between 1 and 240),
  completed_at timestamptz not null default now(),
  primary key (user_id, catalog_id, library_key, lesson_key, topic_key)
);

create table if not exists public.study_recent_topics (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  library_key text not null check (length(btrim(library_key)) between 1 and 240),
  lesson_key text not null check (length(btrim(lesson_key)) between 1 and 240),
  topic_key text not null check (length(btrim(topic_key)) between 1 and 240),
  visited_at timestamptz not null default now(),
  primary key (user_id, catalog_id)
);

create index if not exists study_progress_by_catalog_idx
  on public.study_topic_progress(user_id, catalog_id, lesson_key);
create index if not exists study_recent_by_user_idx
  on public.study_recent_topics(user_id, visited_at desc);

alter table public.study_topic_progress enable row level security;
alter table public.study_recent_topics enable row level security;

drop policy if exists "study_progress_owner" on public.study_topic_progress;
create policy "study_progress_owner" on public.study_topic_progress
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "study_recent_owner" on public.study_recent_topics;
create policy "study_recent_owner" on public.study_recent_topics
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.study_topic_progress to authenticated;
grant select, insert, update, delete on public.study_recent_topics to authenticated;
