/**
 * Head-to-head backtest of the two rating models: production Elo (eloCore.js)
 * and the Bayesian player-strength filter (bayesCore.js).
 *
 * It answers three questions in one run, in the order they need answering:
 *
 *   1. Is the shipped Elo K-schedule mis-tuned? A restricted-universe backtest
 *      suggested flattening 250/(n+5)^0.4 toward a constant K was worth several
 *      points of accuracy. Elo gets a real sweep here to confirm or kill that.
 *   2. Does training on non-roster opponents help or hurt? Production Elo rates
 *      every tour-level opponent, including players who enter at the 1500 base
 *      and never appear in the graded record. On the restricted universe the
 *      SMALLER training set scored better, which is backwards and worth a
 *      controlled test.
 *   3. Does the Bayesian filter beat a FAIRLY TUNED Elo? Not the shipped one -
 *      beating a mis-tuned incumbent proves nothing.
 *
 * PROTOCOL
 *   Training universe: the full raw match cache when available (multi-season,
 *   all opponents), else the committed track record (one season,
 *   roster-vs-roster). See lib/matchUniverse.js - the source is printed and
 *   recorded, because a verdict from the fallback universe does NOT transfer
 *   to production.
 *
 *   Scoring set: only matches the track record grades, always, whatever the
 *   training universe. Changing what a model learns from must never change the
 *   denominator it is judged on.
 *
 *   Split: the most recent HOLDOUT_MONTHS are held out and every sweep is run
 *   on the earlier data only. Platt recalibration coefficients are fitted on
 *   the training side too. Ratings are replayed in date order throughout and
 *   every prediction is taken from the state BEFORE its match, so the holdout
 *   is clean even though the timeline runs through it.
 *
 * Usage: node backtestBayes.js [atp|wta] [--quick] [--track] [--rank-prior]
 *                              [--holdout-months=N]
 */
const fs = require('fs');
const path = require('path');
const { buildBayesTimeline, winProbBayes, DEFAULT_PARAMS } = require('./bayesCore');
const { buildTimeline, predElo, expected, setEloParams } = require('./eloCore');
const { logLoss, accuracy, fitCalib, applyCalib } = require('./lib/evalCore');
const { loadUniverse, gradedRows } = require('./lib/matchUniverse');
const ENGINE = require('../src/engineConfig.json');

const OUT_PATH = path.join(__dirname, 'output', 'bayes_backtest.json');

const argv = process.argv.slice(2);
const onlyTour = ['atp', 'wta'].includes(argv[0]) ? argv[0] : null;
const QUICK = argv.includes('--quick');
const FORCE_TRACK = argv.includes('--track');
const WITH_RANK_PRIOR = argv.includes('--rank-prior');
const HOLDOUT_MONTHS = Number((argv.find((a) => a.startsWith('--holdout-months=')) || '').split('=')[1]) || 6;

const fmt = (n, d = 4) => (n == null ? '  n/a ' : n.toFixed(d));
const pct = (n) => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`);

// ── Model runners ─────────────────────────────────────────────────────────
// Both replay `timeline` in date order and return Map<matchId, {p, won}> for
// the graded matches only, where p = P(the graded row's p1 wins). Orientation
// comes from the graded row, never from the timeline's winner/loser order -
// otherwise `p` would encode the answer.
function orient(graded, m, pWinner) {
  const row = graded.get(m.id);
  if (!row) return null;
  const p1IsWinner = row.winner === row.p1;
  return { p: p1IsWinner ? pWinner : 1 - pWinner, won: p1IsWinner ? 1 : 0, surface: m.surface, date: m.date };
}

function runElo(timeline, graded, params) {
  setEloParams(params || ENGINE.elo || {});
  const out = new Map();
  buildTimeline(timeline, (m, rw, rl) => {
    if (!graded.has(m.id)) return;
    const rec = orient(graded, m, expected(predElo(rw, m.surface), predElo(rl, m.surface)));
    if (rec) out.set(m.id, rec);
  });
  return out;
}

function runBayes(timeline, graded, params) {
  const out = new Map();
  buildBayesTimeline(timeline, (m, sw, sl) => {
    if (!graded.has(m.id)) return;
    const rec = orient(graded, m, winProbBayes(sw, sl, m.surface));
    if (rec) return void out.set(m.id, { ...rec, minSeen: Math.min(sw.seen, sl.seen) });
  }, { params });
  return out;
}

// ── Grids ─────────────────────────────────────────────────────────────────
const sq = (x) => x * x;
const yr = (sdPerYear) => sq(sdPerYear) / 365;

const ELO_GRID = QUICK
  ? { rho: [0.5], marginK: [true], kScale: [250], kExp: [0, 0.4] }
  : {
    rho: [0.35, 0.5, 0.65],
    marginK: [true, false],
    // Extended down to 40: the first full-cache run pinned WTA at the old 150
    // floor WITH kExp=0, i.e. a constant K, and a constant K of 150 is very
    // large (this repo's default schedule is ~70 at 20 matches played). An
    // optimum sitting on a grid boundary is not an optimum, so the range has
    // to contain it before any of it reaches engineConfig.
    kScale: [40, 60, 100, 150, 250, 400, 600, 900],
    // 0 is a constant K; negative would mean K GROWING with experience, which
    // has no defensible story, so 0 is the floor by design rather than by grid.
    kExp: [0, 0.1, 0.25, 0.4, 0.6],
  };

const BAYES_GRID = QUICK
  ? { v0: [sq(250)], v0Surf: [0, sq(180)], drift: [yr(1800)], driftSurf: [yr(1000)], marginK: [true], rankPrior: [0] }
  : {
    v0: [sq(140), sq(180), sq(250), sq(350)],
    v0Surf: [0, sq(120), sq(180), sq(250)],
    // drift saturates once a typical between-match gap re-opens as much
    // variance as v0 caps, so the top of this range is a plateau, not an edge.
    drift: [yr(600), yr(1200), yr(1800)],
    driftSurf: [0, yr(600), yr(1000)],
    marginK: [true, false],
    rankPrior: WITH_RANK_PRIOR ? [0, 250] : [0],
  };

function configs(grid) {
  let out = [{}];
  for (const [key, vals] of Object.entries(grid)) {
    const next = [];
    for (const base of out) for (const v of vals) next.push({ ...base, [key]: v });
    out = next;
  }
  return out;
}

const eloLabel = (c) => `rho=${c.rho} margin=${c.marginK ? 'on' : 'off'} kScale=${c.kScale} kExp=${c.kExp}`;
const bayesLabel = (c) =>
  `sd0=${Math.round(Math.sqrt(c.v0))} sdSurf=${Math.round(Math.sqrt(c.v0Surf))} ` +
  `drift=${Math.round(Math.sqrt(c.drift * 365))}/yr driftSurf=${Math.round(Math.sqrt(c.driftSurf * 365))}/yr ` +
  `margin=${c.marginK ? 'on' : 'off'}${c.rankPrior ? ` rankPrior=${c.rankPrior}` : ''}`;

// ── Report ────────────────────────────────────────────────────────────────
const report = { generatedAt: new Date().toISOString(), holdoutMonths: HOLDOUT_MONTHS, tours: {} };

for (const tour of (onlyTour ? [onlyTour] : ['atp', 'wta'])) {
  const uni = loadUniverse(tour, { prefer: FORCE_TRACK ? 'track' : 'raw' });
  if (!uni) { console.log(`${tour}: no match universe available - skipping.`); continue; }
  const graded = gradedRows(tour);
  if (graded.size < 200) { console.log(`${tour}: only ${graded.size} graded matches - skipping.`); continue; }

  // Holdout cutoff: the last HOLDOUT_MONTHS of the timeline - but clamped so
  // the TRAINING side keeps at least half the graded rows.
  //
  // The two datasets have very different spans: the raw timeline reaches back
  // years, while the graded scoring set only covers the current season. A
  // holdout defined on the timeline therefore says nothing about how the
  // graded rows split, and a 6-month window on an 11-year cache left ~500
  // graded matches to sweep on and ~2200 to be judged on - fitting on the
  // small side and testing on the big one. Ratings still learn from the whole
  // timeline; only hyperparameter SELECTION needs a fair share of labels.
  const gd = [...graded.values()].map((m) => new Date(m.date).getTime()).sort((a, b) => a - b);
  const median = gd[Math.floor(gd.length / 2)];
  const byMonths = new Date(uni.to).getTime() - HOLDOUT_MONTHS * 30.44 * 864e5;
  const cutoff = Math.max(byMonths, median);
  const splitNote = cutoff === median
    ? `median of graded rows (a ${HOLDOUT_MONTHS}-month window would leave too few labels to sweep on)`
    : `last ${HOLDOUT_MONTHS} months`;
  const isTrain = (r) => new Date(r.date).getTime() < cutoff;
  const isTest = (r) => new Date(r.date).getTime() >= cutoff;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`${tour.toUpperCase()}  universe=${uni.source.toUpperCase()}  ${uni.matches.length} matches  ` +
    `${uni.from.slice(0, 10)} -> ${uni.to.slice(0, 10)} (${uni.spanDays}d)  roster-vs-roster ${pct(uni.rosterShare)}`);
  console.log(`graded scoring set: ${graded.size}  |  split: ${splitNote} @ ${new Date(cutoff).toISOString().slice(0, 10)}`);
  if (uni.source === 'track') {
    console.log('! FALLBACK UNIVERSE: one season, roster-vs-roster only. Findings here do NOT transfer to production.');
  }

  // Training-universe variants. Only meaningful when the raw cache actually
  // contains non-roster matches to drop.
  const variants = [['full', uni.matches]];
  if (uni.rosterShare < 0.999) variants.push(['rosterOnly', uni.matches.filter((m) => m.rostered)]);

  const pickRows = (mp, keep) => [...mp.values()].filter(keep).map((r) => ({ p: r.p, won: r.won }));
  const tourOut = {
    universe: { source: uni.source, n: uni.matches.length, from: uni.from, to: uni.to, rosterShare: uni.rosterShare },
    graded: graded.size, cutoff: new Date(cutoff).toISOString(), elo: {}, bayes: {},
  };

  // ── 1 + 2. Elo: shipped vs swept, per training universe ────────────────
  console.log(`\nELO  (sweeping ${configs(ELO_GRID).length} configs on the training side, per training universe)`);
  console.log(`  ${'universe / config'.padEnd(46)} ${'holdout LL'.padStart(10)} ${'acc'.padStart(7)}`);
  let eloBest = null;
  for (const [vname, timeline] of variants) {
    const shipped = runElo(timeline, graded, ENGINE.elo || {});
    const shipA = fitCalib(pickRows(shipped, isTrain));
    const shipTest = pickRows(shipped, isTest).map((r) => ({ p: applyCalib(r.p, shipA), won: r.won }));
    console.log(`  ${`${vname}: as shipped +Platt(a=${shipA})`.padEnd(46)} ${fmt(logLoss(shipTest)).padStart(10)} ${pct(accuracy(shipTest)).padStart(7)}`);

    let bestHere = null;
    const ranked = [];
    for (const c of configs(ELO_GRID)) {
      const preds = runElo(timeline, graded, c);
      const train = pickRows(preds, isTrain);
      const a = fitCalib(train);
      const fitLL = logLoss(train.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
      const cand = { c, a, fitLL, preds, variant: vname, timeline };
      ranked.push(cand);
      if (!bestHere || fitLL < bestHere.fitLL) bestHere = cand;
    }
    // Also report the best config that leaves rho at whatever engineConfig
    // ships. rho is the only Elo parameter the CLIENT also reads
    // (src/engines.js eloProb), and it is currently a single global value, so
    // a tuned rho that differs per tour would turn a pipeline-only retune
    // into a client change. Knowing what rho is worth decides whether that
    // is a cost worth paying.
    const shippedRho = (ENGINE.elo || {}).rho ?? 0.5;
    const bestFixedRho = ranked.filter((r) => r.c.rho === shippedRho).sort((a, b) => a.fitLL - b.fitLL)[0];
    if (bestFixedRho) {
      const t = pickRows(bestFixedRho.preds, isTest).map((r) => ({ p: applyCalib(r.p, bestFixedRho.a), won: r.won }));
      console.log(`  ${`${vname}: TUNED, rho pinned ${shippedRho} ${eloLabel(bestFixedRho.c)}`.padEnd(46)} ${fmt(logLoss(t)).padStart(10)} ${pct(accuracy(t)).padStart(7)}`);
      tourOut.elo[`${vname}_fixedRho`] = { ...bestFixedRho.c, a: bestFixedRho.a, logLoss: logLoss(t), accuracy: accuracy(t) };
    }
    const test = pickRows(bestHere.preds, isTest).map((r) => ({ p: applyCalib(r.p, bestHere.a), won: r.won }));
    bestHere.testLL = logLoss(test); bestHere.testAcc = accuracy(test);
    console.log(`  ${`${vname}: TUNED ${eloLabel(bestHere.c)}`.padEnd(46)} ${fmt(bestHere.testLL).padStart(10)} ${pct(bestHere.testAcc).padStart(7)}`);
    tourOut.elo[vname] = {
      shipped: { a: shipA, logLoss: logLoss(shipTest), accuracy: accuracy(shipTest) },
      tuned: { ...bestHere.c, a: bestHere.a, logLoss: bestHere.testLL, accuracy: bestHere.testAcc },
    };
    if (!eloBest || bestHere.testLL < eloBest.testLL) eloBest = bestHere;
  }

  // ── 3. Bayes on the SAME training universe the tuned Elo won on ────────
  const arena = eloBest.timeline;
  console.log(`\nBAYES (sweeping ${configs(BAYES_GRID).length} configs; training universe = ${eloBest.variant}, matching the best Elo)`);
  let bBest = null, bNoSurf = null;
  const bDefault = runBayes(arena, graded, DEFAULT_PARAMS);
  for (const c of configs(BAYES_GRID)) {
    const params = { ...DEFAULT_PARAMS, ...c };
    const preds = runBayes(arena, graded, params);
    const train = pickRows(preds, isTrain);
    const a = fitCalib(train);
    const fitLL = logLoss(train.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
    const cand = { c, params, a, fitLL, preds };
    if (!bBest || fitLL < bBest.fitLL) bBest = cand;
    if (c.v0Surf === 0 && (!bNoSurf || fitLL < bNoSurf.fitLL)) bNoSurf = cand;
  }
  const testOf = (cand) => {
    const t = pickRows(cand.preds, isTest).map((r) => ({ p: applyCalib(r.p, cand.a), won: r.won }));
    return { logLoss: logLoss(t), accuracy: accuracy(t) };
  };
  const bDefA = fitCalib(pickRows(bDefault, isTrain));
  const bDefTest = pickRows(bDefault, isTest).map((r) => ({ p: applyCalib(r.p, bDefA), won: r.won }));
  const bBestTest = testOf(bBest), bNoSurfTest = bNoSurf ? testOf(bNoSurf) : null;

  console.log(`  ${'config'.padEnd(46)} ${'holdout LL'.padStart(10)} ${'acc'.padStart(7)}`);
  console.log(`  ${'shipped defaults +Platt'.padEnd(46)} ${fmt(logLoss(bDefTest)).padStart(10)} ${pct(accuracy(bDefTest)).padStart(7)}`);
  console.log(`  ${`TUNED ${bayesLabel(bBest.c)}`.padEnd(46)} ${fmt(bBestTest.logLoss).padStart(10)} ${pct(bBestTest.accuracy).padStart(7)}`);
  if (bNoSurfTest) console.log(`  ${'ablation: surface offsets OFF'.padEnd(46)} ${fmt(bNoSurfTest.logLoss).padStart(10)} ${pct(bNoSurfTest.accuracy).padStart(7)}`);
  tourOut.bayes = { defaults: { a: bDefA, logLoss: logLoss(bDefTest), accuracy: accuracy(bDefTest) },
    tuned: { ...bBest.c, a: bBest.a, ...bBestTest }, noSurfaceOffsets: bNoSurfTest };

  // ── Verdicts ───────────────────────────────────────────────────────────
  // Promotion rule, same as the frontier bench: a challenger earns a slot only
  // by beating the incumbent on BOTH log loss and accuracy, per surface.
  const cells = [];
  for (const s of ['hard', 'clay', 'grass']) {
    const bs = pickRows(bBest.preds, (r) => isTest(r) && r.surface === s).map((r) => ({ p: applyCalib(r.p, bBest.a), won: r.won }));
    const es = pickRows(eloBest.preds, (r) => isTest(r) && r.surface === s).map((r) => ({ p: applyCalib(r.p, eloBest.a), won: r.won }));
    if (bs.length < 40) { cells.push({ s, n: bs.length, verdict: 'too few' }); continue; }
    const win = logLoss(bs) < logLoss(es) && accuracy(bs) > accuracy(es);
    cells.push({ s, n: bs.length, bayesLL: logLoss(bs), bayesAcc: accuracy(bs), eloLL: logLoss(es), eloAcc: accuracy(es), verdict: win ? 'bayes' : 'elo/tie' });
  }
  console.log(`\nVERDICT (${tour})`);
  const shippedBest = tourOut.elo[eloBest.variant].shipped;
  const dLL = shippedBest.logLoss - eloBest.testLL, dAcc = eloBest.testAcc - shippedBest.accuracy;
  console.log(`  1. Elo retune: ${dLL > 0.005 && dAcc > 0.005 ? 'CONFIRMED' : 'NOT confirmed'} - ` +
    `${eloLabel(eloBest.c)} beats shipped by ${dLL.toFixed(4)} LL / ${(dAcc * 100).toFixed(1)}pt acc on the holdout.`);
  if (variants.length > 1) {
    const f = tourOut.elo.full.tuned, r = tourOut.elo.rosterOnly.tuned;
    console.log(`  2. Non-roster opponents: training on them is ${f.logLoss <= r.logLoss ? 'BETTER' : 'WORSE'} ` +
      `(full ${fmt(f.logLoss)}/${pct(f.accuracy)} vs rosterOnly ${fmt(r.logLoss)}/${pct(r.accuracy)}).`);
  } else {
    console.log('  2. Non-roster opponents: untestable on this universe (roster-vs-roster only).');
  }
  const wins = cells.filter((c) => c.verdict === 'bayes').length;
  console.log(`  3. Bayes vs TUNED Elo: wins ${wins}/${cells.filter((c) => c.verdict !== 'too few').length} surfaces on BOTH metrics ` +
    `-> ${wins === cells.filter((c) => c.verdict !== 'too few').length ? 'SHIP' : wins > 0 ? 'PARTIAL (surface-gated at best)' : 'DO NOT SHIP'}`);
  for (const c of cells) {
    if (c.verdict === 'too few') { console.log(`     ${c.s.padEnd(6)} n=${c.n} - too few to read`); continue; }
    console.log(`     ${c.s.padEnd(6)} n=${String(c.n).padStart(4)}  bayes ${fmt(c.bayesLL)}/${pct(c.bayesAcc)}  elo ${fmt(c.eloLL)}/${pct(c.eloAcc)}  -> ${c.verdict}`);
  }
  tourOut.verdict = { eloRetuneConfirmed: dLL > 0.005 && dAcc > 0.005, eloGain: { logLoss: dLL, accuracy: dAcc }, surfaces: cells };
  report.tours[tour] = tourOut;
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), OUT_PATH)}`);
