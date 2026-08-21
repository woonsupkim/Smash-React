/**
 * Builds public/data/track_record.json - every completed 2026 tour-level
 * singles match where BOTH players are in the SMASH roster, for both tours,
 * across all surfaces. For each match we PRECOMPUTE five predictions:
 *   1. sim (Point Sim)   - closed-form match probability on recency-weighted
 *                          season surface stats, real per-event format
 *   2. upset (Hot Streak) - the same math on 7-day hot-form stats
 *   3. rank baseline      - higher-ranked player wins
 *   4. elo (Form)         - surface Elo win probability
 *   5. smash (Smart Blend) - sim + elo + rank mixed with per-tour-x-surface
 *                          tuned weights from engineConfig.json
 * Then every row is annotated with the DEPLOYED pick: the call made by the
 * most accurate engine for that tour x surface (pickEngine/pickCorrect/...).
 * The Elo uses leak-free PRE-MATCH ratings (replayed chronologically), so the
 * blend is measured honestly. The page just reads this JSON - no client sim.
 *
 * Usage: node buildTrackRecord.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { buildTimeline, predElo, expected, parseSets, setEloParams, eloParamsFor } = require('./eloCore');
const { applyCalib, logLoss, marketProb } = require('./lib/evalCore');
const { matchProb, matchDetail } = require('./lib/analyticProb');
const { slamsForYear } = require('./lib/slamCalendar');
const { isDeployTier } = require('./lib/events');

// Event label for a match: the tournament-names cache when we have it
// (fetchSurfaces backfills it over a few runs), else a slam-window
// heuristic (a grass match inside the Wimbledon fortnight IS Wimbledon),
// else null - the UI falls back to the format chip.
// The season is the current calendar year everywhere in this file.
const SEASON_YEAR = new Date().getUTCFullYear();

// The four labels the slam heuristic can produce (used by label healing).
const SLAM_NAMES = new Set(['Australian Open', 'French Open', 'Wimbledon', 'US Open']);

// ESPN tournament names carry a " - City" suffix ("Wimbledon - London",
// "Nordea Open - Bastad"). Strip it so cache names and the slam-window
// heuristic agree on one label per event (no "Wimbledon" AND
// "Wimbledon - London" splitting the same tournament in filters).
function cleanEventName(name) {
  if (!name) return name;
  // Cut at the first SPACED hyphen: cities can contain unspaced hyphens
  // ("Monte-Carlo", "'s-Hertogenbosch") that a match-the-last-segment
  // regex can't reach. Also drop a leading "The ": ESPN flips between
  // "HSBC Championships" and "The HSBC Championships" across days of the
  // same event, splitting it in filters. Mirrored in src/utils/eventName.js
  // - keep in sync.
  const cut = String(name).replace(/\s+-\s+.*$/, '').replace(/^The\s+/i, '').trim();
  return cut || name;
}

function slamLabel(dateStr, surface) {
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  for (const s of slamsForYear(d.getUTCFullYear())) {
    // Window padded 2 days early: the calendar rule dates drift a little
    // (the AO has started on a Sunday in recent years). Callers guard this
    // with a tournament-span check, so the padding can't grab weekly events.
    if (s.surface === surface && d >= new Date(s.start.getTime() - 2 * 864e5) && d < new Date(s.start.getTime() + 15 * 864e5)) return s.label;
  }
  return null;
}
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
  const namesPath = path.join(RAW, 'tournament-names.json');
  const tournamentNames = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf8')) : {};
  const season = loadStats(tour, false);
  const upset = loadStats(tour, true);

  // Keyed by match IDENTITY, not by the feed's id. The feed emits the same
  // match under several ids - sometimes under different tournament names for
  // the same fixture - and keying on the id let all of them through. 38% of
  // this file was duplicate rows (5,018 where 3,112 matches were played), one
  // fixture appearing up to six times.
  //
  // Two things were wrong because of it. The published record was inflated,
  // and the season accuracy with it (67.2% against a true 65.8%, because the
  // duplicates skew toward matches we called correctly). And allMatches feeds
  // the ELO TIMELINE, so the same result was moving ratings up to six times.
  //
  // Identity is the pair plus the calendar day: two given players do not meet
  // twice in one day in singles. Same rule the prediction ledger already uses
  // (see buildPredictions, which was deduplicated for this in v3.7); the
  // retrospective record never was.
  const identity = (aId, bId, date) => `${[aId, bId].sort().join('_')}@${String(date).slice(0, 10)}`;
  const allMatches = new Map();  // identity -> {date,winnerId,loserId,surface} for the Elo timeline
  const evalMatches = new Map(); // identity -> rec for scoring (roster-vs-roster with stats, this season)
  const tSpan = new Map();       // tournamentId -> {min,max} date span (for the label pass)
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles|names/.test(f))) {
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

      const tid = String(m.tournamentId);
      if (m.date) {
        const sp = tSpan.get(tid);
        if (!sp) tSpan.set(tid, { min: m.date, max: m.date });
        else { if (m.date < sp.min) sp.min = m.date; if (m.date > sp.max) sp.max = m.date; }
      }

      const ident = identity(p1Id, p2Id, m.date);
      if (!allMatches.has(ident)) {
        const { setsW, setsL } = parseSets(m.result, winId === p1Id);
        allMatches.set(ident, { id, date: m.date, winnerId: winId, loserId: winId === p1Id ? p2Id : p1Id, surface, setsW, setsL, bestOf: Number(m.best_of) || null });
      }

      const d = new Date(m.date);
      // Current calendar year = the season. Rolls over automatically each
      // January (the benchmark resets and refills; see docs/SEASON-ROLLOVER.md).
      if (isNaN(d) || d < new Date(`${SEASON_YEAR}-01-01`) || d >= new Date(`${SEASON_YEAR + 1}-01-01`)) continue;
      const p1 = apiToShort.get(p1Id), p2 = apiToShort.get(p2Id);
      if (!p1 || !p2) continue;
      const winner = apiToShort.get(winId);
      if (!winner || evalMatches.has(ident)) continue;
      const rowA = season[surface].get(p1), rowB = season[surface].get(p2);
      if (!rowA || !rowB) continue;
      evalMatches.set(ident, { m, id, ident, tid, p1, p2, p1Id, p2Id, surface, winner, rowA, rowB });
    }
  }

  // Label pass. The tournament-names cache is AUTHORITATIVE; the slam-window
  // heuristic only fills gaps for tournaments whose own date span looks like
  // a slam fortnight (9+ days). That guard is what stops weekly events that
  // overlap a slam window (Abu Dhabi under the AO, post-final clay 250s
  // inside the French window) from being mislabeled as the slam: a blank
  // label is honest, a wrong one isn't.
  for (const rec of evalMatches.values()) {
    const cacheName = cleanEventName(tournamentNames[rec.tid]) || null;
    const sp = tSpan.get(rec.tid);
    const spanDays = sp ? (new Date(sp.max) - new Date(sp.min)) / 864e5 : 0;
    rec.cacheName = cacheName;
    rec.eventName = cacheName || (spanDays >= 9 ? slamLabel(rec.m.date, rec.surface) : null);
  }

  // Replay the full timeline, snapshotting pre-match predicting Elos for the
  // matches we score.
  const preElo = new Map();
  // Per-tour K-factor schedule; loadTour is called for both tours in one
  // process, so this must be set per replay (see eloCore.eloParamsFor).
  setEloParams(eloParamsFor(tour));
  buildTimeline([...allMatches.values()], (mm, rw, rl) => {
    // evalMatches is keyed by identity now, so this has to look up the same
    // way. Checking mm.id here would miss every time and quietly leave every
    // row without a pre-match Elo, which falls back to 0.5 rather than
    // failing - exactly the kind of silence this file has been bitten by.
    const ident = identity(mm.winnerId, mm.loserId, mm.date);
    if (!evalMatches.has(ident)) return;
    preElo.set(ident, { winnerId: mm.winnerId, we: predElo(rw, mm.surface), le: predElo(rl, mm.surface) });
  });

  return { tour, season, upset, evalMatches, preElo, bestOf: tour === 'wta' ? 3 : 5 };
}

function evaluate(ctx, rec) {
  const { season, upset, preElo, bestOf, tour } = ctx;
  const { m, id, p1, p2, p1Id, surface, winner, rowA, rowB, eventName } = rec;

  // Per-match format: ATP is best-of-five at slams ONLY - Masters and the
  // rest of the tour play best-of-three. The API's best_of field is always
  // null, so DERIVE it from the completed result: a winner with three sets
  // played best-of-five, with two played best-of-three (exact for full
  // matches; retirements fall back to the tour default).
  const { setsW: boSetsW } = parseSets(m.result, String(m.match_winner) === p1Id);
  const bo = boSetsW >= 3 ? 5 : boSetsW === 2 ? 3 : bestOf;

  // 1. season model - closed-form match probability + exact set-score
  // distribution (no Monte Carlo noise; see lib/analyticProb.js). Best-of-
  // five scorelines use the fitted set-probability temperature: sweeps
  // outrun iid set math (+6pts exact-score accuracy walk-forward).
  const setTemp = bo >= 5 ? (ENGINE.scoreline?.bo5Temp || 1) : 1;
  const sum = matchDetail(probsFromRow(rowA), probsFromRow(rowB), bo, setTemp);
  const probP1 = sum.probP1;
  const favorite = probP1 >= 0.5 ? p1 : p2;
  const favProb = probP1 >= 0.5 ? probP1 : 1 - probP1;

  // 2. upset model
  const upA = upset[surface].get(p1) || rowA;
  const upB = upset[surface].get(p2) || rowB;
  const upsetProbP1 = matchProb(probsFromRow(upA), probsFromRow(upB), bo);
  const upsetFavorite = upsetProbP1 >= 0.5 ? p1 : p2;

  // 3. rank baseline
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankPick = rankA <= rankB ? p1 : p2;

  // 4. Elo model (leak-free pre-match ratings)
  const pe = preElo.get(rec.ident);
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

  // Predicted scoreline for BOTH winner orientations (the most likely
  // number of sets the loser takes). The deployed-pick annotation pass at
  // the bottom of this file orients predScore to whichever engine's
  // favorite is the site's actual call for this tour x surface.
  const modalOf = (d) => { let mi = 0; for (let i = 1; i < sum.target; i++) if (d[i] > d[mi]) mi = i; return mi; };
  const predScoreP1Win = `${sum.target}–${modalOf(sum.lossDist[0])}`;
  const predScoreP2Win = `${sum.target}–${modalOf(sum.lossDist[1])}`;
  const predScore = smashFavorite === p1 ? predScoreP1Win : predScoreP2Win;

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
    event: eventName || null, bestOf: bo,
    p1, p2,
    name1: m.player1?.name || p1, name2: m.player2?.name || p2,
    country1: m.player1?.countryAcr || '', country2: m.player2?.countryAcr || '',
    winner, score: m.result || '',
    probP1: r3(probP1), favorite, favProb: r3(favProb), correct: favorite === winner,
    upsetProbP1: r3(upsetProbP1), upsetFavorite, upsetCorrect: upsetFavorite === winner,
    eloProbP1: r3(eloProbP1), eloCorrect: eloFavorite === winner,
    rankProbP1: r3(rankProbP1),
    smashProbP1: r3(smashProbP1), smashFavorite, smashCorrect: smashFavorite === winner,
    predScore, predScoreP1Win, predScoreP2Win,
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
// `row` versions the per-row SCHEMA (fields like predScoreP1Win that the
// annotation pass depends on): bump it whenever a new per-row field is
// added, or incremental reuse resurrects rows missing that field.
const modelKey = JSON.stringify({ w: ENGINE.weights, cal: ENGINE.calibration || null, elo: ENGINE.elo || null, rs: ENGINE.rankScale, sl: ENGINE.scoreline || null, sim: 'analytic-v1', bo: 'derived-v1', evt: 2, row: 1 });
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
    if (existing.has(r.id)) {
      const row = existing.get(r.id);
      // Label healing on reused rows (labels are metadata, not predictions -
      // the locked numbers stay untouched):
      //   1. normalize labels written before cleanEventName existed,
      //   2. the names cache OVERRIDES any older guess as it backfills,
      //   3. blanks fill from the current heuristic (span-guarded),
      //   4. a stored SLAM label that neither the cache nor the guarded
      //      heuristic stands behind was an old loose-window mislabel
      //      (Abu Dhabi under the AO window etc.) - drop it. Blank is
      //      honest; the cache supplies the truth on a later run.
      if (row.event) row.event = cleanEventName(row.event);
      if (r.cacheName) {
        if (row.event !== r.cacheName) row.event = r.cacheName;
      } else if (r.eventName) {
        if (!row.event) row.event = r.eventName;
      } else if (row.event && SLAM_NAMES.has(row.event)) {
        row.event = null;
      }
      all.push(row);
    } else {
      all.push(evaluate(ctx, r));
    }
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

// ── Engine accuracy summary (per tour x surface, + "all") ─────────────────
// Both the Track Record page and the H2H "Recommended" tag read this to know
// which engine is strongest for a given tour/surface - and the deployed-pick
// annotation below uses it to decide each match's actual call.
const ENGINE_FIELD = { smash: 'smashCorrect', sim: 'correct', elo: 'eloCorrect', rank: 'rankCorrect', upset: 'upsetCorrect' };
const ENGINE_PROB = { smash: 'smashProbP1', sim: 'probP1', elo: 'eloProbP1', rank: 'rankProbP1', upset: 'upsetProbP1' };

// ── Which engine gets deployed in a cell ───────────────────────────────────
// Two rules, both learned the hard way.
//
// 1. SELECT ON THE POPULATION WE SERVE. The raw archive is ~2/3 challengers
//    and 250s, but the site only ever locks picks on slams and the six
//    combined 1000s. Selecting on the archive picked Form for WTA hard
//    (best across 685 small events) and shipped it to the US Open, where
//    it was not the best. Selection now looks only at deploy-tier matches.
//
// 2. ONLY SWITCH WHEN IT MEANS SOMETHING. Deploy-tier cells hold a few
//    hundred matches, where one standard deviation of accuracy is ~3
//    points. Plain argmax on that sample proposed shipping the RANKINGS
//    baseline for both hard cells on a ~1-point lead: noise, and a product
//    that beats rankings has no business deploying them. So the Smart
//    Blend (the tuned general-purpose default, and the best-calibrated
//    engine in most cells) holds the slot unless a challenger is better by
//    a margin whose 95% paired-bootstrap interval clears zero. Ties, near
//    misses, and thin samples all resolve to the blend.
//
// As deploy-tier evidence accumulates a genuinely better engine will cross
// the bar on its own; nothing here is frozen.
const DEPLOY_BASE = 'smash';
const DEPLOY_MIN_N = 100;   // below this, the cell has no business choosing
const BOOT_REPS = 2000;

// 2.5th percentile of the paired accuracy difference (a - b), in points.
// Seeded so a rerun of the same data always deploys the same engine - a
// selector that flickered between refreshes would be worse than a wrong one.
function pairedBootLo(list, fa, fb) {
  const usable = list.filter((m) => m[fa] != null && m[fb] != null);
  if (usable.length < DEPLOY_MIN_N) return -Infinity;
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const diffs = [];
  for (let r = 0; r < BOOT_REPS; r++) {
    let a = 0, b = 0;
    for (let i = 0; i < usable.length; i++) {
      const m = usable[Math.floor(rnd() * usable.length)];
      if (m[fa]) a++;
      if (m[fb]) b++;
    }
    diffs.push(((a - b) / usable.length) * 100);
  }
  diffs.sort((x, y) => x - y);
  return diffs[Math.floor(BOOT_REPS * 0.025)];
}

function selectEngine(deployList) {
  const accOf = (id) => {
    const f = ENGINE_FIELD[id];
    const v = deployList.filter((m) => m[f] != null);
    return v.length ? Math.round((v.filter((m) => m[f]).length / v.length) * 100) : null;
  };
  const acc = Object.fromEntries(Object.keys(ENGINE_FIELD).map((id) => [id, accOf(id)]));
  if (deployList.length < DEPLOY_MIN_N) {
    return { engine: DEPLOY_BASE, basis: 'thin-sample', n: deployList.length, acc, margin: null };
  }
  let engine = DEPLOY_BASE, margin = 0;
  for (const id of Object.keys(ENGINE_FIELD)) {
    if (id === DEPLOY_BASE) continue;
    const lo = pairedBootLo(deployList, ENGINE_FIELD[id], ENGINE_FIELD[DEPLOY_BASE]);
    if (lo > 0 && lo > margin) { engine = id; margin = lo; }
  }
  return {
    engine,
    basis: engine === DEPLOY_BASE ? 'blend-default' : 'significant',
    n: deployList.length,
    acc,
    margin: engine === DEPLOY_BASE ? null : +margin.toFixed(1),
  };
}

function summarize(list) {
  if (!list.length) return null;
  const out = { n: list.length };
  const lls = {};
  for (const [id, field] of Object.entries(ENGINE_FIELD)) {
    out[id] = Math.round((list.filter((m) => m[field]).length / list.length) * 100);
    const ll = logLoss(list.map((m) => ({ p: m[ENGINE_PROB[id]], won: m.p1Won })));
    lls[id] = ll != null ? +ll.toFixed(4) : null;
  }
  out.logLoss = lls;
  // The percentages above describe the WHOLE archive (the site's evidence
  // base, and what the comparison panels show). The deployed engine is a
  // separate question, answered only on the matches the site actually calls.
  const sel = selectEngine(list.filter((m) => isDeployTier(m.event)));
  out.best = sel.engine;
  out.selection = sel;
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

// ── Deployed picks ─────────────────────────────────────────────────────────
// Product rule: every call the site makes uses the best predicting engine
// for its tour x surface, and the headline benchmark grades THOSE calls.
// Annotated on every run (cheap), so reused rows re-orient whenever the
// best-engine table moves. Known tradeoff, on the record: the cell winner
// is chosen from the same season being displayed, which flatters the
// headline slightly - the per-engine panels stay pure for comparison.
const FAV_OF = {
  smash: (m) => m.smashFavorite,
  sim: (m) => m.favorite,
  elo: (m) => (m.eloProbP1 >= 0.5 ? m.p1 : m.p2),
  rank: (m) => m.rankPick,
  upset: (m) => m.upsetFavorite,
};
for (const m of all) {
  const best = accuracy[m.tour]?.[m.surface]?.best || 'smash';
  m.pickEngine = best;
  m.pickProbP1 = m[ENGINE_PROB[best]];
  m.pickFavorite = FAV_OF[best](m);
  m.pickCorrect = m.pickFavorite === m.winner;
  if (m.predScoreP1Win && m.predScoreP2Win) {
    m.predScore = m.pickFavorite === m.p1 ? m.predScoreP1Win : m.predScoreP2Win;
  }
}
for (const tour of ['atp', 'wta']) {
  const ms = all.filter((m) => m.tour === tour);
  const right = ms.filter((m) => m.pickCorrect).length;
  console.log(`${tour.toUpperCase()} deployed picks (best engine per surface): ${right}/${ms.length} (${Math.round((right / ms.length) * 100)}%)`);
}

// North-star metric: log loss vs the bookmakers' closing odds, on the
// subset of matches that carry odds - scored on the DEPLOYED picks, the
// same calls the headline grades.
const logLossMeta = {};
for (const tour of ['atp', 'wta']) {
  const priced = all.filter((m) => m.tour === tour && m.od1 && m.od2);
  const model = logLoss(priced.map((m) => ({ p: m.pickProbP1, won: m.p1Won })));
  const market = logLoss(priced.map((m) => ({ p: marketProb(m.od1, m.od2), won: m.p1Won })));
  const allTour = all.filter((m) => m.tour === tour);
  logLossMeta[tour] = {
    n: allTour.length,
    model: allTour.length ? +logLoss(allTour.map((m) => ({ p: m.pickProbP1, won: m.p1Won }))).toFixed(4) : null,
    nPriced: priced.length,
    modelOnPriced: priced.length ? +model.toFixed(4) : null,
    market: priced.length ? +market.toFixed(4) : null,
    gap: priced.length ? +(model - market).toFixed(4) : null,
  };
  if (priced.length) {
    console.log(`${tour.toUpperCase()} log loss vs market (n=${priced.length}): deployed ${model.toFixed(4)} | market ${market.toFixed(4)} | gap ${(model - market).toFixed(4)}`);
  }
}

fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sims: 'analytic', modelKey, logLoss: logLossMeta, matches: all }));
console.log(`Wrote ${all.length} matches to ${outPath}`);

const accPath = path.join(__dirname, '..', 'public', 'data', 'engine_accuracy.json');
fs.writeFileSync(accPath, JSON.stringify(accuracy));
console.log(`Wrote engine accuracy summary to ${accPath}`);
