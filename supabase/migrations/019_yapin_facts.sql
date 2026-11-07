-- 019_yapin_facts.sql
-- Yapin' integration, matched to how Yapin' really works (feature 16b).
--
-- Sign in
-- - Yapin' has one OAuth scope, identify, and never shares an email address.
--   So nobody is ever matched by email any more: yapin_find_user(yapin_id)
--   only finds the account linked to that Yapin' id. The old two argument
--   yapin_find_user(yapin_id, email) from 018 is dropped.
-- - A new account made by Sign in with Yapin' gets a placeholder address,
--   yapin_<id>@users.noreply.<site host>, because Supabase auth needs one.
--   profiles.email_placeholder (not readable through the API) marks it, set by
--   yapin_mark_placeholder(user_id) (service role only) and cleared by a
--   trigger on auth.users when the person adds a real address in Settings.
--   Nothing should ever mail an account with email_placeholder = true.
-- - unlink_yapin() refuses with needs_email while the account has only the
--   placeholder: Yapin' is then the only way in. yapin_status() also answers
--   needs_email so Settings can say so.
--
-- Announcements
-- - Yapin' incoming webhooks are https://<host>/api/webhooks/<id>/<token> on
--   yapin.gg, www.yapin.gg, yapper.website or www.yapper.website (one service
--   on two domains). yapin_webhook_is_valid() checks exactly that now, and the
--   check on yapin_webhooks is re-made with it. Saved URLs that do not match
--   (other subdomains or paths, which Yapin' never serves) are removed first,
--   with their queued posts marked failed.
--
-- Errors (the message, P0001): needs_email (new), plus those of 018.
--
-- Keep the checks in step with lib/yapin/rules.ts and worker/lib/yapin.mjs.
--
-- Run after 018_yapin.sql. Safe to run more than once.

-- Webhook URLs ------------------------------------------------------------------------------

create or replace function public.yapin_webhook_is_valid(url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select url is not null
     and char_length(url) <= 500
     and url ~ '^https://(www\.)?(yapin\.gg|yapper\.website)/api/webhooks/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$';
$$;

-- Queued posts on a webhook that is about to go: failed, with the reason.
update public.yapin_posts p
   set status = 'failed', error = 'not a Yapin'' webhook URL', finished_at = now()
  from public.yapin_webhooks w
 where w.id = p.webhook_id
   and p.status in ('queued', 'sending')
   and not public.yapin_webhook_is_valid(w.url);

delete from public.yapin_webhooks w where not public.yapin_webhook_is_valid(w.url);

-- Re-made so the check is validated again with the function above.
alter table public.yapin_webhooks drop constraint if exists yapin_webhooks_url_valid;
alter table public.yapin_webhooks add constraint yapin_webhooks_url_valid check (public.yapin_webhook_is_valid(url));

-- Placeholder email addresses ------------------------------------------------------------------

-- Same check as isPlaceholderEmail in lib/yapin/rules.ts.
create or replace function public.yapin_is_placeholder_email(email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select email is not null and email ~* '^yapin_[a-z0-9_-]+@users\.noreply\.[^@[:space:]]+$';
$$;

-- Not readable through the API: 002 grants select on named columns only.
alter table public.profiles add column if not exists email_placeholder boolean not null default false;

-- Marks a new Sign in with Yapin' account. Only when its address really is a placeholder.
create or replace function public.yapin_mark_placeholder(user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.profiles p
     set email_placeholder = true
    from auth.users u
   where p.id = yapin_mark_placeholder.user_id
     and u.id = p.id
     and public.yapin_is_placeholder_email(u.email::text);
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- A real address (confirmed through Supabase's email change) clears the mark.
create or replace function public.yapin_email_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and not public.yapin_is_placeholder_email(new.email::text) then
    update public.profiles p set email_placeholder = false where p.id = new.id and p.email_placeholder;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed_yapin on auth.users;
create trigger on_auth_user_email_changed_yapin
  after update of email on auth.users
  for each row execute function public.yapin_email_changed();

-- Sign in and linking ------------------------------------------------------------------------------

-- The account linked to this Yapin' id, if any. Never by email.
drop function if exists public.yapin_find_user(text, text);
drop function if exists public.yapin_find_user(text);
create function public.yapin_find_user(yapin_id text)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
   where p.yapin_id = yapin_find_user.yapin_id
   limit 1;
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
  if exists (select 1 from public.profiles p where p.id = me and p.email_placeholder) then
    raise exception 'needs_email' using errcode = 'P0001';
  end if;
  update public.profiles p set yapin_id = null, yapin_username = null where p.id = me;
end;
$$;

drop function if exists public.yapin_status();
create function public.yapin_status()
returns table (linked boolean, yapin_username text, needs_email boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := public.yapin_caller();
begin
  return query select p.yapin_id is not null, p.yapin_username, p.email_placeholder from public.profiles p where p.id = me;
end;
$$;

-- Grants -------------------------------------------------------------------------------------------

revoke execute on function public.yapin_find_user(text) from public, anon, authenticated;
revoke execute on function public.yapin_mark_placeholder(uuid) from public, anon, authenticated;
revoke execute on function public.yapin_email_changed() from public, anon, authenticated;
revoke execute on function public.unlink_yapin() from public;
revoke execute on function public.yapin_status() from public;

grant execute on function public.yapin_find_user(text) to service_role;
grant execute on function public.yapin_mark_placeholder(uuid) to service_role;
grant execute on function public.unlink_yapin() to authenticated;
grant execute on function public.yapin_status() to authenticated;
