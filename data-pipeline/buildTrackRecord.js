/**
 * Builds public/data/track_record.json — every completed 2026 tour-level
 * singles match where BOTH players are in the SMASH roster, for both tours,
 * across all surfaces (not just the Grand Slams). For each match we PRECOMPUTE
 * the model's prediction here (season model + upset model + rank baseline) by
 * running the same Monte Carlo simulation the app uses, so the Track Record
 * page loads instantly instead of simulating ~1200 matches in the browser.
 *
 * Match data comes from the per-player caches in data-pipeline/raw/ — each
 * match appears in both players' files, so results are deduped by match id.
 * Surface is resolved per tournament from raw/tournament-surfaces.json.
 *
 * Usage: node buildTrackRecord.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const SIMS = 1000;

// ── Simulation core (kept in sync with src/simulator.js) ──────────────────
// A CRA app can't share its ESM simulator with a CommonJS pipeline script
// without build tooling, so the point/game/set logic is mirrored here. Only
// the win-probability is needed, so tie-break point tracking is omitted.
function simPoint(srv, rtn) {
  if (Math.random() < srv[0]) {
    if (Math.random() < (srv[5] || 0)) return 0;
    if (Math.random() < rtn[2]) return Math.random() < srv[4] ? 0 : 1;
    return 0;
  }
  if (Math.random() < srv[1]) {
    if (Math.random() < rtn[3]) return Math.random() < srv[4] ? 0 : 1;
    return 0;
  }
  return 1;
}
function simGame(s, r) {
  const p = [0, 0];
  while (true) {
    p[simPoint(s, r)]++;
    if ((p[0] >= 4 || p[1] >= 4) && Math.abs(p[0] - p[1]) >= 2) return p[0] > p[1] ? 0 : 1;
  }
}
function simTiebreak(a, b, srv) {
  const s = [0, 0];
  let pt = 0;
  while (true) {
    const server = pt === 0 ? srv : (Math.floor((pt - 1) / 2) % 2 === 0 ? 1 - srv : srv);
    const w = server === 0 ? simPoint(a, b) : simPoint(b, a);
    if (server === 0) { if (w === 0) s[0]++; else s[1]++; }
    else { if (w === 0) s[1]++; else s[0]++; }
    pt++;
    if ((s[0] >= 7 || s[1] >= 7) && Math.abs(s[0] - s[1]) >= 2) return s[0] > s[1] ? 0 : 1;
  }
}
function simSet(a, b) {
  const g = [0, 0];
  let server = Math.random() < 0.5 ? 0 : 1;
  while (true) {
    const w = simGame(server === 0 ? a : b, server === 0 ? b : a);
    if (w === 0) { if (server === 0) g[0]++; else g[1]++; }
    else { if (server === 0) g[1]++; else g[0]++; }
    server = 1 - server;
    if ((g[0] >= 6 || g[1] >= 6) && Math.abs(g[0] - g[1]) >= 2) break;
    if (g[0] === 6 && g[1] === 6) { if (simTiebreak(a, b, server) === 0) g[0]++; else g[1]++; break; }
  }
  return g[0] > g[1] ? 0 : 1;
}
function simMatch(a, b, bestOf) {
  const target = Math.ceil(bestOf / 2);
  const won = [0, 0];
  while (Math.max(won[0], won[1]) < target) won[simSet(a, b)]++;
  return won[0] > won[1] ? 0 : 1;
}
function winProb(a, b, n, bestOf) {
  let w0 = 0;
  for (let i = 0; i < n; i++) if (simMatch(a, b, bestOf) === 0) w0++;
  return w0 / n;
}

// ── Stats loading ─────────────────────────────────────────────────────────
const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

function loadStats(tour, upset) {
  const ns = tour === 'wta' ? 'women' : '';
  const dir = path.join(__dirname, '..', 'public', 'data', ns);
  const bySurface = {};
  for (const [surface, file] of Object.entries(SURFACE_CSV)) {
    const f = upset ? file.replace('.csv', '_upset.csv') : file;
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { bySurface[surface] = new Map(); continue; }
    const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
    bySurface[surface] = new Map(rows.map((r) => [r.id, r]));
  }
  return bySurface;
}

const probsFromRow = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);

// Normalize the surface map's labels (e.g. "I.hard" indoor hard → hard).
function normSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard')) return 'hard';
  if (s.includes('carpet')) return 'hard';
  return null;
}

function collect(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const RAW = path.join(__dirname, 'raw', ns);
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([shortId, apiId]) => [String(apiId), shortId]));
  const surfaces = JSON.parse(fs.readFileSync(path.join(RAW, 'tournament-surfaces.json'), 'utf8'));
  const bestOf = tour === 'wta' ? 3 : 5;

  const season = loadStats(tour, false);
  const upset = loadStats(tour, true);

  const out = new Map();
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    const matches = Array.isArray(j) ? j : (j.matches || j.data || []);
    for (const m of matches) {
      if (m.result_type !== 'completed') continue;
      const d = new Date(m.date);
      if (isNaN(d) || d < new Date('2026-01-01') || d > new Date('2026-12-31')) continue;
      const p1 = apiToShort.get(String(m.player1Id));
      const p2 = apiToShort.get(String(m.player2Id));
      if (!p1 || !p2) continue;                 // roster-vs-roster only
      const winner = apiToShort.get(String(m.match_winner));
      if (!winner) continue;
      if (out.has(String(m.id))) continue;
      const surface = normSurface(surfaces[String(m.tournamentId)]);
      if (!surface) continue;                   // need a surface to pick stats
      const rowA = season[surface].get(p1), rowB = season[surface].get(p2);
      if (!rowA || !rowB) continue;             // both must have stats on this surface
      out.set(String(m.id), { m, p1, p2, surface, bestOf, winner, rowA, rowB, season, upset });
    }
  }
  return [...out.values()];
}

function evaluate(rec) {
  const { m, p1, p2, surface, bestOf, winner, rowA, rowB, season, upset } = rec;

  // 1. season model
  const probP1 = winProb(probsFromRow(rowA), probsFromRow(rowB), SIMS, bestOf);
  const favorite = probP1 >= 0.5 ? p1 : p2;
  const favProb = probP1 >= 0.5 ? probP1 : 1 - probP1;

  // 2. upset model (falls back to season stats where recent data is thin)
  const upA = upset[surface].get(p1) || rowA;
  const upB = upset[surface].get(p2) || rowB;
  const upsetProbP1 = winProb(probsFromRow(upA), probsFromRow(upB), SIMS, bestOf);
  const upsetFavorite = upsetProbP1 >= 0.5 ? p1 : p2;

  // 3. rank baseline (lower us_seed = higher ranked)
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankPick = rankA <= rankB ? p1 : p2;

  return {
    id: String(m.id),
    tour: rec.tour,
    surface,
    date: m.date,
    p1, p2,
    name1: m.player1?.name || p1,
    name2: m.player2?.name || p2,
    country1: m.player1?.countryAcr || '',
    country2: m.player2?.countryAcr || '',
    winner,
    score: m.result || '',
    probP1: Math.round(probP1 * 1000) / 1000,
    favorite,
    favProb: Math.round(favProb * 1000) / 1000,
    correct: favorite === winner,
    upsetProbP1: Math.round(upsetProbP1 * 1000) / 1000,
    upsetFavorite,
    upsetCorrect: upsetFavorite === winner,
    upsetHasData: !!(upset[surface].get(p1) && upset[surface].get(p2)),
    rankPick,
    rankCorrect: rankPick === winner,
    p1Won: winner === p1,
  };
}

const all = [];
for (const tour of ['atp', 'wta']) {
  const recs = collect(tour).map((r) => ({ ...r, tour }));
  process.stdout.write(`Simulating ${recs.length} ${tour.toUpperCase()} matches (${SIMS} sims each)…\n`);
  for (const r of recs) all.push(evaluate(r));
}
all.sort((a, b) => new Date(a.date) - new Date(b.date));

const summary = {};
for (const r of all) {
  const k = `${r.tour}-${r.surface}`;
  summary[k] = (summary[k] || 0) + 1;
}
console.log('Matches:', summary, 'total', all.length);

const outPath = path.join(__dirname, '..', 'public', 'data', 'track_record.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sims: SIMS, matches: all }));
console.log(`Wrote ${all.length} matches to ${outPath}`);
