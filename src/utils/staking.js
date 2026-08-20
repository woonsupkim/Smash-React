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
    dist = { lo: worst, hi: best, bins: bins.map((prob, i) => ({ prob, win: worst + (span * (i + 0.5)) / BINS > 1e-9 })) };
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

/**
 * The best plan for a budget, decided AT THE PLAN LEVEL.
 *
 * Why this is not just "stake the +EV picks": expected value is additive, so
 * no reshuffling of stakes can rescue a slip whose every instrument is -EV.
 * But which INSTRUMENTS exist is a plan-level choice, and a parlay's edge is
 * the product of its legs' - so a parlay can be +EV while individual legs are
 * not. A leg priced at 0.95 of our number drags a single below break-even yet
 * still pays its way inside a combination that clears it (1.10 * 0.95 > 1).
 * Filtering legs on their own edge first, as a per-matchup pass does, throws
 * those away and reports "nothing is worth staking" on a slate that has a
 * perfectly good plan in it.
 *
 * So: adjust every probability to the model's measured reliability, search
 * leg combinations for the best +EV parlay, then fund every +EV instrument by
 * Kelly fraction. Kelly is the objective because the break-even constraint
 * alone does not pick a plan - maximising EV would put the whole budget on the
 * single largest edge - and growth-optimal sizing is what balances that edge
 * against the chance of losing the lot. Funding only +EV instruments makes
 * plan EV >= 0 automatic, so the constraint is satisfied by construction
 * rather than by assertion.
 *
 * @param {{key:string,p:number,o:number}[]} bets
 * @param {number} budget
 */
export function bestPlan(bets, budget, { lambda = 1, maxParlayLegs = 6, maxSearch = 12, allowParlay = true } = {}) {
  const adj = (bets || []).map((b) => ({ ...b, pStated: b.p, p: adjustProb(b.p, lambda) }));
  const priced = adj.filter((b) => b.o > 1 && b.p > 0);

  // Singles worth funding on their own.
  const instruments = [];
  for (const b of priced) {
    const f = kellyFraction(b.p, b.o);
    if (f > 0) instruments.push({ type: 'single', key: b.key, f });
  }

  // Best +EV parlay over any combination - including legs that are -EV alone.
  // Ranked by Kelly fraction, since that is what decides the money it gets.
  const pool = [...priced]
    .sort((a, b) => (edgePerDollar(b.p, b.o) || 0) - (edgePerDollar(a.p, a.o) || 0))
    .slice(0, maxSearch);
  let bestCombo = null;
  const walk = (start, chosen, p, o) => {
    if (chosen.length >= 2) {
      const edge = p * o - 1;
      const f = kellyFraction(p, o);
      if (edge > 0 && f > 0 && (!bestCombo || f > bestCombo.f)) {
        bestCombo = { legs: chosen.slice(), p, o, edge, f, n: chosen.length };
      }
    }
    if (chosen.length >= maxParlayLegs) return;
    for (let i = start; i < pool.length; i++) {
      chosen.push(pool[i].key);
      walk(i + 1, chosen, p * pool[i].p, o * pool[i].o);
      chosen.pop();
    }
  };
  if (allowParlay && maxParlayLegs >= 2) walk(0, [], 1, 1);
  if (bestCombo) instruments.push({ type: 'parlay', f: bestCombo.f });

  const totalF = instruments.reduce((s, c) => s + c.f, 0);
  const singles = {};
  let parlayStake = 0;
  if (totalF > 0 && budget > 0) {
    for (const c of instruments) {
      const stake = (budget * c.f) / totalF;
      if (c.type === 'single') singles[c.key] = stake;
      else parlayStake = stake;
    }
  }

  const parlayLegs = parlayStake > 0 && bestCombo ? bestCombo.legs : [];
  const staked = adj.map((b) => ({ ...b, single: singles[b.key] || 0 }));
  const metrics = analyzeSlip(staked, { stake: parlayStake, legs: parlayLegs });

  return {
    feasible: totalF > 0,
    lambda,
    singles,
    parlayLegs,
    parlayStake,
    combo: bestCombo,
    metrics,
    // How many legs carry money at all - the honest size of the plan, which is
    // usually smaller than the slip the user selected.
    funded: Object.values(singles).filter((s) => s > 0).length + (parlayStake > 0 ? 1 : 0),
    reason: totalF > 0 ? null
      : (priced.length
        ? 'every price on this slate is at or above our own number, alone and in every combination'
        : 'none of these carry a market price'),
  };
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
