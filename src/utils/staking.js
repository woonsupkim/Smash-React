// src/utils/staking.js
//
// Expected-value + staking math for the Parlay builder's Staking Plan.
//
// Everything here is honest EV, and one fact drives all of it: a bet's edge
// per $1 is fixed at p*o - 1 (p = our model win prob, o = the decimal odds you
// are actually offered) and CANNOT be changed by the stake size - the stake
// only scales it. So "break even or better" means betting where p*o > 1 and
// sizing so the +EV stakes outweigh any -EV ones. This is the same
// model-vs-market math the Edge board shows, applied to a slip. It is not
// betting advice, and EV is a long-run average: any single slip can lose.

// EV per $1 staked on a single pick at decimal odds o with win prob p.
// null when there is no usable price (o <= 1).
export const edgePerDollar = (p, o) => (o > 1 && p > 0 ? p * o - 1 : null);

// Growth-optimal (Kelly) fraction of bankroll for one bet; 0 when not +EV.
// f = (p*o - 1) / (o - 1) = edge / (profit multiple).
export const kellyFraction = (p, o) => {
  if (!(o > 1) || !(p > 0)) return 0;
  const f = (p * o - 1) / (o - 1);
  return f > 0 ? f : 0;
};

const parlayLegsOf = (bets, legs) =>
  (legs || []).map((k) => bets.find((b) => b.key === k)).filter(Boolean);

// Combined independent-parlay probability and decimal odds for a set of legs.
export function parlayCombo(bets, legs) {
  const L = parlayLegsOf(bets, legs);
  const p = L.reduce((m, b) => m * b.p, 1);
  const o = L.reduce((m, b) => m * b.o, 1);
  const priced = L.length >= 2 && L.every((b) => b.o > 1);
  return { p, o, priced, n: L.length, edge: priced ? p * o - 1 : null };
}

// Analyze a whole slip: singles on some matches plus one parlay over a chosen
// subset. Each match is one independent binary (our pick wins or not).
//   bets:   [{ key, p, o, single }]   single = stake on that match's single (>=0)
//   parlay: { stake, legs: [key,...] }
// Returns exact expected value, amount staked, and - by enumerating every
// outcome - the probability of finishing ahead, plus expected/worst/best P&L.
export function analyzeSlip(bets, parlay) {
  const staked = bets.reduce((s, b) => s + (b.single || 0), 0) + (parlay?.stake || 0);
  const combo = parlayCombo(bets, parlay?.legs);
  const parlayActive = (parlay?.stake || 0) > 0 && combo.priced;

  // Expected value is linear and correlation-independent: sum each bet's edge.
  let ev = bets.reduce((s, b) => s + (b.single || 0) * (edgePerDollar(b.p, b.o) || 0), 0);
  if (parlayActive) ev += parlay.stake * combo.edge;

  // Matches that actually carry money (a single stake or an active parlay leg).
  const involved = bets.filter(
    (b) => (b.single || 0) > 0 || (parlayActive && parlay.legs.includes(b.key))
  );
  const n = involved.length;

  // The extremes are closed-form: everything loses = -staked; everything wins =
  // every single and the parlay pay out. No need to search for them.
  const worst = -staked;
  const best = bets.reduce((s, b) => s + ((b.single || 0) > 0 ? b.single * (b.o - 1) : 0), 0)
    + (parlayActive ? parlay.stake * (combo.o - 1) : 0);

  // Enumerate every outcome once: probability of finishing ahead + a P&L
  // histogram (BINS buckets from worst to best) for the distribution bar.
  const BINS = 15;
  let pProfit = null, dist = null;
  if (n > 0 && n <= 16) {
    const span = best - worst || 1;
    const bins = new Array(BINS).fill(0);
    let pPos = 0;
    for (let mask = 0; mask < (1 << n); mask++) {
      let prob = 1, pl = 0;
      const win = {};
      for (let i = 0; i < n; i++) {
        const b = involved[i];
        const w = (mask >> i) & 1;
        win[b.key] = !!w;
        prob *= w ? b.p : 1 - b.p;
      }
      for (const b of bets) {
        if (!(b.single > 0)) continue;
        pl += win[b.key] ? b.single * (b.o - 1) : -b.single;
      }
      if (parlayActive) {
        pl += parlay.legs.every((k) => win[k]) ? parlay.stake * (combo.o - 1) : -parlay.stake;
      }
      if (pl > 1e-9) pPos += prob;
      let bi = Math.floor(((pl - worst) / span) * BINS);
      if (bi >= BINS) bi = BINS - 1;
      if (bi < 0) bi = 0;
      bins[bi] += prob;
    }
    pProfit = pPos;
    dist = {
      lo: worst,
      hi: best,
      bins: bins.map((prob, i) => ({ prob, win: worst + (span * (i + 0.5)) / BINS > 1e-9 })),
    };
  }

  return {
    staked,
    ev,
    roi: staked > 0 ? ev / staked : 0,
    breakEven: ev >= -1e-9,
    pProfit,
    expProfit: ev,
    worst,
    best,
    dist,
    parlay: parlayActive ? combo : null,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * How far to trust the model's stated confidence, MEASURED on its own graded
 * forward record instead of assumed.
 *
 * The engine states a probability per pick; the record says how often picks
 * like that actually land. `lambda` maps one onto the other through the same
 * shrink-toward-50% form the engine's own Platt layer uses:
 * p' = 0.5 + lambda*(p - 0.5). lambda = 1 means stated confidence is exactly
 * borne out, below 1 means the model is overconfident, above 1 underconfident.
 *
 * lambda is then shrunk toward 1 by sample size. A season's forward record is
 * ~160 graded picks, which is not remotely enough to justify a large
 * correction, and over-correcting on noise is worse than not correcting at
 * all. `trusted` says whether the sample cleared minSample at all.
 *
 * @param {{favProb:number,status:string,correct:boolean}[]} graded
 */
export function reliability(graded, { minSample = 60 } = {}) {
  const rows = (graded || []).filter(
    (r) => typeof r.favProb === 'number' && (r.status === 'won' || r.status === 'lost')
  );
  const n = rows.length;
  if (!n) return { n: 0, lambda: 1, accuracy: null, stated: null, trusted: false };
  const accuracy = rows.filter((r) => r.correct).length / n;
  const stated = rows.reduce((s, r) => s + r.favProb, 0) / n;
  const raw = stated > 0.5 + 1e-6 ? (accuracy - 0.5) / (stated - 0.5) : 1;
  const w = n / (n + minSample); // 0 with no data, -> 1 as the record grows
  return {
    n,
    accuracy,
    stated,
    lambdaRaw: raw,
    lambda: clamp(1 + w * (raw - 1), 0.5, 1.5),
    trusted: n >= minSample,
  };
}

// The model's stated probability, re-expressed at its measured reliability.
export const adjustProb = (p, lambda = 1) =>
  (lambda === 1 ? p : clamp(0.5 + lambda * (p - 0.5), 0.001, 0.999));

// Every +EV combination of 2..maxLegs legs, best-edge first. The parlay's
// universe is every combination of the day's matches, not a subset someone
// ticked, because a combination can clear its price when its legs do not:
// parlay edge is the PRODUCT of the legs', so 1.10 * 0.95 > 1.
function parlayCandidates(priced, maxLegs, maxSearch) {
  const pool = [...priced]
    .sort((a, b) => (edgePerDollar(b.p, b.o) || 0) - (edgePerDollar(a.p, a.o) || 0))
    .slice(0, maxSearch);
  const found = [];
  const walk = (start, chosen, p, o) => {
    if (chosen.length >= 2) {
      const edge = p * o - 1;
      const f = kellyFraction(p, o);
      if (edge > 0 && f > 0) found.push({ legs: chosen.slice(), p, o, edge, f, n: chosen.length });
    }
    if (chosen.length >= maxLegs) return;
    for (let i = start; i < pool.length; i++) {
      chosen.push(pool[i].key);
      walk(i + 1, chosen, p * pool[i].p, o * pool[i].o);
      chosen.pop();
    }
  };
  if (maxLegs >= 2) walk(0, [], 1, 1);
  return found.sort((a, b) => b.edge - a.edge);
}

/**
 * A FLAT-STAKE SPREAD across the day's card - the plan this page is for.
 *
 * The shape of it, in the terms the question is usually asked in: ten matches,
 * a model right about 70% of the time, a dollar on each. Ten dollars is the
 * most that can be lost, seven winners is what to expect, and the thing worth
 * checking is whether the return from those seven covers the ten staked.
 *
 * With equal stakes that check falls on the AVERAGE - sum(p*o) >= n - which is
 * what makes it a plan-level question rather than a per-match one. A match
 * whose own price is slightly short can be carried by stronger ones, and
 * excluding it on its own merits (which is what a per-match +EV filter does)
 * gives up breadth for nothing. Breadth is the point: it is how a 70% model
 * actually shows up, instead of riding on one result.
 *
 * Matches are taken best-edge-first and kept while the portfolio still covers
 * its stake, which yields the WIDEST spread that clears - greedy on a running
 * mean is exact here, since adding in descending order keeps that mean as high
 * as it can be at every size.
 *
 * @param {{key:string,p:number,o:number}[]} bets  p should already be adjusted
 * @param {number} budget  split equally across whatever is taken
 */
export function spreadPlan(bets, budget, { lambda = 1 } = {}) {
  const adj = (bets || [])
    .map((b) => ({ ...b, pStated: b.p, p: adjustProb(b.p, lambda) }))
    .filter((b) => b.o > 1 && b.p > 0);
  const ranked = [...adj].sort((a, b) => (b.p * b.o) - (a.p * a.o));

  // Widest prefix whose mean p*o still covers 1 per dollar staked.
  let take = 0, sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    const next = sum + ranked[i].p * ranked[i].o;
    if (next < i + 1 - 1e-12) break;   // this match would break the cover
    sum = next;
    take = i + 1;
  }

  const chosen = ranked.slice(0, take);
  const B = Number(budget) || 0;
  const perMatch = take > 0 ? B / take : 0;
  const singles = {};
  for (const b of chosen) singles[b.key] = perMatch;

  const staked = perMatch * take;
  const expWinners = chosen.reduce((s, b) => s + b.p, 0);
  const expReturn = chosen.reduce((s, b) => s + perMatch * b.p * b.o, 0);
  // How many of them have to land before the stake is back. Uses the mean
  // payout, so it is the honest "about N of them" rather than an exact count
  // when the prices differ.
  const meanO = take > 0 ? chosen.reduce((s, b) => s + b.o, 0) / take : 0;
  const breakEvenWins = meanO > 0 ? Math.ceil(staked / (perMatch * meanO) - 1e-9) : 0;

  return {
    legs: chosen.map((b) => b.key),
    count: take,
    singles,
    parlayLegs: [],
    parlayStake: 0,
    combo: null,
    perMatch,
    staked,
    expWinners,
    expReturn,
    breakEvenWins,
    coversStake: take > 0 && expReturn >= staked - 1e-9,
    funded: take,
    metrics: analyzeSlip(adj.map((b) => ({ ...b, single: singles[b.key] || 0 })), { stake: 0, legs: [] }),
  };
}

/**
 * A small menu of RECOMMENDED plans for a budget, every one of which stakes so
 * that expected return >= total staked (plan EV >= 0).
 *
 * That constraint does not pick a plan on its own - it admits a whole family,
 * and the ends of that family are far apart in risk. Rather than choose for
 * the user, this returns the family's useful corners:
 *
 *   safest   - the highest chance of finishing ahead
 *   balanced - growth-optimal (Kelly) sizing across everything that clears
 *   profit   - the largest expected profit
 *
 * Each may or may not include a parlay; that falls out of the objective rather
 * than being a switch. Only bets that beat their price are ever funded, so the
 * break-even property holds by construction for every plan here.
 *
 * IMPORTANT: EV >= 0 is an expectation, not a promise. Each plan's own
 * `metrics.pProfit` is the honest chance of actually finishing ahead, and it is
 * routinely below 50% - a plan can be sound and still lose most of the time.
 *
 * @param {{key:string,p:number,o:number}[]} bets
 * @param {number} budget
 */
export function planFrontier(bets, budget, { lambda = 1, maxParlayLegs = 6, maxSearch = 12 } = {}) {
  const adj = (bets || []).map((b) => ({ ...b, pStated: b.p, p: adjustProb(b.p, lambda) }));
  const priced = adj.filter((b) => b.o > 1 && b.p > 0);
  const B = Number(budget) || 0;

  const shape = (singles, combo, comboStake) => {
    const staked = adj.map((b) => ({ ...b, single: singles[b.key] || 0 }));
    const legs = comboStake > 0 && combo ? combo.legs : [];
    const metrics = analyzeSlip(staked, { stake: comboStake, legs });
    const singleKeys = Object.keys(singles).filter((k) => singles[k] > 0);
    return {
      singles,
      combo: comboStake > 0 ? combo : null,
      parlayLegs: legs,
      parlayStake: comboStake > 0 ? comboStake : 0,
      metrics,
      funded: singleKeys.length + (comboStake > 0 ? 1 : 0),
      // Stated the way the question is asked: how many of the matches we
      // expect to land, and what the whole plan is expected to return.
      expWinners: singleKeys.reduce((t, k) => t + (priced.find((b) => b.key === k)?.p || 0), 0),
      expReturn: metrics.ev + metrics.staked,
    };
  };

  // The spread is the headline: a flat stake on as much of the card as can
  // still cover itself. Everything else is measured against it.
  const spread = spreadPlan(bets, B, { lambda });
  const combos = parlayCandidates(priced, maxParlayLegs, maxSearch);
  const bestCombo = combos.length ? combos.reduce((a, c) => (c.f > a.f ? c : a), combos[0]) : null;

  const plans = [];
  if (spread.count >= 2 && spread.coversStake) {
    plans.push({ id: 'spread', label: 'Spread across the card', ...spread, expReturn: spread.expReturn });
  }

  // Same spread with a slice moved onto the best combination, sized by Kelly
  // against the singles so the split follows edge rather than a round number.
  if (bestCombo && spread.count >= 2 && spread.coversStake && B > 0) {
    const chosen = priced.filter((b) => spread.legs.includes(b.key));
    const fSingles = chosen.reduce((t, b) => t + kellyFraction(b.p, b.o), 0);
    const total = fSingles + bestCombo.f;
    if (total > 0) {
      const perMatch = (B * (fSingles / total)) / chosen.length;
      const singles = {};
      for (const b of chosen) singles[b.key] = perMatch;
      plans.push({
        id: 'spreadPlus',
        label: 'Spread plus a parlay',
        ...shape(singles, bestCombo, B * (bestCombo.f / total)),
      });
    }
  }

  // The concentrated alternative: only matches whose own price beats them,
  // sized by edge. Fewer bets, more expected profit, more variance.
  const evSingles = priced.filter((b) => kellyFraction(b.p, b.o) > 0);
  if (evSingles.length >= 1 && B > 0) {
    const fs = evSingles.map((b) => ({ key: b.key, f: kellyFraction(b.p, b.o) }));
    const total = fs.reduce((t, i) => t + i.f, 0) + (bestCombo ? bestCombo.f : 0);
    if (total > 0) {
      const singles = {};
      for (const i of fs) singles[i.key] = (B * i.f) / total;
      const sharp = shape(singles, bestCombo, bestCombo ? (B * bestCombo.f) / total : 0);
      // Only worth a slot if it differs from a spread that is ACTUALLY on the
      // menu. Comparing against a spread that was never offered (a one- or
      // two-match card) suppressed the only plan there was and left the page
      // with nothing to show.
      const offeredSpread = plans.find((p) => p.id === 'spread');
      const sameAsSpread = !!offeredSpread
        && sharp.funded === offeredSpread.funded
        && offeredSpread.legs.every((k) => (singles[k] || 0) > 0)
        && !sharp.parlayStake;
      if (!sameAsSpread) plans.push({ id: 'sharp', label: 'Best prices only', ...sharp });
    }
  }

  if (!plans.length) {
    return {
      plans: [],
      lambda,
      reason: priced.length
        ? "even spread across the whole card, these prices do not return the stake - the expected winners' payout falls short of what it costs to back them"
        : 'none of these carry a market price',
    };
  }
  return { plans, lambda, reason: null };
}

// Recommend a break-even-or-better split of a budget. Only +EV bets get money
// (any allocation among +EV bets is EV >= 0), split in proportion to each
// bet's Kelly fraction so stake follows edge strength. The parlay is included
// only when it is itself +EV, which is rare (a parlay compounds the vig).
// Returns { singles: {key: stake}, parlay: stake, anyPositive }.
export function recommendStakes(bets, parlayLegs, budget) {
  const cand = [];
  for (const b of bets) {
    const f = kellyFraction(b.p, b.o);
    if (f > 0) cand.push({ type: 'single', key: b.key, f });
  }
  const combo = parlayCombo(bets, parlayLegs);
  if (combo.priced) {
    const f = kellyFraction(combo.p, combo.o);
    if (f > 0) cand.push({ type: 'parlay', f });
  }
  const total = cand.reduce((s, c) => s + c.f, 0);
  const singles = {};
  let parlay = 0;
  if (total > 0 && budget > 0) {
    for (const c of cand) {
      const stake = (budget * c.f) / total;
      if (c.type === 'single') singles[c.key] = stake;
      else parlay = stake;
    }
  }
  return { singles, parlay, anyPositive: total > 0 };
}
