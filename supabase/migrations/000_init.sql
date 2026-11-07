-- 000_init.sql
-- First migration. Creates a small key/value table the app can use for
-- settings and a "the database is alive" check.
-- Safe to run more than once.

create table if not exists public.app_meta (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_meta enable row level security;

-- Anyone (signed in or not) may read. Nobody may write through the API;
-- writes happen in the SQL editor or with the service role.
drop policy if exists "app_meta is readable by everyone" on public.app_meta;
create policy "app_meta is readable by everyone"
  on public.app_meta
  for select
  to anon, authenticated
  using (true);
