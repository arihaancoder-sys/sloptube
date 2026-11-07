-- 007_watch.sql
-- The watch page: a views column and the watch_video() function.
--
-- - videos.views (bigint, 0 for every video). Counting views arrives with
--   feature 9; the watch page already shows the number.
-- - watch_video(video_id) returns what /watch and /api/media need about one
--   video, in one call, without opening the videos table to more people:
--     - public and unlisted videos: a row for everyone. While the video is
--       not ready the playback fields (hls_key, renditions, the sprite) are
--       null, so the page can say "This video is being processed".
--     - private videos: a row for the owner only. Anybody else gets no row,
--       the same as a video that does not exist.
--     - the owner gets every field in every state, plus is_owner = true.
--   Unlisted videos are not readable through the videos table (005 only
--   opens public and ready ones), so this function is security definer and
--   does the visibility check itself.
-- - The "watch" feature flag, off until the owner switches it on. While it
--   is off /watch keeps the feature 4 stub.
--
-- Run after 006_processing.sql. Safe to run more than once.

-- New column -------------------------------------------------------------------------

alter table public.videos add column if not exists views bigint not null default 0;

alter table public.videos drop constraint if exists videos_views_positive;
alter table public.videos add constraint videos_views_positive check (views >= 0);

-- Readable like the rest of the row (005 granted select on the whole table).

-- RPC ----------------------------------------------------------------------------------

-- The return type changes the function signature, so drop an older shape first.
drop function if exists public.watch_video(uuid);

create function public.watch_video(video_id uuid)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  status text,
  is_owner boolean,
  created_at timestamptz,
  published_at timestamptz,
  duration_s numeric,
  width int,
  height int,
  views bigint,
  renditions jsonb,
  thumbnail_url text,
  hls_key text,
  preview_sprite_key text,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text,
  channel_subscriber_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.id,
    v.title,
    v.description,
    v.visibility,
    v.status,
    mine.yes,
    v.created_at,
    v.published_at,
    v.duration_s,
    v.width,
    v.height,
    v.views,
    case when playable.yes then v.renditions end,
    case when playable.yes then v.thumbnail_url end,
    case when playable.yes then v.hls_key end,
    case when playable.yes then v.preview_sprite_key end,
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url,
    c.subscriber_count
  from public.videos v
  join public.channels c on c.id = v.channel_id
  cross join lateral (select coalesce(v.owner_id = (select auth.uid()), false) as yes) mine
  cross join lateral (select v.status = 'ready' or mine.yes as yes) playable
  where v.id = watch_video.video_id
    and (mine.yes or v.visibility in ('public', 'unlisted'));
$$;

revoke execute on function public.watch_video(uuid) from public;
grant execute on function public.watch_video(uuid) to anon, authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'watch',
  'Watch page',
  'The /watch page with the HLS player, and /api/media for its files.',
  'off'
)
on conflict (key) do nothing;
