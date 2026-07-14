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

// Tunable Elo hyperparameters, validated by walk-forward log-loss in
// data-pipeline/experiments.js. rho = weight on the OVERALL rating in the
// predicting blend (1-rho on the surface rating). marginK scales rating
// updates by match dominance: a straight-sets win moves ratings more than a
// deciding-set escape (mult runs 0.7 for the narrowest win to 1.3 for a
// sweep). Values live in src/engineConfig.json (elo section) so the app,
// the pipeline, and the tuner all read the same ones.
const DEFAULT_PARAMS = (() => {
  try { return { rho: 0.5, marginK: false, ...require('../src/engineConfig.json').elo }; }
  catch { return { rho: 0.5, marginK: false }; }
})();
let PARAMS = { ...DEFAULT_PARAMS };
function setEloParams(p) { PARAMS = { ...DEFAULT_PARAMS, ...p }; }

// Dominance multiplier from set counts (null-safe: no sets info -> 1).
function marginMult(setsW, setsL, bestOf) {
  if (!PARAMS.marginK || setsW == null || setsL == null) return 1;
  const target = Math.ceil((bestOf || (setsW > 2 ? 5 : 3)) / 2);
  if (target <= 1) return 1;
  const margin = Math.max(1, setsW - setsL);
  return 0.7 + 0.6 * ((margin - 1) / (target - 1));
}

function newRating() {
  return { all: BASE, hard: BASE, clay: BASE, grass: BASE, n: 0, ns: { hard: 0, clay: 0, grass: 0 } };
}

// Predicting rating for a player on a surface (overall + surface blend).
function predElo(r, surface) {
  const surf = r[surface] != null ? r[surface] : BASE;
  return PARAMS.rho * r.all + (1 - PARAMS.rho) * surf;
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

    const mult = marginMult(m.setsW, m.setsL, m.bestOf);

    // Overall
    const ew = expected(rw.all, rl.all);
    rw.all += mult * kFactor(rw.n) * (1 - ew);
    rl.all -= mult * kFactor(rl.n) * (1 - ew);
    rw.n++; rl.n++;

    // Surface
    const s = m.surface;
    const ews = expected(rw[s], rl[s]);
    rw[s] += mult * kFactor(rw.ns[s]) * (1 - ews);
    rl[s] -= mult * kFactor(rl.ns[s]) * (1 - ews);
    rw.ns[s]++; rl.ns[s]++;
  }
  return ratings;
}

// Parses "3-6 6-4 7-6(4)" into winner/loser set counts. Returns nulls when
// the result string is missing or malformed (walkover, retirement mid-set).
function parseSets(result, winnerIsP1) {
  if (!result) return { setsW: null, setsL: null };
  let s1 = 0, s2 = 0;
  for (const part of String(result).trim().split(/\s+/)) {
    const m = part.match(/^(\d+)-(\d+)/);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > b) s1++; else if (b > a) s2++;
  }
  if (s1 + s2 === 0) return { setsW: null, setsL: null };
  return winnerIsP1 ? { setsW: s1, setsL: s2 } : { setsW: s2, setsL: s1 };
}

module.exports = { BASE, expected, kFactor, newRating, predElo, winProbElo, buildTimeline, setEloParams, parseSets, DEFAULT_PARAMS };
