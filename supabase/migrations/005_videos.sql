-- 005_videos.sql
-- Videos and the upload RPCs.
--
-- - One row per uploaded video. The file itself lives in Cloudflare R2; the
--   row only holds its object key, size and type. The app server never
--   touches the bytes: the browser uploads straight to R2 with presigned URLs.
-- - Public and ready videos are readable by everyone. Owners read all of
--   their own videos, whatever the status or visibility.
-- - There are no insert, update or delete policies. Rows change only through
--   the security definer functions below:
--     create_upload(title, bytes, mime)    starts an upload, returns id and key
--     finish_upload(video_id)              the file is in R2: status uploaded
--     abandon_upload(video_id, reason)     cancelled or broken: status failed
--     update_upload_details(video_id, title, description, visibility)
-- - channels.video_count is not touched here. A later feature bumps it when a
--   video becomes public and ready.
-- - The "upload" feature flag, off until the owner switches it on.
--
-- Run after 004_channels.sql. Safe to run more than once.

-- Rules ------------------------------------------------------------------------
-- Keep in step with lib/upload/rules.ts.

-- The file extension for an accepted video type, or null when the type is not
-- accepted: mp4, mov, webm and mkv only.
create or replace function public.video_extension_for(mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case mime
    when 'video/mp4' then 'mp4'
    when 'video/quicktime' then 'mov'
    when 'video/webm' then 'webm'
    when 'video/x-matroska' then 'mkv'
    else null
  end;
$$;

-- Table --------------------------------------------------------------------------

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  visibility text not null default 'private',
  status text not null default 'uploading',
  source_key text,
  source_bytes bigint,
  source_mime text,
  duration_s numeric,
  width int,
  height int,
  thumbnail_url text,
  hls_key text,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint videos_title_length check (char_length(title) between 1 and 100),
  constraint videos_description_length check (char_length(description) <= 5000),
  constraint videos_visibility_valid check (visibility in ('private', 'unlisted', 'public')),
  constraint videos_status_valid check (status in ('uploading', 'uploaded', 'processing', 'ready', 'failed')),
  constraint videos_source_bytes_range check (source_bytes is null or source_bytes between 1 and 2147483648),
  constraint videos_source_mime_valid check (source_mime is null or public.video_extension_for(source_mime) is not null),
  constraint videos_thumbnail_url_https check (thumbnail_url is null or thumbnail_url ~ '^https://')
);

create index if not exists videos_owner_created_idx on public.videos (owner_id, created_at desc);
create index if not exists videos_channel_created_idx on public.videos (channel_id, created_at desc);
create index if not exists videos_public_ready_idx on public.videos (published_at desc)
  where visibility = 'public' and status = 'ready';

drop trigger if exists videos_touch on public.videos;
create trigger videos_touch
  before update on public.videos
  for each row execute function public.touch_updated_at();

-- Row level security -------------------------------------------------------------

alter table public.videos enable row level security;

drop policy if exists "public ready videos are readable by everyone" on public.videos;
create policy "public ready videos are readable by everyone"
  on public.videos
  for select
  to anon, authenticated
  using (visibility = 'public' and status = 'ready');

drop policy if exists "owners read their own videos" on public.videos;
create policy "owners read their own videos"
  on public.videos
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

-- Read only through the API. Every change goes through the functions below.
revoke all on public.videos from anon, authenticated;
grant select on public.videos to anon, authenticated;

-- Helpers --------------------------------------------------------------------------

-- Is the upload flag on for this person? Same rules as lib/flags-core.ts.
create or replace function public.upload_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'upload'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- RPCs -------------------------------------------------------------------------------

-- Starts an upload for the signed in person and returns the new video id and
-- the R2 object key the file must be uploaded to:
--   uploads/<owner id>/<video id>/source.<ext>
-- Errors (the message is the code the app shows a friendly text for):
--   not_signed_in, upload_off, not_onboarded, too_young, no_channel,
--   title_invalid, file_empty, file_too_big, bad_type, daily_limit
create or replace function public.create_upload(title text, bytes bigint, mime text)
returns table (video_id uuid, source_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  me_profile public.profiles;
  my_channel uuid;
  clean_title text := trim(both from coalesce(create_upload.title, ''));
  ext text := public.video_extension_for(create_upload.mime);
  recent int;
  new_id uuid := gen_random_uuid();
  new_key text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.upload_flag_on(me) then
    raise exception 'upload_off' using errcode = 'P0001';
  end if;

  select * into me_profile from public.profiles p where p.id = me;
  if me_profile.id is null or not me_profile.onboarded or me_profile.birthdate is null then
    raise exception 'not_onboarded' using errcode = 'P0001';
  end if;
  if public.age_on(me_profile.birthdate) < 13 then
    raise exception 'too_young' using errcode = 'P0001';
  end if;

  select c.id into my_channel from public.channels c where c.owner_id = me;
  if my_channel is null then
    raise exception 'no_channel' using errcode = 'P0001';
  end if;

  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if create_upload.bytes is null or create_upload.bytes < 1 then
    raise exception 'file_empty' using errcode = 'P0001';
  end if;
  if create_upload.bytes > 2147483648 then
    raise exception 'file_too_big' using errcode = 'P0001';
  end if;
  if ext is null then
    raise exception 'bad_type' using errcode = 'P0001';
  end if;

  -- One upload start at a time per person, so the daily count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('create_upload:' || me::text, 0));
  select count(*) into recent
    from public.videos v
   where v.owner_id = me
     and v.created_at > now() - interval '24 hours';
  if recent >= 10 then
    raise exception 'daily_limit' using errcode = 'P0001';
  end if;

  new_key := 'uploads/' || me::text || '/' || new_id::text || '/source.' || ext;
  insert into public.videos (id, channel_id, owner_id, title, source_key, source_bytes, source_mime)
  values (new_id, my_channel, me, clean_title, new_key, create_upload.bytes, create_upload.mime);

  return query select new_id, new_key;
end;
$$;

-- The file is complete in R2 (the app checked its size): status uploaded.
-- Errors: not_signed_in, not_found, not_uploading
create or replace function public.finish_upload(video_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.status into current_status
    from public.videos v
   where v.id = finish_upload.video_id and v.owner_id = me
   for update;
  if current_status is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if current_status = 'uploaded' then
    return 'uploaded';
  end if;
  if current_status <> 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
  update public.videos v
     set status = 'uploaded', error = null
   where v.id = finish_upload.video_id;
  return 'uploaded';
end;
$$;

-- The upload was cancelled or broke: status failed, with a short reason.
-- Only an upload that has not finished can be abandoned.
-- Errors: not_signed_in, not_found, not_uploading
create or replace function public.abandon_upload(video_id uuid, reason text default 'cancelled')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  current_status text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  select v.status into current_status
    from public.videos v
   where v.id = abandon_upload.video_id and v.owner_id = me
   for update;
  if current_status is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if current_status = 'failed' then
    return 'failed';
  end if;
  if current_status <> 'uploading' then
    raise exception 'not_uploading' using errcode = 'P0001';
  end if;
  update public.videos v
     set status = 'failed', error = left(coalesce(nullif(trim(both from reason), ''), 'cancelled'), 200)
   where v.id = abandon_upload.video_id;
  return 'failed';
end;
$$;

-- Title, description and visibility from the upload form.
-- Errors: not_signed_in, not_found, title_invalid, description_too_long, bad_visibility
create or replace function public.update_upload_details(
  video_id uuid,
  title text,
  description text,
  visibility text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_title text := trim(both from coalesce(update_upload_details.title, ''));
  clean_description text := coalesce(update_upload_details.description, '');
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if char_length(clean_title) not between 1 and 100 then
    raise exception 'title_invalid' using errcode = 'P0001';
  end if;
  if char_length(clean_description) > 5000 then
    raise exception 'description_too_long' using errcode = 'P0001';
  end if;
  if update_upload_details.visibility not in ('private', 'unlisted', 'public') then
    raise exception 'bad_visibility' using errcode = 'P0001';
  end if;
  update public.videos v
     set title = clean_title,
         description = clean_description,
         visibility = update_upload_details.visibility
   where v.id = update_upload_details.video_id and v.owner_id = me;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.create_upload(text, bigint, text) from public, anon;
revoke execute on function public.finish_upload(uuid) from public, anon;
revoke execute on function public.abandon_upload(uuid, text) from public, anon;
revoke execute on function public.update_upload_details(uuid, text, text, text) from public, anon;
grant execute on function public.create_upload(text, bigint, text) to authenticated;
grant execute on function public.finish_upload(uuid) to authenticated;
grant execute on function public.abandon_upload(uuid, text) to authenticated;
grant execute on function public.update_upload_details(uuid, text, text, text) to authenticated;

-- Internal helpers are not part of the API.
revoke execute on function public.upload_flag_on(uuid) from public, anon, authenticated;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'upload',
  'Upload',
  'The /upload page, uploads to R2 and the /studio/videos list.',
  'off'
)
on conflict (key) do nothing;
