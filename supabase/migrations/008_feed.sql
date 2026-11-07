-- 008_feed.sql
-- The home feed: feed_videos() and related_videos(), an index, the feed flag.
--
-- - feed_videos(kind, cursor, cursor_id, lim, for_channel) returns video cards
--   for public and ready videos only:
--     'newest'    every channel, newest first
--     'trending'  published in the last 30 days, ranked by
--                 views / hours_since_publish ^ 1.5 (hours at least 1).
--                 Computed on the fly; no cursor, the page shows the top 50.
--     'channel'   one channel (for_channel), newest first
--   'newest' and 'channel' page by keyset on (published_at, id): pass the
--   last card's published_at and id as cursor and cursor_id for the next page.
-- - related_videos(video_id, lim) for Up next on the watch page: the same
--   channel first, then the newest from everybody, never the video itself.
-- - The channel parameter is called for_channel because channel_id is one of
--   the returned columns, and Postgres wants every name to be unique.
-- - Both only return public and ready videos. feed_videos runs as the caller,
--   so the row level security from 005 applies. related_videos is security
--   definer only to read the channel of an unlisted video (the watch page
--   already shows that channel to anybody with the link); private videos of
--   other people give no channel, so nothing about them leaks.
-- - The "feed" feature flag, off until the owner switches it on. While it is
--   off / and /trending keep the placeholder grid.
--
-- Keep the score in step with trendingScore() in lib/feed/score.ts.
--
-- Run after 007_watch.sql. Safe to run more than once.

-- Indexes ------------------------------------------------------------------------------

-- The feed's keyset: newest public and ready videos first.
create index if not exists videos_feed_idx
  on public.videos (visibility, status, published_at desc, id desc);

-- A channel's Videos tab, and "same channel first" in Up next.
create index if not exists videos_channel_feed_idx
  on public.videos (channel_id, published_at desc, id desc)
  where visibility = 'public' and status = 'ready';

-- RPCs ---------------------------------------------------------------------------------

-- The return type is part of the signature, so drop older shapes first.
drop function if exists public.feed_videos(text, timestamptz, uuid, int, uuid);
drop function if exists public.related_videos(uuid, int);

create function public.feed_videos(
  kind text default 'newest',
  cursor timestamptz default null,
  cursor_id uuid default null,
  lim int default 24,
  for_channel uuid default null
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
  channel_avatar_url text
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
      c.avatar_url as channel_avatar_url
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
        else false
      end
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

revoke execute on function public.feed_videos(text, timestamptz, uuid, int, uuid) from public;
grant execute on function public.feed_videos(text, timestamptz, uuid, int, uuid) to anon, authenticated;

create function public.related_videos(video_id uuid, lim int default 12)
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
security definer
set search_path = ''
as $$
  with current_video as (
    -- The channel of the video being watched, when the caller may see it.
    select v.channel_id
    from public.videos v
    where v.id = related_videos.video_id
      and (v.visibility in ('public', 'unlisted') or v.owner_id = (select auth.uid()))
  )
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
  from public.videos v
  join public.channels c on c.id = v.channel_id
  where v.visibility = 'public'
    and v.status = 'ready'
    and v.published_at is not null
    and v.id <> related_videos.video_id
  order by
    (v.channel_id = (select cv.channel_id from current_video cv)) desc nulls last,
    v.published_at desc,
    v.id desc
  limit least(greatest(coalesce(related_videos.lim, 12), 1), 50);
$$;

revoke execute on function public.related_videos(uuid, int) from public;
grant execute on function public.related_videos(uuid, int) to anon, authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'feed',
  'Home feed',
  'The home grid, /trending, the Videos tab on channel pages and Up next from the feed.',
  'off'
)
on conflict (key) do nothing;
