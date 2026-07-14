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
