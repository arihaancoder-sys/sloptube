-- 012_comments.sql
-- Comments on videos: threads one level deep, likes, the creator's pin and
-- heart, soft delete, rate limits, the comments mode per video and per
-- channel, the comments flag.
--
-- Tables
-- - public.comments: one row per comment. parent_id is null for a top level
--   comment, else the top level comment it answers (replies to a reply are
--   attached to the same top level comment, like YouTube). body is 1 to 2000
--   characters. like_count and reply_count are kept by triggers.
--   pinned (one per video, top level only) and hearted are set by the video's
--   owner. Deleting sets deleted_at and empties the body but keeps the row,
--   so the replies under it keep their place ("This comment was deleted").
-- - public.comment_likes: (user, comment). People read only their own rows.
-- - videos.comment_count: comments that are not deleted, replies included.
-- - videos.comments_mode: 'on', 'off' or 'held' (held for review arrives
--   with moderation, feature 14), or null to follow the channel.
--   channels.comments_default is the channel's mode for new videos.
--
-- Reading
-- - Anyone may read comments that are not deleted on public and unlisted
--   ready videos (row level security). The page uses the functions below,
--   which add the author's handle, name and picture and the viewer's like.
-- - list_comments(video_id, sort, cursor, lim): top level comments. sort is
--   'top' (likes, then newest) or 'newest'. cursor is null for the first
--   page, else {"likes", "at", "id"} of the last comment shown (lib/comments
--   /cursor.ts makes it). The pinned comment comes first on the first page
--   and is left out of the rest. Deleted comments only show while they
--   still have replies.
-- - list_replies(parent_id, cursor, lim): replies, oldest first; cursor is
--   {"at", "id"} of the last reply shown.
-- - comments_since(video_id, cursor, lim): top level comments newer than
--   {"at", "id"}, for the "new comments" pill (the page polls it).
-- - comments_info(video_id): the count, the mode and whether the caller
--   owns the video.
-- - studio_comments(lim): the latest comments on the caller's videos.
--
-- Writing, only through these functions
-- - post_comment(video_id, body, parent_id): signed in and finished sign up.
--   10 comments a minute and 100 a day per person; accounts less than a day
--   old 3 a minute. Mode 'off' stops everybody, 'held' everybody but the
--   owner, until moderation arrives.
-- - edit_comment(comment_id, body): the author.
-- - delete_comment(comment_id): the author or the video's owner.
-- - like_comment(comment_id, on): on true or false sets it, null toggles.
-- - pin_comment(comment_id, on), heart_comment(comment_id, on): the video's
--   owner. Pinning one unpins the one before.
-- - set_comments_mode(video_id, mode), set_channel_comments_default(mode).
-- - Likes, edits, deletes, pins and hearts: 60 a minute per person.
-- - Errors: comments_off, comments_disabled, comments_held, not_signed_in,
--   not_onboarded, not_found, not_allowed, bad_body, body_too_long,
--   bad_parent, bad_sort, bad_mode, rate_limited_minute, rate_limited_day,
--   rate_limited_new, rate_limited.
--
-- The "comments" feature flag, off until the owner switches it on.
--
-- Keep the numbers in step with lib/comments/rules.ts.
--
-- Run after 011_engagement.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.comments_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'comments'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Line endings to \n, no blank runs longer than one empty line, no space at
-- the ends. Same as cleanBody() in lib/comments/rules.ts.
create or replace function public.comment_clean_body(body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(replace(coalesce(body, ''), E'\r\n', E'\n'), E'\n{3,}', E'\n\n', 'g'),
    E' \t\n\r'
  );
$$;

-- Columns ------------------------------------------------------------------------------

alter table public.videos add column if not exists comment_count bigint not null default 0;
alter table public.videos drop constraint if exists videos_comment_count_positive;
alter table public.videos add constraint videos_comment_count_positive check (comment_count >= 0);

alter table public.videos add column if not exists comments_mode text;
alter table public.videos drop constraint if exists videos_comments_mode_valid;
alter table public.videos add constraint videos_comments_mode_valid
  check (comments_mode is null or comments_mode in ('on', 'off', 'held'));

alter table public.channels add column if not exists comments_default text not null default 'on';
alter table public.channels drop constraint if exists channels_comments_default_valid;
alter table public.channels add constraint channels_comments_default_valid
  check (comments_default in ('on', 'off', 'held'));

-- 004 grants channel columns one by one; the default is public, like the rest.
grant select (comments_default) on public.channels to anon, authenticated;

-- Tables --------------------------------------------------------------------------------

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null,
  like_count bigint not null default 0,
  reply_count int not null default 0,
  pinned boolean not null default false,
  hearted boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint comments_body_length check (
    char_length(body) <= 2000 and (deleted_at is not null or char_length(body) >= 1)
  ),
  constraint comments_counts_positive check (like_count >= 0 and reply_count >= 0),
  constraint comments_pin_top_level check (not pinned or parent_id is null)
);

-- Top level pages: newest, and top (likes, then newest).
create index if not exists comments_video_new_idx
  on public.comments (video_id, created_at desc, id desc) where parent_id is null;
create index if not exists comments_video_top_idx
  on public.comments (video_id, like_count desc, created_at desc, id desc) where parent_id is null;
create index if not exists comments_replies_idx on public.comments (parent_id, created_at, id) where parent_id is not null;
create index if not exists comments_author_idx on public.comments (author_id, created_at desc);
-- One pinned comment per video.
create unique index if not exists comments_one_pinned_key on public.comments (video_id) where pinned;

alter table public.comments enable row level security;

drop policy if exists "comments on watchable videos are readable by everyone" on public.comments;
create policy "comments on watchable videos are readable by everyone"
  on public.comments
  for select
  to anon, authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.videos v
      where v.id = comments.video_id and v.status = 'ready' and v.visibility in ('public', 'unlisted')
    )
  );

revoke all on public.comments from anon, authenticated;
grant select on public.comments to anon, authenticated;

create table if not exists public.comment_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  comment_id uuid not null references public.comments (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, comment_id)
);

create index if not exists comment_likes_comment_idx on public.comment_likes (comment_id);

alter table public.comment_likes enable row level security;

drop policy if exists "people read their own comment likes" on public.comment_likes;
create policy "people read their own comment likes"
  on public.comment_likes
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.comment_likes from anon, authenticated;
grant select on public.comment_likes to authenticated;

-- One row per counted call, for the rate limits. Nobody reads it through the API.
create table if not exists public.comment_requests (
  user_id uuid not null references public.profiles (id) on delete cascade,
  bucket text not null,
  at timestamptz not null default now()
);

create index if not exists comment_requests_recent_idx on public.comment_requests (user_id, bucket, at desc);

alter table public.comment_requests enable row level security;
revoke all on public.comment_requests from anon, authenticated;

-- Counters --------------------------------------------------------------------------------

-- videos.comment_count and the parent's reply_count count comments that are
-- not deleted. A comment counts while deleted_at is null.
create or replace function public.comments_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was int := case when tg_op <> 'INSERT' and old.deleted_at is null then 1 else 0 end;
  now_alive int := case when tg_op <> 'DELETE' and new.deleted_at is null then 1 else 0 end;
  vid uuid := case when tg_op = 'DELETE' then old.video_id else new.video_id end;
  parent uuid := case when tg_op = 'DELETE' then old.parent_id else new.parent_id end;
begin
  if now_alive = was then
    return null;
  end if;
  update public.videos v set comment_count = greatest(v.comment_count + now_alive - was, 0) where v.id = vid;
  if parent is not null then
    update public.comments c set reply_count = greatest(c.reply_count + now_alive - was, 0) where c.id = parent;
  end if;
  return null;
end;
$$;

drop trigger if exists comments_count on public.comments;
create trigger comments_count
  after insert or update of deleted_at or delete on public.comments
  for each row execute function public.comments_count();

create or replace function public.comment_likes_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments c set like_count = c.like_count + 1 where c.id = new.comment_id;
  else
    update public.comments c set like_count = greatest(c.like_count - 1, 0) where c.id = old.comment_id;
  end if;
  return null;
end;
$$;

drop trigger if exists comment_likes_count on public.comment_likes;
create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.comment_likes_count();

-- Recount, so the counts are right whatever happened before this run.
update public.comments c
   set like_count = coalesce((select count(*) from public.comment_likes l where l.comment_id = c.id), 0)
 where c.like_count is distinct from coalesce((select count(*) from public.comment_likes l where l.comment_id = c.id), 0);

update public.comments c
   set reply_count = coalesce((select count(*) from public.comments r where r.parent_id = c.id and r.deleted_at is null), 0)
 where c.reply_count is distinct from coalesce((
     select count(*) from public.comments r where r.parent_id = c.id and r.deleted_at is null
   ), 0);

update public.videos v
   set comment_count = coalesce((select count(*) from public.comments c where c.video_id = v.id and c.deleted_at is null), 0)
 where v.comment_count is distinct from coalesce((
     select count(*) from public.comments c where c.video_id = v.id and c.deleted_at is null
   ), 0);

-- What the page shows of a comment ---------------------------------------------------------

-- Only the functions below read this (security definer). Deleted comments
-- have no body and no author. liked and mine are for the caller.
create or replace view public.comment_cards
with (security_invoker = true)
as
select
  c.id,
  c.video_id,
  c.parent_id,
  case when c.deleted_at is null then c.body end as body,
  c.like_count,
  c.reply_count,
  c.pinned,
  c.hearted and c.deleted_at is null as hearted,
  c.created_at,
  c.edited_at,
  c.deleted_at is not null as deleted,
  case when c.deleted_at is null then coalesce(ch.handle, p.username) end as author_handle,
  case when c.deleted_at is null then coalesce(nullif(ch.name, ''), nullif(p.display_name, ''), p.username) end as author_name,
  case when c.deleted_at is null then coalesce(ch.avatar_url, p.avatar_url) end as author_avatar_url,
  c.author_id = v.owner_id and c.deleted_at is null as by_owner,
  c.author_id = (select auth.uid()) as mine,
  exists (
    select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = (select auth.uid())
  ) as liked
from public.comments c
join public.videos v on v.id = c.video_id
join public.profiles p on p.id = c.author_id
left join public.channels ch on ch.owner_id = c.author_id;

revoke all on public.comment_cards from public, anon, authenticated;

-- Helpers ---------------------------------------------------------------------------------

-- The video's comments mode: its own, else its channel's, else 'on'.
create or replace function public.video_comments_mode(video_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(v.comments_mode, c.comments_default, 'on')
  from public.videos v
  left join public.channels c on c.id = v.channel_id
  where v.id = video_comments_mode.video_id;
$$;

-- May the caller see this video's comments? Ready, and public, unlisted or theirs.
create or replace function public.comments_video_visible(video_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.videos v
    where v.id = comments_video_visible.video_id
      and v.status = 'ready'
      and (v.visibility in ('public', 'unlisted') or v.owner_id = uid)
  );
$$;

-- Counts one call and raises past the limit. Locks per person, so the count
-- cannot be raced. 'post': 10 a minute (3 for accounts under a day old) and
-- 100 a day. 'act': 60 a minute.
create or replace function public.comment_throttle(who uuid, bucket text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  last_minute int;
  last_day int;
  young boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('comments:' || bucket || ':' || who::text, 0));
  -- Keep a day of rows for this person; now and then sweep everybody's.
  delete from public.comment_requests r
   where r.user_id = who and r.bucket = comment_throttle.bucket and r.at < now() - interval '1 day';
  if random() < 0.01 then
    delete from public.comment_requests r where r.at < now() - interval '1 day';
  end if;

  select
    count(*) filter (where r.at >= now() - interval '1 minute'),
    count(*)
  into last_minute, last_day
  from public.comment_requests r
  where r.user_id = who and r.bucket = comment_throttle.bucket;

  if bucket = 'post' then
    select p.created_at > now() - interval '1 day' into young from public.profiles p where p.id = who;
    if coalesce(young, false) and last_minute >= 3 then
      raise exception 'rate_limited_new' using errcode = 'P0001';
    end if;
    if last_minute >= 10 then
      raise exception 'rate_limited_minute' using errcode = 'P0001';
    end if;
    if last_day >= 100 then
      raise exception 'rate_limited_day' using errcode = 'P0001';
    end if;
  elsif last_minute >= 60 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.comment_requests (user_id, bucket) values (who, comment_throttle.bucket);
end;
$$;

-- The checks every write starts with: signed in and the flag on. Answers the caller.
create or replace function public.comments_writer()
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
  if not public.comments_flag_on(me) then
    raise exception 'comments_off' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- RPCs ---------------------------------------------------------------------------------

-- The return type is part of the signature, so drop older shapes first.
drop function if exists public.comments_info(uuid);
drop function if exists public.list_comments(uuid, text, jsonb, int);
drop function if exists public.list_replies(uuid, jsonb, int);
drop function if exists public.comments_since(uuid, jsonb, int);
drop function if exists public.post_comment(uuid, text, uuid);
drop function if exists public.edit_comment(uuid, text);
drop function if exists public.delete_comment(uuid);
drop function if exists public.like_comment(uuid, boolean);
drop function if exists public.pin_comment(uuid, boolean);
drop function if exists public.heart_comment(uuid, boolean);
drop function if exists public.set_comments_mode(uuid, text);
drop function if exists public.set_channel_comments_default(text);
drop function if exists public.studio_comments(int);

-- The header of the comments section. No row when the caller may not see the video.
create function public.comments_info(video_id uuid)
returns table (comment_count bigint, mode text, is_owner boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    v.comment_count,
    public.video_comments_mode(v.id),
    coalesce(v.owner_id = (select auth.uid()), false)
  from public.videos v
  where v.id = comments_info.video_id
    and public.comments_flag_on((select auth.uid()))
    and public.comments_video_visible(v.id, (select auth.uid()));
$$;

create function public.list_comments(
  video_id uuid,
  sort text default 'top',
  cursor jsonb default null,
  lim int default 20
)
returns setof public.comment_cards
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n int := least(greatest(coalesce(lim, 20), 1), 50);
  c_likes bigint := (list_comments.cursor ->> 'likes')::bigint;
  c_at timestamptz := (list_comments.cursor ->> 'at')::timestamptz;
  c_id uuid := (list_comments.cursor ->> 'id')::uuid;
begin
  if list_comments.sort is null or list_comments.sort not in ('top', 'newest') then
    raise exception 'bad_sort' using errcode = 'P0001';
  end if;
  if not public.comments_flag_on(me)
     or not public.comments_video_visible(list_comments.video_id, me)
     or public.video_comments_mode(list_comments.video_id) = 'off' then
    return;
  end if;

  -- The pinned comment leads the first page, in both sorts.
  if list_comments.cursor is null then
    return query
    select k.* from public.comment_cards k
    where k.video_id = list_comments.video_id and k.parent_id is null and k.pinned and not k.deleted;
  end if;

  if list_comments.sort = 'newest' then
    return query
    select k.* from public.comment_cards k
    where k.video_id = list_comments.video_id
      and k.parent_id is null
      and not k.pinned
      and (not k.deleted or k.reply_count > 0)
      and (c_at is null or (k.created_at, k.id) < (c_at, coalesce(c_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by k.created_at desc, k.id desc
    limit n;
  else
    return query
    select k.* from public.comment_cards k
    where k.video_id = list_comments.video_id
      and k.parent_id is null
      and not k.pinned
      and (not k.deleted or k.reply_count > 0)
      and (
        c_at is null
        or (k.like_count, k.created_at, k.id)
           < (coalesce(c_likes, 0), c_at, coalesce(c_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
      )
    order by k.like_count desc, k.created_at desc, k.id desc
    limit n;
  end if;
end;
$$;

create function public.list_replies(parent_id uuid, cursor jsonb default null, lim int default 10)
returns setof public.comment_cards
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n int := least(greatest(coalesce(lim, 10), 1), 50);
  c_at timestamptz := (list_replies.cursor ->> 'at')::timestamptz;
  c_id uuid := (list_replies.cursor ->> 'id')::uuid;
  vid uuid;
begin
  select c.video_id into vid from public.comments c where c.id = list_replies.parent_id and c.parent_id is null;
  if vid is null
     or not public.comments_flag_on(me)
     or not public.comments_video_visible(vid, me)
     or public.video_comments_mode(vid) = 'off' then
    return;
  end if;
  return query
  select k.* from public.comment_cards k
  where k.parent_id = list_replies.parent_id
    and not k.deleted
    and (c_at is null or (k.created_at, k.id) > (c_at, coalesce(c_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by k.created_at, k.id
  limit n;
end;
$$;

-- Top level comments newer than the newest one the page has, newest first.
create function public.comments_since(video_id uuid, cursor jsonb, lim int default 50)
returns setof public.comment_cards
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  n int := least(greatest(coalesce(lim, 50), 1), 100);
  c_at timestamptz := (comments_since.cursor ->> 'at')::timestamptz;
  c_id uuid := (comments_since.cursor ->> 'id')::uuid;
begin
  if not public.comments_flag_on(me)
     or not public.comments_video_visible(comments_since.video_id, me)
     or public.video_comments_mode(comments_since.video_id) = 'off' then
    return;
  end if;
  return query
  select k.* from public.comment_cards k
  where k.video_id = comments_since.video_id
    and k.parent_id is null
    and not k.deleted
    and (c_at is null or (k.created_at, k.id) > (c_at, coalesce(c_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by k.created_at desc, k.id desc
  limit n;
end;
$$;

create function public.post_comment(video_id uuid, body text, parent_id uuid default null)
returns setof public.comment_cards
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  v public.videos;
  mode text;
  text_in text := public.comment_clean_body(post_comment.body);
  parent public.comments;
  top uuid;
  new_id uuid;
begin
  if not coalesce((select p.onboarded from public.profiles p where p.id = me), false) then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = post_comment.video_id;
  if not found or not public.comments_video_visible(v.id, me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  mode := public.video_comments_mode(v.id);
  if mode = 'off' then
    raise exception 'comments_disabled' using errcode = 'P0001';
  end if;
  if mode = 'held' and v.owner_id <> me then
    raise exception 'comments_held' using errcode = 'P0001';
  end if;
  if char_length(text_in) = 0 then
    raise exception 'bad_body' using errcode = 'P0001';
  end if;
  if char_length(text_in) > 2000 then
    raise exception 'body_too_long' using errcode = 'P0001';
  end if;
  if post_comment.parent_id is not null then
    select * into parent from public.comments c where c.id = post_comment.parent_id;
    if not found or parent.video_id <> v.id then
      raise exception 'bad_parent' using errcode = 'P0001';
    end if;
    -- A reply to a reply goes under the same top level comment.
    top := coalesce(parent.parent_id, parent.id);
    if exists (select 1 from public.comments c where c.id = top and c.deleted_at is not null and c.reply_count = 0) then
      raise exception 'bad_parent' using errcode = 'P0001';
    end if;
  end if;
  perform public.comment_throttle(me, 'post');

  insert into public.comments (video_id, author_id, parent_id, body)
  values (v.id, me, top, text_in)
  returning id into new_id;

  return query select k.* from public.comment_cards k where k.id = new_id;
end;
$$;

create function public.edit_comment(comment_id uuid, body text)
returns setof public.comment_cards
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  c public.comments;
  text_in text := public.comment_clean_body(edit_comment.body);
begin
  select * into c from public.comments x where x.id = edit_comment.comment_id;
  if not found or c.deleted_at is not null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if c.author_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if char_length(text_in) = 0 then
    raise exception 'bad_body' using errcode = 'P0001';
  end if;
  if char_length(text_in) > 2000 then
    raise exception 'body_too_long' using errcode = 'P0001';
  end if;
  perform public.comment_throttle(me, 'act');
  update public.comments x
     set body = text_in, edited_at = case when x.body = text_in then x.edited_at else now() end
   where x.id = c.id;
  return query select k.* from public.comment_cards k where k.id = c.id;
end;
$$;

-- Soft delete: the row stays for its replies, the body goes.
create function public.delete_comment(comment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  c public.comments;
  owner uuid;
begin
  select * into c from public.comments x where x.id = delete_comment.comment_id;
  if not found or c.deleted_at is not null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select v.owner_id into owner from public.videos v where v.id = c.video_id;
  if c.author_id <> me and owner is distinct from me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  perform public.comment_throttle(me, 'act');
  update public.comments x
     set deleted_at = now(), body = '', pinned = false, hearted = false
   where x.id = c.id;
  return true;
end;
$$;

create function public.like_comment(comment_id uuid, "on" boolean default null)
returns table (liked boolean, like_count bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  c public.comments;
  want boolean;
begin
  select * into c from public.comments x where x.id = like_comment.comment_id;
  if not found or c.deleted_at is not null or not public.comments_video_visible(c.video_id, me) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform public.comment_throttle(me, 'act');
  want := coalesce(
    like_comment."on",
    not exists (select 1 from public.comment_likes l where l.user_id = me and l.comment_id = c.id)
  );
  if want then
    insert into public.comment_likes (user_id, comment_id) values (me, c.id)
    on conflict on constraint comment_likes_pkey do nothing;
  else
    delete from public.comment_likes l where l.user_id = me and l.comment_id = c.id;
  end if;
  return query
  select exists (select 1 from public.comment_likes l where l.user_id = me and l.comment_id = c.id), x.like_count
  from public.comments x where x.id = c.id;
end;
$$;

-- The comment and the video, when the caller owns the video. Else not_allowed.
create or replace function public.comment_for_owner(comment_id uuid, me uuid)
returns public.comments
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.comments;
begin
  select * into c from public.comments x where x.id = comment_for_owner.comment_id;
  if not found or c.deleted_at is not null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.videos v where v.id = c.video_id and v.owner_id = me) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return c;
end;
$$;

create function public.pin_comment(comment_id uuid, "on" boolean default true)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  c public.comments := public.comment_for_owner(pin_comment.comment_id, me);
begin
  if c.parent_id is not null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  perform public.comment_throttle(me, 'act');
  if coalesce(pin_comment."on", true) then
    update public.comments x set pinned = false where x.video_id = c.video_id and x.pinned and x.id <> c.id;
    update public.comments x set pinned = true where x.id = c.id;
  else
    update public.comments x set pinned = false where x.id = c.id;
  end if;
  return coalesce(pin_comment."on", true);
end;
$$;

create function public.heart_comment(comment_id uuid, "on" boolean default true)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
  c public.comments := public.comment_for_owner(heart_comment.comment_id, me);
begin
  perform public.comment_throttle(me, 'act');
  update public.comments x set hearted = coalesce(heart_comment."on", true) where x.id = c.id;
  return coalesce(heart_comment."on", true);
end;
$$;

-- mode null makes the video follow its channel again.
create function public.set_comments_mode(video_id uuid, mode text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
begin
  if mode is not null and mode not in ('on', 'off', 'held') then
    raise exception 'bad_mode' using errcode = 'P0001';
  end if;
  update public.videos v set comments_mode = set_comments_mode.mode
   where v.id = set_comments_mode.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return public.video_comments_mode(set_comments_mode.video_id);
end;
$$;

create function public.set_channel_comments_default(mode text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.comments_writer();
begin
  if mode is null or mode not in ('on', 'off', 'held') then
    raise exception 'bad_mode' using errcode = 'P0001';
  end if;
  update public.channels c set comments_default = set_channel_comments_default.mode where c.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return mode;
end;
$$;

-- /studio/comments: the latest comments on the caller's videos, any author.
create function public.studio_comments(lim int default 50)
returns table (
  id uuid,
  video_id uuid,
  video_title text,
  parent_id uuid,
  body text,
  like_count bigint,
  reply_count int,
  pinned boolean,
  hearted boolean,
  created_at timestamptz,
  edited_at timestamptz,
  author_handle text,
  author_name text,
  author_avatar_url text,
  by_owner boolean,
  channel_default text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    k.id, k.video_id, v.title, k.parent_id, k.body, k.like_count, k.reply_count, k.pinned, k.hearted,
    k.created_at, k.edited_at, k.author_handle, k.author_name, k.author_avatar_url, k.by_owner,
    coalesce((select ch.comments_default from public.channels ch where ch.owner_id = (select auth.uid())), 'on')
  from public.comment_cards k
  join public.videos v on v.id = k.video_id
  where v.owner_id = (select auth.uid())
    and not k.deleted
    and public.comments_flag_on((select auth.uid()))
  order by k.created_at desc, k.id desc
  limit least(greatest(coalesce(studio_comments.lim, 50), 1), 50);
$$;

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.comments_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.comments_count() from public, anon, authenticated;
revoke execute on function public.comment_likes_count() from public, anon, authenticated;
revoke execute on function public.video_comments_mode(uuid) from public, anon, authenticated;
revoke execute on function public.comments_video_visible(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.comment_throttle(uuid, text) from public, anon, authenticated;
revoke execute on function public.comments_writer() from public, anon, authenticated;
revoke execute on function public.comment_for_owner(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.comments_info(uuid) from public;
revoke execute on function public.list_comments(uuid, text, jsonb, int) from public;
revoke execute on function public.list_replies(uuid, jsonb, int) from public;
revoke execute on function public.comments_since(uuid, jsonb, int) from public;
revoke execute on function public.post_comment(uuid, text, uuid) from public;
revoke execute on function public.edit_comment(uuid, text) from public;
revoke execute on function public.delete_comment(uuid) from public;
revoke execute on function public.like_comment(uuid, boolean) from public;
revoke execute on function public.pin_comment(uuid, boolean) from public;
revoke execute on function public.heart_comment(uuid, boolean) from public;
revoke execute on function public.set_comments_mode(uuid, text) from public;
revoke execute on function public.set_channel_comments_default(text) from public;
revoke execute on function public.studio_comments(int) from public;

grant execute on function public.comments_info(uuid) to anon, authenticated;
grant execute on function public.list_comments(uuid, text, jsonb, int) to anon, authenticated;
grant execute on function public.list_replies(uuid, jsonb, int) to anon, authenticated;
grant execute on function public.comments_since(uuid, jsonb, int) to anon, authenticated;
grant execute on function public.post_comment(uuid, text, uuid) to authenticated;
grant execute on function public.edit_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.like_comment(uuid, boolean) to authenticated;
grant execute on function public.pin_comment(uuid, boolean) to authenticated;
grant execute on function public.heart_comment(uuid, boolean) to authenticated;
grant execute on function public.set_comments_mode(uuid, text) to authenticated;
grant execute on function public.set_channel_comments_default(text) to authenticated;
grant execute on function public.studio_comments(int) to authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'comments',
  'Comments',
  'The comments section under the watch page: posting, replies, likes, the creator''s pin and heart, and /studio/comments.',
  'off'
)
on conflict (key) do nothing;
