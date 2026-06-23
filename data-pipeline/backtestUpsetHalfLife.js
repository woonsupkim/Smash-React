/**
 * Finds the best half-life for "upset scenario" mode specifically, rather
 * than overall accuracy (that's what backtest.js already does for the
 * default model). Method:
 *   1. Label each historical match as an "upset" if a long-half-life
 *      (365d, "season form") baseline gave the eventual LOSER a clear
 *      favorite probability (>=65%) at the time.
 *   2. For each short candidate half-life, score ONLY on those upset
 *      matches — does that recency window assign more probability to the
 *      eventual (upset) winner than the season-form baseline did? Lower
 *      Brier / higher avg-probability-on-actual-winner = better at
 *      "seeing the upset coming" via recent form.
 *
 * No API calls — uses cached match data already in data-pipeline/raw/.
 * Usage: node data-pipeline/backtestUpsetHalfLife.js [tour]
 *   tour: atp (default) | wta — reads from data-pipeline/raw/women/ instead.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

const TOUR_ARG = process.argv[2] || 'atp';
const RAW_DIR = path.join(__dirname, 'raw', TOUR_ARG === 'wta' ? 'women' : '');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SIMULATOR_PATH = path.join(__dirname, '..', 'src', 'simulator.js');
const SIMS_PER_MATCH = 300;
const BASELINE_HALF_LIFE = 365;
const UPSET_THRESHOLD = 0.65; // baseline gave the loser at least this much win probability
const CANDIDATE_HALF_LIVES = [3, 5, 7, 10, 14, 21, 30, 45, 60, 90];
const MIN_SVPT_SHORT = 60; // matches the lowered threshold used for the shipped "upset" CSVs

function loadSimulatorAsCjs() {
  const source = fs.readFileSync(SIMULATOR_PATH, 'utf8').replace(/^export /gm, '');
  const cjsSource = `${source}\nmodule.exports = { simulateMatch };\n`;
  const tmpFile = path.join(os.tmpdir(), `simulator-cjs-${Date.now()}-${Math.random()}.cjs`);
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
      if (!p1OurId || !p2OurId) continue;
      seen.add(m.id);
      testCases.push({ match: m, p1OurId, p2OurId });
    }
  }
  return testCases;
}

function probabilitiesAsOf(ourId, excludeMatchId, asOfDate, halfLifeDays, idMap, tourAverages, minSvpt) {
  const apiId = idMap[ourId];
  const agg = emptyAgg();
  for (const m of loadMatches(ourId)) {
    if (m.id === excludeMatchId) continue;
    accumulateMatch(agg, null, m, apiId, asOfDate, halfLifeDays);
  }
  return deriveProbabilities(agg, tourAverages, minSvpt);
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

async function predictP1WinProb(simulateMatch, p1OurId, p2OurId, match, halfLifeDays, idMap, tourAvg, minSvpt) {
  const asOfDate = new Date(match.date);
  const prob1 = probabilitiesAsOf(p1OurId, match.id, asOfDate, halfLifeDays, idMap, tourAvg, minSvpt);
  const prob2 = probabilitiesAsOf(p2OurId, match.id, asOfDate, halfLifeDays, idMap, tourAvg, minSvpt);
  if (!prob1 || !prob2) return null;
  let p1Wins = 0;
  for (let i = 0; i < SIMS_PER_MATCH; i++) {
    if (simulateMatch(prob1, prob2).winner === 'A') p1Wins++;
  }
  return p1Wins / SIMS_PER_MATCH;
}

async function main() {
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  const { simulateMatch } = loadSimulatorAsCjs();
  const testCases = findTestCases(idMap);
  console.log(`Found ${testCases.length} historical intra-roster matches.\n`);

  // Step 1: label upsets using the 365-day "season form" baseline.
  const baselineTourAvg = computeGlobalTourAverages(idMap, new Date(), BASELINE_HALF_LIFE);
  const upsetCases = [];
  for (const tc of testCases) {
    const predicted = await predictP1WinProb(simulateMatch, tc.p1OurId, tc.p2OurId, tc.match, BASELINE_HALF_LIFE, idMap, baselineTourAvg, 200);
    if (predicted == null) continue;
    const actualP1Won = String(tc.match.match_winner) === String(idMap[tc.p1OurId]) ? 1 : 0;
    const isUpset = (predicted >= UPSET_THRESHOLD && actualP1Won === 0) || (predicted <= 1 - UPSET_THRESHOLD && actualP1Won === 1);
    if (isUpset) upsetCases.push({ ...tc, baselinePredicted: predicted, actualP1Won });
  }
  console.log(`${upsetCases.length} of those were upsets per the 365-day baseline (favorite given >=${UPSET_THRESHOLD * 100}% lost).\n`);

  if (upsetCases.length === 0) {
    console.log('No upset cases found — nothing to score against.');
    return;
  }

  // Step 2: score each candidate short half-life ONLY on the upset subset.
  console.log('half-life(d) | n upsets scored | brier (lower=better) | avg prob on actual winner (higher=better)');
  console.log('-------------|-----------------|------------------------|---------------------------------------');
  const results = [];
  for (const H of CANDIDATE_HALF_LIVES) {
    const tourAvg = computeGlobalTourAverages(idMap, new Date(), H);
    let n = 0, brierSum = 0, winnerProbSum = 0;
    for (const uc of upsetCases) {
      const predicted = await predictP1WinProb(simulateMatch, uc.p1OurId, uc.p2OurId, uc.match, H, idMap, tourAvg, MIN_SVPT_SHORT);
      if (predicted == null) continue;
      n++;
      brierSum += (predicted - uc.actualP1Won) ** 2;
      winnerProbSum += uc.actualP1Won === 1 ? predicted : 1 - predicted;
    }
    const brier = n ? brierSum / n : null;
    const avgWinnerProb = n ? winnerProbSum / n : null;
    results.push({ H, n, brier, avgWinnerProb });
    console.log(`${String(H).padEnd(12)} | ${String(n).padEnd(15)} | ${brier != null ? brier.toFixed(4).padEnd(22) : 'n/a'} | ${avgWinnerProb != null ? avgWinnerProb.toFixed(4) : 'n/a'}`);
  }

  const best = results.filter(r => r.brier != null).sort((a, b) => a.brier - b.brier)[0];
  if (best) {
    console.log(`\nBest half-life for upset scenarios: ${best.H}d (brier=${best.brier.toFixed(4)}, avg winner prob=${best.avgWinnerProb.toFixed(4)} vs baseline 365d which by definition assigned <=${(1 - UPSET_THRESHOLD).toFixed(2)} or >=${UPSET_THRESHOLD.toFixed(2)} to the wrong side).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
