-- Smash: complete cloud setup in one paste (schema + pickem + bracket challenge + push + digest).
-- Run ONCE in the Supabase SQL editor on a fresh project. (CREATE POLICY is not
-- idempotent, so re-running after success will error harmlessly on the policies.)

-- ============ supabase/schema.sql ============
-- Smash cloud pools schema. Run this once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Design notes:
--  * Lock integrity is enforced here, not in the UI: there are NO update or
--    delete policies on pool_entries, so a locked bracket is immutable even
--    against a hand-crafted API call.
--  * Reads are public (anon key) so share links work for signed-out viewers.
--  * One entry per user per pool; the model ghost entry has user_id NULL and
--    is inserted by the pool creator at creation time.

create table if not exists public.pools (
  id uuid primary key default gen_random_uuid(),
  key text not null,                                   -- tour|tournamentCsv|stage
  name text not null default 'Bracket pool',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.pool_entries (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools (id) on delete cascade,
  user_id uuid references auth.users (id),             -- null for the model ghost
  display_name text not null check (char_length(display_name) between 1 and 24),
  is_ghost boolean not null default false,
  slots jsonb not null,                                -- [playerId, ...]
  picks jsonb not null,                                -- [[round-1 winners], [round-2], ...]
  locked_at timestamptz not null default now(),
  unique (pool_id, user_id)
);

create index if not exists pool_entries_pool_idx on public.pool_entries (pool_id);
create index if not exists pool_entries_user_idx on public.pool_entries (user_id);
create index if not exists pools_key_idx on public.pools (key);

alter table public.pools enable row level security;
alter table public.pool_entries enable row level security;

-- Anyone with a share link can view a pool and its standings, signed in or not.
create policy "pools are readable by anyone"
  on public.pools for select using (true);
create policy "entries are readable by anyone"
  on public.pool_entries for select using (true);

-- Only signed-in users create pools, and only as themselves.
create policy "signed-in users create pools"
  on public.pools for insert
  with check (auth.uid() = created_by);

-- A user may insert their own entry; the pool creator may insert the one
-- ghost entry. No update/delete policies exist: locked means locked.
create policy "users lock their own entry"
  on public.pool_entries for insert
  with check (
    (auth.uid() = user_id and is_ghost = false)
    or (
      user_id is null and is_ghost = true
      and exists (select 1 from public.pools p where p.id = pool_id and p.created_by = auth.uid())
    )
  );

-- ── Community match calls ("who do the fans back?") ────────────────────────
--  * Open to everyone, signed in or not: voter_id is a client-generated id
--    (the signed-in user id when available). It's a fan tally, not a ballot.
--  * One vote per voter per matchup via the unique constraint, and no update
--    or delete policies: a cast call is locked, same as everything else.
create table if not exists public.match_calls (
  id uuid primary key default gen_random_uuid(),
  match_key text not null check (char_length(match_key) between 5 and 120),
  voter_id text not null check (char_length(voter_id) between 8 and 64),
  pick text not null check (char_length(pick) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (match_key, voter_id)
);

create index if not exists match_calls_key_idx on public.match_calls (match_key);

alter table public.match_calls enable row level security;

create policy "tallies are readable by anyone"
  on public.match_calls for select using (true);
create policy "anyone can cast a call"
  on public.match_calls for insert with check (true);

-- ============ supabase/pickem.sql ============
-- Smash pick'em: beat the model, one pick per locked match. Run this once
-- in the Supabase SQL editor (after schema.sql).
--
-- Design notes:
--  * Lock integrity is enforced here, not in the UI: no update or delete
--    policies, so a pick can't be changed after it's cast - the same
--    no-take-backs rule the model lives under.
--  * match_id is the prediction id from predictions.json; grading happens
--    CLIENT-side by joining against the public predictions file, so the
--    database never needs to know results. The leaderboard view only
--    aggregates pick counts; win rates are computed in the app.
--  * display_name is denormalized onto every pick so the leaderboard needs
--    no join against auth.users (which anon can't read anyway).

create table if not exists public.pickem_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  match_id text not null,
  pick text not null,                     -- roster player id the user backs
  match_date timestamptz,                 -- kickoff at cast time (client-supplied)
  created_at timestamptz not null default now(),
  unique (user_id, match_id)
);

create index if not exists pickem_match_idx on public.pickem_picks (match_id);
create index if not exists pickem_user_idx on public.pickem_picks (user_id);

alter table public.pickem_picks enable row level security;

-- The leaderboard is public: anyone can read picks (they're public calls,
-- that's the point of the game).
create policy "picks are readable by anyone"
  on public.pickem_picks for select using (true);

-- Signed-in users cast picks as themselves. No update/delete: no take-backs.
create policy "users cast their own picks"
  on public.pickem_picks for insert
  with check (auth.uid() = user_id);

-- ============ supabase/bracket_challenge.sql ============
-- Smash Slam Bracket Challenge: one locked bracket per user per slam.
-- Run once in the Supabase SQL editor (after schema.sql / pickem.sql).
--
-- Same design rules as pick'em:
--  * Insert-only. No update/delete policies = no take-backs after lock,
--    the rule the model itself plays under.
--  * Grading happens CLIENT-side against the public ledger + draw files,
--    so the database stores only the picks.
--  * display_name denormalized so the leaderboard needs no auth.users join.
--  * event_key example: "atp-us-open-2026". picks is the full bracket:
--    { "r16": [8 ids], "qf": [4 ids], "sf": [2 ids], "f": [1 id] }.

create table if not exists public.bracket_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  event_key text not null,
  picks jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

create index if not exists bracket_event_idx on public.bracket_entries (event_key);

alter table public.bracket_entries enable row level security;

create policy "brackets are readable by anyone"
  on public.bracket_entries for select using (true);

create policy "users lock their own bracket"
  on public.bracket_entries for insert
  with check (auth.uid() = user_id);

-- ============ supabase/push.sql ============
-- Web-push subscriptions for upset alerts. Run once in the Supabase SQL
-- editor. Anonymous browsers subscribe (no account needed for alerts), so:
--  * insert: open to anon - a subscription is just a delivery address.
--  * delete: NO anon policy. RLS can't verify "you own this endpoint" for
--    an anonymous caller, and `using (true)` would let anyone wipe the
--    table. Unsubscribing works without it: the browser-side unsubscribe
--    stops delivery immediately, and the pipeline sender prunes the dead
--    row on the next send (404/410 cleanup in sendPush.js).
--  * select: NO anon policy. Only the service-role key (used by the
--    pipeline sender in CI) can read the list - subscriber endpoints are
--    not public data.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,            -- { p256dh, auth } from PushSubscription.toJSON()
  user_id uuid references auth.users (id), -- optional: signed-in subscribers get personal recaps
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "anyone can subscribe"
  on public.push_subscriptions for insert
  with check (true);

-- ============ supabase/digest.sql ============
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
