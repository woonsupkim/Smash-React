/**
 * Tunes the Smart Blend in src/engineConfig.json: per tour x surface weights
 * plus the calibration layer.
 *
 * Objective: LOG LOSS. Protocol: walk-forward over the season's months -
 * weights are fitted only on matches strictly before each fold and scored
 * on the fold, never the reverse.
 *
 * Training window: ROLLING 24 MONTHS with one-year-half-life recency
 * weighting (a match from last month counts fully, one from 18 months ago
 * about a third). Validated on the harness (experiments.js window): +1.2pt
 * ATP walk-forward accuracy vs season-only tuning, better log loss on both
 * tours, and no January cold start. Prior-season components come from
 * data-pipeline/output/tuner_history.json (built by buildTunerHistory.js in
 * the refresh workflow); with the artifact missing the tuner degrades
 * gracefully to season-only.
 *
 * Calibration: SELECTED per retune between "none" and a per-tour Platt `a`,
 * scored sequentially on the out-of-fold predictions (fold k calibrated
 * only with earlier folds). Finer schemes (per-surface, per-format) were
 * trialed and lost to both (experiments.js calibselect). The winner ships;
 * "none" writes a=1. Calibration never flips a pick.
 *
 * Also reports the gap to the bookmakers' closing odds on the season OOF.
 *
 * Scheduled by .github/workflows/retune-weights.yml just before each slam,
 * which opens a PR for human review instead of committing directly.
 *
 * Usage: node tuneWeights.js
 */
const fs = require('fs');
const path = require('path');
const { logLoss, accuracy, fitWeights, fitCalib, applyCalib, foldKey, marketProb, blendP } = require('./lib/evalCore');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'engineConfig.json');
const TR_PATH = path.join(__dirname, '..', 'public', 'data', 'track_record.json');
const HIST_PATH = path.join(__dirname, 'output', 'tuner_history.json');

const WINDOW_DAYS = 730;
// Swept on the harness (experiments.js decay): any decay beats a flat
// window, and 180-270d is a plateau marginally better than 365d on both
// tours. 270 is the plateau center - robust rather than argmin-chasing.
const HALF_LIFE_DAYS = 270;
const decayWeight = (dateStr, asOf) => {
  const age = (asOf - new Date(dateStr)) / 864e5;
  return age >= 0 && age <= WINDOW_DAYS ? Math.pow(0.5, age / HALF_LIFE_DAYS) : 0;
};

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const seasonRows = JSON.parse(fs.readFileSync(TR_PATH, 'utf8')).matches;
deriveH2h(seasonRows);
const history = fs.existsSync(HIST_PATH) ? JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')) : null;
if (!history) console.log('No tuner_history.json - tuning on the season alone (run buildTunerHistory.js in the refresh to enable the rolling window).');

// Pair-surface head-to-head, derived chronologically when rows do not carry
// it yet: P(p1) from prior meetings on this surface among graded rows,
// shrunk toward 0.5 by two pseudo-meetings ((w+1)/(n+2)). Strictly leak-free:
// each row sees only meetings before it. Rows without player ids (the tuner
// history predates the field) are left without h2h and take the
// renormalization path in blendP - buildTunerHistory writes the field going
// forward, so the history heals on the next refresh.
function deriveH2h(rows) {
  const hist = new Map();
  for (const m of [...rows].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    if (!m.p1 || !m.p2 || !m.surface) continue;
    const first = [m.p1, m.p2].sort()[0];
    const k = [m.p1, m.p2].sort().join('_') + '@' + m.surface;
    const h = hist.get(k) || { n: 0, wFirst: 0 };
    if (typeof m.h2hProbP1 !== 'number') {
      const pFirst = (h.wFirst + 1) / (h.n + 2);
      m.h2hProbP1 = m.p1 === first ? pFirst : 1 - pFirst;
    }
    if (m.winner) { h.n++; if (m.winner === first) h.wFirst++; hist.set(k, h); }
  }
}

const surfaces = ['hard', 'clay', 'grass'];
const usable = (m) => typeof m.probP1 === 'number' && typeof m.eloProbP1 === 'number' && typeof m.rankProbP1 === 'number';

for (const tour of ['atp', 'wta']) {
  const season = seasonRows.filter((m) => m.tour === tour && usable(m));
  const seasonIds = new Set(season.map((m) => m.id));
  const prior = (history?.matches || []).filter((m) => m.tour === tour && usable(m) && !seasonIds.has(m.id));
  const pool = [...prior, ...season].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (season.length < 60) {
    console.log(`${tour}: only ${season.length} season matches - keeping existing weights and calibration.`);
    continue;
  }

  // Weighted fit helpers over the rolling window as of a date.
  const fitAt = (list, asOf, withH2h = false) => {
    const pairs = list.map((m) => [m, decayWeight(m.date, asOf)]).filter(([, w]) => w > 0);
    if (pairs.length < 40) return null;
    return fitWeights(pairs.map(([m]) => m), 0.05, pairs.map(([, w]) => w), { h2h: withH2h });
  };

  // 1. Walk-forward over season months: honest expected performance + the
  // OOF the calibration selection runs on. Run TWICE - with and without the
  // head-to-head component - because a fourth weight is not free: the grid
  // grows eightfold, and on the ATP that variance cost showed up as a WORSE
  // walk-forward the first time this ran. The component must earn its slot
  // per tour on the same both-metrics rule every promotion here follows:
  // better log loss and no worse accuracy, out of fold.
  const folds = new Map();
  for (const m of season) {
    const k = foldKey(m.date, 'month');
    if (!folds.has(k)) folds.set(k, []);
    folds.get(k).push(m);
  }
  const walkForward = (withH2h) => {
    const rows = [];
    for (const [k, test] of folds) {
      const foldStart = new Date(`${k}-01T00:00:00Z`);
      const train = pool.filter((m) => new Date(m.date) < foldStart);
      const tourFit = fitAt(train, foldStart, withH2h);
      if (!tourFit) continue;
      const bySurf = {};
      for (const s of surfaces) {
        bySurf[s] = fitAt(train.filter((m) => m.surface === s), foldStart, withH2h) || tourFit;
      }
      for (const m of test) {
        const w = bySurf[m.surface] || tourFit;
        rows.push({ ...m, fold: k, p: blendP(w, m), won: m.p1Won ? 1 : 0 });
      }
    }
    return rows;
  };
  const oofBase = walkForward(false);
  const oofH2h = walkForward(true);
  const llBase = logLoss(oofBase), accBase = accuracy(oofBase);
  const llH2h = logLoss(oofH2h), accH2h = accuracy(oofH2h);
  const useH2h = llH2h < llBase - 1e-4 && accH2h >= accBase - 1e-3;
  console.log(
    `${tour} h2h component: base LL ${llBase.toFixed(4)}/acc ${(accBase * 100).toFixed(1)}% vs ` +
    `with-h2h LL ${llH2h.toFixed(4)}/acc ${(accH2h * 100).toFixed(1)}% -> ${useH2h ? 'EARNED its slot' : 'not earned, wh stays 0'}`
  );
  const oof = useH2h ? oofH2h : oofBase;
  const rawLL = logLoss(oof);
  const rawAcc = accuracy(oof);

  // 2. Calibration selection: none vs per-tour Platt, scored sequentially.
  const foldOrder = [...new Set(oof.map((r) => r.fold))];
  const seqPerTour = [];
  for (const fk of foldOrder) {
    const past = oof.filter((r) => foldOrder.indexOf(r.fold) < foldOrder.indexOf(fk));
    const a = fitCalib(past);
    for (const r of oof.filter((r) => r.fold === fk)) seqPerTour.push({ p: applyCalib(r.p, a), won: r.won });
  }
  const perTourLL = logLoss(seqPerTour);
  const useCalib = perTourLL < rawLL - 1e-4;
  const a = useCalib ? fitCalib(oof) : 1;
  config.calibration = config.calibration || {};
  config.calibration[tour] = { a };

  // 3. Shipped weights: rolling-window weighted fit as of today.
  const now = new Date();
  const tourFinal = fitAt(pool, now, useH2h);
  for (const surface of surfaces) {
    const fit = fitAt(pool.filter((m) => m.surface === surface), now, useH2h) || tourFinal;
    config.weights[tour][surface] = { ws: fit.ws, we: fit.we, wr: fit.wr, wh: fit.wh || 0 };
    console.log(`${tour} ${surface}: ws=${fit.ws} we=${fit.we} wr=${fit.wr} wh=${fit.wh || 0}`);
  }

  // 4. Report card for the PR body.
  const priced = oof.filter((r) => r.od1 && r.od2);
  let marketLine = 'no odds coverage';
  if (priced.length >= 50) {
    const mLL = logLoss(priced.map((r) => ({ p: marketProb(r.od1, r.od2), won: r.won })));
    const ourLL = logLoss(priced.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
    marketLine = `model ${ourLL.toFixed(4)} vs market ${mLL.toFixed(4)} (gap ${(ourLL - mLL).toFixed(4)}, n=${priced.length})`;
  }
  console.log(
    `${tour} walk-forward (rolling ${history ? '24mo window' : 'SEASON-ONLY fallback'}): ` +
    `acc ${(rawAcc * 100).toFixed(1)}% | LL raw ${rawLL.toFixed(4)} vs per-tour calib ${perTourLL.toFixed(4)} ` +
    `-> shipping ${useCalib ? `a=${a}` : 'no calibration (a=1)'} | training pool ${pool.length} (${prior.length} prior + ${season.length} season) | closing odds: ${marketLine}`
  );

  // 5. Bucketwise honesty, on the same OOF the selection ran on. Log loss is
  // an aggregate and a single temperature is a global shape, so a model can
  // pass both while being wrong in one confidence band - stated 90s landing
  // like 82s is invisible above. This line exists so a SHAPE defect shows up
  // in the retune PR body the day it appears, with the binomial noise floor
  // printed next to it so nobody chases a ghost either. (An August 2026 scare
  // was exactly that: said 90 landed 82 on n=38, z=1.7 - noise.)
  const calOof = oof.map((r) => ({ p: applyCalib(r.p, a), won: r.won }));
  const bands = [[0.5, 0.65], [0.65, 0.75], [0.75, 0.85], [0.85, 1.01]];
  const bandTxt = bands.map(([lo, hi]) => {
    const g = calOof.map((r) => ({ pf: Math.max(r.p, 1 - r.p), hit: (r.p >= 0.5) === (r.won === 1) }))
      .filter((r) => r.pf >= lo && r.pf < hi);
    if (g.length < 20) return `${Math.round(lo * 100)}+: n<20`;
    const said = g.reduce((s, r) => s + r.pf, 0) / g.length;
    const hit = g.filter((r) => r.hit).length / g.length;
    const sigma = Math.sqrt(said * (1 - said) / g.length);
    const z = (said - hit) / sigma;
    return `${Math.round(lo * 100)}-${Math.round(Math.min(hi, 1) * 100)}: said ${(said * 100).toFixed(0)} landed ${(hit * 100).toFixed(0)} (n=${g.length}, z=${z.toFixed(1)})`;
  }).join(' | ');
  console.log(`${tour} calibration by band (OOF): ${bandTxt}`);

  // 6. The money line, same OOF. Accuracy framing ties the market; the
  // return framing is where the product actually lives, so every retune
  // reports what a selective flat-stake policy would have returned on the
  // out-of-fold predictions at the recorded odds. One price snapshot exists
  // per match in this feed (verified: lock price == graded price, byte for
  // byte), so this is settle-at-the-only-price, not closing-line value -
  // CLV stays unmeasurable until a second snapshot is captured.
  const pricedOof = calOof.map((r, i) => ({ ...r, od1: oof[i].od1, od2: oof[i].od2 }))
    .filter((r) => r.od1 > 1 && r.od2 > 1);
  const money = (bets) => {
    let pl = 0;
    for (const r of bets) {
      const pickP1 = r.p >= 0.5;
      const o = pickP1 ? r.od1 : r.od2;
      const wonPick = pickP1 === (r.won === 1);
      pl += wonPick ? o - 1 : -1;
    }
    return { n: bets.length, roi: bets.length ? pl / bets.length : 0 };
  };
  const evBets = pricedOof.filter((r) => {
    const pickP1 = r.p >= 0.5;
    const p = pickP1 ? r.p : 1 - r.p;
    const o = pickP1 ? r.od1 : r.od2;
    return p * o > 1;
  });
  const all = money(pricedOof), ev = money(evBets);
  console.log(`${tour} money (OOF, flat $1): all priced n=${all.n} ROI ${(all.roi * 100).toFixed(1)}% | +EV only n=${ev.n} ROI ${(ev.roi * 100).toFixed(1)}%`);
}

config.tunedAt = new Date().toISOString();
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`\nWrote tuned weights + calibration to ${CONFIG_PATH}`);
