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

  const out = [];
  let done = 0;
  for (const c of cases) {
    const { m, p1, p2, surface } = c;
    const asOf = new Date(m.date);
    const aggA = aggAsOf(p1, m.id, asOf, surface);
    const aggB = aggAsOf(p2, m.id, asOf, surface);
    done++;
    if (done % 500 === 0) console.log(`  ${done}/${cases.length}…`);

    const sim = {};
    let ok = true;
    for (const cshrink of SHRINK_VARIANTS) {
      const pa = deriveProbabilities(aggA, tourAvgs[surface], 200, cshrink);
      const pb = deriveProbabilities(aggB, tourAvgs[surface], 200, cshrink);
      if (!pa || !pb) { ok = false; break; }
      const { matchWins } = simulateBatch(pa, pb, SIMS);
      sim[`c${cshrink}`] = +(matchWins[0] / SIMS).toFixed(4);
    }
    if (!ok) continue;

    const p1Won = String(m.match_winner) === String(m.player1Id);
    const { setsW, setsL } = parseSets(m.result, p1Won);
    const rankA = bundle.ranks[surface].get(p1) || 999;
    const rankB = bundle.ranks[surface].get(p2) || 999;
    const f1 = fatigueOf(p1, m), f2 = fatigueOf(p2, m);
    out.push({
      id: String(m.id), date: m.date, surface, p1Won,
      sim,
      rankProbP1: +(1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale))).toFixed(4),
      market: evalCore.marketProb(Number(m.odd1), Number(m.odd2)),
      setsW, setsL, bestOf: Number(m.best_of) || null,
      rest1: f1.rest, rest2: f2.rest, sets1: f1.sets, sets2: f2.sets,
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

const cmd = process.argv[2];
if (cmd === 'precompute') {
  const tours = process.argv[3] ? [process.argv[3]] : ['atp', 'wta'];
  for (const t of tours) precompute(t);
} else if (cmd === 'elo') cmdElo();
else if (cmd === 'shrink') cmdShrink();
else if (cmd === 'calib') cmdCalib();
else if (cmd === 'fatigue') cmdFatigue();
else if (cmd === 'market') cmdMarket();
else console.log('Usage: node experiments.js precompute|elo|shrink|calib|fatigue|market');
