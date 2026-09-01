// src/utils/staking.js
//
// Expected-value + staking math for the Risk Lab's Staking Plan.
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

  // Probability of finishing ahead, plus a P&L histogram (BINS buckets from
  // worst to best) for the distribution bar.
  //
  // This used to enumerate all 2^n win/lose combinations, which capped out at
  // 16 matches - and a real tour day is 30 to 60. Past the cap it returned
  // null, which the plan cards rendered as "0.0% to win": the headline number
  // read zero on exactly the cards it matters most on.
  //
  // Instead, convolve one match at a time over a quantised P&L grid. Each
  // match is an independent two-outcome shift, so the running distribution is
  // O(matches x buckets) rather than exponential, and a 40-match card costs
  // about the same as a 4-match one.
  //
  // The parlay is the one thing that does not decompose, since it pays only
  // if every leg wins. So the grid is carried in two tracks - every leg has
  // won so far, or one has already gone - and the parlay's payoff is applied
  // at the end according to which track the mass ended up in. Exact, not an
  // approximation of the coupling.
  const BINS = 15;
  let pProfit = null, dist = null, pcts = null;
  if (n > 0) {
    const span = best - worst || 1;
    // Work in index space so rounding happens once per match rather than
    // accumulating through repeated value->index round trips. Never coarser
    // than ~32k buckets, never finer than half a cent - beyond that the
    // precision is imaginary and the arrays get big for nothing.
    const quantum = Math.max(span / 32768, 0.005);
    const G = Math.round(span / quantum) + 1;
    const clamp = (i) => (i < 0 ? 0 : i >= G ? G - 1 : i);

    const ALIVE = 0, DEAD = 1;            // "every parlay leg so far has won"
    const tracks = parlayActive ? 2 : 1;
    let cur = [new Float64Array(G), parlayActive ? new Float64Array(G) : null];
    cur[ALIVE][clamp(Math.round(-worst / quantum))] = 1;   // P&L 0, vacuously alive

    for (const b of involved) {
      const hasSingle = (b.single || 0) > 0;
      const winShift = hasSingle ? Math.round((b.single * (b.o - 1)) / quantum) : 0;
      const loseShift = hasSingle ? Math.round(-b.single / quantum) : 0;
      const isLeg = parlayActive && parlay.legs.includes(b.key);
      const next = [new Float64Array(G), parlayActive ? new Float64Array(G) : null];
      for (let t = 0; t < tracks; t++) {
        const from = cur[t];
        for (let i = 0; i < G; i++) {
          const m = from[i];
          if (m === 0) continue;
          // Winning never kills the parlay; losing a leg does, for good.
          next[t][clamp(i + winShift)] += m * b.p;
          next[isLeg ? DEAD : t][clamp(i + loseShift)] += m * (1 - b.p);
        }
      }
      cur = next;
    }

    // Settle the parlay and fold the tracks back together.
    const final = new Float64Array(G);
    if (parlayActive) {
      const hit = Math.round((parlay.stake * (combo.o - 1)) / quantum);
      const miss = Math.round(-parlay.stake / quantum);
      for (let i = 0; i < G; i++) {
        if (cur[ALIVE][i]) final[clamp(i + hit)] += cur[ALIVE][i];
        if (cur[DEAD][i]) final[clamp(i + miss)] += cur[DEAD][i];
      }
    } else {
      final.set(cur[ALIVE]);
    }

    // Percentiles of the actual P&L, which is a different question from the
    // extremes. On a 40-match spread the extremes are -100% and +47% of stake
    // and BOTH are essentially impossible: every match losing has a
    // probability with twenty zeros after the point. Plotting between them
    // left over half the chart empty and made "if nothing does" read as the
    // downside a reader should plan around, when the honest bad day is an
    // order of magnitude smaller.
    let cum = 0;
    const q = (target) => {
      let c = 0;
      for (let i = 0; i < G; i++) {
        c += final[i];
        // Clamped to the true extremes: the top grid point can sit up to one
        // quantum above `best`, and a chart that claims an outcome better
        // than any that can actually happen is worse than a coarse one.
        if (c >= target) return Math.min(Math.max(worst + i * quantum, worst), best);
      }
      return best;
    };
    for (let i = 0; i < G; i++) cum += final[i];
    const pctl = { p05: q(0.05 * cum), p50: q(0.5 * cum), p95: q(0.95 * cum) };

    // Plot across where the outcomes actually are, not across what is merely
    // conceivable. Clipped at the 1st/99th percentile, widened to always
    // include break-even so the zero line stays on the chart.
    let lo = Math.min(q(0.01 * cum), 0);
    let hi = Math.max(q(0.99 * cum), 0);
    if (!(hi > lo)) { lo = worst; hi = best; }
    const plotSpan = hi - lo;

    const bins = new Array(BINS).fill(0);
    let pPos = 0;
    for (let i = 0; i < G; i++) {
      const m = final[i];
      if (m === 0) continue;
      const pl = worst + i * quantum;
      if (pl > 1e-9) pPos += m;
      // Mass outside the clip is real, so it is folded into the end bins
      // rather than dropped: the bars still sum to 1.
      let bi = Math.floor(((pl - lo) / plotSpan) * BINS);
      if (bi >= BINS) bi = BINS - 1;
      if (bi < 0) bi = 0;
      bins[bi] += m;
    }
    pProfit = pPos;
    pcts = pctl;
    dist = {
      lo,
      hi,
      clipped: lo > worst + 1e-9 || hi < best - 1e-9,
      bins: bins.map((prob, i) => ({ prob, win: lo + (plotSpan * (i + 0.5)) / BINS > 1e-9 })),
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
    // The realistic spread of outcomes. `worst`/`best` stay available for the
    // fine print, but they are the extremes, not the forecast.
    pcts,
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
 * The most edge this app will SIZE a bet on, however much it thinks it sees.
 *
 * The reliability haircut above is uniform: it shrinks every probability by
 * the same lambda, which is right for a model that is a little overconfident
 * everywhere. It is the wrong shape for what the record actually shows.
 * Graded, priced calls, bucketed by the edge we claimed at lock time:
 *
 *     claimed edge    n     we said    it did      gap     flat ROI
 *      0 to  5%      27      73.6%      74.1%    +0.5pt      +2.3%
 *      5 to 10%      15      72.6%      73.3%    +0.7pt      +6.7%
 *     10 to 20%      18      76.0%      66.7%    -9.4pt      +4.7%
 *     20%+           13      66.9%      46.2%   -20.8pt     -10.5%
 *
 * Small edges are honest and profitable. Large ones are mostly estimation
 * error: at 20%+ the model claims 67% and delivers 46%, which does not even
 * clear the 50% those prices need. And because Kelly sizing scales with edge,
 * the biggest stakes land on exactly the least reliable estimates - ranking
 * by estimated edge preferentially selects the estimation errors.
 *
 * The cap says: act on at most this much edge. A bet we rate at +32% is
 * staked as if it were +12%, which is what a real mispricing of that size
 * would more likely be. This is deliberately a PRIOR, not a curve fitted to
 * those four rows - n is 13 in the bucket that matters most, far too few to
 * fit anything. An edge above roughly a tenth against a liquid market is rare
 * enough that our own arithmetic is the likelier explanation.
 *
 * Applied as a probability, not as a stake multiplier, so one number flows
 * through sizing, expected value, the median and the risk read alike. The
 * model's raw probability is untouched everywhere it is a PREDICTION - the
 * match pages, the Edge board, every accuracy claim. This is only about money.
 */
export const EDGE_CAP = 0.12;

export const cappedProb = (p, o, { lambda = 1, edgeCap = EDGE_CAP } = {}) => {
  const adj = adjustProb(p, lambda);
  if (!(o > 1) || !(edgeCap >= 0)) return adj;
  // p * o - 1 <= cap  =>  p <= (1 + cap) / o
  return Math.min(adj, (1 + edgeCap) / o);
};

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
export function spreadPlan(bets, budget, { lambda = 1, edgeCap = EDGE_CAP } = {}) {
  const adj = (bets || [])
    .map((b) => ({ ...b, pStated: b.p, p: cappedProb(b.p, b.o, { lambda, edgeCap }) }))
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
/**
 * Which plan to put on screen by default.
 *
 * This used to be decided by `useState('safest')` in the component, and no
 * plan has ever had the id 'safest' - the ids are spread/spreadPlus/sharp. The
 * lookup missed every time and fell through to plans[0], so the headline
 * "RECOMMENDED PLAN" was really just whichever plan got pushed first. On a
 * full card that meant recommending the spread at 75.6% and $7.24 while
 * "Best prices only" sat beside it at 90.1% and $17.71: better on BOTH axes
 * and not recommended.
 *
 * A plan that is beaten on chance-of-finishing-ahead AND on expected profit is
 * beaten outright, so it is never the answer. Among what survives, lead with
 * the highest chance of finishing ahead: the page's own framing is that this
 * is the number people misjudge most, and the alternatives stay one click away
 * for anyone who would rather have the expectation.
 */
export function recommendedPlanId(plans) {
  if (!plans || !plans.length) return null;
  const val = (p) => ({ w: p.metrics?.pProfit ?? -1, e: p.metrics?.ev ?? -Infinity });
  const dominated = (p) => plans.some((q) => {
    if (q === p) return false;
    const a = val(p), b = val(q);
    return b.w >= a.w && b.e >= a.e && (b.w > a.w + 1e-9 || b.e > a.e + 1e-9);
  });
  const live = plans.filter((p) => !dominated(p));
  const pool = live.length ? live : plans;
  return pool.reduce((best, p) => {
    const a = val(best), b = val(p);
    if (b.w > a.w + 1e-9) return p;
    if (b.w < a.w - 1e-9) return best;
    return b.e > a.e ? p : best;
  }, pool[0]).id;
}

/**
 * Expected log growth of a bankroll over one day of this slip.
 *
 * This is Kelly's own objective, and it is the one number that says "earn
 * more" and "risk less" at the same time rather than trading them off by
 * taste. Doubling money is worth exactly as much as halving it is costly, so
 * a plan that wins big on 49% of days and bleeds on 51% scores badly however
 * flattering its average, and a plan that stakes the whole budget to chase a
 * marginal edge scores worse than the same plan sized down.
 *
 * Undefined (and returned as -Infinity) if any outcome can take more than the
 * bankroll: log of zero or less. That is the correct answer, not an edge case
 * to paper over.
 *
 * Read off analyzeSlip's `dist`, which is clipped at the 1st and 99th
 * percentiles for drawing. The extreme tails are therefore approximated, so
 * this slightly UNDERSTATES the pain of a catastrophic day. It does not
 * matter for what this scores - the recommendation caps any one bet at a
 * tenth of the budget and holds a 5th-percentile day inside 15% of it, so the
 * clipped region carries no plan the search would consider - but a future
 * caller sizing anything near the whole bankroll should know it is there.
 *
 * @param {object} dist analyzeSlip().dist
 * @param {number} bankroll the money the stakes are drawn from
 */
export function expectedLogGrowth(dist, bankroll) {
  if (!dist || !dist.bins || !dist.bins.length || !(bankroll > 0)) return -Infinity;
  const { lo, hi, bins } = dist;
  const span = hi - lo;
  let g = 0, total = 0;
  for (let i = 0; i < bins.length; i++) {
    const pr = bins[i].prob;
    if (!(pr > 0)) continue;
    const pl = lo + (span * (i + 0.5)) / bins.length;
    const end = bankroll + pl;
    if (end <= 0) return -Infinity;
    g += pr * Math.log(end / bankroll);
    total += pr;
  }
  return total > 0 ? g / total : -Infinity;
}

/**
 * THE RECOMMENDED PLAN.
 *
 * Built by search rather than by policy, against two requirements stated in
 * the order they matter:
 *
 *   1. A TYPICAL DAY MUST FINISH UP. The median outcome has to be positive.
 *      This is a hard gate, not a term in a score. Expected value is an
 *      average over many days and a right-skewed plan can carry a healthy one
 *      while losing on most individual days: the old recommendation did
 *      exactly that, +$4.53 expected on a day whose middle outcome was
 *      -$5.56, because it funded two bets and needed both to land. Somebody
 *      following a plan every morning experiences the median, not the mean.
 *
 *   2. AMONG THOSE, MAXIMISE EXPECTED LOG GROWTH. Kelly's criterion, which
 *      rewards return and punishes variance in one number, so "earn more" and
 *      "risk less" stop being a trade-off someone has to weigh by eye.
 *
 * Everything else falls out of those two rather than being imposed:
 *
 *   - It does not spend the budget. Log growth turns down past the
 *     growth-optimal fraction, so the search settles below it on its own and
 *     the remainder stays in the pocket.
 *   - It may not carry a parlay. No parlay is always one of the candidates,
 *     and a parlay only survives when it improves the score of the whole plan
 *     rather than being sized in isolation and bolted on.
 *   - It may back one match, or ten, or none at all. When no candidate clears
 *     the median gate the function returns null and the page says so, which
 *     is the honest answer on a card where every plan loses more days than it
 *     wins.
 *
 * @param {{key:string,p:number,o:number}[]} bets reliability-adjusted already
 * @param {number} budget the money set aside, which is also the bankroll
 */
// Two ceilings on any one bet, and the tighter of them wins.
//
// TEN PERCENT of budget on any one match, so a single match can never be the
// plan. The search maximises growth, and growth alone will happily pile
// everything onto the best price it can see: with this cap the only way to
// put real money to work is to spread it, which is where the risk half of
// "earn more, risk less" starts.
const REC_BET_CAP = 0.10;
const REC_PARLAY_CAP = 0.05;   // a parlay is correlated with its own legs
const REC_MIN_STAKE = 0.005;   // of budget: below this a bet is noise, not a bet
// THE BAD DAY CEILING. A day at the 5th percentile - one in twenty - may not
// cost more than this share of the budget.
//
// Expected log growth on its own will happily commit most of the budget once
// it has enough independent +EV bets to work with: on a nine-bet card it
// staked $88 of $100, which is growth-optimal if our probabilities are exactly
// right and reckless if they are a little hot. Half Kelly already hedges the
// size of each bet; this bounds what the whole day can do, which is the thing
// a person actually feels. Stated as a constraint rather than folded into the
// score because "how much can I lose on a bad day" deserves a real answer, not
// a weight in an objective nobody can inspect.
const REC_MAX_BAD_DAY = 0.15;
// TOTAL exposure to try, as a share of the budget. Deliberately a grid over
// the TOTAL rather than a multiplier applied to each bet: sizing every bet at
// its own Kelly fraction makes a four-bet plan stake four times what a
// one-bet plan does, so the search was really choosing between "concentrated
// at a sane size" and "diversified and over-staked", and it picked the former
// on nine days in ten. Spreading a FIXED total across more independent +EV
// bets raises expected growth outright, and the search can only find that if
// the two choices are separable.
// Kelly multiples to try. Each bet is sized at its OWN Kelly fraction times
// this, INDEPENDENTLY of the others, and the total is whatever that adds up
// to. That independence is the whole trick and it took two wrong versions to
// find: spreading a fixed TOTAL across more bets means every extra bet is
// funded by taking money off the best one, so widening always looked like a
// loss and the search concentrated on a single match nine days in ten. Sized
// independently, each extra +EV bet adds growth on its own account, and
// expected log growth over the JOINT distribution is what stops that running
// away - it already accounts for several bets competing for one bankroll, so
// it turns down on its own once the day is over-committed.
// Topping out at HALF Kelly, never full. Full Kelly is only growth-optimal if
// the probability is exactly right, and ours is a model output with a standard
// error; betting it on a mis-estimated edge is how a positive-edge bettor goes
// broke. Half gives up about a quarter of the growth for a far smaller
// drawdown, and the search usually settles well below even that.
const REC_SCALES = [0.04, 0.07, 0.1, 0.14, 0.18, 0.24, 0.3, 0.38, 0.5];
// How many of the best-priced bets to include.
const REC_WIDTHS = [1, 2, 3, 4, 5, 6, 8, 10, 14, 20];

export function recommendedPlan(bets, budget, { lambda = 1, maxSearch = 12, edgeCap = EDGE_CAP } = {}) {
  const B = Number(budget) || 0;
  if (!(B > 0)) return null;
  const adj = (bets || []).map((b) => ({ ...b, pStated: b.p, p: cappedProb(b.p, b.o, { lambda, edgeCap }) }));
  const priced = adj.filter((b) => b.o > 1 && b.p > 0);

  // Only bets that beat their own price can carry a plan whose typical day is
  // up: a -EV leg lowers both the median and the growth rate at every size.
  const pool = priced
    .map((b) => ({ ...b, f: kellyFraction(b.p, b.o) }))
    .filter((b) => b.f > 0)
    .sort((a, b) => b.f - a.f);
  if (!pool.length) return null;

  const combos = parlayCandidates(pool, 4, maxSearch);
  const byN = new Map();
  for (const c of combos) if (!byN.has(c.n) || c.f > byN.get(c.n).f) byN.set(c.n, c);
  const comboChoices = [...byN.values()].sort((a, b) => a.n - b.n).slice(0, 3);

  // One candidate: spread `exposure` of the budget across the best `width`
  // bets in proportion to their Kelly fractions, handing `share` of that to a
  // parlay. Null when the shape is not worth pricing.
  const build = (width, scale, combo) => {
    const take = pool.slice(0, Math.min(width, pool.length));
    const singles = {};
    let spent = 0;
    for (const b of take) {
      const stake = Math.min(B * REC_BET_CAP, B * scale * b.f);
      if (stake >= B * REC_MIN_STAKE) { singles[b.key] = stake; spent += stake; }
    }
    if (!Object.keys(singles).length) return null;
    // The parlay is sized the same way and out of what is left, so it can
    // never push the day past the budget just because it looked good alone.
    const parStake = combo
      ? Math.min(B * REC_PARLAY_CAP, B * scale * combo.f, Math.max(0, B - spent))
      : 0;
    if (combo && parStake < B * REC_MIN_STAKE) return null;
    if (spent + parStake > B + 1e-9) return null;
    // Only the bets that carry money. A zero-stake leg contributes nothing to
    // the P&L distribution but still costs a convolution pass, and the search
    // prices a hundred candidates against a card that can hold forty matches:
    // on a 28-match card this alone took the search from 468ms to well under
    // a hundred. Parlay legs are kept whatever their single, since the parlay
    // stake rides on them.
    const parLegs = combo ? combo.legs : [];
    const staked = adj
      .filter((b) => (singles[b.key] || 0) > 0 || parLegs.includes(b.key))
      .map((b) => ({ ...b, single: singles[b.key] || 0 }));
    const metrics = analyzeSlip(staked, { stake: parStake, legs: parLegs });
    if (!(metrics.ev > 0)) return null;
    const score = expectedLogGrowth(metrics.dist, B);
    if (!Number.isFinite(score)) return null;
    // One in twenty days is worse than p05. That is the day this plan has to
    // survive, so it is a constraint and not a footnote.
    const badDay = metrics.pcts ? metrics.pcts.p05 : metrics.worst;
    if (badDay < -B * REC_MAX_BAD_DAY) return null;
    return {
      singles, combo: parStake > 0 ? combo : null, parStake, metrics, score,
      width: Object.keys(singles).length,
      typicalUp: !!(metrics.pcts && metrics.pcts.p50 > 0),
    };
  };

  // Every candidate the search prices, so the choice can be made in one pass
  // over all of them instead of depending on the order they were walked.
  const seen = [];
  const consider = (w, sc, c) => {
    const cand = build(w, sc, c);
    if (cand) seen.push(cand);
    return cand;
  };

  // Width x size, without a parlay. Priced in full rather than by coordinate
  // descent: descent was path-dependent and it showed - on a card carrying
  // both tours it locked onto a parlay early and returned a plan whose
  // typical day made 23 cents, while the same search restricted to ATP alone
  // found $4.94. More to choose from must never produce a worse answer, and
  // with a coordinate walk it could. The full sweep is ~90 convolutions and
  // costs about 60ms, which is affordable for something that re-runs on a
  // filter change rather than on a keystroke.
  const widths = REC_WIDTHS.filter((w, i) => w <= pool.length || REC_WIDTHS[i - 1] < pool.length);
  for (const w of widths) for (const sc of REC_SCALES) consider(w, sc, null);

  // Then the parlays, at the widths that proved themselves without one.
  const bare = [...seen].sort((a, b) => b.score - a.score).slice(0, 3);
  const goodWidths = [...new Set(bare.map((c) => c.width))];
  for (const c of comboChoices) {
    for (const w of goodWidths.length ? goodWidths : [widths[0]]) {
      for (const sc of REC_SCALES) consider(w, sc, c);
    }
  }
  if (!seen.length) return null;

  // THE CHOICE, in one pass.
  //
  //   1. A typical day that finishes up, if any candidate manages it. Hard
  //      gate: expected value is an average over many days and a right-skewed
  //      plan can carry a healthy one while losing on most individual days.
  //      Somebody following a plan every morning lives the median.
  //   2. Among those, best expected log growth - Kelly's own measure, which
  //      rewards return and punishes swings in one number.
  //   3. Among plans all but level on growth, the better typical day. A floor
  //      of "greater than zero" let a plan through on a thin card whose middle
  //      day made 27 cents while a near-identical one made several dollars,
  //      and within a few percent of the same growth rate the score is not
  //      really discriminating between them.
  const GROWTH_TOLERANCE = 0.92;
  const up = seen.filter((c) => c.typicalUp);
  const field = up.length ? up : seen;
  const topScore = field.reduce((m, c) => Math.max(m, c.score), -Infinity);
  const median = (c) => (c.metrics.pcts ? c.metrics.pcts.p50 : 0);
  const near = field.filter((c) => c.score >= topScore * (topScore > 0 ? GROWTH_TOLERANCE : 1 / GROWTH_TOLERANCE));
  const best = near.reduce((b, c) => (median(c) > median(b) ? c : b), near[0]);

  return {
    singles: best.singles,
    combo: best.combo,
    parlayStake: best.parStake,
    parlayLegs: best.combo ? best.combo.legs : [],
    metrics: best.metrics,
    growth: best.score,
    typicalUp: best.typicalUp,
  };
}

export function planFrontier(bets, budget, { lambda = 1, maxParlayLegs = 6, maxSearch = 12, edgeCap = EDGE_CAP } = {}) {
  const adj = (bets || []).map((b) => ({ ...b, pStated: b.p, p: cappedProb(b.p, b.o, { lambda, edgeCap }) }));
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
  const spread = spreadPlan(bets, B, { lambda, edgeCap });
  const combos = parlayCandidates(priced, maxParlayLegs, maxSearch);

  // How many legs the parlay should have is decided by the PLAN it lands in,
  // not by the parlay on its own.
  //
  // This used to be `combos.reduce(max f)`: the candidate with the largest
  // Kelly fraction, scored in isolation. Because a parlay's odds compound
  // faster than its edge, Kelly shrinks with every leg added, so that rule
  // returned a 2-leg parlay essentially always - and it never once looked at
  // what the plan's chance of finishing ahead or expected profit actually did.
  // It agreed with the plan-level rule by coincidence rather than by
  // construction, and on a different card it would not have.
  //
  // Scoring all of them is not an option - a full card generates ~2,500
  // candidates and each costs a convolution over the whole slip - so the
  // shortlist is the best-sized candidate at each leg count, which is where
  // the real trade-off lives (2 legs buys chance, 5 buys expectation).
  const shortlist = (() => {
    const byN = new Map();
    for (const c of combos) {
      const cur = byN.get(c.n);
      if (!cur || c.f > cur.f) byN.set(c.n, c);
    }
    return [...byN.values()].sort((a, b) => a.n - b.n);
  })();

  // Build the plan for each shortlisted parlay and choose between them on the
  // same both-axes rule the plan menu uses, so "which parlay" and "which plan"
  // are finally answered by the same question.
  const pickByPlan = (build) => {
    const scored = [];
    for (const c of shortlist) {
      const plan = build(c);
      if (plan) scored.push({ combo: c, plan });
    }
    if (!scored.length) return null;
    const winner = recommendedPlanId(scored.map((s, i) => ({ id: i, metrics: s.plan.metrics })));
    return scored[winner] || scored[0];
  };

  // ── The edge plan: what a daily follower should actually do ──────────────
  // Quarter-Kelly on the calls that beat their price, each bet capped at 20%
  // of budget, plus at most one 2-leg parlay of +EV legs capped at 10% -
  // and NOTHING else. It routinely stakes less than the budget; "keep the
  // rest for tomorrow" is part of the recommendation, not a failure to
  // allocate.
  //
  // Chosen by tournament, not taste (expPlanPolicies.js, walk-forward
  // reliability, settled at the recorded odds). The live figures it produces
  // are written to src/data/planBacktest.json and quoted from there, so the
  // page and this comment cannot drift apart the way they did when the
  // numbers were transcribed by hand. As of the 2026-08-23 run - the first
  // on a calls-only universe, after no-calls stopped being staked - this
  // sizing returned +17.1% on money staked over 78 staked days, worst day
  // -$28, $55 max drawdown per $100 budget, against +6.2% and a $130
  // drawdown for the flat spread. Fractions above a quarter staked more for
  // less. Excluding the no-calls cost about 2.4 points of backtested ROI and
  // was taken anyway: staking a match the record refuses to claim made the
  // product say two different things about the same match.
  const EDGE_FRACTION = 0.25;   // of budget, per Kelly unit
  const EDGE_BET_CAP = 0.20;    // of budget, per single
  const EDGE_PARLAY_CAP = 0.10; // of budget
  // The smallest stake worth printing, as a SHARE of the budget rather than
  // a flat dollar amount. Every other quantity here is a fraction of B, so a
  // flat floor was the one scale-dependent term in a scale-free policy - and
  // it silently changed which bets the plan contained as the budget moved.
  // On a two-bet card sized at 4.6% and 3.3% of budget, a $0.50 floor funded
  // nothing under $11, one bet from $11 to $15, and both from $16 up. The
  // recommendation therefore inverted across a $1 change: at $10 it staked
  // the whole budget, at $11 it staked fifty cents and pocketed the rest,
  // for an expected profit fifteen times smaller on MORE money. A larger
  // budget can always replicate a smaller plan and hold the difference, so
  // that direction is never correct.
  //
  // 0.5% of budget reproduces the old $0.50 exactly at the $100 default, so
  // the shipped plan and every backtest number above are unchanged.
  //
  // Purely proportional, with no absolute floor alongside it. Any absolute
  // term reintroduces the same fault in miniature - it was still reshuffling
  // the plan between $2 and $4 - and it also makes plan EXISTENCE depend on
  // budget. With a pure fraction, a bet is funded exactly when its Kelly
  // fraction clears 2%, which is a property of the bet and not of the wallet:
  // the plan a follower is shown has the same shape at every budget, and
  // scaling the budget scales the stakes and the expected profit with it.
  // Whether the resulting stakes clear a particular book's minimum is a
  // question about that book, not about which bets are worth making.
  const EDGE_MIN_STAKE = B * 0.005;
  const edgePlan = (() => {
    if (!(B > 0)) return null;
    const singles = {};
    for (const b of priced) {
      const f = kellyFraction(b.p, b.o);
      if (!(f > 0)) continue;
      const stake = Math.min(B * EDGE_BET_CAP, B * EDGE_FRACTION * f);
      if (stake >= EDGE_MIN_STAKE) singles[b.key] = stake;
    }
    // One 2-leg parlay from the best-edge +EV legs, only when the pair is
    // itself +EV - same construction the backtest scored.
    const pos = priced.filter((b) => kellyFraction(b.p, b.o) > 0)
      .sort((a, b2) => (b2.p * b2.o) - (a.p * a.o)).slice(0, 4);
    let combo = null;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const cp = pos[i].p * pos[j].p, co = pos[i].o * pos[j].o;
        const f = kellyFraction(cp, co);
        if (f > 0 && (!combo || f > combo.f)) combo = { legs: [pos[i].key, pos[j].key], p: cp, o: co, f, edge: cp * co - 1, n: 2 };
      }
    }
    const spent = Object.values(singles).reduce((t, v) => t + v, 0);
    const parStake = combo ? Math.min(B * EDGE_PARLAY_CAP, B * EDGE_FRACTION * combo.f, Math.max(0, B - spent)) : 0;
    if (!Object.keys(singles).length && !(parStake >= EDGE_MIN_STAKE)) return null;
    return shape(singles, combo, parStake >= EDGE_MIN_STAKE ? parStake : 0);
  })();

  const plans = [];

  // The recommendation, built by search against a positive typical day and
  // best expected growth. It leads the menu because it is the answer; the
  // policy plans below it stay on offer for anyone who wants a different
  // trade, and the page shows every one of them the same numbers.
  const best = recommendedPlan(bets, B, { lambda, maxSearch, edgeCap });
  if (best) {
    plans.push({
      id: 'best',
      label: best.typicalUp ? 'Up on a typical day' : 'Best of a bad card',
      ...shape(best.singles, best.combo, best.parlayStake),
      growth: best.growth,
      typicalUp: best.typicalUp,
    });
  }

  if (edgePlan) {
    plans.push({ id: 'edge', label: 'Follow the edge', ...edgePlan });
  }
  if (spread.count >= 2 && spread.coversStake) {
    plans.push({ id: 'spread', label: 'Back every call', ...spread, expReturn: spread.expReturn });
  }

  // Same spread with a slice moved onto the best combination, sized by Kelly
  // against the singles so the split follows edge rather than a round number.
  if (shortlist.length && spread.count >= 2 && spread.coversStake && B > 0) {
    const chosen = priced.filter((b) => spread.legs.includes(b.key));
    const fSingles = chosen.reduce((t, b) => t + kellyFraction(b.p, b.o), 0);
    const picked = pickByPlan((combo) => {
      const total = fSingles + combo.f;
      if (!(total > 0)) return null;
      const perMatch = (B * (fSingles / total)) / chosen.length;
      const singles = {};
      for (const b of chosen) singles[b.key] = perMatch;
      return shape(singles, combo, B * (combo.f / total));
    });
    if (picked) {
      plans.push({ id: 'spreadPlus', label: 'Spread plus a parlay', ...picked.plan });
    }
  }

  // The tilted alternative: still every match on the card, but the money
  // follows the prices instead of sitting flat.
  //
  // This used to fund ONLY matches whose own price beat them, which on a full
  // card meant backing 27 of 40 and leaving 13 with nothing. The plan-level
  // test this page is built on says the spread has to cover itself ON THE
  // AVERAGE - that a match priced against us can be carried by stronger ones -
  // and dropping those matches quietly abandons that premise the moment the
  // recommendation is taken literally.
  //
  // So half the budget is spread evenly across everything priced, and half
  // follows Kelly. Nothing is dropped, the best prices still get the most, and
  // a match with negative edge gets the base share rather than zero.
  const HALF = 0.5;
  // One priced match is still a card: no spread is possible, but "back it" is
  // the only sensible plan and the menu must not come back empty.
  if (priced.length >= 1 && B > 0) {
    const fs = priced.map((b) => ({ key: b.key, f: kellyFraction(b.p, b.o) }));
    const fTotal = fs.reduce((t, i) => t + i.f, 0);
    // The parlay is funded out of the edge-following half only, so adding one
    // never dilutes the base share that guarantees nobody is dropped.
    const edgePool = B * HALF;
    const basePool = B * (1 - HALF);
    const build = (combo) => {
      const denom = fTotal + (combo ? combo.f : 0);
      if (!(denom > 0)) return null;
      const singles = {};
      for (const i of fs) singles[i.key] = basePool / priced.length + (edgePool * i.f) / denom;
      return shape(singles, combo, combo ? (edgePool * combo.f) / denom : 0);
    };
    // Same question as the plan menu asks, one level down: which parlay leaves
    // THIS plan best off. Falls back to no parlay at all when none helps.
    const pickedSharp = pickByPlan(build);
    const sharp = pickedSharp ? pickedSharp.plan : build(null);
    if (sharp) {
      const singles = sharp.singles;
      // Only worth a slot if it differs from a spread that is ACTUALLY on the
      // menu. Comparing against a spread that was never offered (a one- or
      // two-match card) suppressed the only plan there was and left the page
      // with nothing to show.
      const offeredSpread = plans.find((p) => p.id === 'spread');
      const sameAsSpread = !!offeredSpread
        && sharp.funded === offeredSpread.funded
        && offeredSpread.legs.every((k) => (singles[k] || 0) > 0)
        && !sharp.parlayStake;
      // It has to clear the same bar as the spread. While this plan funded
      // only +EV picks its expected return could not fall short, so nothing
      // checked; now that it carries the negative-edge matches too, the page's
      // claim that "every plan here passes" the cover test has to be earned
      // rather than assumed.
      if (!sameAsSpread && sharp.expReturn >= sharp.metrics.staked - 1e-9) {
        plans.push({ id: 'sharp', label: 'Whole card, weighted', ...sharp });
      }
    }
  }

  if (plans.length) {
    // The recommendation used to be pinned to the edge policy unconditionally,
    // on the reasoning that a daily follower needs one consistent answer and
    // that policy won the walk-forward tournament. It does win on return per
    // dollar risked. What it does not do is finish up on a typical day: on a
    // thin card it funds two bets, needs both, and its middle outcome is a
    // loss. Consistency is worth less than that.
    //
    // `best` is now built to clear that bar directly (recommendedPlan above),
    // so it leads when it exists. The old chance-first rule stays as the
    // tiebreak for a card where the search comes back empty.
    const recommendedId = plans.some((p) => p.id === 'best') ? 'best' : recommendedPlanId(plans);
    return { plans, lambda, reason: null, recommendedId };
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
