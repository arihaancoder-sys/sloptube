-- 006_processing.sql
-- Video processing: the encode job queue and the functions the encoder worker
-- (worker/, running on its own box) calls with the service role key.
--
-- - One row in public.encode_jobs per video. A trigger queues a job when a
--   video's status becomes 'uploaded' (finish_upload in 005). Videos that are
--   already 'uploaded' when this file runs get a job from the backfill below.
-- - Owners can read the job of their own videos (the studio shows progress).
--   Nobody can write jobs through the API: only the functions below change them,
--   and only the service role may call them.
--     claim_encode_job(worker)             next queued job, marks it running
--     encode_progress(job_id, pct)         0 to 100 while it runs
--     encode_done(job_id, duration_s, width, height, hls_key, thumbnail_url,
--                 preview_sprite_key, renditions)
--                                          the video is ready
--     encode_failed(job_id, error, retry)  tried again up to 3 attempts, then
--                                          the video is failed
-- - New columns on videos: renditions (jsonb) and preview_sprite_key.
-- - channels.video_count now counts public and ready videos. A trigger keeps it
--   right when a video becomes ready, changes visibility or is deleted, and
--   sets published_at the first time a video is public and ready.
-- - The "processing" feature flag, off until the owner switches it on. While it
--   is off the worker claims nothing. In test mode it only processes videos of
--   the listed users.
--
-- Run after 005_videos.sql. Safe to run more than once.

-- Settings -----------------------------------------------------------------------
-- Keep in step with worker/lib/limits.mjs.

-- How many times a job is tried before the video is marked failed.
create or replace function public.encode_max_attempts()
returns int
language sql
immutable
set search_path = ''
as $$ select 3 $$;

-- A running job older than this is treated as a crashed worker and tried again.
-- The worker itself stops a job after 2 hours.
create or replace function public.encode_stale_after()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '2 hours 15 minutes' $$;

-- New columns on videos ------------------------------------------------------------

alter table public.videos add column if not exists renditions jsonb;
alter table public.videos add column if not exists preview_sprite_key text;

alter table public.videos drop constraint if exists videos_renditions_array;
alter table public.videos add constraint videos_renditions_array
  check (renditions is null or jsonb_typeof(renditions) = 'array');

-- The new columns are readable like the rest of the row (005 granted select on
-- the whole table, which covers columns added later).

-- Jobs table -------------------------------------------------------------------------

create table if not exists public.encode_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos (id) on delete cascade,
  status text not null default 'queued',
  attempts int not null default 0,
  worker text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  progress int not null default 0,
  created_at timestamptz not null default now(),
  constraint encode_jobs_status_valid check (status in ('queued', 'running', 'done', 'failed')),
  constraint encode_jobs_progress_range check (progress between 0 and 100),
  constraint encode_jobs_attempts_range check (attempts >= 0)
);

create index if not exists encode_jobs_queued_idx on public.encode_jobs (created_at)
  where status = 'queued';
create index if not exists encode_jobs_running_idx on public.encode_jobs (worker)
  where status = 'running';

alter table public.encode_jobs enable row level security;

drop policy if exists "owners read the jobs of their own videos" on public.encode_jobs;
create policy "owners read the jobs of their own videos"
  on public.encode_jobs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = encode_jobs.video_id and v.owner_id = (select auth.uid())
    )
  );

revoke all on public.encode_jobs from anon, authenticated;
grant select on public.encode_jobs to authenticated;

-- Queue a job when a video is uploaded ----------------------------------------------------

create or replace function public.queue_encode_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'uploaded' and (tg_op = 'INSERT' or old.status is distinct from 'uploaded') then
    insert into public.encode_jobs (video_id)
    values (new.id)
    on conflict (video_id) do update
      set status = 'queued',
          attempts = 0,
          progress = 0,
          worker = null,
          error = null,
          started_at = null,
          finished_at = null
      -- Only a finished job starts over. A queued or running one is left alone.
      where public.encode_jobs.status in ('done', 'failed');
  end if;
  return new;
end;
$$;

drop trigger if exists videos_queue_encode on public.videos;
create trigger videos_queue_encode
  after insert or update of status on public.videos
  for each row execute function public.queue_encode_job();

-- Backfill: videos that finished uploading before this migration.
insert into public.encode_jobs (video_id)
select v.id from public.videos v where v.status = 'uploaded'
on conflict (video_id) do nothing;

-- published_at and channels.video_count ----------------------------------------------------

-- The first time a video is public and ready, it gets its published_at.
create or replace function public.videos_set_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'public' and new.status = 'ready' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists videos_published_at on public.videos;
create trigger videos_published_at
  before insert or update of status, visibility on public.videos
  for each row execute function public.videos_set_published_at();

-- channels.video_count is the number of public and ready videos.
create or replace function public.videos_count_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_counted boolean := tg_op <> 'INSERT' and old.visibility = 'public' and old.status = 'ready';
  is_counted boolean := tg_op <> 'DELETE' and new.visibility = 'public' and new.status = 'ready';
begin
  if was_counted and not is_counted then
    update public.channels c set video_count = greatest(c.video_count - 1, 0) where c.id = old.channel_id;
  elsif is_counted and not was_counted then
    update public.channels c set video_count = c.video_count + 1 where c.id = new.channel_id;
  end if;
  return null;
end;
$$;

drop trigger if exists videos_count_public on public.videos;
create trigger videos_count_public
  after insert or update of status, visibility or delete on public.videos
  for each row execute function public.videos_count_public();

-- Recount once, so the counts are right whatever happened before this file.
update public.channels c
   set video_count = coalesce((
     select count(*) from public.videos v
      where v.channel_id = c.id and v.visibility = 'public' and v.status = 'ready'
   ), 0)
 where c.video_count is distinct from coalesce((
     select count(*) from public.videos v
      where v.channel_id = c.id and v.visibility = 'public' and v.status = 'ready'
   ), 0);

-- Helpers ---------------------------------------------------------------------------------

-- Is the processing flag on for this video owner? Same rules as lib/flags-core.ts.
create or replace function public.processing_flag_on(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feature_flags f
    where f.key = 'processing'
      and (f.mode = 'everyone' or (f.mode = 'test' and uid = any (f.users)))
  );
$$;

-- Ends a running attempt that will not finish: queued again while attempts are
-- left, otherwise the job and its video are failed.
create or replace function public.encode_give_up_attempt(job public.encode_jobs, reason text, retry boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_reason text := left(coalesce(nullif(trim(both from reason), ''), 'encode failed'), 200);
begin
  if retry and job.attempts < public.encode_max_attempts() then
    update public.encode_jobs j
       set status = 'queued', progress = 0, worker = null, error = clean_reason, finished_at = null
     where j.id = job.id;
    -- The video stays 'processing' while it waits for the next attempt.
    return 'queued';
  end if;
  update public.encode_jobs j
     set status = 'failed', error = clean_reason, finished_at = now()
   where j.id = job.id;
  update public.videos v
     set status = 'failed', error = clean_reason
   where v.id = job.video_id;
  return 'failed';
end;
$$;

-- Worker RPCs -------------------------------------------------------------------------------

-- Hands the next queued job to this worker and marks it running, or returns no
-- row when there is nothing to do. Jobs are handed out oldest first, one at a
-- time: two workers never get the same job (for update skip locked).
-- Before that it cleans up:
--   - jobs this worker left running (it only asks when it is idle, so they died
--     with a crash or a restart)
--   - jobs any worker left running longer than encode_stale_after()
create or replace function public.claim_encode_job(worker text)
returns table (
  job_id uuid,
  video_id uuid,
  owner_id uuid,
  source_key text,
  source_bytes bigint,
  source_mime text,
  attempt int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := left(coalesce(nullif(trim(both from claim_encode_job.worker), ''), 'worker'), 100);
  dead public.encode_jobs;
  next_job public.encode_jobs;
  vid public.videos;
begin
  for dead in
    select * from public.encode_jobs j
     where j.status = 'running'
       and (j.worker = me or j.started_at < now() - public.encode_stale_after())
     for update skip locked
  loop
    perform public.encode_give_up_attempt(dead, 'the worker stopped during the encode', true);
  end loop;

  select j.* into next_job
    from public.encode_jobs j
    join public.videos v on v.id = j.video_id
   where j.status = 'queued'
     and v.status in ('uploaded', 'processing')
     and v.source_key is not null
     and public.processing_flag_on(v.owner_id)
   order by j.created_at
   limit 1
   for update of j skip locked;

  if next_job.id is null then
    return;
  end if;

  update public.encode_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         worker = me,
         started_at = now(),
         finished_at = null,
         progress = 0
   where j.id = next_job.id
  returning * into next_job;

  update public.videos v
     set status = 'processing', error = null
   where v.id = next_job.video_id
  returning * into vid;

  return query select next_job.id, vid.id, vid.owner_id, vid.source_key, vid.source_bytes, vid.source_mime,
                      next_job.attempts;
end;
$$;

-- Progress of a running job, 0 to 100. Returns false when the job is no longer
-- running (for example it was taken back as stale), so the worker can stop.
create or replace function public.encode_progress(job_id uuid, pct int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.encode_jobs j
     set progress = greatest(0, least(100, coalesce(encode_progress.pct, 0)))
   where j.id = encode_progress.job_id and j.status = 'running';
  return found;
end;
$$;

-- The encode worked: the video is ready. published_at and the channel's
-- video_count follow from the triggers above when the video is public.
-- Errors: not_found, not_running, bad_renditions
create or replace function public.encode_done(
  job_id uuid,
  duration_s numeric,
  width int,
  height int,
  hls_key text,
  thumbnail_url text,
  preview_sprite_key text,
  renditions jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_done.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'done' then
    return 'done';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if encode_done.renditions is null or jsonb_typeof(encode_done.renditions) <> 'array'
     or jsonb_array_length(encode_done.renditions) = 0 then
    raise exception 'bad_renditions' using errcode = 'P0001';
  end if;

  update public.encode_jobs j
     set status = 'done', progress = 100, error = null, finished_at = now()
   where j.id = job.id;

  update public.videos v
     set status = 'ready',
         duration_s = encode_done.duration_s,
         width = encode_done.width,
         height = encode_done.height,
         hls_key = encode_done.hls_key,
         thumbnail_url = nullif(encode_done.thumbnail_url, ''),
         preview_sprite_key = encode_done.preview_sprite_key,
         renditions = encode_done.renditions,
         error = null,
         published_at = case
           when v.visibility = 'public' then coalesce(v.published_at, now())
           else v.published_at
         end
   where v.id = job.video_id;
  return 'done';
end;
$$;

-- The encode broke. With retry (the default) the job goes back in the queue
-- until it has had encode_max_attempts() attempts; then, or right away with
-- retry = false (for example a source that does not match its size), the job
-- and the video are failed. Returns 'queued' or 'failed'.
-- Errors: not_found, not_running
create or replace function public.encode_failed(job_id uuid, error text, retry boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.encode_jobs;
begin
  select * into job from public.encode_jobs j where j.id = encode_failed.job_id for update;
  if job.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if job.status = 'failed' then
    return 'failed';
  end if;
  if job.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  return public.encode_give_up_attempt(job, encode_failed.error, coalesce(encode_failed.retry, true));
end;
$$;

-- Only the service role (the worker) calls these. Nobody calls the helpers.
revoke execute on function public.claim_encode_job(text) from public, anon, authenticated;
revoke execute on function public.encode_progress(uuid, int) from public, anon, authenticated;
revoke execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.encode_failed(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.encode_give_up_attempt(public.encode_jobs, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.processing_flag_on(uuid) from public, anon, authenticated;
revoke execute on function public.queue_encode_job() from public, anon, authenticated;
revoke execute on function public.videos_count_public() from public, anon, authenticated;

grant execute on function public.claim_encode_job(text) to service_role;
grant execute on function public.encode_progress(uuid, int) to service_role;
grant execute on function public.encode_done(uuid, numeric, int, int, text, text, text, jsonb) to service_role;
grant execute on function public.encode_failed(uuid, text, boolean) to service_role;

-- Feature flag ---------------------------------------------------------------------

insert into public.feature_flags (key, label, description, mode)
values (
  'processing',
  'Processing',
  'The encoder worker turns uploads into HLS, thumbnails and a preview sprite. Studio shows progress.',
  'off'
)
on conflict (key) do nothing;
