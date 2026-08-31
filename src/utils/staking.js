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
