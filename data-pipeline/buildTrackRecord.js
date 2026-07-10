/**
 * Builds public/data/track_record.json — every completed 2026 tour-level
 * singles match where BOTH players are in the SMASH roster, for both tours,
 * across all surfaces. For each match we PRECOMPUTE four predictions:
 *   1. season model  — point simulation on recency-weighted surface stats
 *   2. upset model    — point simulation on 7-day hot-form stats
 *   3. rank baseline  — higher-ranked player wins
 *   4. sim + Elo blend — 50/50 blend of the season sim and a surface Elo
 * The Elo uses leak-free PRE-MATCH ratings (replayed chronologically), so the
 * blend is measured honestly. The page just reads this JSON — no client sim.
 *
 * Usage: node buildTrackRecord.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { buildTimeline, predElo, expected } = require('./eloCore');
const ENGINE = require('../src/engineConfig.json'); // per tour x surface blend weights

const SIMS = 1000;

// ── Simulation core (mirrors src/simulator.js) ────────────────────────────
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
  while (true) { p[simPoint(s, r)]++; if ((p[0] >= 4 || p[1] >= 4) && Math.abs(p[0] - p[1]) >= 2) return p[0] > p[1] ? 0 : 1; }
}
function simTiebreak(a, b, srv) {
  const s = [0, 0]; let pt = 0;
  while (true) {
    const server = pt === 0 ? srv : (Math.floor((pt - 1) / 2) % 2 === 0 ? 1 - srv : srv);
    const w = server === 0 ? simPoint(a, b) : simPoint(b, a);
    if (server === 0) { if (w === 0) s[0]++; else s[1]++; } else { if (w === 0) s[1]++; else s[0]++; }
    pt++;
    if ((s[0] >= 7 || s[1] >= 7) && Math.abs(s[0] - s[1]) >= 2) return s[0] > s[1] ? 0 : 1;
  }
}
function simSet(a, b) {
  const g = [0, 0]; let server = Math.random() < 0.5 ? 0 : 1;
  while (true) {
    const w = simGame(server === 0 ? a : b, server === 0 ? b : a);
    if (w === 0) { if (server === 0) g[0]++; else g[1]++; } else { if (server === 0) g[1]++; else g[0]++; }
    server = 1 - server;
    if ((g[0] >= 6 || g[1] >= 6) && Math.abs(g[0] - g[1]) >= 2) break;
    if (g[0] === 6 && g[1] === 6) { if (simTiebreak(a, b, server) === 0) g[0]++; else g[1]++; break; }
  }
  return g[0] > g[1] ? 0 : 1;
}
function simMatch(a, b, bestOf) {
  const target = Math.ceil(bestOf / 2); const won = [0, 0];
  while (Math.max(won[0], won[1]) < target) won[simSet(a, b)]++;
  return won[0] > won[1] ? 0 : 1;
}
function winProb(a, b, n, bestOf) { let w0 = 0; for (let i = 0; i < n; i++) if (simMatch(a, b, bestOf) === 0) w0++; return w0 / n; }

// ── Stats + surface helpers ───────────────────────────────────────────────
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

function normSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
}

// ── Collection ────────────────────────────────────────────────────────────
function loadTour(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const RAW = path.join(__dirname, 'raw', ns);
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([shortId, apiId]) => [String(apiId), shortId]));
  const surfaces = JSON.parse(fs.readFileSync(path.join(RAW, 'tournament-surfaces.json'), 'utf8'));
  const season = loadStats(tour, false);
  const upset = loadStats(tour, true);

  const allMatches = new Map();  // id -> {date,winnerId,loserId,surface} for the Elo timeline
  const evalMatches = new Map(); // id -> rec for scoring (roster-vs-roster with stats, 2026)
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    for (const m of (Array.isArray(j) ? j : (j.matches || j.data || []))) {
      if (m.result_type !== 'completed') continue;
      const id = String(m.id);
      const winId = String(m.match_winner || '');
      const p1Id = String(m.player1Id || ''), p2Id = String(m.player2Id || '');
      if (!winId || (winId !== p1Id && winId !== p2Id)) continue;
      const surface = normSurface(surfaces[String(m.tournamentId)]);
      if (!surface) continue;

      if (!allMatches.has(id)) allMatches.set(id, { id, date: m.date, winnerId: winId, loserId: winId === p1Id ? p2Id : p1Id, surface });

      const d = new Date(m.date);
      if (isNaN(d) || d < new Date('2026-01-01') || d > new Date('2026-12-31')) continue;
      const p1 = apiToShort.get(p1Id), p2 = apiToShort.get(p2Id);
      if (!p1 || !p2) continue;
      const winner = apiToShort.get(winId);
      if (!winner || evalMatches.has(id)) continue;
      const rowA = season[surface].get(p1), rowB = season[surface].get(p2);
      if (!rowA || !rowB) continue;
      evalMatches.set(id, { m, id, p1, p2, p1Id, p2Id, surface, winner, rowA, rowB });
    }
  }

  // Replay the full timeline, snapshotting pre-match predicting Elos for the
  // matches we score.
  const preElo = new Map();
  buildTimeline([...allMatches.values()], (mm, rw, rl) => {
    if (!evalMatches.has(mm.id)) return;
    preElo.set(mm.id, { winnerId: mm.winnerId, we: predElo(rw, mm.surface), le: predElo(rl, mm.surface) });
  });

  return { tour, season, upset, evalMatches, preElo, bestOf: tour === 'wta' ? 3 : 5 };
}

function evaluate(ctx, rec) {
  const { season, upset, preElo, bestOf, tour } = ctx;
  const { m, id, p1, p2, p1Id, surface, winner, rowA, rowB } = rec;

  // 1. season model
  const probP1 = winProb(probsFromRow(rowA), probsFromRow(rowB), SIMS, bestOf);
  const favorite = probP1 >= 0.5 ? p1 : p2;
  const favProb = probP1 >= 0.5 ? probP1 : 1 - probP1;

  // 2. upset model
  const upA = upset[surface].get(p1) || rowA;
  const upB = upset[surface].get(p2) || rowB;
  const upsetProbP1 = winProb(probsFromRow(upA), probsFromRow(upB), SIMS, bestOf);
  const upsetFavorite = upsetProbP1 >= 0.5 ? p1 : p2;

  // 3. rank baseline
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankPick = rankA <= rankB ? p1 : p2;

  // 4. Elo model (leak-free pre-match ratings)
  const pe = preElo.get(id);
  let eloProbP1 = 0.5;
  if (pe) {
    const p1Elo = pe.winnerId === p1Id ? pe.we : pe.le;
    const p2Elo = pe.winnerId === p1Id ? pe.le : pe.we;
    eloProbP1 = expected(p1Elo, p2Elo);
  }
  const eloFavorite = eloProbP1 >= 0.5 ? p1 : p2;

  // 5. Ranking-implied probability (continuous version of the baseline)
  const rankProbP1 = 1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale));

  // 6. SMASH model — per tour x surface blend of sim + Elo + ranking
  const w = (ENGINE.weights[tour] && ENGINE.weights[tour][surface]) || { ws: 0.5, we: 0.5, wr: 0 };
  const smashProbP1 = w.ws * probP1 + w.we * eloProbP1 + w.wr * rankProbP1;
  const smashFavorite = smashProbP1 >= 0.5 ? p1 : p2;

  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    id, tour, surface, date: m.date,
    p1, p2,
    name1: m.player1?.name || p1, name2: m.player2?.name || p2,
    country1: m.player1?.countryAcr || '', country2: m.player2?.countryAcr || '',
    winner, score: m.result || '',
    probP1: r3(probP1), favorite, favProb: r3(favProb), correct: favorite === winner,
    upsetProbP1: r3(upsetProbP1), upsetFavorite, upsetCorrect: upsetFavorite === winner,
    eloProbP1: r3(eloProbP1), eloCorrect: eloFavorite === winner,
    rankProbP1: r3(rankProbP1),
    smashProbP1: r3(smashProbP1), smashFavorite, smashCorrect: smashFavorite === winner,
    rankPick, rankCorrect: rankPick === winner,
    rankA, rankB,
    p1Won: winner === p1,
  };
}

// Incremental by default: reuse predictions already in track_record.json and
// only simulate matches we haven't scored yet. This keeps a nightly refresh
// fast (just the handful of new results) and turns each stored prediction into
// a locked one rather than a retroactively re-simulated one. Set FULL=1 to
// re-simulate everything (e.g. after changing the model or its weights).
const outPath = path.join(__dirname, '..', 'public', 'data', 'track_record.json');
const forceFull = process.env.FULL === '1';
const existing = (!forceFull && fs.existsSync(outPath))
  ? new Map(JSON.parse(fs.readFileSync(outPath, 'utf8')).matches.map((m) => [m.id, m]))
  : new Map();

const all = [];
for (const tour of ['atp', 'wta']) {
  const ctx = loadTour(tour);
  const recs = [...ctx.evalMatches.values()];
  const fresh = recs.filter((r) => !existing.has(r.id));
  process.stdout.write(`${tour.toUpperCase()}: ${recs.length} matches, ${fresh.length} new to simulate…\n`);
  for (const r of recs) {
    all.push(existing.has(r.id) ? existing.get(r.id) : evaluate(ctx, r));
  }
}
all.sort((a, b) => new Date(a.date) - new Date(b.date));

// Report headline accuracies so tuning is visible from the build log
for (const tour of ['atp', 'wta']) {
  const ms = all.filter((m) => m.tour === tour);
  const acc = (k) => (ms.length ? Math.round((ms.filter((m) => m[k]).length / ms.length) * 100) : 0);
  console.log(`${tour.toUpperCase()} n=${ms.length} | SMASH ${acc('smashCorrect')}% | sim ${acc('correct')}% | elo ${acc('eloCorrect')}% | rank ${acc('rankCorrect')}% | upset ${acc('upsetCorrect')}%`);
  for (const s of ['hard', 'clay', 'grass']) {
    const sm = ms.filter((m) => m.surface === s);
    if (sm.length) console.log(`   ${s} n=${sm.length} | SMASH ${Math.round(100 * sm.filter((m) => m.smashCorrect).length / sm.length)}% | rank ${Math.round(100 * sm.filter((m) => m.rankCorrect).length / sm.length)}%`);
  }
}

fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sims: SIMS, matches: all }));
console.log(`Wrote ${all.length} matches to ${outPath}`);
