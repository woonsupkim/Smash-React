/**
 * The match universe a rating model gets to learn from.
 *
 * Rating backtests are only as honest as the timeline they replay, and this
 * repo has two very different timelines available:
 *
 *   RAW  - data-pipeline/raw, the full multi-season match cache the production
 *          Elo actually trains on. Every completed tour-level match, including
 *          opponents who are NOT in the SMASH roster. Gitignored, so it exists
 *          only in the refresh/retune workflows (and locally after a fetch).
 *   TRACK - public/data/track_record.json, the committed graded record. One
 *          season, roster-vs-roster only. Always available, much smaller.
 *
 * A model tuned on TRACK and shipped against RAW is a model validated on the
 * wrong distribution, so every caller gets told which one it received and can
 * refuse to draw production conclusions from the fallback. `source` is
 * deliberately part of the return value rather than a log line.
 */
const fs = require('fs');
const path = require('path');
const { parseSets } = require('../eloCore');
const { normSurface } = require('./espnParse');

const SURFACES = new Set(['hard', 'clay', 'grass']);
const RAW_SKIP = /surfaces|map|profiles|names|budget|alert/;

/**
 * Full timeline from the raw match cache, or null when it isn't present.
 * `rostered` marks whether each side is a roster player: the production Elo
 * rates non-roster opponents too (they enter at the 1500 base), and whether
 * that helps or hurts is one of the things this loader exists to let us test.
 */
function fromRaw(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const RAW = path.join(__dirname, '..', 'raw', ns);
  const mapPath = path.join(RAW, 'player-id-map.json');
  const surfPath = path.join(RAW, 'tournament-surfaces.json');
  if (!fs.existsSync(mapPath) || !fs.existsSync(surfPath)) return null;

  const idMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([shortId, apiId]) => [String(apiId), shortId]));
  const surfaces = JSON.parse(fs.readFileSync(surfPath, 'utf8'));

  const byId = new Map();
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !RAW_SKIP.test(f))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    for (const m of (Array.isArray(j) ? j : (j.matches || j.data || []))) {
      if (m.result_type !== 'completed') continue;
      const id = String(m.id);
      if (byId.has(id)) continue;
      const p1 = String(m.player1Id || ''), p2 = String(m.player2Id || '');
      const win = String(m.match_winner || '');
      if (!p1 || !p2 || p1 === p2) continue;
      if (win !== p1 && win !== p2) continue;
      const surface = normSurface(surfaces[String(m.tournamentId)]);
      if (!SURFACES.has(surface)) continue;
      if (!m.date || isNaN(new Date(m.date))) continue;

      const winnerIsP1 = win === p1;
      const { setsW, setsL } = parseSets(m.result, winnerIsP1);
      const loser = winnerIsP1 ? p2 : p1;
      byId.set(id, {
        id,
        date: m.date,
        winnerId: win,
        loserId: loser,
        surface,
        setsW,
        setsL,
        // The API's best_of is always null in this feed, so derive it the way
        // buildTrackRecord does: a winner with three sets played best-of-five.
        bestOf: Number(m.best_of) || (setsW >= 3 ? 5 : setsW === 2 ? 3 : null),
        rostered: apiToShort.has(win) && apiToShort.has(loser),
        shortWinner: apiToShort.get(win) || null,
        shortLoser: apiToShort.get(loser) || null,
      });
    }
  }
  if (!byId.size) return null;
  return [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Fallback timeline from the committed graded record. Roster-vs-roster by
// construction, so `rostered` is always true and the non-roster experiments
// simply have nothing to vary.
function fromTrackRecord(tour) {
  const p = path.join(__dirname, '..', '..', 'public', 'data', 'track_record.json');
  if (!fs.existsSync(p)) return null;
  const rows = JSON.parse(fs.readFileSync(p, 'utf8')).matches || [];
  const out = [];
  for (const m of rows) {
    if (m.tour !== tour || !m.winner || !m.p1 || !m.p2 || m.p1 === m.p2) continue;
    if (!SURFACES.has(m.surface) || !m.date || isNaN(new Date(m.date))) continue;
    const winnerIsP1 = m.winner === m.p1;
    const { setsW, setsL } = parseSets(m.score, winnerIsP1);
    out.push({
      id: String(m.id),
      date: m.date,
      winnerId: m.winner,
      loserId: winnerIsP1 ? m.p2 : m.p1,
      surface: m.surface,
      setsW,
      setsL,
      bestOf: m.bestOf || null,
      rostered: true,
      shortWinner: m.winner,
      shortLoser: winnerIsP1 ? m.p2 : m.p1,
      row: m,
    });
  }
  return out.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * @param {'atp'|'wta'} tour
 * @param {{prefer?: 'raw'|'track'}} [opts]
 * @returns {{source:'raw'|'track', matches:Array, spanDays:number, from:string,
 *            to:string, rosterShare:number}|null}
 */
function loadUniverse(tour, opts = {}) {
  const want = opts.prefer || 'raw';
  const raw = want === 'track' ? null : fromRaw(tour);
  const matches = raw || fromTrackRecord(tour);
  if (!matches || !matches.length) return null;
  const source = raw ? 'raw' : 'track';
  const from = matches[0].date, to = matches[matches.length - 1].date;
  return {
    source,
    matches,
    from,
    to,
    spanDays: Math.round((new Date(to) - new Date(from)) / 864e5),
    rosterShare: matches.filter((m) => m.rostered).length / matches.length,
  };
}

// Every graded roster-vs-roster row, keyed by match id - the SCORING set.
// Rating models may learn from the whole universe, but they are only ever
// scored on matches the track record actually grades, so a change in training
// universe can never quietly change the denominator.
function gradedRows(tour) {
  const p = path.join(__dirname, '..', '..', 'public', 'data', 'track_record.json');
  if (!fs.existsSync(p)) return new Map();
  const rows = JSON.parse(fs.readFileSync(p, 'utf8')).matches || [];
  return new Map(rows.filter((m) => m.tour === tour && m.winner).map((m) => [String(m.id), m]));
}

module.exports = { loadUniverse, fromRaw, fromTrackRecord, gradedRows };
