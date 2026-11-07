-- 010_search.sql
-- Search: full text and trigram search over videos and channels, suggestions,
-- a per person (or per address) rate limit, the search flag.
--
-- - pg_trgm in the extensions schema (Supabase's usual place for extensions).
--   If it was installed somewhere else before, it is moved there.
-- - videos.search_doc: a generated tsvector, the title with weight A and the
--   description with weight B, with a GIN index. Trigram indexes on
--   videos.title, channels.name and channels.handle.
-- - search_normalize(q): lower case, punctuation to spaces, spaces collapsed,
--   at most 100 characters. Keep in step with normalizeQuery() in
--   lib/search/query.ts (the app normalizes first; this is the safety net).
-- - search_videos(q, cursor_rank, cursor_id, lim, filters) returns video cards
--   with the same columns as feed_videos plus the description and the sort
--   key, public and ready videos only. A video matches when the full text
--   query (every word, as a prefix) matches, or when the query is close to
--   the title by trigram word similarity. Relevance is
--   ts_rank(search_doc) + word_similarity(q, title).
--   filters (jsonb, every key optional):
--     uploaded  hour | today | week | month | year
--     duration  short (under 4 minutes) | medium (4 to 20) | long (over 20)
--     sort      relevance (default) | date | views
--   Pages by keyset on (sort_key, id): pass the last card's sort_key and id
--   as cursor_rank and cursor_id for the next page. sort_key is the
--   relevance, the publish time in microseconds, or the view count.
-- - search_channels(q, lim): channels by trigram similarity on name and
--   handle (or a name or handle that starts with the query), with
--   subscriber_count and video_count.
-- - search_suggest(q, lim): up to 10 lower case suggestions from public video
--   titles and channel names, prefix matches first, then trigram matches,
--   without repeats.
-- - Rate limit: search_videos and search_channels count 60 calls a minute
--   each, search_suggest 240, per signed in person, or per address for
--   people who are signed out. The address is the x-search-client header the
--   app sends (the visitor's address as the app's reverse proxy saw it), else
--   the first x-forwarded-for entry. Calls are logged in
--   public.search_requests and nobody reads that table through the API.
--   Errors: rate_limited
-- - All three run as the caller, so the row level security from 004 and 005
--   applies, and every query also checks public and ready itself.
-- - The "search" feature flag, off until the owner switches it on.
--
-- Keep the limits in step with lib/search/rules.ts.
--
-- Run after 009_subscriptions.sql. Safe to run more than once.

-- pg_trgm ------------------------------------------------------------------------------

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname <> 'extensions'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;

create extension if not exists pg_trgm with schema extensions;

-- Columns and indexes ---------------------------------------------------------------------

alter table public.videos
  add column if not exists search_doc tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'B')
  ) stored;

create index if not exists videos_search_doc_idx on public.videos using gin (search_doc);
create index if not exists videos_title_trgm_idx on public.videos using gin (title extensions.gin_trgm_ops);
create index if not exists channels_name_trgm_idx on public.channels using gin (name extensions.gin_trgm_ops);
create index if not exists channels_handle_trgm_idx on public.channels using gin (handle extensions.gin_trgm_ops);

-- Settings and helpers ----------------------------------------------------------------------

create or replace function public.search_limit_per_minute(bucket text)
returns int
language sql
immutable
set search_path = ''
as $$ select case bucket when 'suggest' then 240 else 60 end $$;

create or replace function public.search_normalize(q text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(q, '')), '[''’]', '', 'g'),
      '[[:punct:][:space:]]+', ' ', 'g'
    )),
    100
  )
$$;

-- "pancake rec" becomes 'pancake:* & rec:*', so the last word can still be
-- typed. Only letters, digits and spaces reach to_tsquery, so it cannot fail.
create or replace function public.search_tsquery(q text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  select case
    when public.search_normalize(q) = '' then null
    else to_tsquery(
      'english'::regconfig,
      (
        select string_agg(w || ':*', ' & ')
        from unnest(regexp_split_to_array(public.search_normalize(q), ' ')) as w
        where w <> ''
      )
    )
  end
$$;

-- One row per counted call, for the rate limit. Nobody reads it through the API.
create table if not exists public.search_requests (
  key text not null,
  bucket text not null,
  at timestamptz not null default now()
);

create index if not exists search_requests_recent_idx
  on public.search_requests (key, bucket, at desc);

alter table public.search_requests enable row level security;
revoke all on public.search_requests from anon, authenticated;

-- Counts one call for the caller and raises rate_limited past the limit.
-- Locks per key, so the count cannot be raced.
create or replace function public.search_throttle(bucket text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  headers json := nullif(current_setting('request.headers', true), '')::json;
  address text;
  who text;
  recent int;
begin
  if bucket not in ('videos', 'channels', 'suggest') then
    raise exception 'bad_bucket' using errcode = 'P0001';
  end if;
  if me is not null then
    who := 'user:' || me::text;
  else
    address := nullif(btrim(coalesce(
      headers ->> 'x-search-client',
      split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)
    )), '');
    who := 'addr:' || left(coalesce(address, 'unknown'), 64);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('search:' || bucket || ':' || who, 0));
  delete from public.search_requests r
   where r.key = who and r.bucket = search_throttle.bucket and r.at < now() - interval '1 minute';
  -- Now and then, sweep the rows of addresses that never came back.
  if random() < 0.01 then
    delete from public.search_requests r where r.at < now() - interval '1 minute';
  end if;
  select count(*) into recent
    from public.search_requests r
   where r.key = who and r.bucket = search_throttle.bucket;
  if recent >= public.search_limit_per_minute(bucket) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.search_requests (key, bucket) values (who, search_throttle.bucket);
end;
$$;

-- RPCs ---------------------------------------------------------------------------------

-- The return type is part of the signature, so drop older shapes first.
drop function if exists public.search_videos(text, double precision, uuid, int, jsonb);
drop function if exists public.search_channels(text, int);
drop function if exists public.search_suggest(text, int);

create function public.search_videos(
  q text,
  cursor_rank double precision default null,
  cursor_id uuid default null,
  lim int default 20,
  filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  title text,
  description text,
  duration_s numeric,
  thumbnail_url text,
  hls_key text,
  preview_sprite_key text,
  published_at timestamptz,
  views bigint,
  score double precision,
  sort_key double precision,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_avatar_url text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  clean text := public.search_normalize(q);
  tsq tsquery := public.search_tsquery(q);
  f jsonb := coalesce(filters, '{}'::jsonb);
  uploaded text := f ->> 'uploaded';
  duration text := f ->> 'duration';
  sort text := coalesce(f ->> 'sort', 'relevance');
  since timestamptz;
  page int := least(greatest(coalesce(lim, 20), 1), 50);
begin
  if clean = '' then
    return;
  end if;
  perform public.search_throttle('videos');

  since := case uploaded
    when 'hour' then now() - interval '1 hour'
    when 'today' then now() - interval '1 day'
    when 'week' then now() - interval '7 days'
    when 'month' then now() - interval '1 month'
    when 'year' then now() - interval '1 year'
    else null
  end;
  if sort not in ('relevance', 'date', 'views') then
    sort := 'relevance';
  end if;

  return query
  with matches as (
    select
      v.*,
      (
        coalesce(ts_rank(v.search_doc, tsq), 0)
        + extensions.word_similarity(clean, lower(v.title))
      )::double precision as relevance
    from public.videos v
    where v.visibility = 'public'
      and v.status = 'ready'
      and v.published_at is not null
      and (
        (tsq is not null and v.search_doc @@ tsq)
        or clean operator(extensions.<%) v.title
      )
      and (since is null or v.published_at >= since)
      and (
        duration is null
        or (duration = 'short' and v.duration_s < 240)
        or (duration = 'medium' and v.duration_s >= 240 and v.duration_s <= 1200)
        or (duration = 'long' and v.duration_s > 1200)
        or duration not in ('short', 'medium', 'long')
      )
  ),
  keyed as (
    select
      m.*,
      case sort
        when 'date' then floor(extract(epoch from m.published_at) * 1000000)::double precision
        when 'views' then m.views::double precision
        else m.relevance
      end as k
    from matches m
  )
  select
    k.id,
    k.title,
    left(k.description, 500),
    k.duration_s,
    k.thumbnail_url,
    k.hls_key,
    k.preview_sprite_key,
    k.published_at,
    k.views,
    k.relevance,
    k.k,
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    c.avatar_url
  from keyed k
  join public.channels c on c.id = k.channel_id
  where search_videos.cursor_rank is null
     or (k.k, k.id) < (search_videos.cursor_rank, coalesce(search_videos.cursor_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  order by k.k desc, k.id desc
  limit page;
end;
$$;

create function public.search_channels(q text, lim int default 3)
returns table (
  id uuid,
  handle text,
  name text,
  description text,
  avatar_url text,
  subscriber_count int,
  video_count int,
  score double precision
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  clean text := public.search_normalize(q);
  squashed text := replace(public.search_normalize(q), ' ', '');
begin
  if clean = '' then
    return;
  end if;
  perform public.search_throttle('channels');

  return query
  select
    c.id,
    c.handle,
    coalesce(nullif(c.name, ''), c.handle),
    left(c.description, 300),
    c.avatar_url,
    c.subscriber_count,
    c.video_count,
    greatest(
      extensions.word_similarity(clean, lower(c.name)),
      extensions.word_similarity(squashed, lower(c.handle)),
      case when lower(c.name) like clean || '%' or lower(c.handle) like squashed || '%' then 1 else 0 end
    )::double precision as score
  from public.channels c
  where clean operator(extensions.<%) c.name
     or squashed operator(extensions.<%) c.handle
     or lower(c.name) like clean || '%'
     or lower(c.handle) like squashed || '%'
  order by score desc, c.subscriber_count desc, c.id
  limit least(greatest(coalesce(lim, 3), 1), 50);
end;
$$;

create function public.search_suggest(q text, lim int default 10)
returns table (suggestion text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  clean text := public.search_normalize(q);
begin
  if clean = '' then
    return;
  end if;
  perform public.search_throttle('suggest');

  return query
  with candidates as (
    select lower(v.title) as s, extensions.word_similarity(clean, lower(v.title)) as sim, v.views::double precision as pop
    from public.videos v
    where v.visibility = 'public'
      and v.status = 'ready'
      and (lower(v.title) like clean || '%' or clean operator(extensions.<%) v.title)
    union all
    select lower(coalesce(nullif(c.name, ''), c.handle)), extensions.word_similarity(clean, lower(c.name)), c.subscriber_count::double precision
    from public.channels c
    where lower(c.name) like clean || '%' or clean operator(extensions.<%) c.name
  ),
  ranked as (
    select
      btrim(regexp_replace(cd.s, '\s+', ' ', 'g')) as s,
      max(case when cd.s like clean || '%' then 1 else 0 end) as is_prefix,
      max(cd.sim) as sim,
      max(cd.pop) as pop
    from candidates cd
    group by 1
  )
  select r.s
  from ranked r
  where r.s <> ''
  order by r.is_prefix desc, r.sim desc, r.pop desc, r.s
  limit least(greatest(coalesce(lim, 10), 1), 10);
end;
$$;

-- Who may call what ------------------------------------------------------------------------

-- The search functions run as the caller and call the throttle, so callers
-- need it. Calling it directly only uses up the caller's own allowance.
revoke execute on function public.search_throttle(text) from public;
grant execute on function public.search_throttle(text) to anon, authenticated;

revoke execute on function public.search_videos(text, double precision, uuid, int, jsonb) from public;
revoke execute on function public.search_channels(text, int) from public;
revoke execute on function public.search_suggest(text, int) from public;
grant execute on function public.search_videos(text, double precision, uuid, int, jsonb) to anon, authenticated;
grant execute on function public.search_channels(text, int) to anon, authenticated;
grant execute on function public.search_suggest(text, int) to anon, authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'search',
  'Search',
  'The search box with suggestions and recent searches, and /results with filters.',
  'off'
)
on conflict (key) do nothing;
