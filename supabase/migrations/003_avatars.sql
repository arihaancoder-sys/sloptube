-- 003_avatars.sql
-- Storage bucket for profile pictures.
-- Public read (the files are served from a public URL), 2 MB max,
-- PNG, JPG or WebP. Each person writes only inside their own folder:
--   avatars/<user id>/<file>
-- Run after 002_profiles.sql. Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading a file by its public URL needs no policy because the bucket is
-- public. This policy only lets people list and replace their own files.
drop policy if exists "avatars: owners can list their files" on storage.objects;
create policy "avatars: owners can list their files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: owners can upload" on storage.objects;
create policy "avatars: owners can upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: owners can replace" on storage.objects;
create policy "avatars: owners can replace"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: owners can delete" on storage.objects;
create policy "avatars: owners can delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
