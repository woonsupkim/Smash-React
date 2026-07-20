-- Weekly digest subscribers. Run once in the Supabase SQL editor.
--  * insert: open to anon - subscribing is just leaving an address.
--  * select/update/delete: NO anon policies. Only the service-role key
--    (used by the digest sender in CI) can read the list - subscriber
--    emails are private data, never exposed to the client.
-- Unsubscribes are handled by reply/mailto for now (the digest footer says
-- so); a tokenized unsubscribe link can come later without a schema change.

create table if not exists public.digest_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (position('@' in email) > 1),
  created_at timestamptz not null default now()
);

alter table public.digest_subscribers enable row level security;

create policy "anyone can subscribe to the digest"
  on public.digest_subscribers for insert
  with check (true);
