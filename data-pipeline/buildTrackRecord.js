/**
 * Builds public/data/track_record.json - every completed 2026 tour-level
 * singles match where BOTH players are in the SMASH roster, for both tours,
 * across all surfaces. For each match we PRECOMPUTE four predictions:
 *   1. season model  - point simulation on recency-weighted surface stats
 *   2. upset model    - point simulation on 7-day hot-form stats
 *   3. rank baseline  - higher-ranked player wins
 *   4. sim + Elo blend - 50/50 blend of the season sim and a surface Elo
 * The Elo uses leak-free PRE-MATCH ratings (replayed chronologically), so the
 * blend is measured honestly. The page just reads this JSON - no client sim.
 *
 * Usage: node buildTrackRecord.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { buildTimeline, predElo, expected, parseSets } = require('./eloCore');
const { applyCalib, logLoss, marketProb } = require('./lib/evalCore');
const { matchProb, matchDetail } = require('./lib/analyticProb');
const ENGINE = require('../src/engineConfig.json'); // per tour x surface blend weights

// Per-tour Platt recalibration of the blend (mirrors src/engines.js
// calibrate): p' = sigmoid(a*logit(p)). Never flips picks.
function calibrate(p, tour) {
  return applyCalib(p, ENGINE.calibration && ENGINE.calibration[tour] && ENGINE.calibration[tour].a);
}

// Match probabilities and set-score distributions come from the closed-form
// model in lib/analyticProb.js (the exact expectation of the point-by-point
// simulation - no Monte Carlo noise, fully deterministic).

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

      if (!allMatches.has(id)) {
        const { setsW, setsL } = parseSets(m.result, winId === p1Id);
        allMatches.set(id, { id, date: m.date, winnerId: winId, loserId: winId === p1Id ? p2Id : p1Id, surface, setsW, setsL, bestOf: Number(m.best_of) || null });
      }

      const d = new Date(m.date);
      if (isNaN(d) || d < new Date('2026-01-01') || d >= new Date('2027-01-01')) continue;
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

  // 1. season model - closed-form match probability + exact set-score
  // distribution (no Monte Carlo noise; see lib/analyticProb.js)
  const sum = matchDetail(probsFromRow(rowA), probsFromRow(rowB), bestOf);
  const probP1 = sum.probP1;
  const favorite = probP1 >= 0.5 ? p1 : p2;
  const favProb = probP1 >= 0.5 ? probP1 : 1 - probP1;

  // 2. upset model
  const upA = upset[surface].get(p1) || rowA;
  const upB = upset[surface].get(p2) || rowB;
  const upsetProbP1 = matchProb(probsFromRow(upA), probsFromRow(upB), bestOf);
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

  // 6. SMASH model - per tour x surface blend of sim + Elo + ranking, with
  // the per-tour Platt recalibration (engineConfig calibration).
  const w = (ENGINE.weights[tour] && ENGINE.weights[tour][surface]) || { ws: 0.5, we: 0.5, wr: 0 };
  const smashProbP1 = calibrate(w.ws * probP1 + w.we * eloProbP1 + w.wr * rankProbP1, tour);
  const smashFavorite = smashProbP1 >= 0.5 ? p1 : p2;

  // Predicted scoreline, from the deployed pick's (Smart Blend favorite's)
  // perspective: the most likely number of sets the loser takes in the point
  // simulation, e.g. "3-1" (best-of-5) or "2-0" (best-of-3).
  const favIsP1 = smashFavorite === p1;
  const dist = sum.lossDist[favIsP1 ? 0 : 1];
  let modal = 0; for (let i = 1; i < sum.target; i++) if (dist[i] > dist[modal]) modal = i;
  const predScore = `${sum.target}–${modal}`;

  // Bookmaker-favorite baseline: whoever the market priced shorter (lower
  // decimal odds). Only defined for matches that actually carry odds.
  const o1 = Number(m.odd1), o2 = Number(m.odd2);
  let oddFav = null, oddCorrect = null;
  if (o1 > 0 && o2 > 0 && o1 !== o2) {
    oddFav = o1 < o2 ? p1 : p2;
    oddCorrect = oddFav === winner;
  }

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
    predScore,
    rankPick, rankCorrect: rankPick === winner,
    oddFav, oddCorrect,
    od1: o1 > 0 ? o1 : null, od2: o2 > 0 ? o2 : null,
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
// Model fingerprint: when the weights or calibration change, every cached
// row is stale - re-simulate everything instead of silently serving rows
// from two different models in one file.
const modelKey = JSON.stringify({ w: ENGINE.weights, cal: ENGINE.calibration || null, elo: ENGINE.elo || null, rs: ENGINE.rankScale, sim: 'analytic-v1' });
const forceFull = process.env.FULL === '1';
let existing = new Map();
if (!forceFull && fs.existsSync(outPath)) {
  const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  if (prev.modelKey === modelKey) {
    existing = new Map(prev.matches.map((m) => [m.id, m]));
  } else {
    console.log('Model config changed since the last run - re-simulating all matches.');
  }
}

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
  const odds = ms.filter((m) => m.oddCorrect != null);
  const oddAcc = odds.length ? Math.round((odds.filter((m) => m.oddCorrect).length / odds.length) * 100) : 0;
  console.log(`${tour.toUpperCase()} n=${ms.length} | SMASH ${acc('smashCorrect')}% | sim ${acc('correct')}% | elo ${acc('eloCorrect')}% | rank ${acc('rankCorrect')}% | upset ${acc('upsetCorrect')}% || baselines: rank ${acc('rankCorrect')}% · bookmaker ${oddAcc}% (n=${odds.length})`);
  for (const s of ['hard', 'clay', 'grass']) {
    const sm = ms.filter((m) => m.surface === s);
    if (sm.length) console.log(`   ${s} n=${sm.length} | SMASH ${Math.round(100 * sm.filter((m) => m.smashCorrect).length / sm.length)}% | rank ${Math.round(100 * sm.filter((m) => m.rankCorrect).length / sm.length)}%`);
  }
}

// North-star metric: log loss vs the bookmakers' closing odds, on the
// subset of matches that carry odds. The market is the strongest known
// predictor, so the gap to it is the honest read on remaining headroom -
// and whether a model change was real or noise.
const logLossMeta = {};
for (const tour of ['atp', 'wta']) {
  const priced = all.filter((m) => m.tour === tour && m.od1 && m.od2);
  const model = logLoss(priced.map((m) => ({ p: m.smashProbP1, won: m.p1Won })));
  const market = logLoss(priced.map((m) => ({ p: marketProb(m.od1, m.od2), won: m.p1Won })));
  const allTour = all.filter((m) => m.tour === tour);
  logLossMeta[tour] = {
    n: allTour.length,
    model: allTour.length ? +logLoss(allTour.map((m) => ({ p: m.smashProbP1, won: m.p1Won }))).toFixed(4) : null,
    nPriced: priced.length,
    modelOnPriced: priced.length ? +model.toFixed(4) : null,
    market: priced.length ? +market.toFixed(4) : null,
    gap: priced.length ? +(model - market).toFixed(4) : null,
  };
  if (priced.length) {
    console.log(`${tour.toUpperCase()} log loss vs market (n=${priced.length}): model ${model.toFixed(4)} | market ${market.toFixed(4)} | gap ${(model - market).toFixed(4)}`);
  }
}

fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sims: 'analytic', modelKey, logLoss: logLossMeta, matches: all }));
console.log(`Wrote ${all.length} matches to ${outPath}`);

// ── Engine accuracy summary (per tour x surface, + "all") ─────────────────
// Both the Track Record page and the H2H "Recommended" tag read this to know
// which engine is most accurate for a given tour/surface.
const ENGINE_FIELD = { smash: 'smashCorrect', sim: 'correct', elo: 'eloCorrect', rank: 'rankCorrect', upset: 'upsetCorrect' };
function summarize(list) {
  if (!list.length) return null;
  const out = { n: list.length };
  for (const [id, field] of Object.entries(ENGINE_FIELD)) {
    out[id] = Math.round((list.filter((m) => m[field]).length / list.length) * 100);
  }
  // Best selectable engine (Smart Blend wins ties - it's the deployed default).
  const order = ['smash', 'sim', 'elo', 'rank', 'upset'];
  out.best = order.reduce((b, id) => (out[id] > out[b] ? id : b), 'smash');
  return out;
}
const accuracy = {};
for (const tour of ['atp', 'wta', 'all']) {
  accuracy[tour] = {};
  for (const surface of ['hard', 'clay', 'grass', 'all']) {
    const list = all.filter((m) => (tour === 'all' || m.tour === tour) && (surface === 'all' || m.surface === surface));
    const s = summarize(list);
    if (s) accuracy[tour][surface] = s;
  }
}
const accPath = path.join(__dirname, '..', 'public', 'data', 'engine_accuracy.json');
fs.writeFileSync(accPath, JSON.stringify(accuracy));
console.log(`Wrote engine accuracy summary to ${accPath}`);
