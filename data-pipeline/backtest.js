/**
 * Calibration / backtest: for every historical match between two players who
 * are BOTH in the current roster, recompute each player's point-in-time
 * decayed p1-p5 using only matches strictly before that match's date, run
 * the actual simulator's simulateBatch on that snapshot, and compare the
 * predicted win probability to what really happened.
 *
 * This produces a calibration score (Brier score / log loss / accuracy) per
 * candidate half-life so you can pick the half-life that's actually most
 * predictive, rather than just plausible-looking.
 *
 * Usage: node backtest.js [comma-separated halfLifeDays list]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

const RAW_DIR = path.join(__dirname, 'raw');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SIMULATOR_PATH = path.join(__dirname, '..', 'src', 'simulator.js');
const SIMS_PER_MATCH = 300;
const DEFAULT_HALF_LIVES = [60, 90, 150, 270, 365, 540, 730];

// src/simulator.js is an ES module (used by the React app's build). Rather
// than duplicate its logic here, transpile it to CommonJS on the fly into a
// throwaway temp file and require that, so the backtest always exercises
// the exact same simulation code the live app uses.
function loadSimulatorAsCjs() {
  const source = fs.readFileSync(SIMULATOR_PATH, 'utf8').replace(/^export /gm, '');
  const exported = ['simulateMatch', 'simulateBatch', 'simulateMatchStepwise'];
  const cjsSource = `${source}\nmodule.exports = { ${exported.join(', ')} };\n`;
  const tmpFile = path.join(os.tmpdir(), `simulator-cjs-${Date.now()}.cjs`);
  fs.writeFileSync(tmpFile, cjsSource);
  const mod = require(tmpFile);
  fs.unlinkSync(tmpFile);
  return mod;
}

function loadMatches(ourId) {
  const file = path.join(RAW_DIR, `${ourId}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findTestCases(idMap) {
  const apiToOur = new Map(Object.entries(idMap).map(([ourId, apiId]) => [String(apiId), ourId]));
  const seen = new Set();
  const testCases = [];

  for (const ourId of Object.keys(idMap)) {
    for (const m of loadMatches(ourId)) {
      if (!m.id || seen.has(m.id) || !m.date || !m.stats || m.match_winner == null) continue;
      const p1OurId = apiToOur.get(String(m.player1Id));
      const p2OurId = apiToOur.get(String(m.player2Id));
      if (!p1OurId || !p2OurId) continue; // need both sides in our roster to backtest this match
      seen.add(m.id);
      testCases.push({ match: m, p1OurId, p2OurId });
    }
  }
  return testCases;
}

// Point-in-time probabilities for a player: aggregate all their OTHER
// matches (excluding the one being predicted) with decay weight relative to
// asOfDate, so nothing from the test match itself leaks into the estimate.
function probabilitiesAsOf(ourId, excludeMatchId, asOfDate, halfLifeDays, idMap, tourAverages) {
  const apiId = idMap[ourId];
  const agg = emptyAgg();
  for (const m of loadMatches(ourId)) {
    if (m.id === excludeMatchId) continue;
    accumulateMatch(agg, null, m, apiId, asOfDate, halfLifeDays);
  }
  return deriveProbabilities(agg, tourAverages);
}

function computeGlobalTourAverages(idMap, asOfDate, halfLifeDays) {
  const tourTotals = emptyAgg();
  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      accumulateMatch(emptyAgg(), tourTotals, m, apiId, asOfDate, halfLifeDays);
    }
  }
  return deriveTourAverages(tourTotals);
}

async function scoreHalfLife(halfLifeDays, testCases, idMap, simulateBatch) {
  // Tour averages only affect p3/p4 fallback + the p5 baseline (a roughly
  // constant offset shared by both sides of a matchup), so using one global
  // snapshot rather than a fresh point-in-time one per test case is a
  // reasonable simplification — it doesn't need to be exact to compare
  // half-life options against each other.
  const tourAverages = computeGlobalTourAverages(idMap, new Date(), halfLifeDays);

  let n = 0;
  let brierSum = 0;
  let logLossSum = 0;
  let correct = 0;

  for (const { match, p1OurId, p2OurId } of testCases) {
    const asOfDate = new Date(match.date);
    const probA = probabilitiesAsOf(p1OurId, match.id, asOfDate, halfLifeDays, idMap, tourAverages);
    const probB = probabilitiesAsOf(p2OurId, match.id, asOfDate, halfLifeDays, idMap, tourAverages);
    if (!probA || !probB) continue; // not enough prior history at this point in time

    const { matchWins } = simulateBatch(probA, probB, SIMS_PER_MATCH);
    const predictedP1Win = matchWins[0] / SIMS_PER_MATCH;
    const actualP1Won = String(match.match_winner) === String(idMap[p1OurId]) ? 1 : 0;

    n++;
    brierSum += (predictedP1Win - actualP1Won) ** 2;
    const p = Math.min(0.99, Math.max(0.01, predictedP1Win));
    logLossSum += -(actualP1Won * Math.log(p) + (1 - actualP1Won) * Math.log(1 - p));
    if ((predictedP1Win >= 0.5 ? 1 : 0) === actualP1Won) correct++;
  }

  return {
    halfLifeDays,
    n,
    brier: n ? brierSum / n : null,
    logLoss: n ? logLossSum / n : null,
    accuracy: n ? correct / n : null,
  };
}

async function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error('Missing data-pipeline/raw/player-id-map.json — run fetch.js first.');
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  const { simulateBatch } = loadSimulatorAsCjs();

  const testCases = findTestCases(idMap);
  console.log(`Found ${testCases.length} historical intra-roster matches to backtest against.\n`);
  if (testCases.length === 0) {
    console.log('No matches between two roster players found — nothing to backtest.');
    return;
  }

  const halfLives = process.argv[2]
    ? process.argv[2].split(',').map(Number)
    : DEFAULT_HALF_LIVES;

  const results = [];
  for (const hl of halfLives) {
    results.push(await scoreHalfLife(hl, testCases, idMap, simulateBatch));
  }

  console.log('half-life(d) | n cases | accuracy | brier (lower=better) | log loss (lower=better)');
  console.log('-------------|---------|----------|------------------------|------------------------');
  for (const r of results) {
    console.log(
      `${String(r.halfLifeDays).padEnd(12)} | ${String(r.n).padEnd(7)} | ${r.accuracy != null ? r.accuracy.toFixed(3) : 'n/a'.padEnd(8)} | ${r.brier != null ? r.brier.toFixed(4).padEnd(22) : 'n/a'} | ${r.logLoss != null ? r.logLoss.toFixed(4) : 'n/a'}`
    );
  }

  const best = results.filter((r) => r.brier != null).sort((a, b) => a.brier - b.brier)[0];
  if (best) {
    console.log(`\nLowest Brier score: half-life=${best.halfLifeDays}d (brier=${best.brier.toFixed(4)}, accuracy=${(best.accuracy * 100).toFixed(1)}%).`);
    console.log(`To use it: npm run compute-stats -- ${best.halfLifeDays}  (then npm run build-stats-csv)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
