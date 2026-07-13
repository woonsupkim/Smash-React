// src/utils/bracketPool.js
//
// Bracket pools v1: everything lives in localStorage (per-device, anonymous)
// and travels between people as a share link with one locked bracket encoded
// in the URL. Opening a friend's link folds their bracket into your local
// pool for that tournament; the model's own bracket ("ghost") is generated
// and locked alongside yours, so every pool has the house entry to beat.
//
// A pool is keyed by tour|tournamentCsv|stage so the same device can hold
// separate pools for each slam, tour, and starting round.

const STORE = 'smash_bracket_pools_v1';

export const poolKey = (tour, tournament, stage) => `${tour}|${tournament}|${stage}`;

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) || {};
  } catch {
    return {};
  }
}

function saveStore(s) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* private browsing - pool just won't persist */
  }
}

// { mine: entry|null, ghost: entry|null, friends: entry[] }
// entry: { name, lockedAt, slots: [playerId], picks: [[playerId per round]] }
export function getPool(key) {
  return loadStore()[key] || { mine: null, ghost: null, friends: [] };
}

export function savePool(key, pool) {
  const s = loadStore();
  s[key] = pool;
  saveStore(s);
}

export function clearMine(key) {
  const pool = getPool(key);
  const next = { ...pool, mine: null, ghost: null };
  savePool(key, next);
  return next;
}

export function addFriendEntry(key, entry) {
  const pool = getPool(key);
  // Same person re-sharing an identical lock is a no-op, not a duplicate row.
  if (!pool.friends.some((f) => f.name === entry.name && f.lockedAt === entry.lockedAt)) {
    pool.friends = [...pool.friends, entry];
    savePool(key, pool);
  }
  return pool;
}

// ── Share-link encoding ────────────────────────────────────────────────
// base64url of the JSON payload; unicode-safe for typed display names.

export function encodeEntry(key, entry) {
  const json = JSON.stringify({ v: 1, k: key, e: entry });
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeEntry(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (payload?.v !== 1 || typeof payload.k !== 'string') return null;
    const e = payload.e;
    if (!e || typeof e.name !== 'string' || !Array.isArray(e.slots) || !Array.isArray(e.picks)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Scoring ────────────────────────────────────────────────────────────
// March-Madness escalation: a correct call in transition t is worth 2^t
// points, so each round's total pot stays constant and the champion call
// is worth as much as a whole opening round.
//
// realSets[t] is the Set of player ids known to have reached the round that
// picks[t] predicts (the last set holds just the champion). An empty set
// means that round hasn't been reached yet - its picks stay unscored rather
// than counting as misses.

export function scoreEntry(entry, realSets) {
  let total = 0;
  let correct = 0;
  let picksCount = 0;
  let decidedPicks = 0;
  entry.picks.forEach((roundPicks, t) => {
    picksCount += roundPicks.length;
    const real = realSets?.[t];
    if (!real || real.size === 0) return;
    decidedPicks += roundPicks.length;
    const c = roundPicks.filter((id) => real.has(id)).length;
    correct += c;
    total += c * 2 ** t;
  });
  return { total, correct, picksCount, decidedPicks };
}
