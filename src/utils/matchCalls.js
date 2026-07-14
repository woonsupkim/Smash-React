// src/utils/matchCalls.js
//
// Community pick tally: who do the fans back? Cloud-only (Supabase) - with
// no backend configured, castCall is a no-op and fetchTally returns null,
// so pages simply omit the tally and keep their localStorage-only behavior.
//
// One vote per voter per matchup, enforced by a unique constraint. A cast
// call is locked (no update/delete policies), so re-picking locally never
// re-votes the cloud tally.
import { supabase } from '../lib/supabase';

export const tallyEnabled = !!supabase;

// Stable per-browser voter id; the signed-in user id wins when available so
// one person's phone and laptop don't double-count once they sign in.
const VOTER_KEY = 'smash_voter_id';
function localVoterId() {
  try {
    let id = localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = (window.crypto?.randomUUID && window.crypto.randomUUID())
        || `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(VOTER_KEY, id);
    }
    return id;
  } catch {
    return null; // private browsing: vote silently skipped
  }
}

// Matchup key shared by H2H and the match pages: order-independent pair +
// surface + tour, so the same matchup tallies together everywhere.
export const matchCallKey = (id1, id2, surface, tour) =>
  `${[id1, id2].sort().join('_')}|${surface}|${tour}`;

// Fire-and-forget: duplicate votes (unique violation) are expected and fine.
export async function castCall(matchKey, pick, userId = null) {
  if (!supabase || !matchKey || !pick) return;
  const voter = userId || localVoterId();
  if (!voter) return;
  try {
    await supabase.from('match_calls').insert({ match_key: matchKey, voter_id: voter, pick });
  } catch { /* offline or already voted - the tally read is the truth */ }
}

// { counts: { playerId: n }, total } or null (cloud off / fetch failed).
export async function fetchTally(matchKey) {
  if (!supabase || !matchKey) return null;
  try {
    const { data, error } = await supabase
      .from('match_calls')
      .select('pick')
      .eq('match_key', matchKey)
      .limit(5000);
    if (error || !data) return null;
    const counts = {};
    for (const r of data) counts[r.pick] = (counts[r.pick] || 0) + 1;
    return { counts, total: data.length };
  } catch {
    return null;
  }
}
