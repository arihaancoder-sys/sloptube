-- 018_yapin.sql
-- Yapin' integration: sign in with Yapin', the link on profiles, upload
-- announcements in a Yapin' channel through an incoming webhook, the yapin flag.
--
-- Sign in
-- - profiles.yapin_id (unique, nullable) and profiles.yapin_username: the
--   Yapin' account linked to this profile. Not readable through the API
--   (002 grants select on named columns only); yapin_status() answers the
--   caller about their own link.
-- - link_yapin(user_id, yapin_id, yapin_username) and
--   yapin_find_user(yapin_id, email): service role only. The app calls them
--   from /auth/yapin after it has checked the Yapin' answer itself, so nobody
--   can claim someone else's Yapin' id through the API.
-- - unlink_yapin(): the caller removes their own link.
--
-- Announcements
-- - yapin_webhooks: one incoming webhook URL per channel. The URL is a
--   secret: the owner can read the row (RLS, owner only) but not the url
--   column, only url_hint (the last 4 characters). Written through
--   set_yapin_webhook(url) only; null or '' disconnects.
-- - yapin_posts: one announcement per video, queued by a trigger when a video
--   that was uploaded after the webhook was connected first becomes public
--   and ready, with the yapin flag on for its owner. The encoder box claims
--   them (claim_yapin_posts, service role only), posts the card with 3
--   retries and reports back (yapin_post_result). Owners read their own
--   through RLS or list_yapin_posts(lim).
--
-- Limits: 30 calls a minute per person for unlink_yapin, set_yapin_webhook,
-- list_yapin_posts and yapin_status (logged in yapin_requests).
--
-- Errors (the message, P0001): yapin_off, not_signed_in, no_channel,
-- bad_webhook, yapin_taken, not_found, rate_limited.
--
-- Flag (off until the owner switches it on):
-- - yapin: Continue with Yapin' on /login and /signup and Settings >
--   Connections (both also need YAPIN_CLIENT_ID, YAPIN_CLIENT_SECRET and
--   SUPABASE_SERVICE_ROLE_KEY on the app server), Share to Yapin', /embed/<id>
--   with og:video and twitter:player on watch pages, and announcements in
--   /studio/settings.
--
-- Keep the numbers in step with lib/yapin/rules.ts and worker/lib/yapin.mjs.
--
-- Run after 017_launch.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.yapin_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'yapin'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Same as lib/yapin/rules.ts.
create or replace function public.yapin_per_minute() returns int language sql immutable set search_path = '' as $$ select 30 $$;

-- An incoming webhook on yapin.gg (or one of its subdomains), https only, no
-- spaces, at most 500 characters. The encoder only ever posts to such a URL.
create or replace function public.yapin_webhook_is_valid(url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select url is not null
     and char_length(url) <= 500
     and url ~ '^https://([a-z0-9-]+\.)*yapin\.gg/[^\s]+$';
$$;

-- Profiles ---------------------------------------------------------------------------------

alter table public.profiles add column if not exists yapin_id text;
alter table public.profiles add column if not exists yapin_username text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_yapin_id_key') then
    alter table public.profiles add constraint profiles_yapin_id_key unique (yapin_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_yapin_id_shape') then
    alter table public.profiles add constraint profiles_yapin_id_shape
      check (yapin_id is null or (char_length(yapin_id) between 1 and 64 and yapin_id ~ '^[A-Za-z0-9_-]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_yapin_username_length') then
    alter table public.profiles add constraint profiles_yapin_username_length
      check (yapin_username is null or char_length(yapin_username) <= 64);
  end if;
end;
$$;

-- Tables -------------------------------------------------------------------------------------

-- One row per counted call, for the rate limit. Nobody reads it through the API.
create table if not exists public.yapin_requests (
  user_id uuid not null,
  at timestamptz not null default now()
);

create index if not exists yapin_requests_recent_idx on public.yapin_requests (user_id, at desc);

alter table public.yapin_requests enable row level security;
revoke all on public.yapin_requests from anon, authenticated;

create table if not exists public.yapin_webhooks (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null unique references public.channels (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  url text not null,
  url_hint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yapin_webhooks_url_valid check (public.yapin_webhook_is_valid(url)),
  constraint yapin_webhooks_hint_length check (char_length(url_hint) <= 8)
);

alter table public.yapin_webhooks enable row level security;

drop policy if exists "yapin_webhooks are readable by their owner" on public.yapin_webhooks;
create policy "yapin_webhooks are readable by their owner"
  on public.yapin_webhooks
  for select
  to authenticated
  using (owner_id = auth.uid());

-- Every column but url. Nobody writes through the API (set_yapin_webhook is security definer).
revoke all on public.yapin_webhooks from anon, authenticated;
grant select (id, channel_id, owner_id, url_hint, created_at, updated_at) on public.yapin_webhooks to authenticated;

create table if not exists public.yapin_posts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  webhook_id uuid references public.yapin_webhooks (id) on delete set null,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  error text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint yapin_posts_status_valid check (status in ('queued', 'sending', 'sent', 'failed')),
  constraint yapin_posts_error_length check (error is null or char_length(error) <= 500),
  constraint yapin_posts_once unique (video_id, channel_id)
);

create index if not exists yapin_posts_channel_idx on public.yapin_posts (channel_id, queued_at desc);
create index if not exists yapin_posts_todo_idx on public.yapin_posts (queued_at) where status in ('queued', 'sending');

alter table public.yapin_posts enable row level security;

drop policy if exists "yapin_posts are readable by the channel owner" on public.yapin_posts;
create policy "yapin_posts are readable by the channel owner"
  on public.yapin_posts
  for select
  to authenticated
  using (exists (select 1 from public.channels c where c.id = yapin_posts.channel_id and c.owner_id = auth.uid()));

revoke all on public.yapin_posts from anon, authenticated;
grant select on public.yapin_posts to authenticated;

-- Helpers ---------------------------------------------------------------------------------------

-- Signed in, the flag on and under the limit. Answers the caller.
create or replace function public.yapin_caller()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  recent int;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.yapin_flag_on(me) then
    raise exception 'yapin_off' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yapin:' || me::text, 0));
  delete from public.yapin_requests r where r.user_id = me and r.at < now() - interval '1 minute';
  if random() < 0.01 then
    delete from public.yapin_requests r where r.at < now() - interval '1 minute';
  end if;
  select count(*) into recent from public.yapin_requests r where r.user_id = me;
  if recent >= public.yapin_per_minute() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.yapin_requests (user_id) values (me);
  return me;
end;
$$;

-- Sign in and linking ------------------------------------------------------------------------------

-- Who signs in with this Yapin' account: the linked profile first, else the
-- account with this email address (the app only passes a verified one).
drop function if exists public.yapin_find_user(text, text);
create function public.yapin_find_user(yapin_id text, email text)
returns table (user_id uuid, email text, matched_by text, linked_yapin_id text)
language sql
stable
security definer
set search_path = ''
as $$
  (select p.id, u.email::text, 'yapin'::text, p.yapin_id
     from public.profiles p
     join auth.users u on u.id = p.id
    where p.yapin_id = yapin_find_user.yapin_id
    limit 1)
  union all
  (select u.id, u.email::text, 'email'::text, p.yapin_id
     from auth.users u
     join public.profiles p on p.id = u.id
    where yapin_find_user.email is not null
      and lower(u.email) = lower(yapin_find_user.email)
      and not exists (select 1 from public.profiles q where q.yapin_id = yapin_find_user.yapin_id)
    limit 1);
$$;

create or replace function public.link_yapin(user_id uuid, yapin_id text, yapin_username text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.yapin_id = link_yapin.yapin_id and p.id <> link_yapin.user_id) then
    raise exception 'yapin_taken' using errcode = 'P0001';
  end if;
  update public.profiles p
     set yapin_id = link_yapin.yapin_id,
         yapin_username = left(nullif(btrim(coalesce(link_yapin.yapin_username, '')), ''), 64)
   where p.id = link_yapin.user_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.unlink_yapin()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.yapin_caller();
begin
  update public.profiles p set yapin_id = null, yapin_username = null where p.id = me;
end;
$$;

drop function if exists public.yapin_status();
create function public.yapin_status()
returns table (linked boolean, yapin_username text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.yapin_caller();
begin
  return query select p.yapin_id is not null, p.yapin_username from public.profiles p where p.id = me;
end;
$$;

-- Announcements ------------------------------------------------------------------------------------

-- Connects (or replaces) the caller's channel webhook, or disconnects it with
-- null or ''. Answers the hint, never the URL.
create or replace function public.set_yapin_webhook(url text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.yapin_caller();
  ch uuid;
  clean text := btrim(coalesce(set_yapin_webhook.url, ''));
  hint text;
begin
  select c.id into ch from public.channels c where c.owner_id = me;
  if ch is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;
  if clean = '' then
    delete from public.yapin_webhooks w where w.channel_id = ch;
    return null;
  end if;
  if not public.yapin_webhook_is_valid(clean) then
    raise exception 'bad_webhook' using errcode = 'P0001';
  end if;
  hint := right(clean, 4);
  insert into public.yapin_webhooks (channel_id, owner_id, url, url_hint)
  values (ch, me, clean, hint)
  on conflict (channel_id) do update
    set url = excluded.url, url_hint = excluded.url_hint, updated_at = now();
  return hint;
end;
$$;

drop function if exists public.list_yapin_posts(int);
create function public.list_yapin_posts(lim int default 50)
returns table (
  id uuid,
  video_id uuid,
  title text,
  status text,
  attempts int,
  error text,
  queued_at timestamptz,
  finished_at timestamptz,
  connected boolean,
  url_hint text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.yapin_caller();
  ch uuid;
  hint text;
begin
  select c.id into ch from public.channels c where c.owner_id = me;
  if ch is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;
  select w.url_hint into hint from public.yapin_webhooks w where w.channel_id = ch;
  -- One row with no post when there are none yet, so the page still learns about the webhook.
  return query
  select p.id, p.video_id, v.title, p.status, p.attempts, p.error, p.queued_at, p.finished_at, hint is not null, hint
    from public.yapin_posts p
    join public.videos v on v.id = p.video_id
   where p.channel_id = ch
   order by p.queued_at desc, p.id desc
   limit least(greatest(coalesce(list_yapin_posts.lim, 50), 1), 200);
  if not found then
    return query select null::uuid, null::uuid, null::text, null::text, 0, null::text, null::timestamptz, null::timestamptz, hint is not null, hint;
  end if;
end;
$$;

-- Queues the announcement when a video first becomes public and ready.
create or replace function public.yapin_queue_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hook record;
begin
  if new.status <> 'ready' or new.visibility <> 'public' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'ready' and old.visibility = 'public' then
    return new;
  end if;
  if new.deleted_at is not null or new.removed_at is not null then
    return new;
  end if;
  select w.id, w.created_at into hook from public.yapin_webhooks w where w.channel_id = new.channel_id;
  if hook.id is null or new.created_at < hook.created_at then
    return new;
  end if;
  if not public.yapin_flag_on(new.owner_id) then
    return new;
  end if;
  insert into public.yapin_posts (video_id, channel_id, webhook_id)
  values (new.id, new.channel_id, hook.id)
  on conflict (video_id, channel_id) do nothing;
  return new;
end;
$$;

drop trigger if exists videos_yapin_queue on public.videos;
create trigger videos_yapin_queue
  after insert or update of status, visibility on public.videos
  for each row execute function public.yapin_queue_post();

-- The encoder ----------------------------------------------------------------------------------------

-- The next announcements to post. A post left 'sending' for 10 minutes (a
-- crashed box) is taken again. Answers the webhook URL: service role only.
drop function if exists public.claim_yapin_posts(text, int);
create function public.claim_yapin_posts(worker text, lim int default 5)
returns table (
  id uuid,
  url text,
  video_id uuid,
  title text,
  description text,
  thumbnail_url text,
  hls_key text,
  channel_name text,
  channel_handle text,
  attempts int
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Posts whose webhook was disconnected, or whose video is no longer public, are dropped first.
  update public.yapin_posts p
     set status = 'failed', error = 'no longer public or not connected', finished_at = now()
   where (p.status = 'queued' or (p.status = 'sending' and p.started_at < now() - interval '10 minutes'))
     and (not exists (select 1 from public.yapin_webhooks w where w.channel_id = p.channel_id)
          or not exists (select 1 from public.videos v where v.id = p.video_id and v.visibility = 'public' and v.status = 'ready'
                           and v.deleted_at is null and v.removed_at is null));

  return query
  with picked as (
    select p.id
      from public.yapin_posts p
     where p.status = 'queued'
        or (p.status = 'sending' and p.started_at < now() - interval '10 minutes')
     order by p.queued_at
     limit least(greatest(coalesce(claim_yapin_posts.lim, 5), 1), 20)
     for update skip locked
  ), marked as (
    update public.yapin_posts p
       set status = 'sending', worker = left(claim_yapin_posts.worker, 100), started_at = now()
      from picked
     where p.id = picked.id
    returning p.id, p.video_id, p.channel_id, p.attempts
  )
  select m.id, w.url, v.id, v.title, v.description, v.thumbnail_url, v.hls_key, c.name, c.handle, m.attempts
    from marked m
    join public.videos v on v.id = m.video_id
    join public.channels c on c.id = m.channel_id
    join public.yapin_webhooks w on w.channel_id = m.channel_id;
end;
$$;

create or replace function public.yapin_post_result(post_id uuid, ok boolean, tries int, error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.yapin_posts p
     set status = case when yapin_post_result.ok then 'sent' else 'failed' end,
         attempts = p.attempts + greatest(coalesce(yapin_post_result.tries, 1), 1),
         error = case when yapin_post_result.ok then null else left(coalesce(yapin_post_result.error, 'failed'), 500) end,
         finished_at = now()
   where p.id = yapin_post_result.post_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function public.yapin_flag_on(uuid) from public;
revoke execute on function public.yapin_caller() from public;
revoke execute on function public.yapin_find_user(text, text) from public, anon, authenticated;
revoke execute on function public.link_yapin(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.unlink_yapin() from public;
revoke execute on function public.yapin_status() from public;
revoke execute on function public.set_yapin_webhook(text) from public;
revoke execute on function public.list_yapin_posts(int) from public;
revoke execute on function public.yapin_queue_post() from public, anon, authenticated;
revoke execute on function public.claim_yapin_posts(text, int) from public, anon, authenticated;
revoke execute on function public.yapin_post_result(uuid, boolean, int, text) from public, anon, authenticated;

grant execute on function public.yapin_find_user(text, text) to service_role;
grant execute on function public.link_yapin(uuid, text, text) to service_role;
grant execute on function public.unlink_yapin() to authenticated;
grant execute on function public.yapin_status() to authenticated;
grant execute on function public.set_yapin_webhook(text) to authenticated;
grant execute on function public.list_yapin_posts(int) to authenticated;
grant execute on function public.claim_yapin_posts(text, int) to service_role;
grant execute on function public.yapin_post_result(uuid, boolean, int, text) to service_role;

-- Feature flag -------------------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'yapin',
  'Yapin'' integration',
  'Continue with Yapin'' on sign in and sign up, Settings > Connections, Share to Yapin'', the /embed player for link previews and upload announcements in a Yapin'' channel.',
  'off'
)
on conflict (key) do nothing;
