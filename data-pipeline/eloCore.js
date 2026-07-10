/**
 * Surface-aware Elo ratings from cached match history, shared by
 * computeElo.js (writes current ratings for the live H2H blend) and
 * buildTrackRecord.js (replays the timeline to capture leak-free pre-match
 * ratings for the retrospective measurement).
 *
 * Each player carries an overall rating plus one per surface; the predicting
 * rating blends the two (0.5/0.5), FiveThirtyEight-style, so sparse-surface
 * players lean on their overall level instead of pure noise.
 */
const BASE = 1500;

const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

// K-factor shrinks as a player accumulates matches - big early swings,
// stable once established.
const kFactor = (n) => 250 / Math.pow(n + 5, 0.4);

function newRating() {
  return { all: BASE, hard: BASE, clay: BASE, grass: BASE, n: 0, ns: { hard: 0, clay: 0, grass: 0 } };
}

// Predicting rating for a player on a surface (overall + surface blend).
function predElo(r, surface) {
  const surf = r[surface] != null ? r[surface] : BASE;
  return 0.5 * r.all + 0.5 * surf;
}

// P(A beats B) on a surface, from two rating objects.
function winProbElo(rA, rB, surface) {
  return expected(predElo(rA, surface), predElo(rB, surface));
}

/**
 * Replays matches in date order, updating ratings. `onMatch(m, rWinner,
 * rLoser)` fires BEFORE each update so callers can snapshot pre-match ratings.
 * @param {{date,winnerId,loserId,surface}[]} matches
 * @returns {Map<string, rating>} final ratings by player id
 */
function buildTimeline(matches, onMatch) {
  const ratings = new Map();
  const get = (id) => {
    if (!ratings.has(id)) ratings.set(id, newRating());
    return ratings.get(id);
  };
  const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const m of sorted) {
    if (!m.winnerId || !m.loserId || !m.surface || m.winnerId === m.loserId) continue;
    const rw = get(m.winnerId), rl = get(m.loserId);
    if (onMatch) onMatch(m, rw, rl);

    // Overall
    const ew = expected(rw.all, rl.all);
    rw.all += kFactor(rw.n) * (1 - ew);
    rl.all -= kFactor(rl.n) * (1 - ew);
    rw.n++; rl.n++;

    // Surface
    const s = m.surface;
    const ews = expected(rw[s], rl[s]);
    rw[s] += kFactor(rw.ns[s]) * (1 - ews);
    rl[s] -= kFactor(rl.ns[s]) * (1 - ews);
    rw.ns[s]++; rl.ns[s]++;
  }
  return ratings;
}

module.exports = { BASE, expected, kFactor, newRating, predElo, winProbElo, buildTimeline };
