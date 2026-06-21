/**
 * RESEARCH PROTOTYPE — not wired into the production pipeline or the app.
 *
 * Tests whether splitting "serve won" into (a) unreturnable ace vs (b) an
 * actual rally win improves predictive accuracy, using the `aces` field
 * that's fully populated in every cached match but currently unused by
 * computeStats.js / simulator.js.
 *
 * Current production model (src/simulator.js + data-pipeline/lib/probabilities.js):
 *   p5 = "server's rally win rate", calibrated as a tour-average-relative
 *   residual. It implicitly bakes ace rate into that one number, so a
 *   90-ace match and a 0-ace, all-rallies match with the same point-win
 *   rate look identical to the model.
 *
 * Prototype model (this file):
 *   Same p1-p4. Adds p6 = P(ace | 1st serve in). p5 is recomputed net of
 *   aces (using firstWon-minus-aces instead of firstWon), so it represents
 *   pure rally skill, with aces handled as a separate, opponent-independent
 *   gate in the point simulator — because an ace, by definition, doesn't
 *   involve the returner's skill at all, while the old model's p5 quietly
 *   assumed every "win on serve" point was contestable.
 *
 * Both models are run through the SAME point-in-time backtest harness used
 * for the half-life calibration, head to head, to see if the added realism
 * actually pays off in prediction accuracy or is just a more complicated
 * way to describe the same thing.
 *
 * Usage: node data-pipeline/prototypeAceModel.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages, clamp01 } = require('./lib/probabilities');

const RAW_DIR = path.join(__dirname, 'raw');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SIMULATOR_PATH = path.join(__dirname, '..', 'src', 'simulator.js');
const SIMS_PER_MATCH = 300;
const HALF_LIFE_DAYS = 60;
const P5_BASELINE = 0.38;

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

// ---- Model A: production (unmodified) ----
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

// ---- Model B: ace-split prototype ----
function decayWeight(matchDate, asOfDate) {
  const daysAgo = (asOfDate - matchDate) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 0;
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

function emptyAceAgg() {
  return { ...emptyAgg(), aces: 0 };
}

function addServerStatsWithAces(agg, w, side) {
  const svpt = Number(side.firstServeOf) || 0;
  const firstIn = Number(side.firstServe) || 0;
  const df = Number(side.doubleFaults) || 0;
  const firstWon = Number(side.winningOnFirstServe) || 0;
  const secondTotal = Number(side.winningOnSecondServeOf) || 0;
  const secondWon = Number(side.winningOnSecondServe) || 0;
  const aces = Number(side.aces) || 0;
  const secondAttempts = Math.max(secondTotal - df, 0);
  agg.svpt += w * svpt;
  agg.firstIn += w * firstIn;
  agg.df += w * df;
  agg.firstWon += w * firstWon;
  agg.secondAttempts += w * secondAttempts;
  agg.secondWon += w * secondWon;
  agg.aces += w * aces; // attributed entirely to 1st serve — a simplifying assumption for this prototype
}

function addReturnerStatsForAceModel(agg, w, opponentSide) {
  const oppFirstIn = Number(opponentSide.firstServe) || 0;
  const oppFirstWon = Number(opponentSide.winningOnFirstServe) || 0;
  const oppSecondTotal = Number(opponentSide.winningOnSecondServeOf) || 0;
  const oppDf = Number(opponentSide.doubleFaults) || 0;
  const oppSecondWon = Number(opponentSide.winningOnSecondServe) || 0;
  const oppSecondAttempts = Math.max(oppSecondTotal - oppDf, 0);
  agg.oppFirstIn += w * oppFirstIn;
  agg.oppFirstWon += w * oppFirstWon;
  agg.oppSecondAttempts += w * oppSecondAttempts;
  agg.oppSecondWon += w * oppSecondWon;
}

function accumulateMatchAceModel(agg, tourTotals, match, apiId, asOfDate) {
  if (!match.date || !match.stats) return;
  const isPlayer1 = String(match.player1Id) === String(apiId);
  const mySide = isPlayer1 ? match.stats.player1 : match.stats.player2;
  const oppSide = isPlayer1 ? match.stats.player2 : match.stats.player1;
  if (!mySide || !oppSide) return;
  const w = decayWeight(new Date(match.date), asOfDate);
  if (!w || w < 1e-6) return;
  addServerStatsWithAces(agg, w, mySide);
  addReturnerStatsForAceModel(agg, w, oppSide);
  if (tourTotals) {
    addServerStatsWithAces(tourTotals, w, mySide);
    addServerStatsWithAces(tourTotals, w, oppSide);
  }
}

// p1-p4 identical to production. p6 = ace rate given 1st serve in. p5 is
// recomputed net of aces, then centered against the tour average the same
// way production does (relative-to-baseline), but using the ace-adjusted
// win rate so it represents pure rally skill, not rally+ace combined.
function deriveProbabilitiesAceModel(agg, tourAverages) {
  if (agg.svpt < 200) return null;
  const { r3Avg, r4Avg, tourServerWin1stNonAce, tourServerWin2nd } = tourAverages;

  const p1 = agg.firstIn / agg.svpt;
  const p2 = agg.secondAttempts / (agg.svpt - agg.firstIn);
  const p3 = agg.oppFirstIn > 0 ? 1 - agg.oppFirstWon / agg.oppFirstIn : r3Avg;
  const p4 = agg.oppSecondAttempts > 0 ? 1 - agg.oppSecondWon / agg.oppSecondAttempts : r4Avg;
  const p6 = agg.firstIn > 0 ? clamp01(agg.aces / agg.firstIn) : 0;

  const nonAceFirstWon = Math.max(agg.firstWon - agg.aces, 0);
  const nonAceFirstIn = Math.max(agg.firstIn - agg.aces, 1e-9);
  const serverWin1stNonAce = nonAceFirstWon / nonAceFirstIn;
  const serverWin2nd = agg.secondWon / agg.secondAttempts;

  const delta1 = serverWin1stNonAce - tourServerWin1stNonAce;
  const delta2 = serverWin2nd - tourServerWin2nd;
  const p5 = Math.min(0.65, Math.max(0.05, P5_BASELINE + (delta1 + delta2) / 2));

  return [clamp01(p1), clamp01(p2), clamp01(p3), clamp01(p4), p5, p6];
}

function deriveTourAveragesAceModel(tourTotals) {
  const nonAceFirstWon = Math.max(tourTotals.firstWon - tourTotals.aces, 0);
  const nonAceFirstIn = Math.max(tourTotals.firstIn - tourTotals.aces, 1e-9);
  return {
    r3Avg: 1 - tourTotals.firstWon / tourTotals.firstIn,
    r4Avg: 1 - tourTotals.secondWon / tourTotals.secondAttempts,
    tourServerWin1stNonAce: nonAceFirstWon / nonAceFirstIn,
    tourServerWin2nd: tourTotals.secondWon / tourTotals.secondAttempts,
  };
}

function probabilitiesAsOf_aceModel(ourId, excludeMatchId, asOfDate, idMap, tourAverages) {
  const apiId = idMap[ourId];
  const agg = emptyAceAgg();
  for (const m of loadMatches(ourId)) {
    if (m.id === excludeMatchId) continue;
    accumulateMatchAceModel(agg, null, m, apiId, asOfDate);
  }
  return deriveProbabilitiesAceModel(agg, tourAverages);
}

function computeGlobalTourAverages_aceModel(idMap, asOfDate) {
  const tourTotals = emptyAceAgg();
  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      accumulateMatchAceModel(emptyAceAgg(), tourTotals, m, apiId, asOfDate);
    }
  }
  return deriveTourAveragesAceModel(tourTotals);
}

// Point/match simulator for the ace-split model (mirrors src/simulator.js's
// best-of-5 structure exactly, just with the extra ace gate on the serve).
function simulatePointAceModel(srv, rtn) {
  if (Math.random() < srv[0]) {
    if (Math.random() < srv[5]) return 0; // unreturnable ace
    if (Math.random() < rtn[2]) return Math.random() < srv[4] ? 0 : 1;
    return 0;
  }
  if (Math.random() < srv[1]) {
    if (Math.random() < rtn[3]) return Math.random() < srv[4] ? 0 : 1;
    return 0;
  }
  return 1;
}

function simulateGameAceModel(srvProb, rtnProb) {
  let points = [0, 0];
  while (true) {
    const winner = simulatePointAceModel(srvProb, rtnProb);
    points[winner]++;
    if ((points[0] >= 4 || points[1] >= 4) && Math.abs(points[0] - points[1]) >= 2) {
      return points[0] > points[1] ? 0 : 1;
    }
  }
}

function simulateTiebreakAceModel(probA, probB, initialServer) {
  let scoreA = 0, scoreB = 0, point = 0;
  while (true) {
    let server;
    if (point === 0) server = initialServer;
    else {
      const cycle = Math.floor((point - 1) / 2) % 2;
      server = cycle === 0 ? 1 - initialServer : initialServer;
    }
    let p;
    if (server === 0) { p = simulatePointAceModel(probA, probB); if (p === 0) scoreA++; else scoreB++; }
    else { p = simulatePointAceModel(probB, probA); if (p === 0) scoreB++; else scoreA++; }
    point++;
    if ((scoreA >= 7 || scoreB >= 7) && Math.abs(scoreA - scoreB) >= 2) return scoreA > scoreB ? 0 : 1;
  }
}

function simulateSetAceModel(probA, probB) {
  let gamesA = 0, gamesB = 0;
  let server = Math.random() < 0.5 ? 0 : 1;
  while (true) {
    const winner = simulateGameAceModel(server === 0 ? probA : probB, server === 0 ? probB : probA);
    if (winner === 0) { if (server === 0) gamesA++; else gamesB++; }
    else { if (server === 0) gamesB++; else gamesA++; }
    server = 1 - server;
    if ((gamesA >= 6 || gamesB >= 6) && Math.abs(gamesA - gamesB) >= 2) break;
    if (gamesA === 6 && gamesB === 6) {
      const tb = simulateTiebreakAceModel(probA, probB, server);
      if (tb === 0) gamesA++; else gamesB++;
      break;
    }
  }
  return [gamesA, gamesB];
}

function simulateMatchAceModel(probA, probB) {
  const maxSets = 5, targetSets = 3;
  const setsWon = [0, 0];
  for (let i = 0; i < maxSets && Math.max(...setsWon) < targetSets; i++) {
    const [ga, gb] = simulateSetAceModel(probA, probB);
    if (ga > gb) setsWon[0]++; else setsWon[1]++;
  }
  return setsWon[0] > setsWon[1] ? 'A' : 'B';
}

function simulateBatchAceModel(probA, probB, n) {
  let aWins = 0;
  for (let i = 0; i < n; i++) {
    if (simulateMatchAceModel(probA, probB) === 'A') aWins++;
  }
  return aWins / n;
}

async function main() {
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  const { simulateMatch } = loadSimulatorAsCjs();
  const testCases = findTestCases(idMap);
  console.log(`Backtesting ${testCases.length} historical intra-roster matches against both models...\n`);

  const tourAvgProd = computeGlobalTourAverages_production(idMap, new Date());
  const tourAvgAce = computeGlobalTourAverages_aceModel(idMap, new Date());

  const scoreA = { n: 0, brierSum: 0, logLossSum: 0, correct: 0 };
  const scoreB = { n: 0, brierSum: 0, logLossSum: 0, correct: 0 };

  for (const { match, p1OurId, p2OurId } of testCases) {
    const asOfDate = new Date(match.date);
    const actualP1Won = String(match.match_winner) === String(idMap[p1OurId]) ? 1 : 0;

    // Model A: production, run via the real simulateMatch + manual batching
    const probA1 = probabilitiesAsOf_production(p1OurId, match.id, asOfDate, idMap, tourAvgProd);
    const probA2 = probabilitiesAsOf_production(p2OurId, match.id, asOfDate, idMap, tourAvgProd);
    if (probA1 && probA2) {
      let p1Wins = 0;
      for (let i = 0; i < SIMS_PER_MATCH; i++) {
        if (simulateMatch(probA1, probA2).winner === 'A') p1Wins++;
      }
      const predicted = p1Wins / SIMS_PER_MATCH;
      scoreA.n++;
      scoreA.brierSum += (predicted - actualP1Won) ** 2;
      const p = Math.min(0.99, Math.max(0.01, predicted));
      scoreA.logLossSum += -(actualP1Won * Math.log(p) + (1 - actualP1Won) * Math.log(1 - p));
      if ((predicted >= 0.5 ? 1 : 0) === actualP1Won) scoreA.correct++;
    }

    // Model B: ace-split prototype
    const probB1 = probabilitiesAsOf_aceModel(p1OurId, match.id, asOfDate, idMap, tourAvgAce);
    const probB2 = probabilitiesAsOf_aceModel(p2OurId, match.id, asOfDate, idMap, tourAvgAce);
    if (probB1 && probB2) {
      const predicted = simulateBatchAceModel(probB1, probB2, SIMS_PER_MATCH);
      scoreB.n++;
      scoreB.brierSum += (predicted - actualP1Won) ** 2;
      const p = Math.min(0.99, Math.max(0.01, predicted));
      scoreB.logLossSum += -(actualP1Won * Math.log(p) + (1 - actualP1Won) * Math.log(1 - p));
      if ((predicted >= 0.5 ? 1 : 0) === actualP1Won) scoreB.correct++;
    }
  }

  const report = (label, s) => {
    if (!s.n) { console.log(`${label}: no usable test cases`); return; }
    console.log(`${label}: n=${s.n}  accuracy=${(s.correct / s.n * 100).toFixed(1)}%  brier=${(s.brierSum / s.n).toFixed(4)}  logLoss=${(s.logLossSum / s.n).toFixed(4)}`);
  };
  report('Model A (production, no ace split)', scoreA);
  report('Model B (prototype, with ace split)', scoreB);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
