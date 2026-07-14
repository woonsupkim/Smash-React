/**
 * Tunes the Smart Blend in src/engineConfig.json: the per tour x surface
 * weights AND the per-tour Platt calibration.
 *
 * Objective: LOG LOSS, not accuracy - accuracy can't tell a 55% call from a
 * 95% call; log loss is exactly the penalty for stated confidence.
 *
 * Protocol: walk-forward. The season's matches fold by calendar month;
 * weights are fitted only on months strictly before each fold and scored on
 * the fold, never the reverse. The pooled out-of-fold predictions are what
 * the Platt `a` is fitted on (so the calibration never sees its own
 * training data), and the walk-forward log loss is the honest headline
 * number reported to the PR. The SHIPPED weights are then refitted on the
 * full season (standard practice: validation tells you the expected error,
 * the final model uses all available data).
 *
 * Also reports the gap to the bookmakers' closing odds - the north-star
 * benchmark for whether a change was real.
 *
 * Reads the already-simulated per-match component probabilities from
 * public/data/track_record.json. Run AFTER a track-record build; the full
 * re-simulation with new weights happens automatically on the next refresh
 * (buildTrackRecord fingerprints the model config via modelKey).
 *
 * Scheduled by .github/workflows/retune-weights.yml just before each slam,
 * which opens a PR for human review instead of committing directly.
 *
 * Usage: node tuneWeights.js
 */
const fs = require('fs');
const path = require('path');
const { logLoss, accuracy, fitWeights, fitCalib, applyCalib, walkForwardOOF, marketProb } = require('./lib/evalCore');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'engineConfig.json');
const TR_PATH = path.join(__dirname, '..', 'public', 'data', 'track_record.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const matches = JSON.parse(fs.readFileSync(TR_PATH, 'utf8')).matches;

const tours = ['atp', 'wta'];
const surfaces = ['hard', 'clay', 'grass'];

for (const tour of tours) {
  const list = matches.filter((m) => m.tour === tour &&
    typeof m.probP1 === 'number' && typeof m.eloProbP1 === 'number' && typeof m.rankProbP1 === 'number');
  if (list.length < 60) {
    console.log(`${tour}: only ${list.length} matches - keeping existing weights and calibration.`);
    continue;
  }

  // 1. Honest expected performance + calibration data: walk-forward OOF.
  const oof = walkForwardOOF(list, { minTrain: 100, minSurface: 40, foldBy: 'month' });
  const oofLL = logLoss(oof);
  const oofAcc = accuracy(oof);

  // 2. Platt `a` fitted on the OOF predictions only.
  const a = fitCalib(oof);
  const calLL = logLoss(oof.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
  config.calibration = config.calibration || {};
  config.calibration[tour] = { a };

  // 3. Shipped weights: refit on the full season by log loss.
  const tourFit = fitWeights(list);
  for (const surface of surfaces) {
    const slist = list.filter((m) => m.surface === surface);
    const fit = slist.length >= 40 ? fitWeights(slist) : tourFit;
    config.weights[tour][surface] = { ws: fit.ws, we: fit.we, wr: fit.wr };
    console.log(`${tour} ${surface} (n=${slist.length}): ws=${fit.ws} we=${fit.we} wr=${fit.wr} (in-sample LL ${fit.logLoss.toFixed(4)})`);
  }

  // 4. Benchmarks on the OOF set.
  const rankLL = logLoss(oof.map((r) => ({ p: r.rankProbP1, won: r.won })));
  const priced = oof.filter((r) => r.od1 && r.od2);
  let marketLine = 'no odds coverage';
  if (priced.length >= 50) {
    const mLL = logLoss(priced.map((r) => ({ p: marketProb(r.od1, r.od2), won: r.won })));
    const ourLL = logLoss(priced.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
    marketLine = `model ${ourLL.toFixed(4)} vs market ${mLL.toFixed(4)} (gap ${(ourLL - mLL).toFixed(4)}, n=${priced.length})`;
  }
  console.log(
    `${tour} walk-forward: raw LL ${oofLL.toFixed(4)} -> calibrated ${calLL.toFixed(4)} (a=${a}) | ` +
    `acc ${(oofAcc * 100).toFixed(1)}% | rank baseline LL ${rankLL.toFixed(4)} | closing odds: ${marketLine}`
  );
}

config.tunedAt = new Date().toISOString();
fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`\nWrote tuned weights + calibration to ${CONFIG_PATH}`);
