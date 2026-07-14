/**
 * Tunes the Smart Blend weights in src/engineConfig.json.
 *
 * Reads the already-simulated per-match component probabilities from
 * public/data/track_record.json (probP1 = point sim, eloProbP1 = surface Elo,
 * rankProbP1 = ranking-implied) and grid-searches the per tour x surface blend
 * ws*sim + we*elo + wr*rank that maximizes winner-call accuracy on the 2026
 * season, tie-broken by log loss. The point of the blend is to beat the plain
 * "higher-ranked player wins" baseline by a comfortable margin - this reports
 * that margin per surface so the improvement is visible.
 *
 * Run AFTER a track-record build (which produces the component probs). The
 * full re-simulation with the new weights happens automatically on the next
 * refresh: buildTrackRecord fingerprints the model config (modelKey) and
 * re-evaluates everything when it changes.
 *
 * Scheduled by .github/workflows/retune-weights.yml just before each slam,
 * which opens a PR for human review instead of committing directly.
 *
 * Usage: node tuneWeights.js
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'engineConfig.json');
const TR_PATH = path.join(__dirname, '..', 'public', 'data', 'track_record.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const matches = JSON.parse(fs.readFileSync(TR_PATH, 'utf8')).matches;

const STEP = 0.05; // grid granularity for each weight
const clamp = (p) => Math.min(0.999, Math.max(0.001, p));

// Candidate (ws, we, wr) triples on the simplex ws+we+wr=1.
function grid() {
  const out = [];
  const n = Math.round(1 / STEP);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const ws = i / n, we = j / n, wr = (n - i - j) / n;
      out.push({ ws: +ws.toFixed(3), we: +we.toFixed(3), wr: +wr.toFixed(3) });
    }
  }
  return out;
}
const GRID = grid();

// Accuracy + log loss of a weight triple over a set of matches.
function score(list, w) {
  let correct = 0, logLoss = 0;
  for (const m of list) {
    const blend = w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1;
    const pickP1 = blend >= 0.5;
    if (pickP1 === m.p1Won) correct++;
    const p = clamp(blend);
    logLoss += -(m.p1Won ? Math.log(p) : Math.log(1 - p));
  }
  return { acc: correct / list.length, logLoss: logLoss / list.length };
}

const tours = ['atp', 'wta'];
const surfaces = ['hard', 'clay', 'grass'];

for (const tour of tours) {
  for (const surface of surfaces) {
    const list = matches.filter((m) => m.tour === tour && m.surface === surface &&
      typeof m.probP1 === 'number' && typeof m.eloProbP1 === 'number' && typeof m.rankProbP1 === 'number');
    if (list.length < 15) {
      console.log(`${tour} ${surface}: only ${list.length} matches - keeping existing weights.`);
      continue;
    }
    // Baseline = plain "higher rank wins" (argmax of rankProb).
    const baseAcc = list.filter((m) => (m.rankProbP1 >= 0.5) === m.p1Won).length / list.length;

    let best = null;
    for (const w of GRID) {
      const s = score(list, w);
      if (!best || s.acc > best.acc + 1e-9 || (Math.abs(s.acc - best.acc) < 1e-9 && s.logLoss < best.logLoss)) {
        best = { ...w, ...s };
      }
    }
    config.weights[tour][surface] = { ws: best.ws, we: best.we, wr: best.wr };
    const lift = ((best.acc - baseAcc) * 100).toFixed(1);
    console.log(
      `${tour} ${surface} (n=${list.length}): ws=${best.ws} we=${best.we} wr=${best.wr} | ` +
      `blend ${(best.acc * 100).toFixed(1)}% vs baseline ${(baseAcc * 100).toFixed(1)}% (+${lift} pts)`
    );
  }
}

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
console.log(`\nWrote tuned weights to ${CONFIG_PATH}`);
