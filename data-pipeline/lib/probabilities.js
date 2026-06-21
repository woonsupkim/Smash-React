/**
 * Shared logic for turning raw per-match serve/return box scores into
 * simulator.js-compatible p1-p5 probabilities, with exponential time-decay
 * weighting. Used by both computeStats.js (live refresh) and backtest.js
 * (point-in-time calibration).
 */
const P5_BASELINE = 0.38;

function decayWeight(matchDate, asOfDate, halfLifeDays) {
  const daysAgo = (asOfDate - matchDate) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 0; // matches after the cutoff never count
  return Math.pow(0.5, daysAgo / halfLifeDays);
}

function emptyAgg() {
  return {
    svpt: 0, firstIn: 0, df: 0, firstWon: 0, secondAttempts: 0, secondWon: 0,
    oppFirstIn: 0, oppFirstWon: 0, oppSecondAttempts: 0, oppSecondWon: 0,
  };
}

function addServerStats(agg, w, side) {
  const svpt = Number(side.firstServeOf) || 0;
  const firstIn = Number(side.firstServe) || 0;
  const df = Number(side.doubleFaults) || 0;
  const firstWon = Number(side.winningOnFirstServe) || 0;
  const secondTotal = Number(side.winningOnSecondServeOf) || 0; // includes DFs
  const secondWon = Number(side.winningOnSecondServe) || 0;
  const secondAttempts = Math.max(secondTotal - df, 0); // 2nd serves actually put in play
  agg.svpt += w * svpt;
  agg.firstIn += w * firstIn;
  agg.df += w * df;
  agg.firstWon += w * firstWon;
  agg.secondAttempts += w * secondAttempts;
  agg.secondWon += w * secondWon;
}

function addReturnerStats(agg, w, opponentSide) {
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

// Accumulates one match's contribution into a player's own agg and (if
// provided) into a tour-wide totals agg, given the apiId identifying which
// side of the match record ("player1"/"player2") is this player.
function accumulateMatch(agg, tourTotals, match, apiId, asOfDate, halfLifeDays) {
  if (!match.date || !match.stats) return;
  const isPlayer1 = String(match.player1Id) === String(apiId);
  const mySide = isPlayer1 ? match.stats.player1 : match.stats.player2;
  const oppSide = isPlayer1 ? match.stats.player2 : match.stats.player1;
  if (!mySide || !oppSide) return;

  const w = decayWeight(new Date(match.date), asOfDate, halfLifeDays);
  if (!w || w < 1e-6) return;

  addServerStats(agg, w, mySide);
  addReturnerStats(agg, w, oppSide);
  if (tourTotals) {
    addServerStats(tourTotals, w, mySide);
    addServerStats(tourTotals, w, oppSide);
  }
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

// Derives p1-p5 from one player's aggregated sums plus tour-average rates
// (used as a fallback when data is thin, and as the centering baseline for
// p5 — see computeStats.js header comment for why p5 needs a baseline).
function deriveProbabilities(agg, tourAverages) {
  const { r3Avg, r4Avg, tourServerWin1st, tourServerWin2nd } = tourAverages;
  if (agg.svpt < 200) return null; // not enough data to trust

  const p1 = agg.firstIn / agg.svpt;
  const p2 = agg.secondAttempts / (agg.svpt - agg.firstIn);
  const p3 = agg.oppFirstIn > 0 ? 1 - agg.oppFirstWon / agg.oppFirstIn : r3Avg;
  const p4 = agg.oppSecondAttempts > 0 ? 1 - agg.oppSecondWon / agg.oppSecondAttempts : r4Avg;

  const serverWin1st = agg.firstWon / agg.firstIn;
  const serverWin2nd = agg.secondWon / agg.secondAttempts;
  const delta1 = serverWin1st - tourServerWin1st;
  const delta2 = serverWin2nd - tourServerWin2nd;
  const p5 = Math.min(0.65, Math.max(0.05, P5_BASELINE + (delta1 + delta2) / 2));

  return [clamp01(p1), clamp01(p2), clamp01(p3), clamp01(p4), p5];
}

function deriveTourAverages(tourTotals) {
  return {
    r3Avg: 1 - tourTotals.firstWon / tourTotals.firstIn,
    r4Avg: 1 - tourTotals.secondWon / tourTotals.secondAttempts,
    tourServerWin1st: tourTotals.firstWon / tourTotals.firstIn,
    tourServerWin2nd: tourTotals.secondWon / tourTotals.secondAttempts,
  };
}

module.exports = {
  emptyAgg,
  accumulateMatch,
  deriveProbabilities,
  deriveTourAverages,
  clamp01,
};
