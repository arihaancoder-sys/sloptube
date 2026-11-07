-- 004_channels.sql
-- Channels: every profile owns exactly one channel.
--
-- - A trigger on public.profiles creates the channel, so the sign up path
--   (auth.users -> handle_new_user -> profiles) now also makes a channel.
--   Profiles that already exist get theirs from the backfill below.
-- - Everyone can read channels.
-- - Owners update name, description, links, avatar and banner directly.
-- - The handle only changes through set_channel_handle(), once every 14 days.
-- - subscriber_count and video_count are never writable through the API.
--   Later features update them from security definer functions.
-- - The channel picture follows the profile picture (one picture everywhere).
-- - The public "banners" storage bucket: 6 MB max, PNG, JPG or WebP.
-- - The "channels" feature flag, off until the owner switches it on.
--
-- Run after 003_avatars.sql. Safe to run more than once.

-- Handle rules -----------------------------------------------------------------
-- Keep in step with lib/channels/validation.ts.

-- Returns the rule a handle breaks, or null when it is fine:
-- too_short, too_long, bad_characters, bad_dots, reserved.
create or replace function public.channel_handle_problem(handle text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when handle is null or char_length(handle) < 3 then 'too_short'
    when char_length(handle) > 30 then 'too_long'
    when handle !~ '^[a-z0-9_.]{3,30}$' then 'bad_characters'
    when handle like '.%' or handle like '%.' or position('..' in handle) > 0 then 'bad_dots'
    when handle in (
      'about', 'admin', 'administrator', 'api', 'auth', 'c', 'channel', 'channels', 'embed',
      'feed', 'flags', 'help', 'history', 'home', 'library', 'login', 'logout', 'me',
      'moderator', 'null', 'official', 'playlist', 'results', 'root', 'settings', 'shorts',
      'signup', 'sloptube', 'staff', 'studio', 'subscriptions', 'support', 'system',
      'trending', 'undefined', 'upload', 'user', 'videos', 'watch', 'welcome'
    ) then 'reserved'
    else null
  end;
$$;

create or replace function public.channel_handle_is_valid(handle text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.channel_handle_problem(handle) is null;
$$;

-- About links: a JSON array of up to 5 {"title", "url"} objects, https only.
create or replace function public.channel_links_are_valid(links jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(links) = 'array'
    and jsonb_array_length(links) <= 5
    and not exists (
      select 1
      from jsonb_array_elements(links) as l(item)
      where jsonb_typeof(l.item) <> 'object'
         or jsonb_typeof(l.item -> 'title') is distinct from 'string'
         or jsonb_typeof(l.item -> 'url') is distinct from 'string'
         or char_length(l.item ->> 'title') not between 1 and 40
         or char_length(l.item ->> 'url') > 300
         or (l.item ->> 'url') !~* '^https://[^\s/$.?#][^\s]*$'
    );
$$;

-- Table ------------------------------------------------------------------------

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  handle text not null,
  name text not null default '',
  description text not null default '',
  links jsonb not null default '[]'::jsonb,
  avatar_url text,
  banner_url text,
  handle_changed_at timestamptz,
  subscriber_count int not null default 0,
  video_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint channels_handle_valid check (public.channel_handle_is_valid(handle)),
  constraint channels_name_length check (char_length(name) <= 50),
  constraint channels_description_length check (char_length(description) <= 1000),
  constraint channels_links_valid check (public.channel_links_are_valid(links)),
  constraint channels_avatar_url_https check (avatar_url is null or avatar_url ~ '^https://'),
  constraint channels_banner_url_https check (banner_url is null or banner_url ~ '^https://'),
  constraint channels_counts_not_negative check (subscriber_count >= 0 and video_count >= 0)
);

-- Handles are unique without caring about case.
create unique index if not exists channels_handle_lower_key
  on public.channels (lower(handle));

-- Row level security -------------------------------------------------------------

alter table public.channels enable row level security;

drop policy if exists "channels are readable by everyone" on public.channels;
create policy "channels are readable by everyone"
  on public.channels
  for select
  to anon, authenticated
  using (true);

drop policy if exists "owners update their own channel" on public.channels;
create policy "owners update their own channel"
  on public.channels
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- No insert or delete policies: the trigger inserts, and the channel goes
-- away with the profile (on delete cascade).

-- Column privileges: handle, handle_changed_at and the counts are not
-- writable through the API, only through the functions below.
revoke all on public.channels from anon, authenticated;
grant select (
  id, owner_id, handle, name, description, links, avatar_url, banner_url,
  handle_changed_at, subscriber_count, video_count, created_at
) on public.channels to anon, authenticated;
grant update (name, description, links, avatar_url, banner_url)
  on public.channels to authenticated;

-- Helpers ------------------------------------------------------------------------

-- A free handle based on the seed (usually the username), like "antic" or
-- "antic_4821" when "antic" is taken or reserved.
create or replace function public.generate_channel_handle(seed text)
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
  base := left(regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9_]', '', 'g'), 24);
  if public.channel_handle_is_valid(base)
     and not exists (select 1 from public.channels c where lower(c.handle) = base) then
    return base;
  end if;
  if char_length(base) < 3 then
    base := 'channel';
  end if;
  loop
    candidate := base || '_' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when public.channel_handle_is_valid(candidate)
      and not exists (select 1 from public.channels c where lower(c.handle) = candidate);
    tries := tries + 1;
    if tries > 25 then
      candidate := 'channel_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Creates the channel for a new profile.
create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.channels (owner_id, handle, name, avatar_url)
  values (
    new.id,
    public.generate_channel_handle(new.username),
    left(coalesce(nullif(new.display_name, ''), new.username), 50),
    new.avatar_url
  )
  on conflict (owner_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created
  after insert on public.profiles
  for each row execute function public.handle_new_profile();

-- One picture everywhere: when the profile picture changes, the channel follows.
create or replace function public.sync_channel_avatar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.channels c
     set avatar_url = new.avatar_url
   where c.owner_id = new.id
     and c.avatar_url is distinct from new.avatar_url;
  return new;
end;
$$;

drop trigger if exists on_profile_avatar_changed on public.profiles;
create trigger on_profile_avatar_changed
  after update of avatar_url on public.profiles
  for each row execute function public.sync_channel_avatar();

-- Backfill: a channel for every profile that does not have one yet.
-- One row at a time so each generated handle sees the ones made before it.
do $$
declare
  p record;
begin
  for p in
    select pr.id, pr.username, pr.display_name, pr.avatar_url
    from public.profiles pr
    where not exists (select 1 from public.channels c where c.owner_id = pr.id)
    order by pr.created_at
  loop
    insert into public.channels (owner_id, handle, name, avatar_url)
    values (
      p.id,
      public.generate_channel_handle(p.username),
      left(coalesce(nullif(p.display_name, ''), p.username), 50),
      p.avatar_url
    )
    on conflict (owner_id) do nothing;
  end loop;
end;
$$;

-- RPCs ---------------------------------------------------------------------------

-- Is this handle free for the person asking? Used by the studio form.
create or replace function public.channel_handle_available(handle text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.channel_handle_is_valid(lower(handle))
    and not exists (
      select 1 from public.channels c
      where lower(c.handle) = lower(channel_handle_available.handle)
        and c.owner_id is distinct from (select auth.uid())
    );
$$;

grant execute on function public.channel_handle_available(text) to anon, authenticated;

-- Changes the signed in person's handle and returns the new one.
-- The first change is free, then once every 14 days.
-- Errors (the message is the code the app shows a friendly text for):
--   not_signed_in, no_channel, handle_invalid, handle_reserved, handle_taken,
--   handle_cooldown (the detail holds the time of the next allowed change)
create or replace function public.set_channel_handle(new_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(trim(both from regexp_replace(coalesce(new_handle, ''), '^\s*@', '')));
  problem text;
  mine public.channels;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;

  select * into mine from public.channels c where c.owner_id = me for update;
  if mine.id is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;

  -- Same handle: nothing to do, and no cooldown is used up.
  if lower(mine.handle) = wanted then
    return mine.handle;
  end if;

  problem := public.channel_handle_problem(wanted);
  if problem = 'reserved' then
    raise exception 'handle_reserved' using errcode = 'P0001';
  elsif problem is not null then
    raise exception 'handle_invalid' using errcode = 'P0001', detail = problem;
  end if;

  if mine.handle_changed_at is not null and mine.handle_changed_at + interval '14 days' > now() then
    raise exception 'handle_cooldown' using
      errcode = 'P0001',
      detail = to_char((mine.handle_changed_at + interval '14 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  if exists (select 1 from public.channels c where lower(c.handle) = wanted and c.id <> mine.id) then
    raise exception 'handle_taken' using errcode = 'P0001';
  end if;

  begin
    update public.channels c
       set handle = wanted,
           handle_changed_at = now()
     where c.id = mine.id;
  exception when unique_violation then
    -- Someone took it in the same moment.
    raise exception 'handle_taken' using errcode = 'P0001';
  end;

  return wanted;
end;
$$;

revoke execute on function public.set_channel_handle(text) from public, anon;
grant execute on function public.set_channel_handle(text) to authenticated;

-- Internal helpers are not part of the API.
revoke execute on function public.generate_channel_handle(text) from public, anon, authenticated;
revoke execute on function public.handle_new_profile() from public, anon, authenticated;
revoke execute on function public.sync_channel_avatar() from public, anon, authenticated;

-- Banners bucket -------------------------------------------------------------------
-- Public read, 6 MB max. Each person writes only inside their own folder:
--   banners/<user id>/<file>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 6291456, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "banners: owners can list their files" on storage.objects;
create policy "banners: owners can list their files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "banners: owners can upload" on storage.objects;
create policy "banners: owners can upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "banners: owners can replace" on storage.objects;
create policy "banners: owners can replace"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "banners: owners can delete" on storage.objects;
create policy "banners: owners can delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'banners'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'channels',
  'Channels',
  'Channel pages at /@handle and channel editing in /studio/channel.',
  'off'
)
on conflict (key) do nothing;
