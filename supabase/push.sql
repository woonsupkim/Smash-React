-- Web-push subscriptions for upset alerts. Run once in the Supabase SQL
-- editor. Anonymous browsers subscribe (no account needed for alerts), so:
--  * insert: open to anon - a subscription is just a delivery address.
--  * delete: allowed only when the caller names the exact endpoint URL,
--    which is an unguessable capability only that browser holds.
--  * select: NO anon policy. Only the service-role key (used by the
--    pipeline sender in CI) can read the list - subscriber endpoints are
--    not public data.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,            -- { p256dh, auth } from PushSubscription.toJSON()
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "anyone can subscribe"
  on public.push_subscriptions for insert
  with check (true);

create policy "unsubscribe by endpoint"
  on public.push_subscriptions for delete
  using (true);
