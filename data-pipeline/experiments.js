/**
 * Model-change validation harness. Every candidate change to the prediction
 * model gets judged the same way: walk-forward out-of-fold log loss on
 * point-in-time (leak-free) predictions over 2024+ intra-roster matches,
 * with earlier years feeding the stats and Elo history. Nothing ships into
 * engineConfig.json unless it wins here.
 *
 * Usage:
 *   node experiments.js precompute [atp|wta]  - build cached eval cases
 *       (point-in-time sim probs per shrinkage variant; slow, run once)
 *   node experiments.js elo      - Elo variants: surface/overall blend rho,
 *                                  margin-aware K
 *   node experiments.js shrink   - serve-stat shrinkage c variants
 *   node experiments.js calib    - Platt recalibration vs hand-fit tailShrink
 *   node experiments.js fatigue  - rest-days / prior-sets adjustment
 *   node experiments.js market   - model vs bookmaker closing odds
 *
 * Elo variants are cheap (a timeline replay per variant); sim variants ride
 * on the precomputed cache.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Papa = require('papaparse');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');
const { buildTimeline, predElo, expected, setEloParams, parseSets } = require('./eloCore');
const { matchProb } = require('./lib/analyticProb');
const evalCore = require('./lib/evalCore');
const ENGINE = require('../src/engineConfig.json');

const SHRINK_VARIANTS = [0, 200, 400, 800];
const SIMS = 400;
const EVAL_FROM = '2024-01-01';
const SURFACE_DISPLAY = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
const normSurf = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
};

function loadSimulatorAsCjs() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'simulator.js'), 'utf8').replace(/^export /gm, '');
  const tmpFile = path.join(os.tmpdir(), `simulator-cjs-${Date.now()}.cjs`);
  fs.writeFileSync(tmpFile, `${source}\nmodule.exports = { simulateMatch, simulateBatch, simulateMatchStepwise };\n`);
  const mod = require(tmpFile);
  fs.unlinkSync(tmpFile);
  return mod;
}

// ── Per-tour raw data bundle ──────────────────────────────────────────────
function loadTourRaw(tour) {
  const RAW = path.join(__dirname, 'raw', tour === 'wta' ? 'women' : '');
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToOur = new Map(Object.entries(idMap).map(([o, a]) => [String(a), o]));
  const surfaceMap = JSON.parse(fs.readFileSync(path.join(RAW, 'tournament-surfaces.json'), 'utf8'));
  const files = new Map(); // ourId -> matches[]
  for (const ourId of Object.keys(idMap)) {
    const f = path.join(RAW, `${ourId}.json`);
    if (fs.existsSync(f)) files.set(ourId, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  // Current ranks per surface (the same approximation the track record uses).
  const CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };
  const ranks = {};
  for (const [s, file] of Object.entries(CSV)) {
    const p = path.join(__dirname, '..', 'public', 'data', tour === 'wta' ? 'women' : '', file);
    ranks[s] = new Map();
    if (fs.existsSync(p)) {
      for (const r of Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data) {
        if (r.id) ranks[s].set(r.id, Number(r.us_seed) || 999);
      }
    }
  }
  return { tour, RAW, idMap, apiToOur, surfaceMap, files, ranks };
}

// All completed matches (any opponent) for the Elo timeline, with set counts.
function timelineMatches(bundle) {
  const seen = new Map();
  for (const [, matches] of bundle.files) {
    for (const m of matches) {
      if (m.result_type !== 'completed') continue;
      const id = String(m.id);
      if (seen.has(id)) continue;
      const w = String(m.match_winner || '');
      const p1 = String(m.player1Id || ''), p2 = String(m.player2Id || '');
      if (!w || (w !== p1 && w !== p2)) continue;
      const surface = normSurf(bundle.surfaceMap[String(m.tournamentId)]);
      if (!surface) continue;
      const { setsW, setsL } = parseSets(m.result, w === p1);
      seen.set(id, { id, date: m.date, winnerId: w, loserId: w === p1 ? p2 : p1, surface, setsW, setsL, bestOf: Number(m.best_of) || null });
    }
  }
  return [...seen.values()];
}

// ── Precompute: point-in-time sim probs per shrink variant ────────────────
const HALF_LIFE = { hard: 270, clay: 365, grass: 270 };

function casesPath(tour) { return path.join(__dirname, 'output', `evalcases_${tour}.json`); }

function precompute(tour) {
  const bundle = loadTourRaw(tour);
  const { simulateBatch } = loadSimulatorAsCjs();

  // Case list: intra-roster completed matches from EVAL_FROM.
  const seen = new Set();
  const cases = [];
  for (const [, matches] of bundle.files) {
    for (const m of matches) {
      if (m.result_type !== 'completed' || !m.date || seen.has(String(m.id))) continue;
      if (m.date < EVAL_FROM) continue;
      const p1 = bundle.apiToOur.get(String(m.player1Id)), p2 = bundle.apiToOur.get(String(m.player2Id));
      if (!p1 || !p2) continue;
      const w = String(m.match_winner || '');
      if (!w || (w !== String(m.player1Id) && w !== String(m.player2Id))) continue;
      const surface = normSurf(bundle.surfaceMap[String(m.tournamentId)]);
      if (!surface) continue;
      seen.add(String(m.id));
      cases.push({ m, p1, p2, surface });
    }
  }
  cases.sort((a, b) => new Date(a.m.date) - new Date(b.m.date));
  console.log(`${tour}: ${cases.length} candidate cases from ${EVAL_FROM}`);

  // Global per-surface tour averages (backtest.js-style snapshot; constant
  // across variants so comparisons stay fair).
  const tourAvgs = {};
  for (const s of ['hard', 'clay', 'grass']) {
    const totals = emptyAgg();
    for (const [ourId, matches] of bundle.files) {
      const apiId = bundle.idMap[ourId];
      for (const m of matches) {
        const ms = bundle.surfaceMap[String(m.tournamentId)];
        if ((ms === 'I.hard' ? 'Hard' : ms) !== SURFACE_DISPLAY[s]) continue;
        accumulateMatch(emptyAgg(), totals, m, apiId, new Date(), HALF_LIFE[s]);
      }
    }
    tourAvgs[s] = deriveTourAverages(totals);
  }

  // Point-in-time agg for one player on one surface as of a date.
  function aggAsOf(ourId, excludeId, asOf, surface) {
    const apiId = bundle.idMap[ourId];
    const agg = emptyAgg();
    for (const m of bundle.files.get(ourId) || []) {
      if (m.id === excludeId) continue;
      const ms = bundle.surfaceMap[String(m.tournamentId)];
      if ((ms === 'I.hard' ? 'Hard' : ms) !== SURFACE_DISPLAY[surface]) continue;
      accumulateMatch(agg, null, m, apiId, asOf, HALF_LIFE[surface]);
    }
    return agg;
  }

  // Fatigue inputs from a player's file: days since last completed match,
  // and sets played earlier in the same tournament (within 25 days).
  function fatigueOf(ourId, caseM) {
    const asOf = new Date(caseM.date);
    let last = null, sets = 0;
    for (const m of bundle.files.get(ourId) || []) {
      if (m.id === caseM.id || m.result_type !== 'completed' || !m.date) continue;
      const d = new Date(m.date);
      if (d >= asOf) continue;
      if (!last || d > last) last = d;
      if (String(m.tournamentId) === String(caseM.tournamentId) && (asOf - d) < 25 * 864e5) {
        const parts = String(m.result || '').trim().split(/\s+/).filter((x) => /^\d+-\d+/.test(x));
        sets += parts.length;
      }
    }
    const rest = last ? Math.min(21, Math.round((asOf - last) / 864e5)) : 21;
    return { rest, sets };
  }

  // Recent form: win rate over the player's last 10 completed matches
  // strictly before the case date.
  function formOf(ourId, caseM) {
    const asOf = new Date(caseM.date);
    const prior = (bundle.files.get(ourId) || [])
      .filter((m) => m.id !== caseM.id && m.result_type === 'completed' && m.date && new Date(m.date) < asOf)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10);
    if (prior.length < 4) return null;
    const apiId = String(bundle.idMap[ourId]);
    const w = prior.filter((m) => String(m.match_winner) === apiId).length;
    return w / prior.length;
  }

  // Prior head-to-head between the two players, strictly before the case.
  function h2hOf(caseM) {
    const asOf = new Date(caseM.date);
    const p1Api = String(caseM.player1Id), p2Api = String(caseM.player2Id);
    let w1 = 0, n = 0;
    const seen = new Set();
    for (const key of [bundle.apiToOur.get(p1Api), bundle.apiToOur.get(p2Api)]) {
      for (const m of bundle.files.get(key) || []) {
        if (m.result_type !== 'completed' || !m.date || seen.has(String(m.id)) || m.id === caseM.id) continue;
        if (new Date(m.date) >= asOf) continue;
        const a = String(m.player1Id), b = String(m.player2Id);
        if (!((a === p1Api && b === p2Api) || (a === p2Api && b === p1Api))) continue;
        seen.add(String(m.id));
        n++;
        if (String(m.match_winner) === p1Api) w1++;
      }
    }
    return { w1, n };
  }

  const out = [];
  let done = 0;
  for (const c of cases) {
    const { m, p1, p2, surface } = c;
    const asOf = new Date(m.date);
    const aggA = aggAsOf(p1, m.id, asOf, surface);
    const aggB = aggAsOf(p2, m.id, asOf, surface);
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${cases.length}…`);

    // The API's best_of is always null; derive the format from the result
    // (winner with 3 sets = best-of-five). Exact for completed full matches.
    const boSets = parseSets(m.result, String(m.match_winner) === String(m.player1Id)).setsW;
    const bestOf = boSets >= 3 ? 5 : boSets === 2 ? 3 : (tour === 'wta' ? 3 : 5);
    const sim = {};
    let ok = true;
    let ana = null;
    for (const cshrink of SHRINK_VARIANTS) {
      const pa = deriveProbabilities(aggA, tourAvgs[surface], 200, cshrink);
      const pb = deriveProbabilities(aggB, tourAvgs[surface], 200, cshrink);
      if (!pa || !pb) { ok = false; break; }
      const { matchWins } = simulateBatch(pa, pb, SIMS);
      sim[`c${cshrink}`] = +(matchWins[0] / SIMS).toFixed(4);
      if (cshrink === 0) ana = +matchProb(pa, pb, bestOf).toFixed(4);
    }
    if (!ok) continue;

    const p1Won = String(m.match_winner) === String(m.player1Id);
    const { setsW, setsL } = parseSets(m.result, p1Won);
    const rankA = bundle.ranks[surface].get(p1) || 999;
    const rankB = bundle.ranks[surface].get(p2) || 999;
    const f1 = fatigueOf(p1, m), f2 = fatigueOf(p2, m);
    const h2h = h2hOf(m);
    out.push({
      id: String(m.id), date: m.date, surface, p1Won,
      sim, ana,
      rankProbP1: +(1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale))).toFixed(4),
      market: evalCore.marketProb(Number(m.odd1), Number(m.odd2)),
      setsW, setsL, bestOf,
      rest1: f1.rest, rest2: f2.rest, sets1: f1.sets, sets2: f2.sets,
      form1: formOf(p1, m), form2: formOf(p2, m),
      h2hW1: h2h.w1, h2hN: h2h.n,
    });
  }
  if (!fs.existsSync(path.join(__dirname, 'output'))) fs.mkdirSync(path.join(__dirname, 'output'), { recursive: true });
  fs.writeFileSync(casesPath(tour), JSON.stringify({ generatedAt: new Date().toISOString(), sims: SIMS, evalFrom: EVAL_FROM, cases: out }));
  console.log(`${tour}: wrote ${out.length} eval cases (of ${cases.length}) to ${casesPath(tour)}`);
}

// ── Elo probs for the eval cases under given params ───────────────────────
function eloProbsFor(bundle, caseIds, params) {
  setEloParams(params);
  const probs = new Map(); // caseId -> P(p1 side of THE CASE wins)... winner-oriented, fixed below
  const tl = timelineMatches(bundle);
  buildTimeline(tl, (m, rw, rl) => {
    if (!caseIds.has(m.id)) return;
    probs.set(m.id, { winnerProb: expected(predElo(rw, m.surface), predElo(rl, m.surface)), winnerId: m.winnerId });
  });
  setEloParams({}); // restore engineConfig defaults
  return probs;
}

function loadCases(tour) {
  const p = casesPath(tour);
  if (!fs.existsSync(p)) { console.error(`Missing ${p} - run: node experiments.js precompute ${tour}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf8')).cases;
}

// Attach elo probs (p1 perspective) to cases; cases without a snapshot drop.
function withElo(bundle, cases, params) {
  const probs = eloProbsFor(bundle, new Set(cases.map((c) => c.id)), params);
  const out = [];
  for (const c of cases) {
    const e = probs.get(c.id);
    if (!e) continue;
    // The snapshot is winner-oriented; flip to the p1 perspective.
    const eloProbP1 = c.p1Won ? e.winnerProb : 1 - e.winnerProb;
    out.push({ ...c, eloProbP1 });
  }
  return out;
}

function report(label, rows, simKey = 'c0') {
  const prepped = rows.map((r) => ({ ...r, probP1: r.sim[simKey] }));
  const oof = evalCore.walkForwardOOF(prepped);
  const raw = { logLoss: evalCore.logLoss(oof), accuracy: evalCore.accuracy(oof) };
  const cal = evalCore.sequentialCalibLogLoss(oof);
  const simAlone = evalCore.logLoss(oof.map((r) => ({ p: r.probP1, won: r.won })));
  const eloAlone = evalCore.logLoss(oof.map((r) => ({ p: r.eloProbP1, won: r.won })));
  console.log(
    `${label.padEnd(34)} | oof n=${String(oof.length).padEnd(5)} | blend ${raw.logLoss.toFixed(4)} (acc ${(raw.accuracy * 100).toFixed(1)}%) | ` +
    `+calib ${cal.logLoss.toFixed(4)} | sim ${simAlone.toFixed(4)} | elo ${eloAlone.toFixed(4)}`
  );
  return { oof, raw, cal };
}

// ── Experiment commands ───────────────────────────────────────────────────
function cmdElo() {
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - Elo variants (sim=c0) ══`);
    const bundle = loadTourRaw(tour);
    const cases = loadCases(tour);
    for (const marginK of [false, true]) {
      for (const rho of [0.5, 0.65, 0.8]) {
        const rows = withElo(bundle, cases, { rho, marginK });
        report(`rho=${rho} marginK=${marginK ? 'on ' : 'off'}`, rows);
      }
    }
  }
}

function cmdShrink() {
  const rho = Number(process.env.RHO || 0.5);
  const marginK = process.env.MARGINK === '1';
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - shrinkage variants (rho=${rho}, marginK=${marginK}) ══`);
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho, marginK });
    for (const c of SHRINK_VARIANTS) report(`shrinkC=${c}`, rows, `c${c}`);
  }
}

function cmdCalib() {
  const rho = Number(process.env.RHO || 0.5);
  const marginK = process.env.MARGINK === '1';
  const simKey = process.env.SIMKEY || 'c0';
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - calibration (rho=${rho}, marginK=${marginK}, sim=${simKey}) ══`);
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho, marginK });
    const prepped = rows.map((r) => ({ ...r, probP1: r.sim[simKey] }));
    const oof = evalCore.walkForwardOOF(prepped);
    const raw = evalCore.logLoss(oof);
    // Hand-fit tailShrink (current production calibration) applied to OOF.
    const ts = ENGINE.tailShrink && ENGINE.tailShrink[tour];
    const shrunk = ts ? evalCore.logLoss(oof.map((r) => {
      const fav = Math.max(r.p, 1 - r.p);
      const shr = fav <= ts.knee ? fav : ts.knee + (fav - ts.knee) * ts.factor;
      return { p: r.p >= 0.5 ? shr : 1 - shr, won: r.won };
    })) : null;
    const seq = evalCore.sequentialCalibLogLoss(oof);
    const aAll = evalCore.fitCalib(oof);
    console.log(`raw ${raw.toFixed(4)} | tailShrink ${shrunk ? shrunk.toFixed(4) : 'n/a'} | Platt(seq) ${seq.logLoss.toFixed(4)} | a(fit on all OOF, for reference) = ${aAll}`);
  }
}

function cmdFatigue() {
  const rho = Number(process.env.RHO || 0.5);
  const marginK = process.env.MARGINK === '1';
  const simKey = process.env.SIMKEY || 'c0';
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - fatigue adjustment (rho=${rho}, marginK=${marginK}, sim=${simKey}) ══`);
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho, marginK });
    const prepped = rows.map((r) => ({ ...r, probP1: r.sim[simKey] }));
    const oof = evalCore.walkForwardOOF(prepped);
    console.log(`baseline oof ${evalCore.logLoss(oof).toFixed(4)}`);
    // Features (p1 minus p2): rest-day difference (log-capped), prior sets
    // in this tournament. Fit beta on all OOF (upper bound of usefulness -
    // if even THIS doesn't help, honest sequential fitting won't either).
    for (const feat of [
      ['restDiff', (r) => Math.log(1 + Math.min(r.rest1, 7)) - Math.log(1 + Math.min(r.rest2, 7))],
      ['setsDiff', (r) => (r.sets2 - r.sets1) / 3],
    ]) {
      const [name, fn] = feat;
      let best = { beta: 0, ll: evalCore.logLoss(oof) };
      for (let beta = -0.3; beta <= 0.3001; beta += 0.03) {
        const ll = evalCore.logLoss(oof.map((r) => ({ p: evalCore.sigmoid(evalCore.logit(r.p) + beta * fn(r)), won: r.won })));
        if (ll < best.ll) best = { beta: +beta.toFixed(2), ll };
      }
      console.log(`${name}: best beta=${best.beta} -> ${best.ll.toFixed(4)} (delta ${(best.ll - evalCore.logLoss(oof)).toFixed(5)})`);
    }
  }
}

function cmdMarket() {
  const rho = Number(process.env.RHO || 0.5);
  const marginK = process.env.MARGINK === '1';
  const simKey = process.env.SIMKEY || 'c0';
  for (const tour of ['atp', 'wta']) {
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho, marginK });
    const prepped = rows.map((r) => ({ ...r, probP1: r.sim[simKey] }));
    const oof = evalCore.walkForwardOOF(prepped).filter((r) => r.market != null);
    const seq = evalCore.sequentialCalibLogLoss(oof);
    const mkt = evalCore.logLoss(oof.map((r) => ({ p: r.market, won: r.won })));
    const mktAcc = evalCore.accuracy(oof.map((r) => ({ p: r.market, won: r.won })));
    console.log(`${tour.toUpperCase()} (n=${oof.length} with odds): model+calib ${seq.logLoss.toFixed(4)} (acc ${(seq.accuracy * 100).toFixed(1)}%) | market ${mkt.toFixed(4)} (acc ${(mktAcc * 100).toFixed(1)}%) | gap ${(seq.logLoss - mkt).toFixed(4)}`);
  }
}

// ── Analytic vs Monte Carlo sim component ─────────────────────────────────
function cmdAna() {
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - Monte Carlo (400 sims) vs closed-form sim ══`);
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho: 0.5, marginK: true }).filter((r) => r.ana != null);
    for (const [label, key] of [['MC-400', null], ['analytic', 'ana']]) {
      const prepped = rows.map((r) => ({ ...r, probP1: key ? r[key] : r.sim.c0 }));
      const oof = evalCore.walkForwardOOF(prepped);
      const simAlone = evalCore.logLoss(oof.map((r) => ({ p: r.probP1, won: r.won })));
      const simAcc = evalCore.accuracy(oof.map((r) => ({ p: r.probP1, won: r.won })));
      console.log(`${label.padEnd(10)} | blend ${evalCore.logLoss(oof).toFixed(4)} (acc ${(evalCore.accuracy(oof) * 100).toFixed(1)}%) | sim alone ${simAlone.toFixed(4)} (acc ${(simAcc * 100).toFixed(1)}%)`);
    }
  }
}

// ── Regularized logistic stacker over component logits + features ─────────
const clamp3 = (x) => Math.max(-3, Math.min(3, x));
function stackFeatures(r) {
  const lA = clamp3(evalCore.logit(r.ana != null ? r.ana : r.sim.c0));
  const lE = clamp3(evalCore.logit(r.eloProbP1));
  const lR = clamp3(evalCore.logit(r.rankProbP1));
  const form = (r.form1 != null && r.form2 != null) ? (r.form1 - r.form2) : 0;
  // Prior head-to-head lean, damped by sample size (4+ meetings = full).
  const h2h = r.h2hN ? ((r.h2hW1 / r.h2hN) - 0.5) * Math.min(1, r.h2hN / 4) : 0;
  const clay = r.surface === 'clay' ? 1 : 0;
  const grass = r.surface === 'grass' ? 1 : 0;
  // Surface interactions on the sim logit let clay/grass trust the point
  // sim differently without breaking swap-antisymmetry.
  return [lA, lE, lR, form, h2h, clay * lA, grass * lA];
}

function cmdStack() {
  for (const tour of ['atp', 'wta']) {
    console.log(`\n══ ${tour.toUpperCase()} - logistic stacker (walk-forward) ══`);
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho: 0.5, marginK: true }).filter((r) => r.ana != null);

    // Baseline: the current 3-weight blend, refit per fold, on the analytic sim.
    const blendOOF = evalCore.walkForwardOOF(rows.map((r) => ({ ...r, probP1: r.ana })));
    console.log(`blend (3 weights, analytic sim)     | acc ${(evalCore.accuracy(blendOOF) * 100).toFixed(1)}% | LL ${evalCore.logLoss(blendOOF).toFixed(4)} | n=${blendOOF.length}`);

    for (const lambda of [0.3, 1, 3, 10]) {
      // Walk-forward by quarter, same protocol as walkForwardOOF.
      const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
      const folds = new Map();
      for (const r of sorted) {
        const k = evalCore.foldKey(r.date);
        if (!folds.has(k)) folds.set(k, []);
        folds.get(k).push(r);
      }
      const train = [];
      const oof = [];
      for (const [k, test] of folds) {
        if (train.length >= 150) {
          const w = evalCore.fitLogistic(train.map(stackFeatures), train.map((r) => (r.p1Won ? 1 : 0)), { lambda });
          for (const r of test) oof.push({ ...r, p: evalCore.predictLogistic(w, stackFeatures(r)), won: r.p1Won ? 1 : 0, fold: k });
        }
        train.push(...test);
      }
      const bySurf = ['hard', 'clay', 'grass'].map((s) => {
        const list = oof.filter((r) => r.surface === s);
        return `${s} ${(evalCore.accuracy(list) * 100).toFixed(1)}%`;
      }).join(' · ');
      console.log(`stacker lambda=${String(lambda).padEnd(4)}                | acc ${(evalCore.accuracy(oof) * 100).toFixed(1)}% | LL ${evalCore.logLoss(oof).toFixed(4)} | ${bySurf}`);

      // Head-to-head with the market on the priced subset.
      const priced = oof.filter((r) => r.market != null);
      if (lambda === 1 && priced.length) {
        const usAcc = evalCore.accuracy(priced);
        const mkAcc = evalCore.accuracy(priced.map((r) => ({ p: r.market, won: r.won })));
        const usLL = evalCore.logLoss(priced.map((r) => ({ p: r.p, won: r.won })));
        const mkLL = evalCore.logLoss(priced.map((r) => ({ p: r.market, won: r.won })));
        const agree = priced.filter((r) => (r.p >= 0.5) === (r.market >= 0.5)).length;
        const disagrees = priced.filter((r) => (r.p >= 0.5) !== (r.market >= 0.5));
        const disWins = disagrees.filter((r) => (r.p >= 0.5) === !!r.won).length;
        console.log(`  vs market (n=${priced.length}): us ${(usAcc * 100).toFixed(1)}% / ${usLL.toFixed(4)} | market ${(mkAcc * 100).toFixed(1)}% / ${mkLL.toFixed(4)} | agree ${(100 * agree / priced.length).toFixed(0)}% | when we disagree we win ${disWins}/${disagrees.length}`);
      }
    }
  }
}

// ── Rolling training window: should the tuner see more than this season? ──
// Weighted log-loss grid fit (same grid as evalCore.fitWeights, each match's
// loss scaled by a recency weight).
function fitWeightsW(list, wts, step = 0.05) {
  let best = null;
  for (const w of evalCore.weightGrid(step)) {
    let s = 0, W = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const p = Math.min(0.999, Math.max(0.001, w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1));
      s += wts[i] * -(m.p1Won ? Math.log(p) : Math.log(1 - p));
      W += wts[i];
    }
    const ll = s / W;
    if (!best || ll < best.logLoss) best = { ...w, logLoss: ll };
  }
  return best;
}

function cmdWindow() {
  const VARIANTS = {
    'season-only': (m) => (m.date >= '2026-01-01' ? 1 : 0),
    'window-24mo': (m, foldStart) => ((foldStart - new Date(m.date)) / 864e5 <= 730 ? 1 : 0),
    'decay-12mo': (m, foldStart) => {
      const age = (foldStart - new Date(m.date)) / 864e5;
      return age <= 730 ? Math.pow(0.5, age / 365) : 0;
    },
  };
  for (const tour of ['atp', 'wta']) {
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho: 0.5, marginK: true })
      .filter((r) => r.ana != null)
      .map((r) => ({ ...r, probP1: r.ana }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Evaluate on 2026 monthly folds; each variant trains on everything
    // strictly earlier, filtered/weighted its own way.
    const folds = new Map();
    for (const r of rows) {
      if (r.date < '2026-01-01') continue;
      const k = evalCore.foldKey(r.date, 'month');
      if (!folds.has(k)) folds.set(k, []);
      folds.get(k).push(r);
    }

    const oofByVariant = {};
    for (const [vName, weightFn] of Object.entries(VARIANTS)) {
      const oof = new Map();
      for (const [k, test] of folds) {
        const foldStart = new Date(`${k}-01T00:00:00Z`);
        const pool = rows.filter((m) => new Date(m.date) < foldStart);
        const pairs = pool.map((m) => [m, weightFn(m, foldStart)]).filter(([, w]) => w > 0);
        if (pairs.length < 100) continue;
        const train = pairs.map(([m]) => m);
        const tw = pairs.map(([, w]) => w);
        const tourFit = fitWeightsW(train, tw);
        const bySurf = {};
        for (const s of ['hard', 'clay', 'grass']) {
          const sp = pairs.filter(([m]) => m.surface === s);
          bySurf[s] = sp.length >= 40 ? fitWeightsW(sp.map(([m]) => m), sp.map(([, w]) => w)) : tourFit;
        }
        for (const m of test) {
          const w = bySurf[m.surface] || tourFit;
          oof.set(m.id, { p: w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1, won: m.p1Won ? 1 : 0 });
        }
      }
      oofByVariant[vName] = oof;
    }

    const names = Object.keys(oofByVariant);
    const common = [...oofByVariant[names[0]].keys()].filter((id) => names.every((n) => oofByVariant[n].has(id)));
    console.log(`\n══ ${tour.toUpperCase()} - tuning window (2026 walk-forward; common n=${common.length}) ══`);
    for (const n of names) {
      const all = [...oofByVariant[n].values()];
      const com = common.map((id) => oofByVariant[n].get(id));
      console.log(
        `${n.padEnd(12)} | common folds: acc ${(evalCore.accuracy(com) * 100).toFixed(1)}% LL ${evalCore.logLoss(com).toFixed(4)}` +
        ` | full coverage: n=${all.length} acc ${(evalCore.accuracy(all) * 100).toFixed(1)}% LL ${evalCore.logLoss(all).toFixed(4)}`
      );
    }
  }
}

// ── Calibration scheme selection on the decay-12mo rolling-window OOF ─────
// Every scheme is fitted SEQUENTIALLY (fold k calibrated only with folds
// strictly before k), so the comparison is honest. Calibration never flips
// a pick, so the metric is log loss.
function cmdCalibSelect() {
  const decayW = (m, foldStart) => {
    const age = (foldStart - new Date(m.date)) / 864e5;
    return age <= 730 ? Math.pow(0.5, age / 365) : 0;
  };
  for (const tour of ['atp', 'wta']) {
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho: 0.5, marginK: true })
      .filter((r) => r.ana != null)
      .map((r) => ({ ...r, probP1: r.ana }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Decay-12mo walk-forward OOF over 2026 months, keeping metadata.
    const folds = new Map();
    for (const r of rows) {
      if (r.date < '2026-01-01') continue;
      const k = evalCore.foldKey(r.date, 'month');
      if (!folds.has(k)) folds.set(k, []);
      folds.get(k).push(r);
    }
    const oof = [];
    for (const [k, test] of folds) {
      const foldStart = new Date(`${k}-01T00:00:00Z`);
      const pairs = rows.filter((m) => new Date(m.date) < foldStart)
        .map((m) => [m, decayW(m, foldStart)]).filter(([, w]) => w > 0);
      if (pairs.length < 100) continue;
      const train = pairs.map(([m]) => m);
      const tw = pairs.map(([, w]) => w);
      const tourFit = fitWeightsW(train, tw);
      const bySurf = {};
      for (const s of ['hard', 'clay', 'grass']) {
        const sp = pairs.filter(([m]) => m.surface === s);
        bySurf[s] = sp.length >= 40 ? fitWeightsW(sp.map(([m]) => m), sp.map(([, w]) => w)) : tourFit;
      }
      for (const m of test) {
        const w = bySurf[m.surface] || tourFit;
        oof.push({
          fold: k, surface: m.surface, bestOf: m.bestOf,
          p: w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1,
          won: m.p1Won ? 1 : 0,
        });
      }
    }

    // Sequential scoring under each scheme: fold k uses a's fitted on the
    // OOF from earlier folds only, grouped by the scheme's key.
    const groupers = {
      none: null,
      'per-tour': () => 'all',
      'per-surface': (r) => r.surface,
      'per-format': (r) => `bo${r.bestOf}`,
    };
    console.log(`\n══ ${tour.toUpperCase()} - calibration schemes on decay-12mo OOF (n=${oof.length}) ══`);
    const foldOrder = [...new Set(oof.map((r) => r.fold))];
    for (const [name, keyFn] of Object.entries(groupers)) {
      const scored = [];
      for (const fk of foldOrder) {
        const past = oof.filter((r) => foldOrder.indexOf(r.fold) < foldOrder.indexOf(fk));
        const test = oof.filter((r) => r.fold === fk);
        for (const r of test) {
          if (!keyFn) { scored.push({ p: r.p, won: r.won }); continue; }
          const group = past.filter((q) => keyFn(q) === keyFn(r));
          const a = evalCore.fitCalib(group);
          scored.push({ p: evalCore.applyCalib(r.p, a), won: r.won });
        }
      }
      console.log(`${name.padEnd(12)} | LL ${evalCore.logLoss(scored).toFixed(4)} | acc ${(evalCore.accuracy(scored) * 100).toFixed(1)}%`);
    }
  }
}

// ── Recency half-life sweep (24-month window fixed, decay varied) ─────────
function cmdDecay() {
  const HALF_LIVES = [90, 180, 270, 365, 550, Infinity]; // days; Infinity = flat window
  for (const tour of ['atp', 'wta']) {
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), { rho: 0.5, marginK: true })
      .filter((r) => r.ana != null)
      .map((r) => ({ ...r, probP1: r.ana }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const folds = new Map();
    for (const r of rows) {
      if (r.date < '2026-01-01') continue;
      const k = evalCore.foldKey(r.date, 'month');
      if (!folds.has(k)) folds.set(k, []);
      folds.get(k).push(r);
    }
    const oofByHl = {};
    for (const hl of HALF_LIVES) {
      const weightFn = (m, foldStart) => {
        const age = (foldStart - new Date(m.date)) / 864e5;
        if (age > 730) return 0;
        return hl === Infinity ? 1 : Math.pow(0.5, age / hl);
      };
      const oof = new Map();
      for (const [k, test] of folds) {
        const foldStart = new Date(`${k}-01T00:00:00Z`);
        const pairs = rows.filter((m) => new Date(m.date) < foldStart)
          .map((m) => [m, weightFn(m, foldStart)]).filter(([, w]) => w > 0);
        if (pairs.length < 100) continue;
        const train = pairs.map(([m]) => m);
        const tw = pairs.map(([, w]) => w);
        const tourFit = fitWeightsW(train, tw);
        const bySurf = {};
        for (const s of ['hard', 'clay', 'grass']) {
          const sp = pairs.filter(([m]) => m.surface === s);
          bySurf[s] = sp.length >= 40 ? fitWeightsW(sp.map(([m]) => m), sp.map(([, w]) => w)) : tourFit;
        }
        for (const m of test) {
          const w = bySurf[m.surface] || tourFit;
          oof.set(m.id, { p: w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1, won: m.p1Won ? 1 : 0 });
        }
      }
      oofByHl[hl] = oof;
    }
    const keys = Object.keys(oofByHl);
    const common = [...oofByHl[keys[0]].keys()].filter((id) => keys.every((k) => oofByHl[k].has(id)));
    console.log(`\n══ ${tour.toUpperCase()} - half-life sweep (24mo window; paired n=${common.length}) ══`);
    for (const hl of HALF_LIVES) {
      const com = common.map((id) => oofByHl[hl].get(id));
      console.log(`half-life ${String(hl === Infinity ? 'flat' : hl + 'd').padEnd(6)} | acc ${(evalCore.accuracy(com) * 100).toFixed(1)}% | LL ${evalCore.logLoss(com).toFixed(4)}`);
    }
  }
}

// ── Frontier 2: research-inspired engine candidates ───────────────────────
// Three pre-match engines borrowed from the literature, all leak-free:
//   - Common-Opponent (Knottenbelt et al. 2012): compare how thoroughly A
//     and B dominated the opponents they BOTH played (share of total points
//     won), a style-adjusted signal.
//   - PageRank (Radicchi 2011): a recency-decayed who-beat-whom graph over
//     the whole tour; beating good players ripples through the network.
//     Monthly point-in-time snapshots.
//   - Dominance form: the form-tilt idea, but tilting Elo by the gap in
//     share of POINTS won over the last 10 matches instead of W/L (the
//     recurring lesson of the 2024-25 momentum papers: fine-grained
//     dominance beats win/loss form).
// Single free parameters are fit sequentially (earlier folds only).

function frontier2Enrich(tour) {
  const bundle = loadTourRaw(tour);
  const cases = withElo(bundle, loadCases(tour), {});

  // Per-player chronological box-score log: date, opponent, share of total
  // points won in that match.
  const logByPlayer = new Map();
  for (const [ourId, matches] of bundle.files) {
    const apiId = String(bundle.idMap[ourId]);
    const log = [];
    for (const m of matches) {
      if (m.result_type !== 'completed' || !m.date || !m.stats) continue;
      const isP1 = String(m.player1Id) === apiId;
      const my = isP1 ? m.stats.player1 : m.stats.player2;
      const op = isP1 ? m.stats.player2 : m.stats.player1;
      if (!my || !op) continue;
      const mySv = Number(my.firstServeOf) || 0, opSv = Number(op.firstServeOf) || 0;
      const myWon = (Number(my.winningOnFirstServe) || 0) + (Number(my.winningOnSecondServe) || 0);
      const opWon = (Number(op.winningOnFirstServe) || 0) + (Number(op.winningOnSecondServe) || 0);
      const pts = mySv + opSv;
      if (pts < 40) continue;
      const dom = (myWon + (opSv - opWon)) / pts;
      log.push({ id: String(m.id), t: new Date(m.date).getTime(), opp: String(isP1 ? m.player2Id : m.player1Id), dom });
    }
    log.sort((a, b) => a.t - b.t);
    logByPlayer.set(ourId, log);
  }

  // PageRank snapshots: one per calendar month seen in the cases, built from
  // all completed tour matches strictly before that month, edge weights
  // decayed with a one-year half-life. Damping 0.85, 60 iterations.
  const tl = timelineMatches(bundle).sort((a, b) => new Date(a.date) - new Date(b.date));
  const months = [...new Set(cases.map((c) => c.date.slice(0, 7)))].sort();
  const prByMonth = new Map();
  for (const mo of months) {
    const cutoff = new Date(`${mo}-01T00:00:00Z`).getTime();
    const edges = new Map();
    const nodes = new Set();
    for (const m of tl) {
      const t = new Date(m.date).getTime();
      if (t >= cutoff) break;
      const w = Math.pow(0.5, (cutoff - t) / (365 * 864e5));
      if (w < 1e-4) continue;
      nodes.add(m.winnerId); nodes.add(m.loserId);
      if (!edges.has(m.loserId)) edges.set(m.loserId, new Map());
      const em = edges.get(m.loserId);
      em.set(m.winnerId, (em.get(m.winnerId) || 0) + w);
    }
    const ids = [...nodes];
    const idx = new Map(ids.map((x, i) => [x, i]));
    let pr = new Array(ids.length).fill(1 / ids.length);
    const D = 0.85;
    for (let it = 0; it < 60; it++) {
      const nx = new Array(ids.length).fill((1 - D) / ids.length);
      let dangling = 0;
      for (let i = 0; i < ids.length; i++) {
        const em = edges.get(ids[i]);
        if (!em || !em.size) { dangling += pr[i]; continue; }
        let tot = 0;
        for (const w of em.values()) tot += w;
        for (const [win, w] of em) nx[idx.get(win)] += D * pr[i] * (w / tot);
      }
      const add = (D * dangling) / ids.length;
      for (let i = 0; i < ids.length; i++) nx[i] += add;
      pr = nx;
    }
    const map = new Map();
    for (let i = 0; i < ids.length; i++) map.set(ids[i], pr[i]);
    prByMonth.set(mo, map);
  }

  // Case id -> player ids (the cache stores none).
  const byId = new Map();
  for (const [, matches] of bundle.files) {
    for (const m of matches) {
      if (m.result_type !== 'completed' || !m.date) continue;
      const p1 = bundle.apiToOur.get(String(m.player1Id)), p2 = bundle.apiToOur.get(String(m.player2Id));
      if (!p1 || !p2 || byId.has(String(m.id))) continue;
      byId.set(String(m.id), { p1, p2, api1: String(m.player1Id), api2: String(m.player2Id) });
    }
  }

  const out = [];
  for (const c of cases) {
    const raw = byId.get(c.id);
    if (!raw) continue;
    const t = new Date(c.date).getTime();
    const logA = (logByPlayer.get(raw.p1) || []).filter((r) => r.t < t && r.id !== c.id);
    const logB = (logByPlayer.get(raw.p2) || []).filter((r) => r.t < t && r.id !== c.id);

    const domOf = (log) => {
      const last = log.slice(-10);
      if (last.length < 4) return null;
      return last.reduce((s, r) => s + r.dom, 0) / last.length;
    };
    const dA = domOf(logA), dB = domOf(logB);

    const byOpp = (log) => {
      const m = new Map();
      for (const r of log) {
        if (!m.has(r.opp)) m.set(r.opp, { s: 0, n: 0 });
        const e = m.get(r.opp);
        e.s += r.dom; e.n++;
      }
      return m;
    };
    const oppA = byOpp(logA), oppB = byOpp(logB);
    let coSum = 0, coW = 0, coN = 0;
    for (const [opp, ea] of oppA) {
      if (opp === raw.api1 || opp === raw.api2) continue;
      const eb = oppB.get(opp);
      if (!eb) continue;
      const w = Math.min(ea.n, eb.n);
      coSum += w * (ea.s / ea.n - eb.s / eb.n);
      coW += w; coN++;
    }
    const coGap = coN >= 2 ? coSum / coW : null;

    const prMap = prByMonth.get(c.date.slice(0, 7));
    let prGap = null;
    if (prMap) {
      const a = prMap.get(raw.api1), b = prMap.get(raw.api2);
      if (a && b) prGap = Math.log(a) - Math.log(b);
    }

    out.push({ ...c, probP1: c.ana, domGap: dA != null && dB != null ? dA - dB : null, coGap, coN, prGap });
  }
  return out;
}

// Form-tilted Elo (the frontier-1 winner, benched for grass): Elo nudged by
// the last-10 W/L gap, beta fit only on earlier folds. Kept here as the
// reference line the new candidates must beat.
function formEloSequential(rows, { minTrain = 150 } = {}) {
  const withForm = rows.filter((r) => r.form1 != null && r.form2 != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const folds = new Map();
  for (const r of withForm) { const k = evalCore.foldKey(r.date); if (!folds.has(k)) folds.set(k, []); folds.get(k).push(r); }
  const oof = [], train = [];
  for (const [k, test] of folds) {
    if (train.length >= minTrain) {
      let best = { beta: 0, ll: Infinity };
      for (let beta = -1; beta <= 1.001; beta += 0.05) {
        const ll = evalCore.logLoss(train.map((r) => ({ p: evalCore.sigmoid(evalCore.logit(r.eloProbP1) + beta * (r.form1 - r.form2)), won: r.p1Won ? 1 : 0 })));
        if (ll < best.ll) best = { beta, ll };
      }
      for (const m of test) oof.push({ ...m, p: evalCore.sigmoid(evalCore.logit(m.eloProbP1) + best.beta * (m.form1 - m.form2)), won: m.p1Won ? 1 : 0, fold: k });
    }
    train.push(...test);
  }
  return oof;
}

// Sequential single-parameter fits (earlier folds only, quarter folds).
// seqTilt: p = sigmoid(logit(base) + beta * feature); missing feature = 0.
function seqTilt(rows, feat, grid, base = (r) => r.eloProbP1) {
  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
  const folds = new Map();
  for (const r of sorted) { const k = evalCore.foldKey(r.date); if (!folds.has(k)) folds.set(k, []); folds.get(k).push(r); }
  const oof = [], train = [];
  for (const [k, test] of folds) {
    const fitRows = train.filter((r) => feat(r) != null);
    if (fitRows.length >= 150) {
      let best = { beta: 0, ll: Infinity };
      for (const beta of grid) {
        const ll = evalCore.logLoss(fitRows.map((r) => ({ p: evalCore.sigmoid(evalCore.logit(base(r)) + beta * feat(r)), won: r.p1Won ? 1 : 0 })));
        if (ll < best.ll) best = { beta, ll };
      }
      for (const m of test) oof.push({ ...m, p: evalCore.sigmoid(evalCore.logit(base(m)) + best.beta * (feat(m) ?? 0)), won: m.p1Won ? 1 : 0, fold: k });
    }
    train.push(...test);
  }
  return oof;
}

// seqStandalone: p = sigmoid(kk * feature) on rows where the feature exists.
function seqStandalone(rows, feat, grid) {
  const usable = rows.filter((r) => feat(r) != null).sort((a, b) => new Date(a.date) - new Date(b.date));
  const folds = new Map();
  for (const r of usable) { const k = evalCore.foldKey(r.date); if (!folds.has(k)) folds.set(k, []); folds.get(k).push(r); }
  const oof = [], train = [];
  for (const [k, test] of folds) {
    if (train.length >= 150) {
      let best = { kk: 0, ll: Infinity };
      for (const kk of grid) {
        const ll = evalCore.logLoss(train.map((r) => ({ p: evalCore.sigmoid(kk * feat(r)), won: r.p1Won ? 1 : 0 })));
        if (ll < best.ll) best = { kk, ll };
      }
      for (const m of test) oof.push({ ...m, p: evalCore.sigmoid(best.kk * feat(m)), won: m.p1Won ? 1 : 0, fold: k });
    }
    train.push(...test);
  }
  return oof;
}

const gridRange = (lo, hi, step) => { const g = []; for (let x = lo; x <= hi + 1e-9; x += step) g.push(+x.toFixed(3)); return g; };

function cmdFrontier2() {
  const tours = process.env.TOUR ? [process.env.TOUR] : ['atp', 'wta'];
  for (const tour of tours) {
    console.log(`\n══ ${tour.toUpperCase()} - frontier 2 (research engines) ══`);
    const rows = frontier2Enrich(tour);
    const cov = (f) => rows.filter((r) => f(r) != null).length;
    console.log(`enriched n=${rows.length} | coverage: domGap ${cov((r) => r.domGap)} | coGap ${cov((r) => r.coGap)} | prGap ${cov((r) => r.prGap)}`);

    const oof3 = evalCore.walkForwardOOF(rows);
    const ids = new Set(oof3.map((r) => r.id));
    const inIds = (l) => l.filter((r) => ids.has(r.id));

    const oofFE = inIds(formEloSequential(rows));
    const oofDom = inIds(seqTilt(rows, (r) => r.domGap, gridRange(-20, 20, 0.5)));
    const oofCoT = inIds(seqTilt(rows, (r) => r.coGap, gridRange(-20, 20, 0.5)));
    const oofCoS = inIds(seqStandalone(rows, (r) => r.coGap, gridRange(0, 30, 0.5)));
    const oofPrT = inIds(seqTilt(rows, (r) => r.prGap, gridRange(-2, 2, 0.05)));
    const oofPrS = inIds(seqStandalone(rows, (r) => r.prGap, gridRange(0, 3, 0.05)));
    // Double tilt: dominance + common-opponent on top of Elo, greedily
    // (dominance beta first, then co beta on the residual).
    const oofDuo = inIds(seqTilt(
      oofDom.map((r) => ({ ...r, eloTilted: r.p })),
      (r) => r.coGap, gridRange(-20, 20, 0.5), (r) => r.eloTilted
    ));

    if (process.env.DUMP_OOF) {
      const slim = (l) => l.map((r) => ({ id: r.id, surface: r.surface, p: +r.p.toFixed(4), won: r.won }));
      fs.writeFileSync(path.join(__dirname, 'output', `frontier2_oof_${tour}.json`), JSON.stringify({
        oof3: slim(oof3), oofFE: slim(oofFE), oofDom: slim(oofDom), oofCoT: slim(oofCoT),
        oofCoS: slim(oofCoS), oofPrT: slim(oofPrT), oofPrS: slim(oofPrS), oofDuo: slim(oofDuo),
        engines: rows.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, surface: r.surface, won: r.p1Won ? 1 : 0, sim: r.probP1, elo: r.eloProbP1, rank: r.rankProbP1 })),
      }));
      console.log(`dumped OOF rows to output/frontier2_oof_${tour}.json`);
    }

    const line = (name, list) => {
      if (!list.length) return;
      console.log(`  ${name.padEnd(28)} | n=${String(list.length).padEnd(5)} | LL ${evalCore.logLoss(list).toFixed(4)} | acc ${(evalCore.accuracy(list) * 100).toFixed(1)}%`);
    };
    const block = (label, filter) => {
      console.log(label);
      const cell = rows.filter((r) => ids.has(r.id)).filter(filter);
      const alone = (name, fn) => line(name, cell.map((r) => ({ p: fn(r), won: r.p1Won ? 1 : 0 })).filter((x) => x.p != null));
      alone('elo', (r) => r.eloProbP1);
      alone('sim (ana)', (r) => r.probP1);
      line('blend3 (production)', oof3.filter((r) => filter(r)));
      line('form-tilted elo (bench)', oofFE.filter((r) => filter(r)));
      line('dominance-tilted elo', oofDom.filter((r) => filter(r)));
      line('common-opp tilted elo', oofCoT.filter((r) => filter(r)));
      line('common-opp standalone', oofCoS.filter((r) => filter(r)));
      line('pagerank-tilted elo', oofPrT.filter((r) => filter(r)));
      line('pagerank standalone', oofPrS.filter((r) => filter(r)));
      line('dom + common-opp tilt', oofDuo.filter((r) => filter(r)));
    };
    block('-- tour level --', () => true);
    for (const s of ['hard', 'clay', 'grass']) block(`-- ${s} --`, (r) => r.surface === s);
  }
}

// ── Selector policies: how should each cell pick its deployed engine? ─────
// Simulates the DEPLOYMENT decision walk-forward, month by month: at each
// month, each tour x surface cell picks an engine using only strictly
// earlier results, then that engine's picks are graded on the month.
// Policies: always Smart Blend, season-to-date accuracy best (production
// today), and recency-decayed accuracy best at several half-lives.
// The smash engine is represented by the honest walk-forward blend OOF
// probability. Hot Streak is excluded (no cached point-in-time probs; it
// has never led a cell).
function cmdSelector() {
  const POLICIES = [
    { id: 'always-smash', type: 'fixed' },
    { id: 'season-best', type: 'season' },
    { id: 'decay-45d', type: 'decay', hl: 45 },
    { id: 'decay-90d', type: 'decay', hl: 90 },
    { id: 'decay-180d', type: 'decay', hl: 180 },
  ];
  for (const tour of ['atp', 'wta']) {
    const bundle = loadTourRaw(tour);
    const rows = withElo(bundle, loadCases(tour), {}).map((r) => ({ ...r, probP1: r.ana }));
    const oof3 = evalCore.walkForwardOOF(rows);
    const univ = oof3.map((r) => ({
      id: r.id, date: r.date, surface: r.surface, won: r.won,
      probs: { smash: r.p, sim: r.probP1, elo: r.eloProbP1, rank: r.rankProbP1 },
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    const folds = new Map();
    for (const r of univ) { const k = evalCore.foldKey(r.date, 'month'); if (!folds.has(k)) folds.set(k, []); folds.get(k).push(r); }
    const ENGINES = ['smash', 'sim', 'elo', 'rank']; // smash first: wins ties
    console.log(`\n══ ${tour.toUpperCase()} - selector policies (n=${univ.length}) ══`);
    for (const pol of POLICIES) {
      const graded = [];
      const train = [];
      let switches = 0;
      const lastPick = {};
      for (const [k, test] of folds) {
        if (train.length >= 200) {
          const foldStart = new Date(`${k}-01T00:00:00Z`).getTime();
          for (const s of ['hard', 'clay', 'grass']) {
            let cell = train.filter((r) => r.surface === s);
            let wts = null;
            if (pol.type === 'season') {
              const sameYear = cell.filter((r) => r.date.slice(0, 4) === k.slice(0, 4));
              if (sameYear.length >= 30) cell = sameYear;
            } else if (pol.type === 'decay') {
              wts = cell.map((r) => Math.pow(0.5, (foldStart - new Date(r.date).getTime()) / 864e5 / pol.hl));
            }
            let pick = 'smash';
            if (pol.type !== 'fixed' && cell.length >= 30) {
              let best = -1;
              for (const e of ENGINES) {
                let num = 0, den = 0;
                for (let i = 0; i < cell.length; i++) {
                  const w = wts ? wts[i] : 1;
                  num += w * ((cell[i].probs[e] >= 0.5) === !!cell[i].won ? 1 : 0);
                  den += w;
                }
                const acc = den ? num / den : 0;
                if (acc > best + 1e-9) { best = acc; pick = e; }
              }
            }
            if (lastPick[s] && lastPick[s] !== pick) switches++;
            lastPick[s] = pick;
            for (const r of test.filter((x) => x.surface === s)) graded.push({ p: r.probs[pick], won: r.won });
          }
        }
        train.push(...test);
      }
      console.log(`  ${pol.id.padEnd(14)} | n=${graded.length} | acc ${(evalCore.accuracy(graded) * 100).toFixed(1)}% | LL ${evalCore.logLoss(graded).toFixed(4)} | engine switches ${switches}`);
    }
  }
}

const cmd = process.argv[2];
if (cmd === 'precompute') {
  const tours = process.argv[3] ? [process.argv[3]] : ['atp', 'wta'];
  for (const t of tours) precompute(t);
} else if (cmd === 'elo') cmdElo();
else if (cmd === 'shrink') cmdShrink();
else if (cmd === 'calib') cmdCalib();
else if (cmd === 'fatigue') cmdFatigue();
else if (cmd === 'market') cmdMarket();
else if (cmd === 'ana') cmdAna();
else if (cmd === 'stack') cmdStack();
else if (cmd === 'window') cmdWindow();
else if (cmd === 'calibselect') cmdCalibSelect();
else if (cmd === 'decay') cmdDecay();
else if (cmd === 'frontier2') cmdFrontier2();
else if (cmd === 'selector') cmdSelector();
else console.log('Usage: node experiments.js precompute|elo|shrink|calib|fatigue|market|ana|stack|window|frontier2|selector');
