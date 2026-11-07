-- 001_feature_flags.sql
-- Feature flags. Every feature from now on checks a row here so the owner can
-- switch it on step by step:
--   off       hidden for everyone
--   test      only for the user ids listed in "users"
--   everyone  on for all
-- Flip them in the Supabase table editor. Safe to run more than once.

create table if not exists public.feature_flags (
  key text primary key,
  label text not null default '',
  description text not null default '',
  mode text not null default 'off' check (mode in ('off', 'test', 'everyone')),
  users uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Keep updated_at honest when a flag is flipped.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists feature_flags_touch on public.feature_flags;
create trigger feature_flags_touch
  before update on public.feature_flags
  for each row execute function public.touch_updated_at();

alter table public.feature_flags enable row level security;

-- Everyone may read the flags. There are no insert, update or delete policies,
-- so only the service role (and the dashboard) can change them.
drop policy if exists "feature_flags are readable by everyone" on public.feature_flags;
create policy "feature_flags are readable by everyone"
  on public.feature_flags
  for select
  to anon, authenticated
  using (true);

grant select on public.feature_flags to anon, authenticated;
