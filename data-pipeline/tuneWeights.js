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
const { logLoss, accuracy, fitWeights, fitCalib, applyCalib, foldKey, marketProb } = require('./lib/evalCore');

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
const history = fs.existsSync(HIST_PATH) ? JSON.parse(fs.readFileSync(HIST_PATH, 'utf8')) : null;
if (!history) console.log('No tuner_history.json - tuning on the season alone (run buildTunerHistory.js in the refresh to enable the rolling window).');

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
  const fitAt = (list, asOf) => {
    const pairs = list.map((m) => [m, decayWeight(m.date, asOf)]).filter(([, w]) => w > 0);
    if (pairs.length < 40) return null;
    return fitWeights(pairs.map(([m]) => m), 0.05, pairs.map(([, w]) => w));
  };

  // 1. Walk-forward over season months: honest expected performance + the
  // OOF the calibration selection runs on.
  const folds = new Map();
  for (const m of season) {
    const k = foldKey(m.date, 'month');
    if (!folds.has(k)) folds.set(k, []);
    folds.get(k).push(m);
  }
  const oof = [];
  for (const [k, test] of folds) {
    const foldStart = new Date(`${k}-01T00:00:00Z`);
    const train = pool.filter((m) => new Date(m.date) < foldStart);
    const tourFit = fitAt(train, foldStart);
    if (!tourFit) continue;
    const bySurf = {};
    for (const s of surfaces) {
      bySurf[s] = fitAt(train.filter((m) => m.surface === s), foldStart) || tourFit;
    }
    for (const m of test) {
      const w = bySurf[m.surface] || tourFit;
      oof.push({ ...m, fold: k, p: w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1, won: m.p1Won ? 1 : 0 });
    }
  }
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
  const tourFinal = fitAt(pool, now);
  for (const surface of surfaces) {
    const fit = fitAt(pool.filter((m) => m.surface === surface), now) || tourFinal;
    config.weights[tour][surface] = { ws: fit.ws, we: fit.we, wr: fit.wr };
    console.log(`${tour} ${surface}: ws=${fit.ws} we=${fit.we} wr=${fit.wr}`);
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
}

config.tunedAt = new Date().toISOString();
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`\nWrote tuned weights + calibration to ${CONFIG_PATH}`);
