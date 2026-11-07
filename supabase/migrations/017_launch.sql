-- 017_launch.sql
-- Launch pack: the contact form, the sitemap lists, the maintenance and
-- launch flags.
--
-- Contact
-- - contact_messages: one row per message from /contact. name (1 to 80),
--   email (a plain address, up to 254), topic (general, press, legal,
--   safety, bug or other), body (10 to 4000), the sender's account when
--   they were signed in, a hash of the sender's network address (never the
--   address itself), and handled_at once an admin has dealt with it.
--   Nobody reads or writes the table through the API: the form goes through
--   contact_send and admins read it through admin_contact_messages.
-- - contact_send(name, email, topic, body): with the launch flag on for the
--   caller. 5 messages a day per email address and 5 a day per network
--   address (the x-contact-client header the app sends, the visitor's
--   address as the app's reverse proxy saw it, else the first
--   x-forwarded-for entry). Signed out people may send.
-- - admin_contact_messages(include_handled, lim) and
--   admin_contact_mark(id, handled): admins only (is_admin() from 016).
--
-- Sitemap
-- - sitemap_counts(), sitemap_videos(page, per) and sitemap_channels(page,
--   per): public, ready, not removed and not trashed videos, and channels
--   that are not suspended, in a stable order so the pages do not shift.
--   Everything they return is already public on the site.
--
-- Errors (the message, P0001): launch_off, bad_name, bad_email, bad_topic,
-- too_short, too_long, rate_limited, not_admin, not_found.
--
-- Flags (both off until the owner switches them on):
-- - maintenance: everyone but admins sees the maintenance page.
-- - launch: the footer, /about, /terms, /privacy, /guidelines, /press,
--   /contact and the Messages tab in /admin.
--
-- Keep the numbers in step with lib/launch/rules.ts.
--
-- Run after 016_moderation.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------------

create or replace function public.launch_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'launch'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Same as lib/launch/rules.ts.
create or replace function public.contact_per_day() returns int language sql immutable set search_path = '' as $$ select 5 $$;

-- Table ----------------------------------------------------------------------------------

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null default 'general',
  body text not null,
  user_id uuid references public.profiles (id) on delete set null,
  sender_key text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  constraint contact_name_length check (char_length(name) between 1 and 80),
  constraint contact_email_shape check (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint contact_topic_valid check (topic in ('general', 'press', 'legal', 'safety', 'bug', 'other')),
  constraint contact_body_length check (char_length(body) between 10 and 4000)
);

create index if not exists contact_messages_email_idx on public.contact_messages (lower(email), created_at desc);
create index if not exists contact_messages_sender_idx on public.contact_messages (sender_key, created_at desc);
create index if not exists contact_messages_open_idx on public.contact_messages (created_at desc) where handled_at is null;

alter table public.contact_messages enable row level security;

-- Admins may read the messages; nobody writes through the API (contact_send
-- and admin_contact_mark are security definer).
drop policy if exists "contact_messages are readable by admins" on public.contact_messages;
create policy "contact_messages are readable by admins"
  on public.contact_messages
  for select
  to authenticated
  using (public.is_admin());

revoke all on public.contact_messages from anon, authenticated;
grant select on public.contact_messages to authenticated;

-- Sending ----------------------------------------------------------------------------------

create or replace function public.contact_send(name text, email text, topic text, body text)
returns uuid
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
  clean_name text := btrim(regexp_replace(coalesce(contact_send.name, ''), '\s+', ' ', 'g'));
  clean_email text := lower(btrim(coalesce(contact_send.email, '')));
  clean_body text := btrim(coalesce(contact_send.body, ''));
  clean_topic text := coalesce(nullif(btrim(coalesce(contact_send.topic, '')), ''), 'general');
  sent int;
  new_id uuid;
begin
  if not public.launch_flag_on(me) then
    raise exception 'launch_off' using errcode = 'P0001';
  end if;
  if char_length(clean_name) = 0 or char_length(clean_name) > 80 then
    raise exception 'bad_name' using errcode = 'P0001';
  end if;
  if char_length(clean_email) > 254 or clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'bad_email' using errcode = 'P0001';
  end if;
  if clean_topic not in ('general', 'press', 'legal', 'safety', 'bug', 'other') then
    raise exception 'bad_topic' using errcode = 'P0001';
  end if;
  if char_length(clean_body) < 10 then
    raise exception 'too_short' using errcode = 'P0001';
  end if;
  if char_length(clean_body) > 4000 then
    raise exception 'too_long' using errcode = 'P0001';
  end if;

  address := nullif(btrim(coalesce(
    headers ->> 'x-contact-client',
    split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)
  )), '');
  who := case when address is null then null else md5('contact:' || left(address, 64)) end;

  -- One sender at a time per address, so two quick sends cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended('contact:' || clean_email, 0));
  select count(*) into sent from public.contact_messages m
   where lower(m.email) = clean_email and m.created_at > now() - interval '1 day';
  if sent >= public.contact_per_day() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if who is not null then
    perform pg_advisory_xact_lock(hashtextextended('contact-addr:' || who, 0));
    select count(*) into sent from public.contact_messages m
     where m.sender_key = who and m.created_at > now() - interval '1 day';
    if sent >= public.contact_per_day() then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  insert into public.contact_messages (name, email, topic, body, user_id, sender_key)
  values (clean_name, clean_email, clean_topic, clean_body, me, who)
  returning id into new_id;
  return new_id;
end;
$$;

-- Admins ----------------------------------------------------------------------------------

drop function if exists public.admin_contact_messages(boolean, int);
create function public.admin_contact_messages(include_handled boolean default false, lim int default 100)
returns table (
  id uuid,
  name text,
  email text,
  topic text,
  body text,
  created_at timestamptz,
  handled_at timestamptz,
  sender_handle text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  return query
  select m.id, m.name, m.email, m.topic, m.body, m.created_at, m.handled_at, c.handle
    from public.contact_messages m
    left join public.channels c on c.owner_id = m.user_id
   where coalesce(admin_contact_messages.include_handled, false) or m.handled_at is null
   order by m.created_at desc, m.id desc
   limit least(greatest(coalesce(admin_contact_messages.lim, 100), 1), 500);
end;
$$;

create or replace function public.admin_contact_mark(id uuid, handled boolean default true)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  update public.contact_messages m
     set handled_at = case when admin_contact_mark.handled then now() else null end,
         handled_by = case when admin_contact_mark.handled then auth.uid() else null end
   where m.id = admin_contact_mark.id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Sitemap ------------------------------------------------------------------------------------

create index if not exists videos_sitemap_idx on public.videos (published_at, id)
  where visibility = 'public' and status = 'ready' and removed_at is null and deleted_at is null;

create or replace function public.sitemap_counts()
returns table (videos bigint, channels bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.videos v
      where v.visibility = 'public' and v.status = 'ready' and v.removed_at is null and v.deleted_at is null),
    (select count(*) from public.channels c where c.suspended_at is null);
$$;

drop function if exists public.sitemap_videos(int, int);
create function public.sitemap_videos(page int default 1, per int default 5000)
returns table (
  id uuid,
  title text,
  description text,
  thumbnail_url text,
  hls_key text,
  duration_s numeric,
  published_at timestamptz,
  updated_at timestamptz,
  is_short boolean,
  channel_handle text
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.title, v.description, v.thumbnail_url, v.hls_key, v.duration_s,
         coalesce(v.published_at, v.created_at), v.updated_at, v.is_short, c.handle
    from public.videos v
    join public.channels c on c.id = v.channel_id
   where v.visibility = 'public' and v.status = 'ready' and v.removed_at is null and v.deleted_at is null
     and c.suspended_at is null
   order by v.published_at nulls last, v.id
   limit least(greatest(coalesce(sitemap_videos.per, 5000), 1), 5000)
  offset (greatest(coalesce(sitemap_videos.page, 1), 1) - 1) * least(greatest(coalesce(sitemap_videos.per, 5000), 1), 5000);
$$;

drop function if exists public.sitemap_channels(int, int);
create function public.sitemap_channels(page int default 1, per int default 5000)
returns table (handle text, name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.handle, c.name, c.created_at
    from public.channels c
   where c.suspended_at is null
   order by c.created_at, c.id
   limit least(greatest(coalesce(sitemap_channels.per, 5000), 1), 5000)
  offset (greatest(coalesce(sitemap_channels.page, 1), 1) - 1) * least(greatest(coalesce(sitemap_channels.per, 5000), 1), 5000);
$$;

-- Grants ---------------------------------------------------------------------------------------

revoke execute on function public.launch_flag_on(uuid) from public;
revoke execute on function public.contact_send(text, text, text, text) from public;
revoke execute on function public.admin_contact_messages(boolean, int) from public;
revoke execute on function public.admin_contact_mark(uuid, boolean) from public;
revoke execute on function public.sitemap_counts() from public;
revoke execute on function public.sitemap_videos(int, int) from public;
revoke execute on function public.sitemap_channels(int, int) from public;

grant execute on function public.contact_send(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_contact_messages(boolean, int) to authenticated;
grant execute on function public.admin_contact_mark(uuid, boolean) to authenticated;
grant execute on function public.sitemap_counts() to anon, authenticated;
grant execute on function public.sitemap_videos(int, int) to anon, authenticated;
grant execute on function public.sitemap_channels(int, int) to anon, authenticated;

-- Feature flags ----------------------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'maintenance',
  'Maintenance mode',
  'Everyone but admins sees the maintenance page, and the API answers 503. Admins can still sign in and use the site.',
  'off'
)
on conflict (key) do nothing;

insert into public.feature_flags (key, label, description, mode)
values (
  'launch',
  'Launch pack',
  'The footer with About, Terms, Privacy, Guidelines, Press and Contact, the contact form and the Messages tab in /admin.',
  'off'
)
on conflict (key) do nothing;
