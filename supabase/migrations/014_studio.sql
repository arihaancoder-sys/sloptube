-- 014_studio.sql
-- The creator studio: the dashboard numbers, the Content list with the
-- trash, bulk changes, the edit page (title, description, visibility, tags,
-- thumbnail), the purge after 30 days and the R2 cleanup queue, the studio
-- flag.
--
-- The trash (a soft delete)
-- - videos.deleted_at is set when the owner deletes a video. A video in the
--   trash is always private: the visibility it had is kept in
--   videos.trash_visibility and put back on restore. Every page, feed, RPC
--   and policy from 005 to 013 already hides private videos from everybody
--   but the owner, so none of them needs to change, and channels.video_count
--   follows through its trigger (006). The guard trigger refuses any change
--   that would make a video in the trash anything but private (in_trash).
-- - The trash keeps a video for 30 days (studio_trash_days()). purge_trash()
--   then deletes the row for good (comments, likes, views and history go
--   with it through on delete cascade) and queues its R2 folders in
--   storage_cleanup. pg_cron runs it every day at 03:17 UTC when pg_cron is
--   on; otherwise this file says so with a notice.
-- - storage_cleanup is drained by the encoder worker (worker/lib/cleanup.mjs)
--   with claim_cleanup, cleanup_done and cleanup_failed (service role only).
--   Each row is one prefix: hls/<video>/ and uploads/<owner>/<video>/.
--   A failed row is tried again up to 5 times; a running row left behind for
--   15 minutes is taken back.
--
-- RPCs (all need the studio flag; errors are the message, P0001)
-- - studio_overview() for the dashboard: the channel, its totals (views,
--   videos, subscribers, likes, comments, watch time), the last 28 days from
--   video_stats_daily (011), the latest video with its numbers, the trash count.
-- - studio_videos(trash) the caller's videos, the trash with its purge date.
-- - studio_bulk(video_ids, action, visibility) action 'visibility', 'trash'
--   or 'restore' on up to 100 of the caller's own videos at once. All or
--   nothing: one id that is not the caller's (or does not exist) refuses the
--   whole call with not_allowed. 60 calls a minute per person ('bulk').
-- - update_video(video_id, title, description, visibility, tags) the edit
--   page. set_video_thumbnail(video_id, name, url) picks one of the encoder's
--   stills (thumb-1.webp to thumb-3.webp) or a custom upload
--   (custom-<random>.<jpg|png|webp>, under hls/<video>/). url is the public
--   link the app worked out, or null. 60 edits a minute per person ('edit').
-- - Errors: studio_off, not_signed_in, not_found, not_allowed, rate_limited,
--   bad_action, bad_visibility, too_many, in_trash, title_invalid,
--   description_invalid, tags_invalid, thumbnail_invalid, not_ready.
--
-- videos.tags: up to 15 tags of 1 to 30 characters, 500 characters in all.
-- videos.thumbnail_name: the chosen file, null for the default (thumb-1.webp).
--
-- The "studio" feature flag, off until the owner switches it on.
--
-- Keep the numbers in step with lib/studio/rules.ts.
--
-- Run after 013_shorts.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.studio_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'studio'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- How long the trash keeps a video. Same as TRASH_DAYS.
create or replace function public.studio_trash_days()
returns int
language sql
immutable
set search_path = ''
as $$
  select 30
$$;

-- Same as tagsProblem() in lib/studio/rules.ts.
create or replace function public.video_tags_are_valid(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select tags is not null
     and coalesce(array_length(tags, 1), 0) <= 15
     and coalesce(char_length(array_to_string(tags, ',')), 0) <= 500
     and not exists (
       select 1 from unnest(tags) as t(tag)
       where t.tag is null or char_length(t.tag) not between 1 and 30 or t.tag <> btrim(t.tag) or t.tag ~ '[,\n\r\t]'
     )
$$;

-- Same as isThumbnailName() in lib/studio/rules.ts.
create or replace function public.video_thumbnail_name_is_valid(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name ~ '^(thumb-[1-3]\.webp|custom-[a-z0-9]{12,32}\.(jpg|png|webp))$'
$$;

-- Columns ------------------------------------------------------------------------------

alter table public.videos add column if not exists deleted_at timestamptz;
alter table public.videos add column if not exists trash_visibility text;
alter table public.videos add column if not exists tags text[] not null default '{}';
alter table public.videos add column if not exists thumbnail_name text;

alter table public.videos drop constraint if exists videos_trash_visibility_valid;
alter table public.videos add constraint videos_trash_visibility_valid
  check (trash_visibility is null or trash_visibility in ('private', 'unlisted', 'public'));
alter table public.videos drop constraint if exists videos_tags_valid;
alter table public.videos add constraint videos_tags_valid check (public.video_tags_are_valid(tags));
alter table public.videos drop constraint if exists videos_thumbnail_name_valid;
alter table public.videos add constraint videos_thumbnail_name_valid
  check (thumbnail_name is null or public.video_thumbnail_name_is_valid(thumbnail_name));

create index if not exists videos_trash_idx on public.videos (deleted_at) where deleted_at is not null;

-- A video in the trash stays private, whoever changes it.
create or replace function public.videos_trash_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.deleted_at is not null and new.visibility <> 'private' then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists videos_trash_guard on public.videos;
create trigger videos_trash_guard
  before insert or update of visibility, deleted_at on public.videos
  for each row execute function public.videos_trash_guard();

-- Tables --------------------------------------------------------------------------------

-- One row per counted call, for the rate limits. Nobody reads it through the API.
create table if not exists public.studio_requests (
  user_id uuid not null,
  bucket text not null,
  at timestamptz not null default now()
);

create index if not exists studio_requests_recent_idx on public.studio_requests (user_id, bucket, at desc);

alter table public.studio_requests enable row level security;
revoke all on public.studio_requests from anon, authenticated;

-- R2 folders to delete. No foreign key: the video row is gone by then.
create table if not exists public.storage_cleanup (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  prefix text not null,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  error text,
  deleted_objects int,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint storage_cleanup_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  -- Only the two folders a video has, so a bad row can never empty the bucket.
  constraint storage_cleanup_prefix_valid check (
    prefix ~ '^hls/[0-9a-f-]{36}/$' or prefix ~ '^uploads/[0-9a-f-]{36}/[0-9a-f-]{36}/$'
  ),
  constraint storage_cleanup_once unique (prefix)
);

create index if not exists storage_cleanup_todo_idx on public.storage_cleanup (queued_at)
  where status in ('queued', 'failed', 'running');

alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from anon, authenticated;

-- Helpers ---------------------------------------------------------------------------------

-- Counts one call and raises rate_limited past the limit: 60 a minute for
-- 'bulk' and for 'edit'. Locks per person, so the count cannot be raced.
create or replace function public.studio_throttle(who uuid, bucket text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('studio:' || bucket || ':' || who::text, 0));
  delete from public.studio_requests r
   where r.user_id = who and r.bucket = studio_throttle.bucket and r.at < now() - interval '1 minute';
  if random() < 0.01 then
    delete from public.studio_requests r where r.at < now() - interval '1 minute';
  end if;
  select count(*) into recent from public.studio_requests r where r.user_id = who and r.bucket = studio_throttle.bucket;
  if recent >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.studio_requests (user_id, bucket) values (who, studio_throttle.bucket);
end;
$$;

-- Signed in and the flag on. Answers the caller.
create or replace function public.studio_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.studio_flag_on(me) then
    raise exception 'studio_off' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- RPCs ---------------------------------------------------------------------------------

drop function if exists public.studio_overview();
drop function if exists public.studio_videos(boolean);
drop function if exists public.studio_bulk(uuid[], text, text);
drop function if exists public.update_video(uuid, text, text, text, text[]);
drop function if exists public.set_video_thumbnail(uuid, text, text);

-- The dashboard, as one JSON object:
--   channel  {id, handle, name, avatar_url, subscribers}, or null
--   totals   {views, videos, public_videos, likes, comments, watch_s}
--   recent   {days: 28, views, watch_s} from video_stats_daily
--   latest   the newest video that is not in the trash, or null:
--            {id, title, visibility, status, thumbnail_url, thumbnail_name,
--             hls_key, created_at, published_at, views, likes, comments, watch_s}
--   trash    how many videos are in the trash
create function public.studio_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.studio_caller();
  ch public.channels;
  out jsonb;
begin
  select * into ch from public.channels c where c.owner_id = me;
  select jsonb_build_object(
    'channel', case when ch.id is null then null else jsonb_build_object(
      'id', ch.id, 'handle', ch.handle, 'name', coalesce(nullif(ch.name, ''), ch.handle),
      'avatar_url', ch.avatar_url, 'subscribers', ch.subscriber_count
    ) end,
    'totals', (
      select jsonb_build_object(
        'views', coalesce(sum(v.views), 0),
        'videos', count(*),
        'public_videos', count(*) filter (where v.visibility = 'public' and v.status = 'ready'),
        'likes', coalesce(sum(v.like_count), 0),
        'comments', coalesce(sum(v.comment_count), 0),
        'watch_s', coalesce((
          select sum(e.watched_s) from public.view_events e
          join public.videos w on w.id = e.video_id
          where w.owner_id = me and w.deleted_at is null
        ), 0)
      )
      from public.videos v
      where v.owner_id = me and v.deleted_at is null
    ),
    'recent', (
      select jsonb_build_object('days', 28, 'views', coalesce(sum(s.views), 0), 'watch_s', coalesce(sum(s.watch_s), 0))
      from public.video_stats_daily s
      join public.videos v on v.id = s.video_id
      where v.owner_id = me and v.deleted_at is null
        and s.day > (now() at time zone 'utc')::date - 28
    ),
    'latest', (
      select jsonb_build_object(
        'id', v.id, 'title', v.title, 'visibility', v.visibility, 'status', v.status,
        'thumbnail_url', v.thumbnail_url, 'thumbnail_name', v.thumbnail_name, 'hls_key', v.hls_key,
        'created_at', v.created_at, 'published_at', v.published_at,
        'views', v.views, 'likes', v.like_count, 'comments', v.comment_count,
        'watch_s', coalesce((select sum(e.watched_s) from public.view_events e where e.video_id = v.id), 0)
      )
      from public.videos v
      where v.owner_id = me and v.deleted_at is null
      order by v.created_at desc, v.id desc
      limit 1
    ),
    'trash', (select count(*) from public.videos v where v.owner_id = me and v.deleted_at is not null)
  ) into out;
  return out;
end;
$$;

-- The caller's videos, newest first: the Content list, or with trash = true
-- the trash, with the moment each one goes for good. At most 500.
create function public.studio_videos(trash boolean default false)
returns table (
  id uuid,
  title text,
  description text,
  visibility text,
  status text,
  is_short boolean,
  short_choice boolean,
  duration_s numeric,
  thumbnail_url text,
  thumbnail_name text,
  hls_key text,
  tags text[],
  comments_mode text,
  created_at timestamptz,
  published_at timestamptz,
  views bigint,
  like_count bigint,
  comment_count bigint,
  deleted_at timestamptz,
  trash_visibility text,
  purge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.studio_caller();
begin
  return query
  select
    v.id, v.title, v.description, v.visibility, v.status, v.is_short, v.short_choice, v.duration_s,
    v.thumbnail_url, v.thumbnail_name, v.hls_key, v.tags, v.comments_mode, v.created_at, v.published_at,
    v.views::bigint, v.like_count::bigint, v.comment_count::bigint, v.deleted_at, v.trash_visibility,
    v.deleted_at + make_interval(days => public.studio_trash_days())
  from public.videos v
  where v.owner_id = me
    and (v.deleted_at is not null) = coalesce(studio_videos.trash, false)
  order by coalesce(v.deleted_at, v.created_at) desc, v.id desc
  limit 500;
end;
$$;

-- Bulk changes on the caller's own videos. Answers how many changed.
create function public.studio_bulk(video_ids uuid[], action text, visibility text default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.studio_caller();
  ids uuid[];
  found_n int;
  changed int := 0;
begin
  if studio_bulk.action is null or studio_bulk.action not in ('visibility', 'trash', 'restore') then
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
  if studio_bulk.action = 'visibility'
     and (studio_bulk.visibility is null or studio_bulk.visibility not in ('private', 'unlisted', 'public')) then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(studio_bulk.video_ids, '{}')) as u(x) where x is not null;
  if cardinality(ids) = 0 then
    return 0;
  end if;
  if cardinality(ids) > 100 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  perform public.studio_throttle(me, 'bulk');

  -- Lock the rows, and refuse the whole call unless every one is the caller's.
  perform 1 from public.videos v where v.id = any (ids) order by v.id for update;
  select count(*) into found_n from public.videos v where v.id = any (ids) and v.owner_id = me;
  if found_n <> cardinality(ids) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if studio_bulk.action = 'visibility' then
    if exists (select 1 from public.videos v where v.id = any (ids) and v.deleted_at is not null) then
      raise exception 'in_trash' using errcode = 'P0001';
    end if;
    update public.videos v set visibility = studio_bulk.visibility
     where v.id = any (ids) and v.visibility <> studio_bulk.visibility;
    get diagnostics changed = row_count;
  elsif studio_bulk.action = 'trash' then
    update public.videos v
       set deleted_at = now(), trash_visibility = v.visibility, visibility = 'private'
     where v.id = any (ids) and v.deleted_at is null;
    get diagnostics changed = row_count;
  else
    update public.videos v
       set deleted_at = null, visibility = coalesce(v.trash_visibility, 'private'), trash_visibility = null
     where v.id = any (ids) and v.deleted_at is not null;
    get diagnostics changed = row_count;
  end if;
  return changed;
end;
$$;

-- The edit page. tags are cleaned by the app; anything the check would
-- refuse is tags_invalid here.
create function public.update_video(
  video_id uuid,
  title text,
  description text,
  visibility text,
  tags text[] default '{}'
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.studio_caller();
  v public.videos;
  clean_title text := btrim(coalesce(update_video.title, ''));
  clean_tags text[] := coalesce(update_video.tags, '{}');
begin
  select * into v from public.videos x where x.id = update_video.video_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.owner_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if char_length(coalesce(update_video.description, '')) > 5000 then
    raise exception 'description_invalid' using errcode = 'P0001';
  end if;
  if update_video.visibility is null or update_video.visibility not in ('private', 'unlisted', 'public') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  if not public.video_tags_are_valid(clean_tags) then
    raise exception 'tags_invalid' using errcode = 'P0001';
  end if;
  perform public.studio_throttle(me, 'edit');
  update public.videos x
     set title = clean_title,
         description = coalesce(update_video.description, ''),
         visibility = update_video.visibility,
         tags = clean_tags
   where x.id = v.id;
end;
$$;

-- Picks the thumbnail. name null goes back to the default still.
create function public.set_video_thumbnail(video_id uuid, name text, url text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.studio_caller();
  v public.videos;
begin
  select * into v from public.videos x where x.id = set_video_thumbnail.video_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.owner_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v.deleted_at is not null then
    raise exception 'in_trash' using errcode = 'P0001';
  end if;
  if v.status <> 'ready' or v.hls_key is null then
    raise exception 'not_ready' using errcode = 'P0001';
  end if;
  if (set_video_thumbnail.name is not null and not public.video_thumbnail_name_is_valid(set_video_thumbnail.name))
     or (set_video_thumbnail.url is not null and (
       set_video_thumbnail.url !~ '^https://'
       or right(set_video_thumbnail.url, char_length(coalesce(set_video_thumbnail.name, 'thumb-1.webp')) + 1) <> '/' || coalesce(set_video_thumbnail.name, 'thumb-1.webp')
     )) then
    raise exception 'thumbnail_invalid' using errcode = 'P0001';
  end if;
  perform public.studio_throttle(me, 'edit');
  update public.videos x
     set thumbnail_name = set_video_thumbnail.name,
         thumbnail_url = set_video_thumbnail.url
   where x.id = v.id;
end;
$$;

-- The purge and the cleanup queue ------------------------------------------------------------

-- Deletes videos that have been in the trash for 30 days and queues their R2
-- folders. Also forgets cleanup rows that finished a month ago. Answers how
-- many videos went. pg_cron (or the service role) only.
create or replace function public.purge_trash(lim int default 500)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gone int := 0;
begin
  with old as (
    select v.id, v.owner_id
    from public.videos v
    where v.deleted_at is not null
      and v.deleted_at < now() - make_interval(days => public.studio_trash_days())
    order by v.deleted_at
    limit least(greatest(coalesce(purge_trash.lim, 500), 1), 5000)
    for update skip locked
  ),
  queued as (
    insert into public.storage_cleanup (video_id, prefix)
    select o.id, p.prefix
    from old o
    cross join lateral (values
      ('hls/' || o.id::text || '/'),
      ('uploads/' || o.owner_id::text || '/' || o.id::text || '/')
    ) as p(prefix)
    on conflict on constraint storage_cleanup_once do update
      set status = 'queued', attempts = 0, error = null, queued_at = now()
    returning 1
  ),
  deleted as (
    delete from public.videos v using old o where v.id = o.id
    returning 1
  )
  -- Every part of the statement runs, so the folders are queued as the rows go.
  select count(*) into gone from deleted;

  delete from public.storage_cleanup c where c.status = 'done' and c.finished_at < now() - interval '30 days';
  return gone;
end;
$$;

-- The next folders for the worker. Queued and failed rows (under 5 tries),
-- and running rows left behind for 15 minutes.
create or replace function public.claim_cleanup(worker text, lim int default 20)
returns table (id uuid, prefix text, attempt int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select c.id
    from public.storage_cleanup c
    where (c.status in ('queued', 'failed') and c.attempts < 5)
       or (c.status = 'running' and c.started_at < now() - interval '15 minutes')
    order by c.queued_at, c.id
    limit least(greatest(coalesce(claim_cleanup.lim, 20), 1), 100)
    for update skip locked
  )
  update public.storage_cleanup c
     set status = 'running', attempts = c.attempts + 1, worker = left(claim_cleanup.worker, 100),
         started_at = now(), error = null
    from picked p
   where c.id = p.id
  returning c.id, c.prefix, c.attempts;
end;
$$;

create or replace function public.cleanup_done(cleanup_id uuid, deleted int default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'done', finished_at = now(), error = null, deleted_objects = cleanup_done.deleted
   where c.id = cleanup_done.cleanup_id;
$$;

create or replace function public.cleanup_failed(cleanup_id uuid, error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_cleanup c
     set status = 'failed', finished_at = now(), error = left(coalesce(cleanup_failed.error, ''), 500)
   where c.id = cleanup_failed.cleanup_id;
$$;

-- Every day at 03:17 UTC with pg_cron when it is on.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule with an existing job name updates that job.
    execute $cron$select cron.schedule('sloptube-trash-purge', '17 3 * * *', 'select public.purge_trash()')$cron$;
  else
    raise notice 'pg_cron is not on: the trash is not emptied after 30 days. Switch it on under Database > Extensions and run this file again.';
  end if;
end;
$$;

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.studio_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.studio_throttle(uuid, text) from public, anon, authenticated;
revoke execute on function public.studio_caller() from public, anon, authenticated;
revoke execute on function public.videos_trash_guard() from public, anon, authenticated;
revoke execute on function public.purge_trash(int) from public, anon, authenticated;
revoke execute on function public.claim_cleanup(text, int) from public, anon, authenticated;
revoke execute on function public.cleanup_done(uuid, int) from public, anon, authenticated;
revoke execute on function public.cleanup_failed(uuid, text) from public, anon, authenticated;

revoke execute on function public.studio_overview() from public;
revoke execute on function public.studio_videos(boolean) from public;
revoke execute on function public.studio_bulk(uuid[], text, text) from public;
revoke execute on function public.update_video(uuid, text, text, text, text[]) from public;
revoke execute on function public.set_video_thumbnail(uuid, text, text) from public;

grant execute on function public.studio_overview() to authenticated;
grant execute on function public.studio_videos(boolean) to authenticated;
grant execute on function public.studio_bulk(uuid[], text, text) to authenticated;
grant execute on function public.update_video(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.set_video_thumbnail(uuid, text, text) to authenticated;

grant execute on function public.purge_trash(int) to service_role;
grant execute on function public.claim_cleanup(text, int) to service_role;
grant execute on function public.cleanup_done(uuid, int) to service_role;
grant execute on function public.cleanup_failed(uuid, text) to service_role;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'studio',
  'Creator studio',
  'The creator studio at /studio: the dashboard, Content with the trash and bulk changes, the edit page, customization and comments under one left nav.',
  'off'
)
on conflict (key) do nothing;
