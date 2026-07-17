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
