-- MIGRATION (run once in the Supabase SQL editor, after digest.sql):
-- gives every digest subscriber an unguessable unsubscribe token and a safe
-- way to use it.
--
-- Why a function instead of a delete policy: the obvious approach is an anon
-- DELETE policy, but a policy broad enough for anon to delete by token is a
-- policy broad enough to be abused, and this project already had to remove
-- exactly that mistake on push_subscriptions (see fix_push_delete.sql).
-- A SECURITY DEFINER function runs as its owner, so anon never gets table
-- rights at all: it can only ask "delete the row whose token is exactly
-- this", and a uuid it does not hold is not guessable.
--
-- Re-runnable: safe to execute more than once.

-- 1. The token. gen_random_uuid() is volatile, so each EXISTING row gets its
--    own distinct value rather than one shared default.
alter table public.digest_subscribers
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists digest_subscribers_unsubscribe_token_key
  on public.digest_subscribers (unsubscribe_token);

-- 2. The only way anon may remove a row. Returns true when a row was actually
--    removed, false for an unknown or already-used token, so the endpoint can
--    tell "you are unsubscribed" from "that link is not valid" without ever
--    revealing whether an address exists.
create or replace function public.digest_unsubscribe(token uuid)
returns boolean
language plpgsql
security definer
-- Pin the search path: without this, a caller-controlled search_path could
-- point the unqualified names below at objects they control.
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.digest_subscribers where unsubscribe_token = token;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- 3. Execute rights: anon and the browser role, nothing more. The table itself
--    stays unreadable to them (digest.sql grants no anon SELECT).
revoke all on function public.digest_unsubscribe(uuid) from public;
grant execute on function public.digest_unsubscribe(uuid) to anon, authenticated;
