-- 002_profiles.sql
-- Accounts: one public profile per auth user.
--
-- - A trigger creates the profile (with a generated username) when someone signs up.
-- - complete_signup(username, birthdate) confirms the username and records the
--   birthdate. People under 13 are refused.
-- - Everyone can read profiles, but birthdate is not readable through the API.
-- - Owners update their own row (username, display name, avatar, bio only).
-- - Rows are never deleted directly: delete_account() removes the auth user
--   and the profile goes with it.
--
-- Run after 001_feature_flags.sql. Safe to run more than once.

-- Username rules, shared by the table, the trigger and the RPCs.
-- Keep in step with lib/accounts/validation.ts.
create or replace function public.username_is_valid(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name is not null
    and name ~ '^[a-z0-9_]{3,24}$'
    and name not in (
      'admin', 'administrator', 'api', 'auth', 'channel', 'flags', 'help', 'history',
      'library', 'login', 'logout', 'me', 'moderator', 'null', 'root', 'settings',
      'signup', 'sloptube', 'staff', 'subscriptions', 'support', 'system', 'trending',
      'undefined', 'upload', 'watch', 'welcome'
    );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null default '',
  avatar_url text,
  bio text not null default '',
  birthdate date,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_valid check (public.username_is_valid(username)),
  constraint profiles_display_name_length check (char_length(display_name) <= 50),
  constraint profiles_bio_length check (char_length(bio) <= 1000),
  constraint profiles_avatar_url_https check (avatar_url is null or avatar_url ~ '^https://')
);

-- Usernames are unique without caring about case.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));

-- Row level security ---------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

drop policy if exists "people update their own profile" on public.profiles;
create policy "people update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No insert or delete policies: the trigger inserts, delete_account() deletes.

-- Column privileges: birthdate and onboarded are never readable or writable
-- through the API, only through the functions below.
revoke all on public.profiles from anon, authenticated;
grant select (id, username, display_name, avatar_url, bio, onboarded, created_at)
  on public.profiles to anon, authenticated;
grant update (username, display_name, avatar_url, bio)
  on public.profiles to authenticated;

-- Helpers --------------------------------------------------------------------

-- Turns an email or a name into a free username like "antic_4821".
create or replace function public.generate_username(seed text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text;
  candidate text;
  tries int := 0;
begin
  base := left(regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9_]', '', 'g'), 16);
  if char_length(base) < 3 then
    base := 'user';
  end if;
  loop
    candidate := base || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when public.username_is_valid(candidate)
      and not exists (select 1 from public.profiles p where lower(p.username) = candidate);
    tries := tries + 1;
    if tries > 25 then
      candidate := 'user_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Is this username free for the person asking? Used by the signup and settings forms.
create or replace function public.username_available(name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.username_is_valid(name)
    and not exists (
      select 1 from public.profiles p
      where lower(p.username) = lower(name)
        and p.id is distinct from (select auth.uid())
    );
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- Age in whole years on a given day.
create or replace function public.age_on(birthdate date, today date default current_date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from age(today, birthdate))::int;
$$;

-- New user trigger -------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := lower(meta ->> 'username');
  claimed_birthdate text := meta ->> 'birthdate';
  chosen text;
  shown text;
  picture text := meta ->> 'avatar_url';
begin
  -- Email sign up sends the birthdate along. Refuse under 13 right away so no
  -- account is created. (Google sign ups confirm it in complete_signup.)
  if claimed_birthdate ~ '^\d{4}-\d{2}-\d{2}$' then
    if public.age_on(claimed_birthdate::date) < 13 then
      raise exception 'too_young' using errcode = 'P0001';
    end if;
  end if;

  if public.username_is_valid(wanted)
     and not exists (select 1 from public.profiles p where lower(p.username) = wanted) then
    chosen := wanted;
  else
    chosen := public.generate_username(
      coalesce(nullif(meta ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1))
    );
  end if;

  shown := left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), chosen), 50);

  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    chosen,
    shown,
    case when picture ~ '^https://' then picture else null end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RPCs -------------------------------------------------------------------------

-- Finishes sign up: confirms the username and records the birthdate (13+ only).
-- Errors (the message is the code the app shows a friendly text for):
--   not_signed_in, invalid_username, username_taken, birthdate_required,
--   invalid_birthdate, too_young, already_complete
create or replace function public.complete_signup(username text, birthdate date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(complete_signup.username));
  current_profile public.profiles;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;

  select * into current_profile from public.profiles p where p.id = me;
  if current_profile.onboarded then
    raise exception 'already_complete' using errcode = 'P0001';
  end if;

  if complete_signup.birthdate is null then
    raise exception 'birthdate_required' using errcode = 'P0001';
  end if;
  if complete_signup.birthdate > current_date or complete_signup.birthdate < date '1900-01-01' then
    raise exception 'invalid_birthdate' using errcode = 'P0001';
  end if;
  if public.age_on(complete_signup.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  if not public.username_is_valid(wanted) then
    raise exception 'invalid_username' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where lower(p.username) = wanted and p.id <> me) then
    raise exception 'username_taken' using errcode = 'P0001';
  end if;

  if current_profile.id is null then
    -- The trigger did not run (for example a user created before this migration).
    insert into public.profiles (id, username, display_name, birthdate, onboarded)
    values (me, wanted, wanted, complete_signup.birthdate, true);
  else
    update public.profiles p
       set username = wanted,
           birthdate = complete_signup.birthdate,
           onboarded = true
     where p.id = me;
  end if;
end;
$$;

revoke execute on function public.complete_signup(text, date) from public, anon;
grant execute on function public.complete_signup(text, date) to authenticated;

-- Deletes the signed in person's account. The profile row goes with it
-- (on delete cascade). The app removes their avatar files first.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  delete from auth.users u where u.id = me;
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- Internal helpers are not part of the API.
revoke execute on function public.generate_username(text) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Feature flag ------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'accounts',
  'Accounts',
  'Sign up, sign in, avatar menu and settings. The base for everything else.',
  'everyone'
)
on conflict (key) do nothing;
