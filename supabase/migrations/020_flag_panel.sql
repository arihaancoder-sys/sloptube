-- 020_flag_panel.sql
-- Feature 17: the flag panel. A small floating panel inside the site
-- (Ctrl+Shift+S, admins only) that flips feature flags for the demo, so the
-- owner does not have to open the table editor on camera.
--
-- feature_flags has no update policy on purpose (001): the API roles cannot
-- write to it. The panel goes through one security definer function instead,
-- which checks is_admin() (016) and validates the mode before it touches a row.
-- Every change still goes through the feature_flags_touch trigger, so
-- updated_at stays honest.
--
-- Modes, as in 001:
--   off       hidden for everyone
--   test      only for the user ids listed in "users"; the panel calls it "Me"
--             and this function makes sure the caller is listed
--   everyone  on for all
--
-- Safe to run more than once.

create or replace function public.set_feature_flag(p_key text, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  row_users uuid[];
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('off', 'test', 'everyone') then
    raise exception 'bad_mode' using errcode = 'P0001';
  end if;

  select f.users into row_users
    from public.feature_flags f
   where f.key = p_key
     for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- "Me": test mode with the caller listed. Other listed ids stay, so a test
  -- account added by hand keeps seeing the feature.
  if p_mode = 'test' and not (me = any (coalesce(row_users, '{}'::uuid[]))) then
    row_users := coalesce(row_users, '{}'::uuid[]) || me;
  end if;

  update public.feature_flags f
     set mode = p_mode,
         users = coalesce(row_users, '{}'::uuid[])
   where f.key = p_key;

  return jsonb_build_object(
    'key', p_key,
    'mode', p_mode,
    'users', to_jsonb(coalesce(row_users, '{}'::uuid[]))
  );
end;
$$;

revoke execute on function public.set_feature_flag(text, text) from public;
revoke execute on function public.set_feature_flag(text, text) from anon;
grant execute on function public.set_feature_flag(text, text) to authenticated;

-- The panel's own flag. It starts on: the panel only ever shows for admins
-- (is_admin()), and it is the tool that flips the other flags, so a switched
-- off panel would send the owner back to the table editor. Turn it off here
-- to hide the panel and its shortcut for every admin.
insert into public.feature_flags (key, label, description, mode)
values (
  'flag_panel',
  'Flag panel',
  'The floating flags panel for admins, Ctrl+Shift+S (Cmd+Shift+S on a Mac). Each switch changes the real flag in this table.',
  'everyone'
)
on conflict (key) do nothing;
