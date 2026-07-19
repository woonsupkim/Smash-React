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
