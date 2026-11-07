-- 016_moderation.sql
-- Moderation: reports, the admin role, the queue and its actions, strikes,
-- suspensions, bans, the mod log, the word list and the link cap, removed
-- videos with appeals, the moderation flag.
--
-- People
-- - profiles.role is 'user' or 'admin'. There is no way to change it through
--   the API (the column is not granted): the owner promotes someone in the
--   SQL editor:
--     update public.profiles set role = 'admin' where username = '<name>';
--   is_admin() answers for the caller (an admin who is not banned) and is
--   used by the RPCs and the row level security policies below.
-- - profiles.banned_at and ban_reason: a banned account. Every API request of
--   a banned person is refused with 'banned' before it runs: PostgREST calls
--   moderation_pre_request() first (pgrst.db_pre_request on the
--   authenticator role, set at the end of this file). The ban also deletes
--   the person's auth sessions, and the app signs them out on their next
--   page (proxy.ts). A ban suspends the person's channel too.
-- - channels.suspended_at and suspended_reason: a suspended channel cannot
--   upload or comment, and its videos are hidden: each one that was not
--   private is made private and its visibility kept in
--   videos.held_visibility, put back on unsuspend. Triggers refuse new
--   videos and comments ('suspended', 'banned') and any change that would
--   make a video of a suspended channel anything but private.
-- - channel_strikes: 3 strikes in 90 days suspend the channel (until an
--   admin unsuspends it). Same as lib/moderation/strikes.ts.
--
-- Reports
-- - reports: one row per report. kind 'report' (anyone signed in, on a
--   video, a comment or a channel, reason spam, sexual, violent,
--   harassment, copyright or other, 'other' needs a few words) or 'appeal'
--   (the owner of a removed video asks for it back). One report per person
--   per target, ever; one open appeal per video, and only one per removal.
--   10 reports a day per person. People read their own reports; admins read
--   them all.
-- - report_target(target_kind, target_id, reason, details) and
--   appeal_removal(video_id, details).
--
-- Admins (is_admin() and the flag on, 120 calls a minute)
-- - admin_reports(lim) the open reports with what they point at; the app
--   groups them by target (lib/moderation/queue.ts).
-- - mod_action(action, target_kind, target_id, reason, kind):
--     dismiss    closes the target's open reports (or turns down an appeal)
--     remove     a video: made private and marked removed (the owner sees
--                why in the studio), kept 30 days and then deleted with its
--                files by purge_trash (014); a comment: soft deleted with
--                the "removed by moderation" placeholder
--     restore    gives a removed video back (an upheld appeal)
--     strike     a strike on the channel behind the target
--     suspend, unsuspend   the channel behind the target
--     ban, unban the person behind the target
--   Admin accounts cannot be struck, suspended or banned. dismiss, remove,
--   restore, strike, suspend and ban close the target's open reports of
--   that kind. Every action writes a mod_log row.
-- - admin_log(before, lim), admin_suspended(), admin_words(),
--   admin_set_word(word, on).
--
-- Automod
-- - moderation_words: words and phrases (lowercase letters and digits,
--   single spaces, ' and -, 2 to 40 characters; a trailing * matches any
--   ending). A comment, a video title or a description that contains one as
--   a whole word is refused with 'blocked_words'. A comment with more than
--   5 links is refused with 'too_many_links'. Both only while the flag is on
--   for the writer. Same as lib/moderation/words.ts.
--
-- Errors (the message, P0001): moderation_off, not_signed_in, not_admin,
-- not_found, not_allowed, bad_kind, bad_reason, details_required,
-- details_too_long, already_reported, rate_limited, bad_action,
-- reason_required, reason_too_long, not_removed, already_appealed,
-- bad_word, banned, suspended, removed, blocked_words, too_many_links.
--
-- The "moderation" feature flag, off until the owner switches it on.
--
-- Keep the numbers in step with lib/moderation/rules.ts.
--
-- Run after 015_stats.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.moderation_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'moderation'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Same as lib/moderation/rules.ts.
create or replace function public.moderation_strike_days() returns int language sql immutable set search_path = '' as $$ select 90 $$;
create or replace function public.moderation_strike_limit() returns int language sql immutable set search_path = '' as $$ select 3 $$;
create or replace function public.moderation_link_limit() returns int language sql immutable set search_path = '' as $$ select 5 $$;
create or replace function public.moderation_reports_per_day() returns int language sql immutable set search_path = '' as $$ select 10 $$;

-- Same as isWord() in lib/moderation/words.ts.
create or replace function public.moderation_word_is_valid(word text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select word is not null
     and char_length(word) between 2 and 40
     and word ~ '^[a-z0-9]+([ ''-][a-z0-9]+)*\*?$'
$$;

-- Columns ------------------------------------------------------------------------------

alter table public.profiles add column if not exists role text not null default 'user';
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles drop constraint if exists profiles_role_valid;
alter table public.profiles add constraint profiles_role_valid check (role in ('user', 'admin'));

alter table public.channels add column if not exists suspended_at timestamptz;
alter table public.channels add column if not exists suspended_reason text;

alter table public.videos add column if not exists removed_at timestamptz;
alter table public.videos add column if not exists removed_reason text;
alter table public.videos add column if not exists removed_visibility text;
alter table public.videos add column if not exists held_visibility text;
alter table public.videos drop constraint if exists videos_moderation_visibility_valid;
alter table public.videos add constraint videos_moderation_visibility_valid check (
  (removed_visibility is null or removed_visibility in ('private', 'unlisted', 'public'))
  and (held_visibility is null or held_visibility in ('private', 'unlisted', 'public'))
);
create index if not exists videos_removed_idx on public.videos (removed_at) where removed_at is not null;

alter table public.comments add column if not exists removed_at timestamptz;

-- Everyone may see that a channel is suspended (the channel page says so),
-- never why. role, banned_at and ban_reason stay unreadable through the API.
grant select (suspended_at) on public.channels to anon, authenticated;

-- Tables --------------------------------------------------------------------------------

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'report',
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  reason text not null,
  details text not null default '',
  status text not null default 'open',
  resolution text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_kind_valid check (kind in ('report', 'appeal')),
  constraint reports_target_kind_valid check (target_kind in ('video', 'comment', 'channel')),
  constraint reports_reason_valid check (
    (kind = 'report' and reason in ('spam', 'sexual', 'violent', 'harassment', 'copyright', 'other'))
    or (kind = 'appeal' and reason = 'appeal' and target_kind = 'video')
  ),
  constraint reports_details_length check (char_length(details) <= 500),
  constraint reports_status_valid check (status in ('open', 'dismissed', 'actioned'))
);

create unique index if not exists reports_once_idx on public.reports (reporter_id, target_kind, target_id) where kind = 'report';
create unique index if not exists reports_open_appeal_idx on public.reports (target_id) where kind = 'appeal' and status = 'open';
create index if not exists reports_open_idx on public.reports (created_at desc) where status = 'open';
create index if not exists reports_target_idx on public.reports (target_kind, target_id, kind);
create index if not exists reports_reporter_recent_idx on public.reports (reporter_id, created_at desc);

create table if not exists public.channel_strikes (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  reason text not null default '',
  target_kind text,
  target_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists channel_strikes_recent_idx on public.channel_strikes (channel_id, created_at desc);

create table if not exists public.mod_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_kind text not null,
  target_id uuid,
  target_label text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists mod_log_recent_idx on public.mod_log (created_at desc, id desc);

create table if not exists public.moderation_words (
  word text primary key,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint moderation_words_valid check (public.moderation_word_is_valid(word))
);

-- One row per counted admin call, for the rate limit. Nobody reads it through the API.
create table if not exists public.moderation_requests (
  user_id uuid not null,
  bucket text not null,
  at timestamptz not null default now()
);

create index if not exists moderation_requests_recent_idx on public.moderation_requests (user_id, bucket, at desc);

-- Who is an admin ------------------------------------------------------------------------

-- The caller is an admin and not banned. Used by the policies below.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.banned_at is null
  );
$$;

-- Row level security ------------------------------------------------------------------------

alter table public.reports enable row level security;
alter table public.channel_strikes enable row level security;
alter table public.mod_log enable row level security;
alter table public.moderation_words enable row level security;
alter table public.moderation_requests enable row level security;

revoke all on public.reports from anon, authenticated;
revoke all on public.channel_strikes from anon, authenticated;
revoke all on public.mod_log from anon, authenticated;
revoke all on public.moderation_words from anon, authenticated;
revoke all on public.moderation_requests from anon, authenticated;

grant select on public.reports to authenticated;
grant select on public.channel_strikes to authenticated;
grant select on public.mod_log to authenticated;
grant select on public.moderation_words to authenticated;

drop policy if exists "people read their own reports" on public.reports;
create policy "people read their own reports"
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

drop policy if exists "admins read every report" on public.reports;
create policy "admins read every report"
  on public.reports for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "owners read their channel strikes" on public.channel_strikes;
create policy "owners read their channel strikes"
  on public.channel_strikes for select to authenticated
  using (exists (select 1 from public.channels c where c.id = channel_id and c.owner_id = (select auth.uid())));

drop policy if exists "admins read every strike" on public.channel_strikes;
create policy "admins read every strike"
  on public.channel_strikes for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins read the mod log" on public.mod_log;
create policy "admins read the mod log"
  on public.mod_log for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins read the word list" on public.moderation_words;
create policy "admins read the word list"
  on public.moderation_words for select to authenticated
  using ((select public.is_admin()));

-- No insert, update or delete policies: only the functions below write.
-- moderation_requests has no policies at all.

-- The removed comment placeholder ---------------------------------------------------------------

-- 012's view with one more column at the end: removed by moderation.
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
  ) as liked,
  c.removed_at is not null as removed
from public.comments c
join public.videos v on v.id = c.video_id
join public.profiles p on p.id = c.author_id
left join public.channels ch on ch.owner_id = c.author_id;

revoke all on public.comment_cards from public, anon, authenticated;

-- Automod helpers ---------------------------------------------------------------------------

-- The first listed word found in the text as a whole word, or null.
-- Same as findBlockedWord() in lib/moderation/words.ts.
create or replace function public.moderation_blocked_word(body text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select w.word
  from public.moderation_words w
  where regexp_replace(lower(coalesce(moderation_blocked_word.body, '')), '\s+', ' ', 'g')
        ~ ('(^|[^a-z0-9])' || rtrim(w.word, '*') || case when w.word like '%*' then '' else '($|[^a-z0-9])' end)
  order by w.word
  limit 1;
$$;

-- Links in a text: http(s):// or www. up to the next space. Same as countLinks().
create or replace function public.moderation_link_count(body text)
returns int
language sql
immutable
set search_path = ''
as $$
  select count(*)::int from regexp_matches(coalesce(moderation_link_count.body, ''), '(https?://\S+|www\.\S+)', 'gi');
$$;

-- Who is behind what ----------------------------------------------------------------------------

-- The person behind a profile is banned, or their channel is suspended:
-- 'banned', 'suspended' or null.
create or replace function public.moderation_block_for(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.profiles p where p.id = uid and p.banned_at is not null) then 'banned'
    when exists (select 1 from public.channels c where c.owner_id = uid and c.suspended_at is not null) then 'suspended'
  end;
$$;

-- Triggers ----------------------------------------------------------------------------------

-- New comments and edits: no banned or suspended authors, the word list and
-- the link cap. A removal (deleted_at set) passes.
create or replace function public.comments_moderation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  block text;
begin
  if new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;
  block := public.moderation_block_for(new.author_id);
  if block is not null then
    raise exception '%', block using errcode = 'P0001';
  end if;
  if public.moderation_flag_on(new.author_id) then
    if public.moderation_blocked_word(new.body) is not null then
      raise exception 'blocked_words' using errcode = 'P0001';
    end if;
    if public.moderation_link_count(new.body) > public.moderation_link_limit() then
      raise exception 'too_many_links' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists comments_moderation_guard on public.comments;
create trigger comments_moderation_guard
  before insert or update of body, deleted_at on public.comments
  for each row execute function public.comments_moderation_guard();

-- New videos: no banned or suspended owners. Titles and descriptions: the
-- word list (only when they change, so an old title never blocks an edit
-- of something else). A removed video, or one of a suspended channel,
-- stays private.
create or replace function public.videos_moderation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  block text;
begin
  if tg_op = 'INSERT' then
    block := public.moderation_block_for(new.owner_id);
    if block is not null then
      raise exception '%', block using errcode = 'P0001';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.title is distinct from old.title or new.description is distinct from old.description)
     and public.moderation_flag_on(new.owner_id)
     and public.moderation_blocked_word(coalesce(new.title, '') || ' ' || coalesce(new.description, '')) is not null then
    raise exception 'blocked_words' using errcode = 'P0001';
  end if;
  if new.visibility <> 'private' then
    if new.removed_at is not null then
      raise exception 'removed' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.channels c where c.id = new.channel_id and c.suspended_at is not null) then
      raise exception 'suspended' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists videos_moderation_guard on public.videos;
create trigger videos_moderation_guard
  before insert or update of title, description, visibility, removed_at on public.videos
  for each row execute function public.videos_moderation_guard();

-- Every API request: a banned person gets nothing. PostgREST runs this
-- before each request (see the end of this file).
create or replace function public.moderation_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is not null and exists (select 1 from public.profiles p where p.id = me and p.banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
end;
$$;

-- Helpers ---------------------------------------------------------------------------------

-- Counts one call and raises rate_limited past 120 a minute ('admin').
create or replace function public.moderation_throttle(who uuid, bucket text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('moderation:' || bucket || ':' || who::text, 0));
  delete from public.moderation_requests r
   where r.user_id = who and r.bucket = moderation_throttle.bucket and r.at < now() - interval '1 minute';
  select count(*) into recent from public.moderation_requests r where r.user_id = who and r.bucket = moderation_throttle.bucket;
  if recent >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.moderation_requests (user_id, bucket) values (who, moderation_throttle.bucket);
end;
$$;

-- Signed in and the flag on. Answers the caller.
create or replace function public.moderation_caller()
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
  if not public.moderation_flag_on(me) then
    raise exception 'moderation_off' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- An admin with the flag on. Answers the caller.
create or replace function public.moderation_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := public.moderation_caller();
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- Strikes in the last 90 days.
create or replace function public.channel_active_strikes(channel_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.channel_strikes s
  where s.channel_id = channel_active_strikes.channel_id
    and s.created_at > now() - make_interval(days => public.moderation_strike_days());
$$;

create or replace function public.mod_write_log(actor uuid, action text, target_kind text, target_id uuid, label text, reason text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  -- clock_timestamp keeps the order of two rows written by one action.
  insert into public.mod_log (actor_id, action, target_kind, target_id, target_label, reason, created_at)
  values (actor, action, target_kind, target_id, left(coalesce(label, ''), 200), left(coalesce(reason, ''), 500), clock_timestamp());
$$;

-- Hides a channel's videos. Answers false when it was already suspended.
create or replace function public.mod_suspend_channel(ch uuid, why text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.channels c set suspended_at = now(), suspended_reason = left(coalesce(why, ''), 500)
   where c.id = ch and c.suspended_at is null;
  if not found then
    return false;
  end if;
  update public.videos v set held_visibility = v.visibility, visibility = 'private'
   where v.channel_id = ch and v.visibility <> 'private' and v.held_visibility is null;
  return true;
end;
$$;

-- Puts a channel's videos back. Answers false when it was not suspended.
create or replace function public.mod_unsuspend_channel(ch uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.channels c set suspended_at = null, suspended_reason = null
   where c.id = ch and c.suspended_at is not null;
  if not found then
    return false;
  end if;
  -- In the trash, the visibility waits for the restore (014). Removed
  -- videos keep theirs in removed_visibility.
  update public.videos v set trash_visibility = v.held_visibility, held_visibility = null
   where v.channel_id = ch and v.held_visibility is not null and v.deleted_at is not null;
  update public.videos v set visibility = v.held_visibility, held_visibility = null
   where v.channel_id = ch and v.held_visibility is not null and v.deleted_at is null and v.removed_at is null;
  return true;
end;
$$;

-- RPCs for everyone signed in -------------------------------------------------------------------

drop function if exists public.moderation_status();
drop function if exists public.report_target(text, uuid, text, text);
drop function if exists public.appeal_removal(uuid, text);

-- The caller, for the app: {admin, flag, banned, suspended, strikes,
-- strike_limit, strike_days, next_strike_expiry}. Signed out: all false.
create function public.moderation_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', public.is_admin(),
    'flag', public.moderation_flag_on((select auth.uid())),
    'banned', coalesce((select p.banned_at is not null from public.profiles p where p.id = (select auth.uid())), false),
    'suspended', coalesce((select c.suspended_at is not null from public.channels c where c.owner_id = (select auth.uid())), false),
    'suspended_reason', (select c.suspended_reason from public.channels c where c.owner_id = (select auth.uid())),
    'strikes', coalesce((select public.channel_active_strikes(c.id) from public.channels c where c.owner_id = (select auth.uid())), 0),
    'strike_limit', public.moderation_strike_limit(),
    'strike_days', public.moderation_strike_days(),
    'next_strike_expiry', (
      select min(s.created_at) + make_interval(days => public.moderation_strike_days())
      from public.channel_strikes s join public.channels c on c.id = s.channel_id
      where c.owner_id = (select auth.uid())
        and s.created_at > now() - make_interval(days => public.moderation_strike_days())
    )
  );
$$;

-- A report. Answers the new report's id.
create function public.report_target(target_kind text, target_id uuid, reason text, details text default '')
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.moderation_caller();
  clean text := btrim(coalesce(report_target.details, ''));
  owner uuid;
  today int;
  new_id uuid;
begin
  if report_target.target_kind is null or report_target.target_kind not in ('video', 'comment', 'channel') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if report_target.reason is null or report_target.reason not in ('spam', 'sexual', 'violent', 'harassment', 'copyright', 'other') then
    raise exception 'bad_reason' using errcode = 'P0001';
  end if;
  if char_length(clean) > 500 then
    raise exception 'details_too_long' using errcode = 'P0001';
  end if;
  if report_target.reason = 'other' and char_length(clean) = 0 then
    raise exception 'details_required' using errcode = 'P0001';
  end if;

  -- The target, as the reporter can see it.
  if report_target.target_kind = 'video' then
    select v.owner_id into owner from public.videos v
     where v.id = report_target.target_id and v.status = 'ready' and v.visibility in ('public', 'unlisted') and v.removed_at is null;
  elsif report_target.target_kind = 'comment' then
    select c.author_id into owner from public.comments c join public.videos v on v.id = c.video_id
     where c.id = report_target.target_id and c.deleted_at is null and v.visibility in ('public', 'unlisted') and v.status = 'ready';
  else
    select c.owner_id into owner from public.channels c where c.id = report_target.target_id;
  end if;
  if owner is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if owner = me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report:' || me::text, 0));
  if exists (
    select 1 from public.reports r
    where r.reporter_id = me and r.kind = 'report'
      and r.target_kind = report_target.target_kind and r.target_id = report_target.target_id
  ) then
    raise exception 'already_reported' using errcode = 'P0001';
  end if;
  select count(*) into today from public.reports r
   where r.reporter_id = me and r.kind = 'report' and r.created_at > now() - interval '1 day';
  if today >= public.moderation_reports_per_day() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.reports (kind, reporter_id, target_kind, target_id, reason, details)
  values ('report', me, report_target.target_kind, report_target.target_id, report_target.reason, clean)
  returning id into new_id;
  return new_id;
end;
$$;

-- The owner of a removed video asks for it back. One appeal per removal.
create function public.appeal_removal(video_id uuid, details text default '')
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.moderation_caller();
  clean text := btrim(coalesce(appeal_removal.details, ''));
  v public.videos;
  new_id uuid;
begin
  if char_length(clean) > 500 then
    raise exception 'details_too_long' using errcode = 'P0001';
  end if;
  select * into v from public.videos x where x.id = appeal_removal.video_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.owner_id <> me then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v.removed_at is null then
    raise exception 'not_removed' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.reports r
    where r.kind = 'appeal' and r.target_id = v.id and (r.status = 'open' or r.created_at >= v.removed_at)
  ) then
    raise exception 'already_appealed' using errcode = 'P0001';
  end if;
  insert into public.reports (kind, reporter_id, target_kind, target_id, reason, details)
  values ('appeal', me, 'video', v.id, 'appeal', clean)
  returning id into new_id;
  return new_id;
end;
$$;

-- The studio's Content list, with the removal (014's shape plus three columns).
drop function if exists public.studio_videos(boolean);
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
  purge_at timestamptz,
  removed_at timestamptz,
  removed_reason text,
  appeal text
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
    -- least() skips nulls: the earlier of the trash and the removal.
    least(v.deleted_at, v.removed_at) + make_interval(days => public.studio_trash_days()),
    v.removed_at, v.removed_reason,
    -- The appeal since the removal: 'open', 'dismissed' (turned down), or null.
    (select r.status from public.reports r
      where r.kind = 'appeal' and r.target_id = v.id and v.removed_at is not null and r.created_at >= v.removed_at
      order by r.created_at desc limit 1)
  from public.videos v
  where v.owner_id = me
    and (v.deleted_at is not null) = coalesce(studio_videos.trash, false)
  order by coalesce(v.deleted_at, v.created_at) desc, v.id desc
  limit 500;
end;
$$;

-- The trash purge (014) also takes removed videos 30 days after the removal.
create or replace function public.purge_trash(lim int default 500)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gone int := 0;
  cutoff timestamptz := now() - make_interval(days => public.studio_trash_days());
begin
  with old as (
    select v.id, v.owner_id
    from public.videos v
    where (v.deleted_at is not null and v.deleted_at < cutoff)
       or (v.removed_at is not null and v.removed_at < cutoff)
    order by least(v.deleted_at, v.removed_at)
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
  select count(*) into gone from deleted;

  delete from public.storage_cleanup c where c.status = 'done' and c.finished_at < now() - interval '30 days';
  return gone;
end;
$$;

-- Admin RPCs ---------------------------------------------------------------------------------

drop function if exists public.admin_reports(int);
drop function if exists public.mod_action(text, text, uuid, text, text);
drop function if exists public.admin_log(timestamptz, int);
drop function if exists public.admin_suspended();
drop function if exists public.admin_words();
drop function if exists public.admin_set_word(text, boolean);

-- The open reports, newest first, with what each one points at.
create function public.admin_reports(lim int default 1000)
returns table (
  id uuid,
  kind text,
  target_kind text,
  target_id uuid,
  reason text,
  details text,
  created_at timestamptz,
  reporter_name text,
  target_label text,
  video_id uuid,
  channel_id uuid,
  channel_handle text,
  channel_name text,
  channel_suspended boolean,
  channel_strikes int,
  owner_banned boolean,
  owner_admin boolean,
  target_removed boolean,
  target_gone boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.moderation_admin();
  return query
  with r as (
    select x.* from public.reports x
    where x.status = 'open'
    order by x.created_at desc, x.id desc
    limit least(greatest(coalesce(admin_reports.lim, 1000), 1), 2000)
  ),
  t as (
    select
      r.id as report_id,
      case r.target_kind
        when 'video' then vv.owner_id
        when 'comment' then cm.author_id
        else cc.owner_id
      end as owner_id,
      case r.target_kind
        when 'video' then vv.title
        when 'comment' then left(cm.body, 200)
        else coalesce(nullif(cc.name, ''), cc.handle)
      end as label,
      case r.target_kind when 'video' then vv.id when 'comment' then cm.video_id end as video_id,
      case r.target_kind
        when 'video' then vv.removed_at is not null
        when 'comment' then cm.removed_at is not null
        else false
      end as removed,
      case r.target_kind
        when 'video' then vv.id is null
        when 'comment' then cm.id is null or (cm.deleted_at is not null and cm.removed_at is null)
        else cc.id is null
      end as gone
    from r
    left join public.videos vv on r.target_kind = 'video' and vv.id = r.target_id
    left join public.comments cm on r.target_kind = 'comment' and cm.id = r.target_id
    left join public.channels cc on r.target_kind = 'channel' and cc.id = r.target_id
  )
  select
    r.id, r.kind, r.target_kind, r.target_id, r.reason, r.details, r.created_at,
    coalesce(nullif(rp.display_name, ''), rp.username),
    t.label, t.video_id,
    ch.id, ch.handle, coalesce(nullif(ch.name, ''), ch.handle),
    ch.suspended_at is not null,
    case when ch.id is null then 0 else public.channel_active_strikes(ch.id) end,
    coalesce(op.banned_at is not null, false),
    coalesce(op.role = 'admin', false),
    t.removed, t.gone
  from r
  join t on t.report_id = r.id
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles op on op.id = t.owner_id
  left join public.channels ch on ch.owner_id = t.owner_id
  order by r.created_at desc, r.id desc;
end;
$$;

-- One moderation action. Answers {closed, suspended}: how many reports it
-- closed, and whether the channel is suspended afterwards.
create function public.mod_action(
  action text,
  target_kind text,
  target_id uuid,
  reason text default '',
  kind text default 'report'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.moderation_admin();
  why text := btrim(coalesce(mod_action.reason, ''));
  owner uuid;
  ch public.channels;
  vid public.videos;
  com public.comments;
  label text;
  closed int := 0;
  now_suspended boolean := false;
begin
  if mod_action.action is null or mod_action.action not in ('dismiss', 'remove', 'restore', 'strike', 'suspend', 'unsuspend', 'ban', 'unban') then
    raise exception 'bad_action' using errcode = 'P0001';
  end if;
  if mod_action.target_kind is null or mod_action.target_kind not in ('video', 'comment', 'channel')
     or mod_action.kind is null or mod_action.kind not in ('report', 'appeal') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if char_length(why) > 500 then
    raise exception 'reason_too_long' using errcode = 'P0001';
  end if;
  if mod_action.action in ('remove', 'strike', 'suspend', 'ban') and char_length(why) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  perform public.moderation_throttle(me, 'admin');

  -- What the target is and who is behind it.
  if mod_action.target_kind = 'video' then
    select * into vid from public.videos v where v.id = mod_action.target_id for update;
    owner := vid.owner_id;
    label := vid.title;
  elsif mod_action.target_kind = 'comment' then
    select * into com from public.comments c where c.id = mod_action.target_id for update;
    owner := com.author_id;
    label := left(com.body, 200);
  else
    select c.owner_id into owner from public.channels c where c.id = mod_action.target_id;
  end if;
  select * into ch from public.channels c where c.owner_id = owner for update;
  if mod_action.target_kind = 'channel' then
    label := coalesce(nullif(ch.name, ''), ch.handle);
  end if;

  -- A dismiss also closes reports whose target is gone.
  if owner is null and mod_action.action <> 'dismiss' then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if mod_action.action in ('strike', 'suspend', 'ban')
     and (owner = me or exists (select 1 from public.profiles p where p.id = owner and p.role = 'admin')) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if mod_action.action = 'remove' then
    if mod_action.target_kind = 'video' then
      if vid.removed_at is null then
        update public.videos v
           set removed_visibility = coalesce(v.held_visibility, v.visibility), held_visibility = null,
               visibility = 'private', removed_at = now(), removed_reason = why
         where v.id = vid.id;
      end if;
      perform public.mod_write_log(me, 'remove_video', 'video', vid.id, label, why);
    elsif mod_action.target_kind = 'comment' then
      if com.removed_at is null then
        update public.comments c
           set removed_at = now(), deleted_at = coalesce(c.deleted_at, now()), body = '', pinned = false, hearted = false
         where c.id = com.id;
      end if;
      perform public.mod_write_log(me, 'remove_comment', 'comment', com.id, label, why);
    else
      raise exception 'bad_action' using errcode = 'P0001';
    end if;
  elsif mod_action.action = 'restore' then
    if mod_action.target_kind <> 'video' then
      raise exception 'bad_action' using errcode = 'P0001';
    end if;
    if vid.removed_at is null then
      raise exception 'not_removed' using errcode = 'P0001';
    end if;
    if ch.suspended_at is not null then
      update public.videos v
         set removed_at = null, removed_reason = null,
             held_visibility = nullif(v.removed_visibility, 'private'), removed_visibility = null
       where v.id = vid.id;
    else
      update public.videos v
         set removed_at = null, removed_reason = null, removed_visibility = null
       where v.id = vid.id;
      update public.videos v set visibility = coalesce(vid.removed_visibility, 'private')
       where v.id = vid.id and v.deleted_at is null;
      update public.videos v set trash_visibility = coalesce(vid.removed_visibility, 'private')
       where v.id = vid.id and v.deleted_at is not null;
    end if;
    perform public.mod_write_log(me, 'restore_video', 'video', vid.id, label, why);
  elsif mod_action.action = 'strike' then
    insert into public.channel_strikes (channel_id, actor_id, reason, target_kind, target_id)
    values (ch.id, me, why, mod_action.target_kind, mod_action.target_id);
    perform public.mod_write_log(me, 'strike', 'channel', ch.id, coalesce(nullif(ch.name, ''), ch.handle), why);
    if public.channel_active_strikes(ch.id) >= public.moderation_strike_limit()
       and public.mod_suspend_channel(ch.id, why) then
      perform public.mod_write_log(me, 'suspend', 'channel', ch.id, coalesce(nullif(ch.name, ''), ch.handle),
        public.moderation_strike_limit() || ' strikes in ' || public.moderation_strike_days() || ' days');
    end if;
  elsif mod_action.action = 'suspend' then
    perform public.mod_suspend_channel(ch.id, why);
    perform public.mod_write_log(me, 'suspend', 'channel', ch.id, coalesce(nullif(ch.name, ''), ch.handle), why);
  elsif mod_action.action = 'unsuspend' then
    perform public.mod_unsuspend_channel(ch.id);
    perform public.mod_write_log(me, 'unsuspend', 'channel', ch.id, coalesce(nullif(ch.name, ''), ch.handle), why);
  elsif mod_action.action = 'ban' then
    update public.profiles p set banned_at = coalesce(p.banned_at, now()), ban_reason = why where p.id = owner;
    -- Sign them out everywhere: their refresh tokens stop working.
    begin
      execute 'delete from auth.sessions where user_id = $1' using owner;
    exception when others then
      raise notice 'could not delete the auth sessions: %', sqlerrm;
    end;
    perform public.mod_suspend_channel(ch.id, why);
    perform public.mod_write_log(me, 'ban', 'user', owner,
      coalesce((select p.username from public.profiles p where p.id = owner), ''), why);
  elsif mod_action.action = 'unban' then
    update public.profiles p set banned_at = null, ban_reason = null where p.id = owner;
    perform public.mod_write_log(me, 'unban', 'user', owner,
      coalesce((select p.username from public.profiles p where p.id = owner), ''), why);
  else
    perform public.mod_write_log(me, 'dismiss', mod_action.target_kind, mod_action.target_id, coalesce(label, ''), why);
  end if;

  if mod_action.action in ('dismiss', 'remove', 'restore', 'strike', 'suspend', 'ban') then
    update public.reports r
       set status = case when mod_action.action = 'dismiss' then 'dismissed' else 'actioned' end,
           resolution = mod_action.action, resolved_by = me, resolved_at = now()
     where r.status = 'open' and r.kind = mod_action.kind
       and r.target_kind = mod_action.target_kind and r.target_id = mod_action.target_id;
    get diagnostics closed = row_count;
  end if;

  select c.suspended_at is not null into now_suspended from public.channels c where c.id = ch.id;
  return jsonb_build_object('closed', closed, 'suspended', coalesce(now_suspended, false));
end;
$$;

-- The mod log, newest first, in pages of up to 100 before a moment.
create function public.admin_log(before timestamptz default null, lim int default 50)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  target_kind text,
  target_id uuid,
  target_label text,
  reason text,
  actor_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.moderation_admin();
  return query
  select l.id, l.created_at, l.action, l.target_kind, l.target_id, l.target_label, l.reason,
         coalesce(nullif(p.display_name, ''), p.username, 'deleted account')
  from public.mod_log l
  left join public.profiles p on p.id = l.actor_id
  where admin_log.before is null or l.created_at < admin_log.before
  order by l.created_at desc, l.id desc
  limit least(greatest(coalesce(admin_log.lim, 50), 1), 100);
end;
$$;

-- Suspended channels, newest first.
create function public.admin_suspended()
returns table (
  channel_id uuid,
  handle text,
  name text,
  suspended_at timestamptz,
  reason text,
  strikes int,
  banned boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.moderation_admin();
  return query
  select c.id, c.handle, coalesce(nullif(c.name, ''), c.handle), c.suspended_at, coalesce(c.suspended_reason, ''),
         public.channel_active_strikes(c.id), p.banned_at is not null
  from public.channels c
  join public.profiles p on p.id = c.owner_id
  where c.suspended_at is not null
  order by c.suspended_at desc
  limit 200;
end;
$$;

create function public.admin_words()
returns table (word text, created_at timestamptz, added_by text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.moderation_admin();
  return query
  select w.word, w.created_at, coalesce(p.username, '')
  from public.moderation_words w
  left join public.profiles p on p.id = w.added_by
  order by w.word;
end;
$$;

-- Adds (on) or removes a word. The app lowercases and squeezes it first.
create function public.admin_set_word(word text, "on" boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.moderation_admin();
  w text := admin_set_word.word;
begin
  if not public.moderation_word_is_valid(w) then
    raise exception 'bad_word' using errcode = 'P0001';
  end if;
  perform public.moderation_throttle(me, 'admin');
  if coalesce(admin_set_word."on", true) then
    insert into public.moderation_words (word, added_by) values (w, me) on conflict on constraint moderation_words_pkey do nothing;
    if found then
      perform public.mod_write_log(me, 'add_word', 'word', null, w, '');
    end if;
  else
    delete from public.moderation_words x where x.word = w;
    if found then
      perform public.mod_write_log(me, 'remove_word', 'word', null, w, '');
    end if;
  end if;
end;
$$;

-- Who may call what ------------------------------------------------------------------------

revoke execute on function public.moderation_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.moderation_blocked_word(text) from public, anon, authenticated;
revoke execute on function public.moderation_block_for(uuid) from public, anon, authenticated;
revoke execute on function public.comments_moderation_guard() from public, anon, authenticated;
revoke execute on function public.videos_moderation_guard() from public, anon, authenticated;
revoke execute on function public.moderation_throttle(uuid, text) from public, anon, authenticated;
revoke execute on function public.moderation_caller() from public, anon, authenticated;
revoke execute on function public.moderation_admin() from public, anon, authenticated;
revoke execute on function public.channel_active_strikes(uuid) from public, anon, authenticated;
revoke execute on function public.mod_write_log(uuid, text, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.mod_suspend_channel(uuid, text) from public, anon, authenticated;
revoke execute on function public.mod_unsuspend_channel(uuid) from public, anon, authenticated;
revoke execute on function public.purge_trash(int) from public, anon, authenticated;

-- is_admin() is used by the policies, so the API roles need it. It only
-- answers for the caller. The pre request check runs as the caller too.
revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
revoke execute on function public.moderation_pre_request() from public;
grant execute on function public.moderation_pre_request() to anon, authenticated, service_role;

revoke execute on function public.moderation_status() from public;
revoke execute on function public.report_target(text, uuid, text, text) from public;
revoke execute on function public.appeal_removal(uuid, text) from public;
revoke execute on function public.studio_videos(boolean) from public;
revoke execute on function public.admin_reports(int) from public;
revoke execute on function public.mod_action(text, text, uuid, text, text) from public;
revoke execute on function public.admin_log(timestamptz, int) from public;
revoke execute on function public.admin_suspended() from public;
revoke execute on function public.admin_words() from public;
revoke execute on function public.admin_set_word(text, boolean) from public;

grant execute on function public.moderation_status() to anon, authenticated;
grant execute on function public.report_target(text, uuid, text, text) to authenticated;
grant execute on function public.appeal_removal(uuid, text) to authenticated;
grant execute on function public.studio_videos(boolean) to authenticated;
grant execute on function public.admin_reports(int) to authenticated;
grant execute on function public.mod_action(text, text, uuid, text, text) to authenticated;
grant execute on function public.admin_log(timestamptz, int) to authenticated;
grant execute on function public.admin_suspended() to authenticated;
grant execute on function public.admin_words() to authenticated;
grant execute on function public.admin_set_word(text, boolean) to authenticated;

grant execute on function public.purge_trash(int) to service_role;

-- The ban check before every API request --------------------------------------------------------

-- PostgREST runs pgrst.db_pre_request before each request. Supabase allows
-- setting it on the authenticator role; the notify makes PostgREST reload.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      execute 'alter role authenticator set pgrst.db_pre_request = ''public.moderation_pre_request''';
      perform pg_notify('pgrst', 'reload config');
    exception when insufficient_privilege then
      raise notice 'Could not set pgrst.db_pre_request on authenticator: banned people are refused by the triggers and the app only.';
    end;
  else
    raise notice 'No authenticator role here (not Supabase): the ban check before each request is not set.';
  end if;
end;
$$;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'moderation',
  'Moderation',
  'Report buttons on videos, comments and channels, the admin queue at /admin with the mod log and the word list, strikes, suspensions, bans, removed videos with appeals.',
  'off'
)
on conflict (key) do nothing;
