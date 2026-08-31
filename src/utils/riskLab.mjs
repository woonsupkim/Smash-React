/**
 * Risk maths for the sizing panel.
 *
 * This module deliberately RECOMMENDS NOTHING. staking.mjs answers "what
 * should I stake"; everything here answers "what am I exposed to if I stake
 * what I already chose". The distinction matters because the two questions
 * have different failure modes: a plan can be right about edge and still
 * bankrupt someone who sized it wrong.
 *
 * Everything is derived from the exact P&L distribution analyzeSlip already
 * computes, except the multi-day paths, which need simulation because a
 * bankroll's route matters as well as its destination (you can end a season
 * up and still have been wiped out in March).
 */

// A day's outcome distribution, as (P&L, probability) pairs. analyzeSlip's
// `dist` is already binned for drawing; this rebuilds the same shape at the
// resolution the risk questions need, from the same bins.
export function outcomePairs(dist) {
  if (!dist || !dist.bins || !dist.bins.length) return [];
  const { lo, hi, bins } = dist;
  const span = hi - lo;
  return bins
    .map((b, i) => ({ pl: lo + (span * (i + 0.5)) / bins.length, prob: b.prob }))
    .filter((x) => x.prob > 0);
}

/**
 * Loss exceedance: for a ladder of loss sizes, the probability of losing AT
 * LEAST that much. This is the honest shape of a downside - "you lose $40 on
 * a bad day" means nothing without how often a bad day arrives.
 *
 * @param {object} dist analyzeSlip().dist
 * @param {number[]} levels loss amounts (positive numbers, dollars)
 */
export function lossExceedance(dist, levels) {
  const pairs = outcomePairs(dist);
  const total = pairs.reduce((s, x) => s + x.prob, 0) || 1;
  return levels.map((L) => ({
    loss: L,
    prob: pairs.filter((x) => x.pl <= -L + 1e-9).reduce((s, x) => s + x.prob, 0) / total,
  }));
}

/**
 * Gain exceedance: the mirror of the ladder above. For each level, the chance
 * of winning AT LEAST that much.
 *
 * The panel showed only losses at first, which is its own kind of dishonesty:
 * a reader deciding what to stake needs both arms of the distribution, and a
 * downside-only view makes every slip look like a bad idea.
 *
 * @param {object} dist analyzeSlip().dist
 * @param {number[]} levels win amounts (positive numbers, dollars)
 */
export function gainExceedance(dist, levels) {
  const pairs = outcomePairs(dist);
  const total = pairs.reduce((s, x) => s + x.prob, 0) || 1;
  return levels.map((L) => ({
    gain: L,
    prob: pairs.filter((x) => x.pl >= L - 1e-9).reduce((s, x) => s + x.prob, 0) / total,
  }));
}

/**
 * The Kelly check: is this slip sized past the growth-optimal bet?
 *
 * Kelly is the stake that maximises long-run growth. Bet MORE than it and
 * expected growth falls even though expected profit rises - past 2x Kelly,
 * growth turns negative and a positive-edge bettor still goes broke. That is
 * the single most useful thing this panel can tell someone, and it needs no
 * recommendation to say it: it is a property of the stake they typed.
 *
 * Full Kelly is computed per bet on the bankroll, then compared with what is
 * actually staked. Ratios are what matter, not the dollar amounts.
 *
 * @param {{p:number,o:number,single:number}[]} bets
 * @param {number} bankroll
 * @param {{stake:number,p:number,o:number}|null} parlay
 */
export function kellyCheck(bets, bankroll, parlay) {
  if (!(bankroll > 0)) return null;
  const kelly = (p, o) => {
    if (!(o > 1) || !(p > 0)) return 0;
    const f = (p * o - 1) / (o - 1);
    return f > 0 ? f : 0;
  };
  let staked = 0, kellyStake = 0;
  for (const b of bets) {
    staked += b.single || 0;
    kellyStake += kelly(b.p, b.o) * bankroll;
  }
  if (parlay && parlay.stake > 0) {
    staked += parlay.stake;
    kellyStake += kelly(parlay.p, parlay.o) * bankroll;
  }
  // No +EV bet in the slip: Kelly says stake nothing, so any stake is
  // infinitely over. Reported as null rather than Infinity so the UI can say
  // that in words instead of printing a symbol.
  const ratio = kellyStake > 1e-9 ? staked / kellyStake : null;
  return {
    staked,
    kellyStake,
    ratio,
    exposure: staked / bankroll,
    // The bands that actually mean something in Kelly's own terms.
    band: ratio == null ? 'none'
      : ratio <= 0.55 ? 'conservative'
        : ratio <= 1.15 ? 'full'
          : ratio <= 2 ? 'aggressive'
            : 'ruinous',
  };
}

/**
 * Simulate a bankroll repeating this slip over many days.
 *
 * Sampling the day's outcome distribution rather than re-simulating each match
 * keeps the correlation between singles and their parlay intact for free: it
 * is already baked into the distribution analyzeSlip produced.
 *
 * Stakes are treated as FIXED in dollars, not as a fraction of a moving
 * bankroll, because that is what someone typing dollar stakes actually does.
 * It is also the less flattering assumption: fractional staking cannot go
 * bankrupt in theory, flat staking can, and the point of the panel is the
 * floor rather than the ceiling.
 *
 * @returns median/5th/95th percentile paths, risk of ruin, worst drawdown
 */
export function simulateBankroll(dist, {
  bankroll, days = 30, trials = 2000, ruinAt = 0, seed = 20260830,
} = {}) {
  const pairs = outcomePairs(dist);
  if (!pairs.length || !(bankroll > 0) || days < 1) return null;

  // Deterministic RNG: the same slip must draw the same chart every render,
  // or the numbers appear to move on their own.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const total = pairs.reduce((a, x) => a + x.prob, 0);
  const cdf = [];
  let acc = 0;
  for (const x of pairs) { acc += x.prob / total; cdf.push({ pl: x.pl, c: acc }); }
  const draw = () => {
    const r = rand();
    for (const x of cdf) if (r <= x.c) return x.pl;
    return cdf[cdf.length - 1].pl;
  };

  const paths = new Array(trials);
  let ruined = 0;
  let drawdownSum = 0;
  const finals = new Array(trials);
  for (let t = 0; t < trials; t++) {
    const path = new Float64Array(days + 1);
    path[0] = bankroll;
    let peak = bankroll, worstDd = 0, dead = false;
    for (let d = 1; d <= days; d++) {
      // Once the bankroll is gone it stays gone: no borrowing to keep betting.
      const v = dead ? path[d - 1] : path[d - 1] + draw();
      path[d] = v;
      if (v > peak) peak = v;
      const dd = peak > 0 ? (peak - v) / peak : 0;
      if (dd > worstDd) worstDd = dd;
      if (!dead && v <= ruinAt) { dead = true; ruined++; }
    }
    paths[t] = path;
    finals[t] = path[days];
    drawdownSum += worstDd;
  }

  // Percentile BANDS across trials at each day, which is the honest way to
  // draw a fan: one simulated path is an anecdote.
  const band = (qt) => {
    const out = new Array(days + 1);
    const col = new Float64Array(trials);
    for (let d = 0; d <= days; d++) {
      for (let t = 0; t < trials; t++) col[t] = paths[t][d];
      const sorted = Array.from(col).sort((a, b) => a - b);
      out[d] = sorted[Math.min(trials - 1, Math.floor(qt * trials))];
    }
    return out;
  };

  const sortedFinal = [...finals].sort((a, b) => a - b);
  const at = (qt) => sortedFinal[Math.min(trials - 1, Math.floor(qt * trials))];

  return {
    days,
    trials,
    p05: band(0.05),
    p50: band(0.5),
    p95: band(0.95),
    riskOfRuin: ruined / trials,
    avgMaxDrawdown: drawdownSum / trials,
    finalP05: at(0.05),
    finalP50: at(0.5),
    finalP95: at(0.95),
    pDown: finals.filter((v) => v < bankroll).length / trials,
    // The upside, on the same footing as the ruin figure beside it. Reporting
    // only the floor is as one-sided as reporting only the ceiling.
    pUp: finals.filter((v) => v > bankroll).length / trials,
    pDouble: finals.filter((v) => v >= bankroll * 2).length / trials,
    bestCase: sortedFinal[trials - 1],
  };
}

/**
 * The longest run of losing days you should expect to sit through.
 *
 * People abandon a positive-edge strategy during a losing streak far more
 * often than they lose their bankroll to one, so the streak is the number
 * worth bracing for. Expected longest run in n trials at loss probability q
 * is approximately log(n)/log(1/q).
 */
export function expectedLosingStreak(pLoseDay, days) {
  if (!(pLoseDay > 0) || pLoseDay >= 1 || days < 2) return null;
  return Math.max(1, Math.round(Math.log(days) / Math.log(1 / pLoseDay)));
}
