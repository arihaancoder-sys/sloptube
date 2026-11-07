-- 009_subscriptions.sql
-- Subscriptions: subscribe to channels, the bell, the subscriptions feed.
--
-- - public.subscriptions: one row per (subscriber, channel), with notify (the
--   bell) on by default. A person reads only their own rows. Writes go through
--   the functions below, which check the flag and the rate limit; the policies
--   still only allow a person's own rows, in case direct writes are ever granted.
-- - Nobody subscribes to their own channel (checked by the functions and by a
--   trigger on the table).
-- - channels.subscriber_count is kept right by a trigger on insert and delete,
--   with a one time recount below. Channel owners (and everybody else) only
--   ever see that count, never who subscribed.
-- - subscribe(channel_id), unsubscribe(channel_id), set_notify(channel_id, on)
--   each answer the new state: subscribed, notify, subscriber_count.
--   Errors (the message is the code the app shows a friendly text for):
--     not_signed_in, subscriptions_off, not_found, own_channel, rate_limited,
--     not_subscribed (set_notify only). unsubscribe works with the flag off,
--     so people can always leave.
-- - At most 60 changes (subscribe, unsubscribe, bell) per hour per person,
--   counted in public.subscription_changes. Repeating the current state is free.
-- - my_subscriptions() lists the signed in person's channels for the guide:
--   picture, name, handle, the latest upload time and an unseen count (0 for
--   now, a placeholder for a later feature).
-- - subscriptions_feed(cursor, cursor_id, lim, only_notify) returns public and
--   ready videos from subscribed channels, newest first, with the same keyset
--   on (published_at, id) and the same columns as feed_videos (no score).
--   only_notify keeps channels with the bell on, for the notifications menu.
-- - The "subscriptions" feature flag, off until the owner switches it on.
--
-- Keep the rate limit in step with lib/subscriptions/rules.ts.
--
-- Run after 008_feed.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.subscription_changes_per_hour()
returns int
language sql
immutable
set search_path = ''
as $$ select 60 $$;

create or replace function public.subscriptions_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'subscriptions'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Tables ---------------------------------------------------------------------------------

create table if not exists public.subscriptions (
  subscriber_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  notify boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (subscriber_id, channel_id)
);

-- Counting a channel's subscribers, and deleting a channel.
create index if not exists subscriptions_channel_idx on public.subscriptions (channel_id);

alter table public.subscriptions enable row level security;

drop policy if exists "people read their own subscriptions" on public.subscriptions;
create policy "people read their own subscriptions"
  on public.subscriptions
  for select
  to authenticated
  using (subscriber_id = (select auth.uid()));

drop policy if exists "people add their own subscriptions" on public.subscriptions;
create policy "people add their own subscriptions"
  on public.subscriptions
  for insert
  to authenticated
  with check (subscriber_id = (select auth.uid()));

drop policy if exists "people change their own subscriptions" on public.subscriptions;
create policy "people change their own subscriptions"
  on public.subscriptions
  for update
  to authenticated
  using (subscriber_id = (select auth.uid()))
  with check (subscriber_id = (select auth.uid()));

drop policy if exists "people remove their own subscriptions" on public.subscriptions;
create policy "people remove their own subscriptions"
  on public.subscriptions
  for delete
  to authenticated
  using (subscriber_id = (select auth.uid()));

-- Reads only through the API. Writes go through the functions, so the flag
-- and the rate limit cannot be skipped.
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- One row per change, for the rate limit. Nobody reads it through the API.
create table if not exists public.subscription_changes (
  subscriber_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);

create index if not exists subscription_changes_recent_idx
  on public.subscription_changes (subscriber_id, at desc);

alter table public.subscription_changes enable row level security;
revoke all on public.subscription_changes from anon, authenticated;

-- No subscribing to your own channel -----------------------------------------------------

create or replace function public.subscriptions_not_own_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.channels c
    where c.id = new.channel_id and c.owner_id = new.subscriber_id
  ) then
    raise exception 'own_channel' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists subscriptions_not_own_channel on public.subscriptions;
create trigger subscriptions_not_own_channel
  before insert or update of channel_id, subscriber_id on public.subscriptions
  for each row execute function public.subscriptions_not_own_channel();

-- channels.subscriber_count ----------------------------------------------------------------

create or replace function public.subscriptions_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.channels c set subscriber_count = c.subscriber_count + 1 where c.id = new.channel_id;
  elsif tg_op = 'DELETE' then
    update public.channels c set subscriber_count = greatest(c.subscriber_count - 1, 0) where c.id = old.channel_id;
  end if;
  return null;
end;
$$;

drop trigger if exists subscriptions_count on public.subscriptions;
create trigger subscriptions_count
  after insert or delete on public.subscriptions
  for each row execute function public.subscriptions_count();

-- Recount once, so the counts are right whatever happened before this file.
update public.channels c
   set subscriber_count = coalesce((
     select count(*) from public.subscriptions s where s.channel_id = c.id
   ), 0)
 where c.subscriber_count is distinct from coalesce((
     select count(*) from public.subscriptions s where s.channel_id = c.id
   ), 0);

-- Writes -------------------------------------------------------------------------------

-- The checks every change shares: signed in, the flag (unless leaving), the
-- channel exists and is not the caller's own, and, when the call really
-- changes something, the rate limit. Locks per person, so the hourly count
-- cannot be raced. Returns the caller's id.
create or replace function public.subscription_change_guard(target uuid, counts boolean, need_flag boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  recent int;
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if need_flag and not public.subscriptions_flag_on(me) then
    raise exception 'subscriptions_off' using errcode = 'P0001';
  end if;
  select c.owner_id into owner from public.channels c where c.id = target;
  if owner is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if owner = me then
    raise exception 'own_channel' using errcode = 'P0001';
  end if;
  if counts then
    perform pg_advisory_xact_lock(hashtextextended('subscription_change:' || me::text, 0));
    delete from public.subscription_changes sc
     where sc.subscriber_id = me and sc.at < now() - interval '1 hour';
    select count(*) into recent
      from public.subscription_changes sc
     where sc.subscriber_id = me;
    if recent >= public.subscription_changes_per_hour() then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    insert into public.subscription_changes (subscriber_id) values (me);
  end if;
  return me;
end;
$$;

-- The return type is part of the signature, so drop older shapes first.
drop function if exists public.subscribe(uuid);
drop function if exists public.unsubscribe(uuid);
drop function if exists public.set_notify(uuid, boolean);
drop function if exists public.my_subscriptions();
drop function if exists public.subscriptions_feed(timestamptz, uuid, int, boolean);

create function public.subscribe(channel_id uuid)
returns table (subscribed boolean, notify boolean, subscriber_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  already boolean := exists (
    select 1 from public.subscriptions s
    where s.subscriber_id = auth.uid() and s.channel_id = subscribe.channel_id
  );
begin
  me := public.subscription_change_guard(subscribe.channel_id, not already, true);
  insert into public.subscriptions (subscriber_id, channel_id)
  values (me, subscribe.channel_id)
  on conflict on constraint subscriptions_pkey do nothing;
  return query
    select true, s.notify, c.subscriber_count
      from public.subscriptions s
      join public.channels c on c.id = s.channel_id
     where s.subscriber_id = me and s.channel_id = subscribe.channel_id;
end;
$$;

-- Leaving works even with the flag off. Unsubscribing twice is free.
create function public.unsubscribe(channel_id uuid)
returns table (subscribed boolean, notify boolean, subscriber_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  there boolean := exists (
    select 1 from public.subscriptions s
    where s.subscriber_id = auth.uid() and s.channel_id = unsubscribe.channel_id
  );
begin
  me := public.subscription_change_guard(unsubscribe.channel_id, there, false);
  delete from public.subscriptions s
   where s.subscriber_id = me and s.channel_id = unsubscribe.channel_id;
  return query
    select false, false, c.subscriber_count
      from public.channels c
     where c.id = unsubscribe.channel_id;
end;
$$;

-- The bell. Errors also: not_subscribed
create function public.set_notify(channel_id uuid, "on" boolean)
returns table (subscribed boolean, notify boolean, subscriber_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid;
  current_notify boolean;
  wanted boolean := coalesce(set_notify."on", true);
begin
  select s.notify into current_notify
    from public.subscriptions s
   where s.subscriber_id = auth.uid() and s.channel_id = set_notify.channel_id;
  me := public.subscription_change_guard(
    set_notify.channel_id,
    current_notify is not null and current_notify <> wanted,
    true
  );
  if current_notify is null then
    raise exception 'not_subscribed' using errcode = 'P0001';
  end if;
  update public.subscriptions s
     set notify = wanted
   where s.subscriber_id = me and s.channel_id = set_notify.channel_id;
  return query
    select true, s.notify, c.subscriber_count
      from public.subscriptions s
      join public.channels c on c.id = s.channel_id
     where s.subscriber_id = me and s.channel_id = set_notify.channel_id;
end;
$$;

-- Reads --------------------------------------------------------------------------------

-- The guide's list. Runs as the caller: the policy above keeps it to their rows.
create function public.my_subscriptions()
returns table (
  channel_id uuid,
  handle text,
  name text,
  avatar_url text,
  notify boolean,
  subscribed_at timestamptz,
  latest_upload_at timestamptz,
  unseen int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    s.notify,
    s.created_at,
    (
      select max(v.published_at) from public.videos v
       where v.channel_id = c.id and v.visibility = 'public' and v.status = 'ready'
    ),
    0
  from public.subscriptions s
  join public.channels c on c.id = s.channel_id
  where s.subscriber_id = (select auth.uid())
  order by 7 desc nulls last, 3, 1;
$$;

-- The subscriptions feed, paged like feed_videos.
create function public.subscriptions_feed(
  cursor timestamptz default null,
  cursor_id uuid default null,
  lim int default 24,
  only_notify boolean default false
)
returns table (
  id uuid,
  title text,
  duration_s numeric,
  thumbnail_url text,
  hls_key text,
  preview_sprite_key text,
  published_at timestamptz,
  views bigint,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.id,
    v.title,
    v.duration_s,
    v.thumbnail_url,
    v.hls_key,
    v.preview_sprite_key,
    v.published_at,
    v.views,
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url
  from public.subscriptions s
  join public.channels c on c.id = s.channel_id
  join public.videos v on v.channel_id = s.channel_id
  where s.subscriber_id = (select auth.uid())
    and (not coalesce(subscriptions_feed.only_notify, false) or s.notify)
    and v.visibility = 'public'
    and v.status = 'ready'
    and v.published_at is not null
    and (
      subscriptions_feed.cursor is null
      or (v.published_at, v.id) < (subscriptions_feed.cursor, coalesce(subscriptions_feed.cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by v.published_at desc, v.id desc
  limit least(greatest(coalesce(subscriptions_feed.lim, 24), 1), 50);
$$;

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.subscriptions_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.subscription_change_guard(uuid, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.subscriptions_not_own_channel() from public, anon, authenticated;
revoke execute on function public.subscriptions_count() from public, anon, authenticated;

revoke execute on function public.subscribe(uuid) from public;
revoke execute on function public.unsubscribe(uuid) from public;
revoke execute on function public.set_notify(uuid, boolean) from public;
revoke execute on function public.my_subscriptions() from public;
revoke execute on function public.subscriptions_feed(timestamptz, uuid, int, boolean) from public;
grant execute on function public.subscribe(uuid) to authenticated;
grant execute on function public.unsubscribe(uuid) to authenticated;
grant execute on function public.set_notify(uuid, boolean) to authenticated;
grant execute on function public.my_subscriptions() to authenticated;
grant execute on function public.subscriptions_feed(timestamptz, uuid, int, boolean) to authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'subscriptions',
  'Subscriptions',
  'Subscribe buttons, the bell, the Subscriptions list in the guide, /feed/subscriptions and the notifications menu.',
  'off'
)
on conflict (key) do nothing;
