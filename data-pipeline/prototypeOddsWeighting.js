/**
 * RESEARCH PROTOTYPE - not wired into the production pipeline or the app.
 *
 * Tests whether weighting a player's match history by opponent quality
 * (via pre-match betting odds, ~50% coverage in cached data, currently
 * unused) improves predictive accuracy versus the current recency-only
 * decay weighting.
 *
 * Current production model: every match contributes to a player's decayed
 * p1-p5 aggregate weighted only by how recent it was - beating a journeyman
 * and beating a top-10 player count identically.
 *
 * Prototype: multiply the recency weight by an opponent-strength factor
 * derived from the opponent's normalized implied win probability from
 * odd1/odd2 at match time (a neutral 50/50 opponent gets weight 1.0; a
 * strong favorite-over-you opponent gets upweighted; a heavy underdog
 * opponent gets downweighted). Matches with no odds (the other ~50%)
 * default to a neutral 1.0 multiplier, so coverage gaps degrade gracefully
 * to current behavior rather than introducing bias.
 *
 * Point-simulation model is untouched (same simulateMatch from
 * src/simulator.js) - this isolates exactly one variable: the aggregation
 * weighting scheme, for a clean comparison against production.
 *
 * Usage: node data-pipeline/prototypeOddsWeighting.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

// lib/probabilities.js doesn't export its internal addServerStats helper,
// so it's reproduced here (same field mapping) for the weighted aggregator below.
function addServerStats(agg, w, side) {
  const svpt = Number(side.firstServeOf) || 0;
  const firstIn = Number(side.firstServe) || 0;
  const df = Number(side.doubleFaults) || 0;
  const firstWon = Number(side.winningOnFirstServe) || 0;
  const secondTotal = Number(side.winningOnSecondServeOf) || 0;
  const secondWon = Number(side.winningOnSecondServe) || 0;
  const secondAttempts = Math.max(secondTotal - df, 0);
  agg.svpt += w * svpt;
  agg.firstIn += w * firstIn;
  agg.df += w * df;
  agg.firstWon += w * firstWon;
  agg.secondAttempts += w * secondAttempts;
  agg.secondWon += w * secondWon;
}

const RAW_DIR = path.join(__dirname, 'raw');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SIMULATOR_PATH = path.join(__dirname, '..', 'src', 'simulator.js');
const SIMS_PER_MATCH = 300;
const HALF_LIFE_DAYS = 60;

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

function decayWeight(matchDate, asOfDate) {
  const daysAgo = (asOfDate - matchDate) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 0;
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

// Opponent's normalized (vig-removed) implied win probability from
// pre-match decimal odds, from the perspective of the player identified by
// apiId. Returns null when odds aren't available for this match.
function opponentImpliedWinProb(match, apiId) {
  if (match.odd1 == null || match.odd2 == null) return null;
  const o1 = Number(match.odd1), o2 = Number(match.odd2);
  if (!o1 || !o2) return null;
  const isPlayer1 = String(match.player1Id) === String(apiId);
  const myImplied = 1 / (isPlayer1 ? o1 : o2);
  const oppImplied = 1 / (isPlayer1 ? o2 : o1);
  return oppImplied / (myImplied + oppImplied); // normalized to remove bookmaker overround
}

function opponentStrengthMultiplier(match, apiId) {
  const oppWinProb = opponentImpliedWinProb(match, apiId);
  if (oppWinProb == null) return 1.0; // no odds available - neutral, degrades to production behavior
  return Math.min(1.6, Math.max(0.6, 0.5 + oppWinProb));
}

// ---- Model A: production (decay-only weighting) ----
function probabilitiesAsOf_production(ourId, excludeMatchId, asOfDate, idMap, tourAverages) {
  const apiId = idMap[ourId];
  const agg = emptyAgg();
  for (const m of loadMatches(ourId)) {
    if (m.id === excludeMatchId) continue;
    accumulateMatch(agg, null, m, apiId, asOfDate, HALF_LIFE_DAYS);
  }
  return deriveProbabilities(agg, tourAverages);
}

function computeGlobalTourAverages_production(idMap, asOfDate) {
  const tourTotals = emptyAgg();
  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      accumulateMatch(emptyAgg(), tourTotals, m, apiId, asOfDate, HALF_LIFE_DAYS);
    }
  }
  return deriveTourAverages(tourTotals);
}

// ---- Model C: opponent-quality-weighted aggregation ----
// Reuses the exact same addServerStats/addReturnerStats/deriveProbabilities
// from lib/probabilities.js - only the weight fed into them differs.
function accumulateMatchWeighted(agg, tourTotals, match, apiId, asOfDate) {
  if (!match.date || !match.stats) return;
  const isPlayer1 = String(match.player1Id) === String(apiId);
  const mySide = isPlayer1 ? match.stats.player1 : match.stats.player2;
  const oppSide = isPlayer1 ? match.stats.player2 : match.stats.player1;
  if (!mySide || !oppSide) return;

  const baseWeight = decayWeight(new Date(match.date), asOfDate);
  if (!baseWeight || baseWeight < 1e-6) return;
  const w = baseWeight * opponentStrengthMultiplier(match, apiId);

  addServerStats(agg, w, mySide);
  // addReturnerStats isn't exported, so inline its logic to reuse the same field mapping
  const oppFirstIn = Number(oppSide.firstServe) || 0;
  const oppFirstWon = Number(oppSide.winningOnFirstServe) || 0;
  const oppSecondTotal = Number(oppSide.winningOnSecondServeOf) || 0;
  const oppDf = Number(oppSide.doubleFaults) || 0;
  const oppSecondWon = Number(oppSide.winningOnSecondServe) || 0;
  const oppSecondAttempts = Math.max(oppSecondTotal - oppDf, 0);
  agg.oppFirstIn += w * oppFirstIn;
  agg.oppFirstWon += w * oppFirstWon;
  agg.oppSecondAttempts += w * oppSecondAttempts;
  agg.oppSecondWon += w * oppSecondWon;

  if (tourTotals) {
    addServerStats(tourTotals, w, mySide);
    addServerStats(tourTotals, w, oppSide);
  }
}

function probabilitiesAsOf_weighted(ourId, excludeMatchId, asOfDate, idMap, tourAverages) {
  const apiId = idMap[ourId];
  const agg = emptyAgg();
  for (const m of loadMatches(ourId)) {
    if (m.id === excludeMatchId) continue;
    accumulateMatchWeighted(agg, null, m, apiId, asOfDate);
  }
  return deriveProbabilities(agg, tourAverages);
}

function computeGlobalTourAverages_weighted(idMap, asOfDate) {
  const tourTotals = emptyAgg();
  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      accumulateMatchWeighted(emptyAgg(), tourTotals, m, apiId, asOfDate);
    }
  }
  return deriveTourAverages(tourTotals);
}

async function main() {
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  const { simulateMatch } = loadSimulatorAsCjs();
  const testCases = findTestCases(idMap);
  console.log(`Backtesting ${testCases.length} historical intra-roster matches against both weighting schemes...\n`);

  const tourAvgProd = computeGlobalTourAverages_production(idMap, new Date());
  const tourAvgWeighted = computeGlobalTourAverages_weighted(idMap, new Date());

  const scoreA = { n: 0, brierSum: 0, logLossSum: 0, correct: 0 };
  const scoreC = { n: 0, brierSum: 0, logLossSum: 0, correct: 0 };

  const runModel = (probFn, tourAvg, score, p1OurId, p2OurId, match, idMap) => {
    const asOfDate = new Date(match.date);
    const prob1 = probFn(p1OurId, match.id, asOfDate, idMap, tourAvg);
    const prob2 = probFn(p2OurId, match.id, asOfDate, idMap, tourAvg);
    if (!prob1 || !prob2) return;
    const actualP1Won = String(match.match_winner) === String(idMap[p1OurId]) ? 1 : 0;
    let p1Wins = 0;
    for (let i = 0; i < SIMS_PER_MATCH; i++) {
      if (simulateMatch(prob1, prob2).winner === 'A') p1Wins++;
    }
    const predicted = p1Wins / SIMS_PER_MATCH;
    score.n++;
    score.brierSum += (predicted - actualP1Won) ** 2;
    const p = Math.min(0.99, Math.max(0.01, predicted));
    score.logLossSum += -(actualP1Won * Math.log(p) + (1 - actualP1Won) * Math.log(1 - p));
    if ((predicted >= 0.5 ? 1 : 0) === actualP1Won) score.correct++;
  };

  for (const { match, p1OurId, p2OurId } of testCases) {
    runModel(probabilitiesAsOf_production, tourAvgProd, scoreA, p1OurId, p2OurId, match, idMap);
    runModel(probabilitiesAsOf_weighted, tourAvgWeighted, scoreC, p1OurId, p2OurId, match, idMap);
  }

  const report = (label, s) => {
    if (!s.n) { console.log(`${label}: no usable test cases`); return; }
    console.log(`${label}: n=${s.n}  accuracy=${(s.correct / s.n * 100).toFixed(1)}%  brier=${(s.brierSum / s.n).toFixed(4)}  logLoss=${(s.logLossSum / s.n).toFixed(4)}`);
  };
  report('Model A (production, decay-only weight)', scoreA);
  report('Model C (prototype, + opponent-quality weight)', scoreC);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
