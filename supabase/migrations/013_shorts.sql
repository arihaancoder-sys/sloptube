-- 013_shorts.sql
-- Shorts: vertical videos of a minute or less, the /shorts feed and its
-- ranking, the shelf on the home feed, the Shorts tab on channel pages, a
-- 3 second view for shorts, the shorts flag.
--
-- What a short is
-- - videos.is_short is true when the processed video is vertical (height
--   greater than width) and 60 seconds or under (the duration rounded down,
--   so whatever the player shows as 1:00 or less), unless the uploader said
--   no. A trigger sets it whenever duration_s, width, height or
--   short_choice change, so encode_done (006) needs no change. Rows from
--   before this file are recounted once at the end of the columns section.
-- - videos.short_choice is the uploader's "Upload as a Short" box: null
--   (decide by shape, the default for every video so far), true or false.
--   True never makes a horizontal or long video a short.
-- - set_short_choice(video_id, on) sets it: the owner only, and once the
--   video is processed, on = true is refused with not_a_short when the
--   video does not qualify. 30 changes a minute per person.
--
-- The feed
-- - list_shorts(cursor, lim) for /shorts and the home shelf: public, ready
--   shorts, never the viewer's own. Unwatched shorts first (tier 0), the
--   ones the viewer already watched after them (tier 1); in each tier by
--   score, then id. The score is the trending math of feature 6 (008) with
--   likes and comments added and one point to start, so new shorts without
--   views still rank by how new they are:
--     (1 + views + 2 * likes + 3 * comments) / max(hours since publish, 1) ^ 1.5
--   rounded to 6 decimals so it survives the trip through JSON.
-- - cursor is null for the first page, else {"at", "tier", "score", "id"}
--   of the last short shown (lib/shorts/cursor.ts makes it). "at" is the
--   moment the first page was read: the age in the score, which shorts are
--   in (published by then) and which count as watched (by then) are all
--   measured at "at", never at now(), so the same cursor gives the same page
--   while the counts stand still. When the counts move between two pages a
--   short can cross the page boundary; the page drops ids it already has.
-- - get_short(video_id) for /shorts/<id>: one ready video, public or
--   unlisted (or the caller's own), with the same columns and is_short, so
--   the page can send a regular video on to /watch.
-- - 60 list_shorts calls a minute per person or address, logged in
--   shorts_requests. Errors: shorts_off, rate_limited, not_signed_in,
--   not_found, not_allowed, not_a_short.
--
-- Watched and views
-- - public.short_watches: (person, short) with when it first reached 3
--   seconds. watch_ping writes it for signed in viewers unless their history
--   is paused. People read their own rows.
-- - A short counts a view at 3 seconds watched instead of 10 (the same once
--   per viewer per day rule as 011): view_threshold_s(duration, is_short).
--   watch_ping is the one from 011 with that threshold and the short_watches
--   row; nothing else in it changes.
--
-- Home and channels
-- - feed_videos gains exclude_shorts (the home grid and the Videos tab leave
--   shorts out while the shelf and the Shorts tab show them), kind
--   'channel_shorts' (one channel's shorts, newest first, same keyset as
--   'channel') and an is_short column.
--
-- The "shorts" feature flag, off until the owner switches it on.
--
-- Keep the numbers in step with lib/shorts/rules.ts.
--
-- Run after 012_comments.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.shorts_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'shorts'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Vertical and a minute or less, unless the uploader said no. Same as
-- isShort() in lib/shorts/rules.ts.
create or replace function public.video_is_short(duration numeric, width int, height int, choice boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(choice, true)
     and coalesce(width, 0) > 0
     and coalesce(height, 0) > width
     and coalesce(duration, 0) > 0
     and floor(duration) <= 60
$$;

-- Seconds of watching that make a view: 3 for a short (or the whole short
-- when it is shorter), else the 011 rule. Keep in step with viewThreshold().
create or replace function public.view_threshold_s(duration numeric, is_short boolean)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(is_short, false) then
      case when duration is null or duration <= 0 then 3 else least(3, greatest(1, floor(duration)::int)) end
    else public.view_threshold_s(duration)
  end
$$;

-- The score of one short at a given moment. Same as shortsScore().
create or replace function public.shorts_score(
  views bigint,
  likes bigint,
  comments bigint,
  published_at timestamptz,
  as_of timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round((
    (1 + greatest(coalesce(views, 0), 0) + 2 * greatest(coalesce(likes, 0), 0) + 3 * greatest(coalesce(comments, 0), 0))::double precision
    / power(greatest(extract(epoch from (as_of - published_at)) / 3600.0, 1.0), 1.5)
  )::numeric, 6)
$$;

-- Columns ------------------------------------------------------------------------------

alter table public.videos add column if not exists is_short boolean not null default false;
alter table public.videos add column if not exists short_choice boolean;

create or replace function public.videos_set_is_short()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.is_short := public.video_is_short(new.duration_s, new.width, new.height, new.short_choice);
  return new;
end;
$$;

drop trigger if exists videos_set_is_short on public.videos;
create trigger videos_set_is_short
  before insert or update of duration_s, width, height, short_choice on public.videos
  for each row execute function public.videos_set_is_short();

-- Recount, so every video already processed gets the right value.
update public.videos v
   set is_short = public.video_is_short(v.duration_s, v.width, v.height, v.short_choice)
 where v.is_short is distinct from public.video_is_short(v.duration_s, v.width, v.height, v.short_choice);

-- The shorts feed and a channel's Shorts tab.
create index if not exists videos_shorts_idx
  on public.videos (published_at desc, id desc)
  where is_short and visibility = 'public' and status = 'ready';
create index if not exists videos_channel_shorts_idx
  on public.videos (channel_id, published_at desc, id desc)
  where is_short and visibility = 'public' and status = 'ready';

-- Tables --------------------------------------------------------------------------------

create table if not exists public.short_watches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  watched_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists short_watches_video_idx on public.short_watches (video_id);

alter table public.short_watches enable row level security;

drop policy if exists "people read their own short watches" on public.short_watches;
create policy "people read their own short watches"
  on public.short_watches
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.short_watches from anon, authenticated;
grant select on public.short_watches to authenticated;

-- One row per counted call, for the rate limits. Nobody reads it through the API.
create table if not exists public.shorts_requests (
  key text not null,
  bucket text not null,
  at timestamptz not null default now()
);

create index if not exists shorts_requests_recent_idx on public.shorts_requests (key, bucket, at desc);

alter table public.shorts_requests enable row level security;
revoke all on public.shorts_requests from anon, authenticated;

-- Clearing the history (011) forgets which shorts were watched too.
create or replace function public.short_watches_follow_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.short_watches s where s.user_id = old.user_id and s.video_id = old.video_id;
  return null;
end;
$$;

drop trigger if exists short_watches_follow_history on public.watch_history;
create trigger short_watches_follow_history
  after delete on public.watch_history
  for each row execute function public.short_watches_follow_history();

-- Helpers ---------------------------------------------------------------------------------

-- Counts one call and raises rate_limited past the limit. The person, else
-- the hashed viewer cookie (011), else the address. 'list': 60 a minute,
-- 'choice': 30 a minute. Locks per key, so the count cannot be raced.
create or replace function public.shorts_throttle(bucket text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  who text;
  recent int;
  lim int := case bucket when 'choice' then 30 else 60 end;
begin
  who := public.engagement_viewer_key();
  if who is null then
    who := 'addr:' || left(coalesce(nullif(btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown'), 64);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shorts:' || bucket || ':' || who, 0));
  delete from public.shorts_requests r
   where r.key = who and r.bucket = shorts_throttle.bucket and r.at < now() - interval '1 minute';
  if random() < 0.01 then
    delete from public.shorts_requests r where r.at < now() - interval '1 minute';
  end if;
  select count(*) into recent from public.shorts_requests r where r.key = who and r.bucket = shorts_throttle.bucket;
  if recent >= lim then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.shorts_requests (key, bucket) values (who, shorts_throttle.bucket);
end;
$$;

-- RPCs ---------------------------------------------------------------------------------

-- The return type is part of the signature, so drop older shapes first.
drop function if exists public.list_shorts(jsonb, int);
drop function if exists public.get_short(uuid);
drop function if exists public.set_short_choice(uuid, boolean);
drop function if exists public.feed_videos(text, timestamptz, uuid, int, uuid);
drop function if exists public.feed_videos(text, timestamptz, uuid, int, uuid, boolean);

-- One page of the shorts feed. See the top of this file for the order.
create function public.list_shorts(cursor jsonb default null, lim int default 10)
returns table (
  id uuid,
  title text,
  duration_s numeric,
  width int,
  height int,
  thumbnail_url text,
  hls_key text,
  published_at timestamptz,
  views bigint,
  like_count bigint,
  comment_count bigint,
  comments_mode text,
  my_reaction text,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  tier int,
  score numeric,
  as_of timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  at_time timestamptz;
  c_tier int;
  c_score numeric;
  c_id uuid;
  n int := least(greatest(coalesce(list_shorts.lim, 10), 1), 30);
begin
  if not public.shorts_flag_on(me) then
    raise exception 'shorts_off' using errcode = 'P0001';
  end if;
  perform public.shorts_throttle('list');

  if list_shorts.cursor is not null then
    begin
      at_time := (list_shorts.cursor ->> 'at')::timestamptz;
      c_tier := (list_shorts.cursor ->> 'tier')::int;
      c_score := (list_shorts.cursor ->> 'score')::numeric;
      c_id := (list_shorts.cursor ->> 'id')::uuid;
    exception when others then
      at_time := null;
    end;
    -- A broken cursor or one from the future gives an empty page, never the first one again.
    if at_time is null or c_tier is null or c_score is null or c_id is null or at_time > now() + interval '1 minute' then
      return;
    end if;
  else
    at_time := now();
  end if;

  return query
  with ranked as (
    select
      v.*,
      case when exists (
        select 1 from public.short_watches w
        where w.user_id = me and w.video_id = v.id and w.watched_at <= at_time
      ) then 1 else 0 end as t,
      public.shorts_score(v.views, v.like_count, v.comment_count, v.published_at, at_time) as s
    from public.videos v
    where v.is_short
      and v.visibility = 'public'
      and v.status = 'ready'
      and v.published_at is not null
      and v.published_at <= at_time
      and v.owner_id is distinct from me
  )
  select
    r.id,
    r.title,
    r.duration_s,
    r.width,
    r.height,
    r.thumbnail_url,
    r.hls_key,
    r.published_at,
    r.views,
    r.like_count,
    r.comment_count,
    coalesce(r.comments_mode, c.comments_default, 'on'),
    (select x.kind from public.video_reactions x where x.user_id = me and x.video_id = r.id),
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    r.t,
    r.s,
    at_time
  from ranked r
  join public.channels c on c.id = r.channel_id
  where c_id is null
     or r.t > c_tier
     or (r.t = c_tier and (r.s < c_score or (r.s = c_score and r.id < c_id)))
  order by r.t, r.s desc, r.id desc
  limit n;
end;
$$;

-- One video for /shorts/<id>, with is_short so a regular video can go on to /watch.
create function public.get_short(video_id uuid)
returns table (
  id uuid,
  title text,
  duration_s numeric,
  width int,
  height int,
  thumbnail_url text,
  hls_key text,
  published_at timestamptz,
  views bigint,
  like_count bigint,
  comment_count bigint,
  comments_mode text,
  my_reaction text,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  is_short boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.title,
    v.duration_s,
    v.width,
    v.height,
    v.thumbnail_url,
    v.hls_key,
    v.published_at,
    v.views,
    v.like_count,
    v.comment_count,
    coalesce(v.comments_mode, c.comments_default, 'on'),
    (select x.kind from public.video_reactions x where x.user_id = (select auth.uid()) and x.video_id = v.id),
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    v.is_short
  from public.videos v
  join public.channels c on c.id = v.channel_id
  where v.id = get_short.video_id
    and v.status = 'ready'
    and (v.visibility in ('public', 'unlisted') or v.owner_id = (select auth.uid()))
    and public.shorts_flag_on((select auth.uid()));
$$;

-- The "Upload as a Short" box. Answers is_short after the change.
create function public.set_short_choice(video_id uuid, "on" boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v public.videos;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.shorts_flag_on(me) then
    raise exception 'shorts_off' using errcode = 'P0001';
  end if;
  perform public.shorts_throttle('choice');
  select * into v from public.videos x where x.id = set_short_choice.video_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.owner_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  -- Before processing the shape is not known yet: the choice waits for it.
  if set_short_choice."on" and v.duration_s is not null
     and not public.video_is_short(v.duration_s, v.width, v.height, true) then
    raise exception 'not_a_short' using errcode = 'P0001';
  end if;
  update public.videos x set short_choice = set_short_choice."on" where x.id = v.id
  returning x.is_short into v.is_short;
  return v.is_short;
end;
$$;

-- feed_videos from 008, with exclude_shorts, kind 'channel_shorts' and is_short.
create function public.feed_videos(
  kind text default 'newest',
  cursor timestamptz default null,
  cursor_id uuid default null,
  lim int default 24,
  for_channel uuid default null,
  exclude_shorts boolean default false
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
  score double precision,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  is_short boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with args as (
    select
      coalesce(feed_videos.kind, 'newest') as kind,
      least(greatest(coalesce(feed_videos.lim, 24), 1), 50) as lim
  ),
  cards as (
    select
      v.id,
      v.title,
      v.duration_s,
      v.thumbnail_url,
      v.hls_key,
      v.preview_sprite_key,
      v.published_at,
      v.views,
      v.views::double precision
        / power(greatest(extract(epoch from (now() - v.published_at)) / 3600.0, 1.0), 1.5) as score,
      c.id as channel_id,
      c.handle as channel_handle,
      coalesce(nullif(c.name, ''), c.handle) as channel_name,
      c.avatar_url as channel_avatar_url,
      v.is_short
    from public.videos v
    join public.channels c on c.id = v.channel_id
    cross join args a
    where v.visibility = 'public'
      and v.status = 'ready'
      and v.published_at is not null
      and case a.kind
        when 'newest' then true
        when 'trending' then v.published_at > now() - interval '30 days'
        when 'channel' then v.channel_id = feed_videos.for_channel
        when 'channel_shorts' then v.channel_id = feed_videos.for_channel and v.is_short
        else false
      end
      and not (coalesce(feed_videos.exclude_shorts, false) and a.kind <> 'channel_shorts' and v.is_short)
      and (
        a.kind = 'trending'
        or feed_videos.cursor is null
        or (v.published_at, v.id) < (feed_videos.cursor, coalesce(feed_videos.cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
  )
  select cards.*
  from cards
  cross join args a
  order by
    case when a.kind = 'trending' then cards.score end desc nulls last,
    cards.published_at desc,
    cards.id desc
  limit (select lim from args);
$$;

-- watch_ping from 011: a short counts at 3 seconds, and signed in viewers
-- get a short_watches row when they reach that. Nothing else changes.
create or replace function public.watch_ping(video_id uuid, position_s numeric, played_s numeric)
returns table (counted boolean, views bigint, watched_s int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  who text;
  v public.videos;
  today date := (now() at time zone 'utc')::date;
  ev public.view_events;
  opened boolean := false;
  credit numeric;
  counted_now boolean := false;
  pos numeric;
  total bigint;
  paused boolean;
begin
  if not public.engagement_flag_on(me) then
    raise exception 'engagement_off' using errcode = 'P0001';
  end if;
  who := public.engagement_viewer_key();
  if who is null then
    raise exception 'no_viewer_key' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = watch_ping.video_id;
  if not found or v.status <> 'ready'
     or not (v.visibility in ('public', 'unlisted') or v.owner_id = me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.engagement_throttle(who, 'ping');

  pos := greatest(0, coalesce(watch_ping.position_s, 0));
  if v.duration_s is not null and v.duration_s > 0 then
    pos := least(pos, v.duration_s);
  end if;

  insert into public.view_events as e (video_id, viewer_key, day)
  values (v.id, who, today)
  on conflict on constraint view_events_pkey do nothing;
  get diagnostics total = row_count;
  opened := total > 0;

  select * into ev from public.view_events e
   where e.video_id = v.id and e.viewer_key = who and e.day = today
   for update;

  credit := case when opened then 0 else least(greatest(coalesce(watch_ping.played_s, 0), 0), 60) end;
  ev.watched_s := greatest(
    ev.watched_s,
    least(ev.watched_s + floor(credit)::int, floor(extract(epoch from (now() - ev.first_at)))::int + 1)
  );
  if not ev.counted and ev.watched_s >= public.view_threshold_s(v.duration_s, v.is_short) then
    ev.counted := true;
    counted_now := true;
  end if;

  update public.view_events e
     set watched_s = ev.watched_s, counted = ev.counted, last_at = now()
   where e.video_id = v.id and e.viewer_key = who and e.day = today;

  if counted_now then
    update public.videos x set views = x.views + 1 where x.id = v.id returning x.views into total;
  else
    total := v.views;
  end if;

  if me is not null then
    paused := coalesce((select p.history_paused from public.profiles p where p.id = me), false);
    if not paused then
      insert into public.watch_history as h (user_id, video_id, position_s, duration_s, last_at)
      values (me, v.id, pos, v.duration_s, now())
      on conflict on constraint watch_history_pkey do update
        set position_s = excluded.position_s, duration_s = excluded.duration_s, last_at = excluded.last_at;
      if v.is_short and ev.watched_s >= public.view_threshold_s(v.duration_s, true) then
        insert into public.short_watches as s (user_id, video_id)
        values (me, v.id)
        on conflict on constraint short_watches_pkey do nothing;
      end if;
    end if;
  end if;

  return query select counted_now, total, ev.watched_s;
end;
$$;

-- Internal helpers are not part of the API.
revoke execute on function public.shorts_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.shorts_throttle(text) from public, anon, authenticated;
revoke execute on function public.videos_set_is_short() from public, anon, authenticated;
revoke execute on function public.short_watches_follow_history() from public, anon, authenticated;

revoke execute on function public.list_shorts(jsonb, int) from public;
revoke execute on function public.get_short(uuid) from public;
revoke execute on function public.set_short_choice(uuid, boolean) from public;
revoke execute on function public.feed_videos(text, timestamptz, uuid, int, uuid, boolean) from public;

grant execute on function public.list_shorts(jsonb, int) to anon, authenticated;
grant execute on function public.get_short(uuid) to anon, authenticated;
grant execute on function public.set_short_choice(uuid, boolean) to authenticated;
grant execute on function public.feed_videos(text, timestamptz, uuid, int, uuid, boolean) to anon, authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'shorts',
  'Shorts',
  'The /shorts feed and /shorts/<id>, the Shorts shelf on the home feed, the Shorts tab on channel pages and the "Upload as a Short" box.',
  'off'
)
on conflict (key) do nothing;
