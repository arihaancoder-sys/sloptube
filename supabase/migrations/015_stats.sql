-- 015_stats.sql
-- Channel and video analytics for the studio: the daily channel rollup,
-- subscribers gained and lost, the audience retention buckets, traffic
-- sources, hourly views for the realtime card, the stats flag.
--
-- What the view ping now carries (watch_ping, 011 and 013)
-- - watch_ping(video_id, position_s, played_s, source) takes one more,
--   optional argument: where the viewer came from, one of 'home', 'search',
--   'subscriptions', 'channel', 'shorts', 'other' (another page here),
--   'direct' and 'external'. Anything else is stored as null. The first
--   ping of the day sets it on the day's view_events row and later pings
--   leave it alone. Rows from before this file have no source; the traffic
--   card only counts rows that have one and is hidden when there are none.
-- - view_events.reached: which parts of the video the viewer saw, as bits.
--   Bits 0 to 19 are the twenty 5% parts of the video (bit k covers k*5% up
--   to (k+1)*5%), bit 20 is "watched to the end". Each ping marks the
--   stretch it covers: from position_s minus the seconds played since the
--   last ping (at most 60) to position_s. The player does not count seeks
--   as played seconds, so a jump marks nothing it skipped. stats_reached()
--   does the marking; lib/stats/retention.ts is the same in TypeScript.
-- - view_events.counted_at: when the view counted, for the hourly views of
--   the realtime card.
-- - The ping carries no country, so there is no country card.
--
-- Rollups (filled by rollup_video_stats(days) from 011, every hour with
-- pg_cron, which now also does the three below)
-- - public.channel_stats_daily: (channel, day) with views and watch_s (the
--   channel's video_stats_daily rows added up) and subs_gained, subs_lost
--   (kept by a trigger on subscriptions as they happen; the rollup leaves
--   them alone). Subscriptions made before this file are counted as gained
--   on the day they were made, once; unsubscribes from before it are not
--   known. Owners read their own rows.
-- - public.video_retention_daily: (video, day) with viewers (view_events
--   rows that have any part marked) and buckets, 21 counts: how many of
--   them saw part k (0 to 19) and the end (20). Owners read their own rows.
-- - public.video_source_daily: (video, day, source) with views and watch_s.
--   Owners read their own rows.
--
-- RPCs (owner only, need the stats flag, 60 a minute per person in the
-- 'stats' bucket of studio_requests from 014; errors are the message, P0001)
-- - studio_analytics(range) the channel: totals for the range (views,
--   watch_s, subs_gained, subs_lost, viewers: distinct viewer keys with a
--   counted view), the daily series, the top 10 videos by views.
-- - video_analytics(video_id, range) one video: totals (views, watch_s,
--   likes, dislikes, comments, viewers), the daily series, the retention
--   buckets and the traffic sources for the range.
-- - realtime_views(video_id) counted views per hour for the last 48 hours,
--   for one video, or with null for the whole channel.
-- - range is '7d', '28d', '90d' or 'lifetime'. A range of n days ends today
--   (UTC) and starts n - 1 days before. Lifetime starts on the day the
--   channel (or the video) was made.
-- - Errors: stats_off, not_signed_in, not_found, not_allowed, rate_limited,
--   bad_range.
--
-- The "stats" feature flag, off until the owner switches it on.
--
-- Keep the numbers in step with lib/stats/rules.ts and lib/stats/retention.ts.
--
-- Run after 014_studio.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.stats_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'stats'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Same as SOURCES in lib/stats/rules.ts.
create or replace function public.stats_source_is_valid(source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select source in ('home', 'search', 'subscriptions', 'channel', 'shorts', 'other', 'direct', 'external')
$$;

-- The first day of a range, today included. Same as rangeBounds().
-- 'lifetime' answers null: the caller starts at the channel or the video.
create or replace function public.stats_range_from(range text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  case range
    when '7d' then return today - 6;
    when '28d' then return today - 27;
    when '90d' then return today - 89;
    when 'lifetime' then return null;
    else raise exception 'bad_range' using errcode = 'P0001';
  end case;
end;
$$;

-- Marks the parts of a video that the stretch from_s to to_s covers. Bits 0
-- to 19 are the twenty 5% parts, bit 20 is the end (the last second, or the
-- last 5% of a video under 20 seconds). Same as markReached().
create or replace function public.stats_reached(mask int, from_s numeric, to_s numeric, duration numeric)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when duration is null or duration <= 0 or from_s is null or to_s is null then coalesce(mask, 0)
    else coalesce(mask, 0)
      | coalesce((
          select bit_or(1 << k)
          from generate_series(
            least(19, floor(greatest(0, least(from_s, to_s)) * 20 / duration)::int),
            least(19, floor(least(greatest(0, greatest(from_s, to_s)), duration) * 20 / duration)::int)
          ) as g(k)
        ), 0)
      | case when greatest(from_s, to_s) >= duration - least(1, duration * 0.05) then 1 << 20 else 0 end
  end
$$;

-- Columns ------------------------------------------------------------------------------

alter table public.view_events add column if not exists reached int not null default 0;
alter table public.view_events add column if not exists source text;
alter table public.view_events add column if not exists counted_at timestamptz;

alter table public.view_events drop constraint if exists view_events_source_valid;
alter table public.view_events add constraint view_events_source_valid
  check (source is null or public.stats_source_is_valid(source));

-- The realtime card reads the last 48 hours of one video or one channel.
create index if not exists view_events_counted_at_idx on public.view_events (video_id, counted_at)
  where counted_at is not null;

-- Tables --------------------------------------------------------------------------------

create table if not exists public.channel_stats_daily (
  channel_id uuid not null references public.channels (id) on delete cascade,
  day date not null,
  views int not null default 0,
  watch_s bigint not null default 0,
  subs_gained int not null default 0,
  subs_lost int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, day)
);

alter table public.channel_stats_daily enable row level security;

drop policy if exists "owners read the stats of their own channel" on public.channel_stats_daily;
create policy "owners read the stats of their own channel"
  on public.channel_stats_daily
  for select
  to authenticated
  using (exists (
    select 1 from public.channels c
    where c.id = channel_stats_daily.channel_id and c.owner_id = (select auth.uid())
  ));

revoke all on public.channel_stats_daily from anon, authenticated;
grant select on public.channel_stats_daily to authenticated;

create table if not exists public.video_retention_daily (
  video_id uuid not null references public.videos (id) on delete cascade,
  day date not null,
  viewers int not null default 0,
  buckets int[] not null default array_fill(0, array[21]),
  updated_at timestamptz not null default now(),
  primary key (video_id, day),
  constraint video_retention_daily_buckets_valid check (cardinality(buckets) = 21)
);

alter table public.video_retention_daily enable row level security;

drop policy if exists "owners read the retention of their own videos" on public.video_retention_daily;
create policy "owners read the retention of their own videos"
  on public.video_retention_daily
  for select
  to authenticated
  using (exists (
    select 1 from public.videos v
    where v.id = video_retention_daily.video_id and v.owner_id = (select auth.uid())
  ));

revoke all on public.video_retention_daily from anon, authenticated;
grant select on public.video_retention_daily to authenticated;

create table if not exists public.video_source_daily (
  video_id uuid not null references public.videos (id) on delete cascade,
  day date not null,
  source text not null,
  views int not null default 0,
  watch_s bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (video_id, day, source),
  constraint video_source_daily_source_valid check (public.stats_source_is_valid(source))
);

alter table public.video_source_daily enable row level security;

drop policy if exists "owners read the traffic sources of their own videos" on public.video_source_daily;
create policy "owners read the traffic sources of their own videos"
  on public.video_source_daily
  for select
  to authenticated
  using (exists (
    select 1 from public.videos v
    where v.id = video_source_daily.video_id and v.owner_id = (select auth.uid())
  ));

revoke all on public.video_source_daily from anon, authenticated;
grant select on public.video_source_daily to authenticated;

-- Subscribers gained and lost ----------------------------------------------------------

create or replace function public.subscriptions_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  if tg_op = 'INSERT' then
    insert into public.channel_stats_daily as s (channel_id, day, subs_gained)
    values (new.channel_id, today, 1)
    on conflict on constraint channel_stats_daily_pkey do update
      set subs_gained = s.subs_gained + 1, updated_at = now();
  elsif tg_op = 'DELETE' then
    -- A channel that is being deleted takes its subscriptions with it: nothing to count.
    if exists (select 1 from public.channels c where c.id = old.channel_id) then
      insert into public.channel_stats_daily as s (channel_id, day, subs_lost)
      values (old.channel_id, today, 1)
      on conflict on constraint channel_stats_daily_pkey do update
        set subs_lost = s.subs_lost + 1, updated_at = now();
    end if;
  end if;
  return null;
end;
$$;

-- The subscriptions there already, as gained on their day. Only rows that
-- are not there yet, so running this file again adds nothing.
insert into public.channel_stats_daily (channel_id, day, subs_gained)
select s.channel_id, (s.created_at at time zone 'utc')::date, count(*)::int
from public.subscriptions s
group by s.channel_id, (s.created_at at time zone 'utc')::date
on conflict on constraint channel_stats_daily_pkey do nothing;

drop trigger if exists subscriptions_stats on public.subscriptions;
create trigger subscriptions_stats
  after insert or delete on public.subscriptions
  for each row execute function public.subscriptions_stats();

-- Helpers ---------------------------------------------------------------------------------

-- Signed in and the flag on. Answers the caller.
create or replace function public.stats_caller()
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
  if not public.stats_flag_on(me) then
    raise exception 'stats_off' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- The view ping --------------------------------------------------------------------------

-- The return type and the arguments are part of the signature: drop the
-- three argument version so old callers reach this one (source defaults to null).
drop function if exists public.watch_ping(uuid, numeric, numeric);

-- watch_ping from 013, plus the source, the parts reached and counted_at.
create or replace function public.watch_ping(video_id uuid, position_s numeric, played_s numeric, source text default null)
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
  src text := case when public.stats_source_is_valid(watch_ping.source) then watch_ping.source end;
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

  insert into public.view_events as e (video_id, viewer_key, day, source)
  values (v.id, who, today, src)
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
  -- The stretch this ping covers, for the retention curve.
  ev.reached := public.stats_reached(
    ev.reached,
    pos - least(greatest(coalesce(watch_ping.played_s, 0), 0), 60),
    pos,
    v.duration_s
  );

  update public.view_events e
     set watched_s = ev.watched_s,
         counted = ev.counted,
         counted_at = case when counted_now then now() else e.counted_at end,
         reached = ev.reached,
         source = coalesce(e.source, src),
         last_at = now()
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

-- The rollup ------------------------------------------------------------------------------

-- rollup_video_stats from 011, plus the channel days, the retention buckets
-- and the traffic sources for the same days. Safe to run as often as you like.
create or replace function public.rollup_video_stats(days int default 2)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  since date := (now() at time zone 'utc')::date - (least(greatest(coalesce(days, 2), 1), 400) - 1);
  touched int;
begin
  insert into public.video_stats_daily as s (video_id, day, views, watch_s, likes, dislikes, updated_at)
  select
    coalesce(e.video_id, r.video_id),
    coalesce(e.day, r.day),
    coalesce(e.views, 0),
    coalesce(e.watch_s, 0),
    coalesce(r.likes, 0),
    coalesce(r.dislikes, 0),
    now()
  from (
    select ve.video_id, ve.day, count(*) filter (where ve.counted)::int as views, sum(ve.watched_s)::bigint as watch_s
    from public.view_events ve
    where ve.day >= since
    group by ve.video_id, ve.day
  ) e
  full outer join (
    select vr.video_id, (vr.created_at at time zone 'utc')::date as day,
           count(*) filter (where vr.kind = 'like')::int as likes,
           count(*) filter (where vr.kind = 'dislike')::int as dislikes
    from public.video_reactions vr
    where vr.created_at >= since::timestamp at time zone 'utc'
    group by vr.video_id, (vr.created_at at time zone 'utc')::date
  ) r on r.video_id = e.video_id and r.day = e.day
  on conflict (video_id, day) do update
    set views = excluded.views,
        watch_s = excluded.watch_s,
        likes = excluded.likes,
        dislikes = excluded.dislikes,
        updated_at = excluded.updated_at;
  get diagnostics touched = row_count;

  -- The channel days: its videos' days added up. Days that lost their rows
  -- (a video deleted for good) go back to 0; the subscriber counts stay.
  insert into public.channel_stats_daily as c (channel_id, day, views, watch_s, updated_at)
  select v.channel_id, s.day, sum(s.views)::int, sum(s.watch_s)::bigint, now()
  from public.video_stats_daily s
  join public.videos v on v.id = s.video_id
  where s.day >= since
  group by v.channel_id, s.day
  on conflict on constraint channel_stats_daily_pkey do update
    set views = excluded.views, watch_s = excluded.watch_s, updated_at = excluded.updated_at;

  update public.channel_stats_daily c
     set views = 0, watch_s = 0, updated_at = now()
   where c.day >= since
     and (c.views <> 0 or c.watch_s <> 0)
     and not exists (
       select 1 from public.video_stats_daily s
       join public.videos v on v.id = s.video_id
       where v.channel_id = c.channel_id and s.day = c.day
     );

  -- Retention: per video and day, the rows with any part marked, and how
  -- many of them marked each of the 21 bits.
  delete from public.video_retention_daily r where r.day >= since;
  insert into public.video_retention_daily (video_id, day, viewers, buckets, updated_at)
  select m.video_id, m.day, max(m.total)::int, array_agg(m.n order by m.k), now()
  from (
    select ve.video_id, ve.day, g.k,
           count(*) filter (where (ve.reached & (1 << g.k)) <> 0)::int as n,
           count(*) as total
    from public.view_events ve
    cross join generate_series(0, 20) as g(k)
    where ve.day >= since and ve.reached <> 0
    group by ve.video_id, ve.day, g.k
  ) m
  group by m.video_id, m.day;

  -- Traffic sources: rows that carry one.
  delete from public.video_source_daily d where d.day >= since;
  insert into public.video_source_daily (video_id, day, source, views, watch_s, updated_at)
  select ve.video_id, ve.day, ve.source, count(*) filter (where ve.counted)::int, sum(ve.watched_s)::bigint, now()
  from public.view_events ve
  where ve.day >= since and ve.source is not null
  group by ve.video_id, ve.day, ve.source;

  return touched;
end;
$$;

-- RPCs ---------------------------------------------------------------------------------

drop function if exists public.studio_analytics(text);
drop function if exists public.video_analytics(uuid, text);
drop function if exists public.realtime_views(uuid);

-- The channel for /studio/analytics, as one JSON object:
--   range, from, to   the range and its first and last day
--   channel           {id, handle, name, subscribers}, or null without a channel
--   totals            {views, watch_s, subs_gained, subs_lost, viewers}
--   daily             [{day, views, watch_s}] days with a row, oldest first
--   top               up to 10 videos by views in the range (not the trash):
--                     [{id, title, status, visibility, is_short, duration_s,
--                       thumbnail_url, thumbnail_name, views, watch_s}]
create function public.studio_analytics(range text default '28d')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.stats_caller();
  since date := public.stats_range_from(studio_analytics.range);
  today date := (now() at time zone 'utc')::date;
  ch public.channels;
  out jsonb;
begin
  perform public.studio_throttle(me, 'stats');
  select * into ch from public.channels c where c.owner_id = me;
  if ch.id is null then
    return jsonb_build_object(
      'range', studio_analytics.range, 'from', coalesce(since, today), 'to', today, 'channel', null,
      'totals', jsonb_build_object('views', 0, 'watch_s', 0, 'subs_gained', 0, 'subs_lost', 0, 'viewers', 0),
      'daily', '[]'::jsonb, 'top', '[]'::jsonb
    );
  end if;
  since := coalesce(since, least((ch.created_at at time zone 'utc')::date, today));

  select jsonb_build_object(
    'range', studio_analytics.range,
    'from', since,
    'to', today,
    'channel', jsonb_build_object(
      'id', ch.id, 'handle', ch.handle, 'name', coalesce(nullif(ch.name, ''), ch.handle), 'subscribers', ch.subscriber_count
    ),
    'totals', (
      select jsonb_build_object(
        'views', coalesce(sum(d.views), 0),
        'watch_s', coalesce(sum(d.watch_s), 0),
        'subs_gained', coalesce(sum(d.subs_gained), 0),
        'subs_lost', coalesce(sum(d.subs_lost), 0),
        'viewers', (
          select count(distinct e.viewer_key)
          from public.view_events e
          join public.videos v on v.id = e.video_id
          where v.channel_id = ch.id and e.counted and e.day >= since
        )
      )
      from public.channel_stats_daily d
      where d.channel_id = ch.id and d.day >= since
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', d.views, 'watch_s', d.watch_s) order by d.day)
      from public.channel_stats_daily d
      where d.channel_id = ch.id and d.day >= since
    ), '[]'::jsonb),
    'top', coalesce((
      select jsonb_agg(t.item order by t.views desc, t.watch_s desc, t.id)
      from (
        select v.id, s.views, s.watch_s, jsonb_build_object(
          'id', v.id, 'title', v.title, 'status', v.status, 'visibility', v.visibility, 'is_short', v.is_short,
          'duration_s', v.duration_s, 'thumbnail_url', v.thumbnail_url, 'thumbnail_name', v.thumbnail_name,
          'views', s.views, 'watch_s', s.watch_s
        ) as item
        from (
          select x.video_id, sum(x.views)::bigint as views, sum(x.watch_s)::bigint as watch_s
          from public.video_stats_daily x
          join public.videos w on w.id = x.video_id
          where w.channel_id = ch.id and x.day >= since
          group by x.video_id
        ) s
        join public.videos v on v.id = s.video_id
        where v.deleted_at is null and s.views > 0
        order by s.views desc, s.watch_s desc, v.id
        limit 10
      ) t
    ), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;

-- One video for /studio/video/<id>/analytics, as one JSON object:
--   range, from, to   as above (lifetime starts on the day the video was made)
--   video             {id, title, status, visibility, is_short, duration_s,
--                      thumbnail_url, thumbnail_name, created_at, published_at,
--                      views, likes, dislikes, comments} (all time)
--   totals            {views, watch_s, likes, dislikes, comments, viewers} in the range
--   daily             [{day, views, watch_s}]
--   retention         {viewers, buckets: 21 counts}
--   sources           [{source, views, watch_s}] most views first
create function public.video_analytics(video_id uuid, range text default '28d')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.stats_caller();
  since date := public.stats_range_from(video_analytics.range);
  today date := (now() at time zone 'utc')::date;
  lifetime boolean := video_analytics.range = 'lifetime';
  v public.videos;
  dislike_total bigint;
  out jsonb;
begin
  select * into v from public.videos x where x.id = video_analytics.video_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.owner_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  perform public.studio_throttle(me, 'stats');
  since := coalesce(since, least((v.created_at at time zone 'utc')::date, today));
  dislike_total := coalesce((select d.dislike_count from public.video_dislike_counts d where d.video_id = v.id), 0);

  select jsonb_build_object(
    'range', video_analytics.range,
    'from', since,
    'to', today,
    'video', jsonb_build_object(
      'id', v.id, 'title', v.title, 'status', v.status, 'visibility', v.visibility, 'is_short', v.is_short,
      'duration_s', v.duration_s, 'thumbnail_url', v.thumbnail_url, 'thumbnail_name', v.thumbnail_name,
      'created_at', v.created_at, 'published_at', v.published_at,
      'views', v.views, 'likes', v.like_count, 'dislikes', dislike_total, 'comments', v.comment_count
    ),
    'totals', (
      select jsonb_build_object(
        'views', coalesce(sum(s.views), 0),
        'watch_s', coalesce(sum(s.watch_s), 0),
        -- All time, the reactions standing now; in a range, the ones made in it that still stand.
        'likes', case when lifetime then v.like_count else coalesce(sum(s.likes), 0) end,
        'dislikes', case when lifetime then dislike_total else coalesce(sum(s.dislikes), 0) end,
        'comments', (
          select count(*) from public.comments c
          where c.video_id = v.id and c.deleted_at is null
            and c.created_at >= since::timestamp at time zone 'utc'
        ),
        'viewers', (
          select count(distinct e.viewer_key) from public.view_events e
          where e.video_id = v.id and e.counted and e.day >= since
        )
      )
      from public.video_stats_daily s
      where s.video_id = v.id and s.day >= since
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', s.day, 'views', s.views, 'watch_s', s.watch_s) order by s.day)
      from public.video_stats_daily s
      where s.video_id = v.id and s.day >= since
    ), '[]'::jsonb),
    'retention', (
      select jsonb_build_object(
        'viewers', coalesce((select sum(r.viewers) from public.video_retention_daily r where r.video_id = v.id and r.day >= since), 0),
        'buckets', (
          select jsonb_agg(coalesce(b.n, 0) order by g.k)
          from generate_series(1, 21) as g(k)
          left join (
            select u.k, sum(u.n)::bigint as n
            from public.video_retention_daily r
            cross join lateral unnest(r.buckets) with ordinality as u(n, k)
            where r.video_id = v.id and r.day >= since
            group by u.k
          ) b on b.k = g.k
        )
      )
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', x.source, 'views', x.views, 'watch_s', x.watch_s)
                       order by x.views desc, x.watch_s desc, x.source)
      from (
        select d.source, sum(d.views)::bigint as views, sum(d.watch_s)::bigint as watch_s
        from public.video_source_daily d
        where d.video_id = v.id and d.day >= since
        group by d.source
      ) x
    ), '[]'::jsonb)
  ) into out;
  return out;
end;
$$;

-- Counted views per hour for the last 48 hours, oldest first, as
-- [{hour, views}] with only the hours that had views. With video_id, one of
-- the caller's videos; with null, every video on the caller's channel.
create function public.realtime_views(video_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.stats_caller();
  v public.videos;
  since timestamptz := date_trunc('hour', now()) - interval '47 hours';
begin
  if realtime_views.video_id is not null then
    select * into v from public.videos x where x.id = realtime_views.video_id;
    if not found then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    if v.owner_id <> me then
      raise exception 'not_allowed' using errcode = 'P0001';
    end if;
  end if;
  perform public.studio_throttle(me, 'stats');
  return coalesce((
    select jsonb_agg(jsonb_build_object('hour', h.hour, 'views', h.views) order by h.hour)
    from (
      select date_trunc('hour', e.counted_at) as hour, count(*)::int as views
      from public.view_events e
      join public.videos w on w.id = e.video_id
      where e.counted_at >= since
        and e.day >= (since at time zone 'utc')::date
        and (case when realtime_views.video_id is null then w.owner_id = me and w.deleted_at is null
                  else w.id = realtime_views.video_id end)
      group by 1
    ) h
  ), '[]'::jsonb);
end;
$$;

-- Fill in every day there is (a year at most), then every hour with the
-- pg_cron job from 011, which runs this same function.
select public.rollup_video_stats(400);

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.stats_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.stats_caller() from public, anon, authenticated;
revoke execute on function public.subscriptions_stats() from public, anon, authenticated;
revoke execute on function public.rollup_video_stats(int) from public, anon, authenticated;

revoke execute on function public.watch_ping(uuid, numeric, numeric, text) from public;
revoke execute on function public.studio_analytics(text) from public;
revoke execute on function public.video_analytics(uuid, text) from public;
revoke execute on function public.realtime_views(uuid) from public;

grant execute on function public.watch_ping(uuid, numeric, numeric, text) to anon, authenticated;
grant execute on function public.studio_analytics(text) to authenticated;
grant execute on function public.video_analytics(uuid, text) to authenticated;
grant execute on function public.realtime_views(uuid) to authenticated;
grant execute on function public.rollup_video_stats(int) to service_role;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'stats',
  'Analytics',
  'Channel analytics at /studio/analytics and per video analytics at /studio/video/<id>/analytics: views, watch time, subscribers, audience retention, traffic sources and the last 48 hours.',
  'off'
)
on conflict (key) do nothing;
