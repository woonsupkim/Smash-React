/**
 * Shared logic for turning raw per-match serve/return box scores into
 * simulator.js-compatible p1-p6 probabilities, with exponential time-decay
 * weighting. Used by both computeStats.js (live refresh) and backtest.js
 * (point-in-time calibration).
 *
 * p6 (ace rate given 1st serve in) was added after a backtested prototype
 * (data-pipeline/prototypeAceModel.js) showed splitting it out of p5
 * improves calibration (lower Brier score / log loss) versus blending ace
 * rate into the rally-win rate - an ace isn't a function of the returner's
 * skill, so lumping it into p5 made aces look like rally dominance.
 */
const P5_BASELINE = 0.38;

function decayWeight(matchDate, asOfDate, halfLifeDays) {
  const daysAgo = (asOfDate - matchDate) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 0; // matches after the cutoff never count
  return Math.pow(0.5, daysAgo / halfLifeDays);
}

function emptyAgg() {
  return {
    svpt: 0, firstIn: 0, df: 0, firstWon: 0, secondAttempts: 0, secondWon: 0, aces: 0,
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
  const aces = Number(side.aces) || 0;
  const secondAttempts = Math.max(secondTotal - df, 0); // 2nd serves actually put in play
  agg.svpt += w * svpt;
  agg.firstIn += w * firstIn;
  agg.df += w * df;
  agg.firstWon += w * firstWon;
  agg.secondAttempts += w * secondAttempts;
  agg.secondWon += w * secondWon;
  agg.aces += w * aces; // attributed entirely to 1st serve - box scores don't split aces by serve number, and 2nd-serve aces are rare enough in pro tennis to approximate as zero
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

// Derives p1-p6 from one player's aggregated sums plus tour-average rates
// (used as a fallback when data is thin, and as the centering baseline for
// p5 - see header comment for why p5 needs a baseline).
//
// shrinkC (decayed serve points) applies empirical-Bayes shrinkage toward
// the tour mean: each rate becomes w*own + (1-w)*tourMean with
// w = svpt/(svpt+shrinkC), so a player estimated from 3 matches speaks more
// quietly than one estimated from 40. The minSvpt eligibility gate is
// evaluated BEFORE shrinkage so the player set is identical with it on/off.
function deriveProbabilities(agg, tourAverages, minSvpt = 200, shrinkC = 0) {
  const { r3Avg, r4Avg, tourServerWin1stNonAce, tourServerWin2nd, p1Avg, p2Avg, p6Avg } = tourAverages;
  if (agg.svpt < minSvpt) return null; // not enough data to trust

  const p1 = agg.firstIn / agg.svpt;
  const p2 = agg.secondAttempts / (agg.svpt - agg.firstIn);
  const p3 = agg.oppFirstIn > 0 ? 1 - agg.oppFirstWon / agg.oppFirstIn : r3Avg;
  const p4 = agg.oppSecondAttempts > 0 ? 1 - agg.oppSecondWon / agg.oppSecondAttempts : r4Avg;
  const p6 = agg.firstIn > 0 ? clamp01(agg.aces / agg.firstIn) : 0;

  // p5 is rally-win rate net of aces: aces are pulled out of the
  // first-serve-win rate before centering against the (also ace-adjusted)
  // tour average, so p5 represents pure rally skill rather than rally+ace
  // combined.
  const nonAceFirstWon = Math.max(agg.firstWon - agg.aces, 0);
  const nonAceFirstIn = Math.max(agg.firstIn - agg.aces, 1e-9);
  const serverWin1stNonAce = nonAceFirstWon / nonAceFirstIn;
  const serverWin2nd = agg.secondWon / agg.secondAttempts;
  const delta1 = serverWin1stNonAce - tourServerWin1stNonAce;
  const delta2 = serverWin2nd - tourServerWin2nd;
  let p5 = Math.min(0.65, Math.max(0.05, P5_BASELINE + (delta1 + delta2) / 2));

  let out = [clamp01(p1), clamp01(p2), clamp01(p3), clamp01(p4), p5, p6];
  if (shrinkC > 0) {
    const w = agg.svpt / (agg.svpt + shrinkC);
    const means = [p1Avg, p2Avg, r3Avg, r4Avg, P5_BASELINE, p6Avg];
    out = out.map((v, i) => (means[i] != null ? w * v + (1 - w) * means[i] : v));
  }
  return out;
}

function deriveTourAverages(tourTotals) {
  const nonAceFirstWon = Math.max(tourTotals.firstWon - tourTotals.aces, 0);
  const nonAceFirstIn = Math.max(tourTotals.firstIn - tourTotals.aces, 1e-9);
  return {
    r3Avg: 1 - tourTotals.firstWon / tourTotals.firstIn,
    r4Avg: 1 - tourTotals.secondWon / tourTotals.secondAttempts,
    tourServerWin1stNonAce: nonAceFirstWon / nonAceFirstIn,
    tourServerWin2nd: tourTotals.secondWon / tourTotals.secondAttempts,
    // Tour means for the shrinkage targets (p3/p4/p5 already have theirs).
    p1Avg: tourTotals.svpt > 0 ? tourTotals.firstIn / tourTotals.svpt : null,
    p2Avg: (tourTotals.svpt - tourTotals.firstIn) > 0 ? tourTotals.secondAttempts / (tourTotals.svpt - tourTotals.firstIn) : null,
    p6Avg: tourTotals.firstIn > 0 ? tourTotals.aces / tourTotals.firstIn : null,
  };
}

module.exports = {
  emptyAgg,
  accumulateMatch,
  deriveProbabilities,
  deriveTourAverages,
  clamp01,
};
