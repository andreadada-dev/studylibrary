-- User-owned preferred order of top-level catalog folders.
create table if not exists public.study_catalog_order (
  user_id uuid not null references auth.users(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,catalog_id)
);
create index if not exists study_catalog_order_list_idx on public.study_catalog_order(user_id,position);
alter table public.study_catalog_order enable row level security;
drop policy if exists "study_catalog_order_user" on public.study_catalog_order;
create policy "study_catalog_order_user" on public.study_catalog_order
  for all to authenticated
  using (auth.uid() = user_id and exists (
    select 1 from public.catalogs c where c.id=catalog_id and c.owner_id=auth.uid()
  ))
  with check (auth.uid() = user_id and exists (
    select 1 from public.catalogs c where c.id=catalog_id and c.owner_id=auth.uid()
  ));
grant select,insert,update,delete on public.study_catalog_order to authenticated;
