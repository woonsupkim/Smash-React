/**
 * Bayesian player-strength filter - the sequential-inference sibling of
 * eloCore.js.
 *
 * Elo carries a bare point rating: one number, no notion of how well we know
 * it. This carries a POSTERIOR - mean and variance - and every match is a
 * Bayesian update of it. Today's posterior is tomorrow's prior, so the daily
 * refresh literally advances the filter rather than re-deriving anything.
 * Three things fall out of that which Elo cannot express:
 *
 *   1. Uncertainty shrinks predictions. P(A beats B) integrates over both
 *      players' posteriors, so a thin-record matchup is pulled toward 50%
 *      instead of stating a confident number off two matches of evidence.
 *   2. Layoffs re-widen the prior. Variance inflates with elapsed time
 *      (process noise), so a player back from six months out is correctly
 *      treated as an unknown quantity rather than as their old self.
 *   3. Surface skill self-shrinks. A player is overall skill PLUS a per-
 *      surface offset whose prior mean is zero. A player with two clay
 *      matches has an offset posterior still near zero, so they lean on
 *      their overall level automatically - no hand-tuned rho (eloCore's
 *      fixed 0.5 overall/surface blend) doing that job by fiat.
 *
 * Math: assumed-density filtering on a logistic likelihood, i.e. Glicko's
 * update, in Elo points so the scale is directly comparable to eloCore. The
 * one approximation worth naming is in the surface split: the observation
 * constrains the SUM (overall + offset), so we keep each component's exact
 * marginal posterior and drop the correlation the observation induces
 * between them (standard mean-field projection - see updateSide below).
 *
 * Shared by backtestBayes.js (validation) and, once validated, computeBayes.js
 * (writes current posteriors for the live blend) and buildTrackRecord.js
 * (replays the timeline for leak-free pre-match posteriors). Deliberately
 * mirrors eloCore's exports so it drops into the same call sites.
 */
const BASE = 1500;
const Q = Math.log(10) / 400;
const SURFACES = ['hard', 'clay', 'grass'];

/**
 * Hyperparameters. Defaults are Glicko-conventional starting points, NOT
 * fitted values - backtestBayes.js sweeps them on a first-half/second-half
 * holdout and prints what to ship here.
 *
 * v0      - prior variance on overall skill for an unseen player (350^2 is
 *           Glicko's default RD, i.e. "we know essentially nothing").
 * v0Surf  - prior variance on a surface offset. Smaller than v0 on purpose:
 *           the prior belief is that players are mostly surface-agnostic and
 *           have to earn a surface offset with evidence.
 * drift   - process noise on overall skill, as VARIANCE ADDED PER DAY. Skill
 *           is a moving target, so certainty decays between matches. Think of
 *           it in sd terms: drift = s^2/365 re-opens s points of sigma over an
 *           idle year.
 * driftSurf - process noise on a surface offset, same units, per day since
 *           that player's last match ON that surface.
 * marginK - scale each observation's information content by set dominance
 *           (a straight-sets win is stronger evidence than a deciding-set
 *           escape). Elo's equivalent knob validated on both tours.
 * rankPrior - Elo points per decade of world ranking used to seed an unseen
 *           player's prior MEAN instead of a flat 1500. Off (0) by default:
 *           it needs a pre-match rank to be leak-free, and the only ranking
 *           the backtest can see is a season snapshot. See backtestBayes.js.
 * rankRef - ranking that maps to BASE under rankPrior.
 */
// Values below are the backtestBayes.js holdout winners (swept on the first
// half of the season, scored on the second). Two things about them are worth
// knowing before trusting them:
//
//   - drift is SATURATED. At 1800 sd-points/year a week's gap re-opens about
//     as much variance as v0 caps, so in practice every player arrives at
//     every match near the prior width. That collapses the filter toward a
//     constant-gain rating set by v0 - which means the uncertainty-tracking
//     machinery is NOT what earns the model's edge on this universe. It is
//     kept because it costs nothing and should start mattering on the full
//     match cache, where debutants, comebacks and sparse-surface players are
//     actually uncertain; on one season of roster-vs-roster matches nobody is.
//   - what DOES earn the edge is the per-surface offset structure: switching
//     it off (v0Surf = 0) costs ~0.032 log loss on ATP and ~0.029 on WTA.
//
// Per-tour values differ slightly (WTA prefers a tighter v0Surf of 180); if
// this engine ships, they belong in src/engineConfig.json next to `elo`
// rather than hardcoded here.
const DEFAULT_PARAMS = {
  v0: 250 * 250,
  v0Surf: 180 * 180,
  drift: (1800 * 1800) / 365,
  driftSurf: (1000 * 1000) / 365,
  marginK: true,
  rankPrior: 0,
  rankRef: 30,
};

// Glicko's g: how much an opponent's uncertainty flattens the logistic. v is
// a VARIANCE in Elo points squared. g(0) = 1 (perfectly known opponent);
// g grows-variance -> 0, pulling the predicted probability toward 0.5.
const g = (v) => 1 / Math.sqrt(1 + (3 * Q * Q * v) / (Math.PI * Math.PI));

// P(the player with mean advantage `dMu` wins), flattened by predictive
// variance `v` (the SUM of both sides' predictive variances).
const expected = (dMu, v) => 1 / (1 + Math.pow(10, (-g(v) * dMu) / 400));

/**
 * Prior state for a player. Surface entries are OFFSETS from overall skill
 * with a prior mean of zero, which is what makes surface specialization
 * something the data has to establish rather than something we assume.
 * @param {number} [mean] - prior mean for overall skill (rank-seeded or BASE)
 * @param {object} [params]
 */
function newState(mean = BASE, params = DEFAULT_PARAMS) {
  const s = {
    all: { m: mean, v: params.v0 },
    seen: 0,
    lastAll: null,
    last: {},
  };
  for (const surf of SURFACES) s[surf] = { m: 0, v: params.v0Surf };
  return s;
}

// Prior mean for an unseen player from their world ranking. Flat BASE when
// rankPrior is 0 (the default) or the rank is unknown.
function priorMean(rank, params = DEFAULT_PARAMS) {
  const r = Number(rank);
  if (!params.rankPrior || !(r > 0)) return BASE;
  return BASE - params.rankPrior * Math.log10(r / params.rankRef);
}

// Predictive mean and variance of a player's skill on a surface: overall
// plus that surface's offset. Variances add (the two are tracked
// independently), which is exactly why a player with no clay evidence
// predicts with a WIDER interval on clay than on their main surface.
function predict(state, surface) {
  const off = state[surface] || { m: 0, v: 0 };
  return { m: state.all.m + off.m, v: state.all.v + off.v };
}

// Point estimate on the Elo scale, for reporting and for parity with
// eloCore.predElo's signature.
const predBayes = (state, surface) => predict(state, surface).m;

/**
 * P(A beats B) on a surface, integrating over BOTH posteriors. This is the
 * number the engine serves: two players 100 points apart predict much closer
 * to a coin flip when one of them is a question mark than when both are
 * well-established.
 */
function winProbBayes(sA, sB, surface) {
  const a = predict(sA, surface), b = predict(sB, surface);
  return expected(a.m - b.m, a.v + b.v);
}

// Predictive spread of the win probability, for the credible-interval UI:
// the probability recomputed at +/-1 predictive sigma of the skill gap.
function winProbBand(sA, sB, surface) {
  const a = predict(sA, surface), b = predict(sB, surface);
  const d = a.m - b.m, v = a.v + b.v, sd = Math.sqrt(v);
  return {
    p: expected(d, v),
    lower: expected(d - sd, v),
    upper: expected(d + sd, v),
  };
}

// Inflate variance for elapsed time - the prior re-widens while a player is
// idle. `perDay` is variance, not sd. Capped at the cold-start prior: however
// long someone is away, they never become less known than a debutant.
function drift(entry, days, perDay, cap) {
  if (!(days > 0) || !(perDay > 0)) return;
  entry.v = Math.min(cap, entry.v + perDay * days);
}

// Set-dominance weight on an observation's information content. Mirrors
// eloCore.marginMult: 0.7 for the narrowest win up to 1.3 for a sweep.
function marginMult(setsW, setsL, bestOf, params) {
  if (!params.marginK || setsW == null || setsL == null) return 1;
  const target = Math.ceil((bestOf || (setsW > 2 ? 5 : 3)) / 2);
  if (target <= 1) return 1;
  const margin = Math.max(1, setsW - setsL);
  return 0.7 + 0.6 * ((margin - 1) / (target - 1));
}

/**
 * ADF update of one side. `score` is 1 for the winner, 0 for the loser;
 * `pre`/`preOpp` are the pre-match predictive {m, v} of the two sides.
 *
 * The observation constrains the player's predictive skill z = overall +
 * offset, so we update z and then split the result across its two
 * components. Each component's MARGINAL posterior is exact under the
 * Gaussian-linear approximation - the mean shift is apportioned by variance
 * share (the Kalman gain of a sum) and the variance reduction by its square,
 * which is algebraically identical to the closed form. What we drop is the
 * covariance the observation induces between overall and offset; keeping a
 * diagonal state is the standard mean-field projection and is what lets the
 * timeline stay a few numbers per player instead of a matrix.
 */
function updateSide(state, surface, pre, preOpp, score, weight) {
  const gOpp = g(preOpp.v);
  const e = 1 / (1 + Math.pow(10, (-gOpp * (pre.m - preOpp.m)) / 400));
  // Observation precision (Glicko's 1/d^2), scaled by the margin weight:
  // a lopsided win carries more information about skill than a squeaker.
  const prec = weight * Q * Q * gOpp * gOpp * e * (1 - e);
  const vPost = 1 / (1 / pre.v + prec);
  const shift = vPost * Q * gOpp * (score - e) * weight;
  const reduce = pre.v - vPost;

  const off = state[surface];
  const fAll = state.all.v / pre.v;
  const fOff = off.v / pre.v;
  state.all.m += fAll * shift;
  off.m += fOff * shift;
  state.all.v -= fAll * fAll * reduce;
  off.v -= fOff * fOff * reduce;
}

/**
 * Replays matches in date order, advancing every player's posterior.
 * `onMatch(m, sWinner, sLoser)` fires BEFORE each update, so callers can
 * snapshot leak-free pre-match posteriors - same contract as
 * eloCore.buildTimeline.
 *
 * @param {{id,date,winnerId,loserId,surface,setsW,setsL,bestOf}[]} matches
 * @param {(m, sWinner, sLoser) => void} [onMatch]
 * @param {object} [opts] - { params, ranks } where ranks is an optional
 *   Map<playerId, worldRank> used only to seed cold-start prior means.
 * @returns {Map<string, state>} final posteriors by player id
 */
function buildBayesTimeline(matches, onMatch, opts = {}) {
  const params = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
  const ranks = opts.ranks || null;
  const states = new Map();
  const get = (id) => {
    if (!states.has(id)) {
      states.set(id, newState(priorMean(ranks ? ranks.get(id) : null, params), params));
    }
    return states.get(id);
  };

  const sorted = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const m of sorted) {
    if (!m.winnerId || !m.loserId || !m.surface || m.winnerId === m.loserId) continue;
    if (!SURFACES.includes(m.surface)) continue;
    const t = new Date(m.date).getTime();
    if (isNaN(t)) continue;

    const sw = get(m.winnerId), sl = get(m.loserId);

    // 1. Advance the prior to match day: uncertainty grows with idle time,
    // overall and on this surface separately.
    for (const s of [sw, sl]) {
      drift(s.all, s.lastAll == null ? 0 : (t - s.lastAll) / 864e5, params.drift, params.v0);
      const lastSurf = s.last[m.surface];
      drift(s[m.surface], lastSurf == null ? 0 : (t - lastSurf) / 864e5, params.driftSurf, params.v0Surf);
    }

    // 2. Snapshot for the caller, then update both sides from the SAME
    // pre-match state (a simultaneous update, not sequential - otherwise the
    // loser would be graded against the winner's already-moved posterior).
    if (onMatch) onMatch(m, sw, sl);
    const preW = predict(sw, m.surface);
    const preL = predict(sl, m.surface);
    const weight = marginMult(m.setsW, m.setsL, m.bestOf, params);
    updateSide(sw, m.surface, preW, preL, 1, weight);
    updateSide(sl, m.surface, preL, preW, 0, weight);

    for (const s of [sw, sl]) {
      s.seen++;
      s.lastAll = t;
      s.last[m.surface] = t;
    }
  }
  return states;
}

module.exports = {
  BASE, SURFACES, DEFAULT_PARAMS,
  g, expected, newState, priorMean, predict, predBayes,
  winProbBayes, winProbBand, marginMult, buildBayesTimeline,
};
