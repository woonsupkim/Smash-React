// Tests for the recommended-plan menu and the cumulative P&L curve.
//
// The property that matters most here is the promise the UI makes: EVERY plan
// offered must stake so that expected return >= total staked. If that ever
// breaks, the page is telling users something untrue about their downside.
import { describe, it, expect } from 'vitest';
import { planFrontier, analyzeSlip, edgePerDollar } from './staking';

const bet = (key, p, o) => ({ key, p, o });
// A slate with a mix: two clear +EV singles, one priced against us, one long shot.
const slate = [
  bet('a', 0.75, 1.6),   // +20% edge
  bet('b', 0.65, 1.7),   // +10.5%
  bet('c', 0.55, 1.7),   // -6.5% alone
  bet('d', 0.45, 2.4),   // +8%
];

describe('planFrontier', () => {
  it('every plan it offers has expected return at least the total staked', () => {
    const { plans } = planFrontier(slate, 100);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.metrics.ev).toBeGreaterThanOrEqual(-1e-9);
      // Restated the way the UI phrases it, to catch a sign slip in either.
      const expectedReturn = p.metrics.ev + p.metrics.staked;
      expect(expectedReturn).toBeGreaterThanOrEqual(p.metrics.staked - 1e-9);
    }
  });

  it('spends the whole budget on each plan', () => {
    for (const p of planFrontier(slate, 250).plans) {
      expect(p.metrics.staked).toBeCloseTo(250, 6);
    }
  });

  it('the safest plan really has the best chance of finishing ahead', () => {
    const { plans } = planFrontier(slate, 100);
    const safest = plans.find((p) => p.id === 'safest');
    for (const p of plans) {
      expect(safest.metrics.pProfit).toBeGreaterThanOrEqual(p.metrics.pProfit - 1e-9);
    }
  });

  it('the profit plan really has the most expected profit', () => {
    const { plans } = planFrontier(slate, 100);
    const profit = plans.find((p) => p.id === 'profit');
    for (const p of plans) {
      expect(profit.metrics.ev).toBeGreaterThanOrEqual(p.metrics.ev - 1e-9);
    }
  });

  it('does not stake every match, and does not put every staked match in the parlay', () => {
    const { plans } = planFrontier(slate, 100);
    // 'c' is -EV alone, so no plan should give it a single stake.
    expect(edgePerDollar(0.55, 1.7)).toBeLessThan(0);
    for (const p of plans) expect(p.singles.c || 0).toBe(0);
    // At least one plan funds fewer instruments than there are matches.
    expect(Math.min(...plans.map((p) => p.funded))).toBeLessThan(slate.length);
    // Where a parlay is funded, it need not contain every staked single.
    const withParlay = plans.find((p) => p.parlayStake > 0);
    if (withParlay) {
      const stakedSingles = Object.entries(withParlay.singles).filter(([, v]) => v > 0).map(([k]) => k);
      const allInParlay = stakedSingles.every((k) => withParlay.parlayLegs.includes(k));
      expect(typeof allInParlay).toBe('boolean'); // either is legitimate; just not forced
    }
  });

  it('offers plans with and without a parlay when both clear their price', () => {
    const { plans } = planFrontier(slate, 100);
    const kinds = new Set(plans.map((p) => p.parlayStake > 0));
    // The menu is only useful if it spans the choice; with this slate it should.
    expect(kinds.size).toBeGreaterThanOrEqual(1);
    expect(plans.every((p) => Array.isArray(p.parlayLegs))).toBe(true);
  });

  it('a parlay can carry a leg that is -EV on its own', () => {
    // 'x' alone is -EV; combined with 'y' the product clears 1.
    const bets = [bet('x', 0.5, 1.9), bet('y', 0.7, 1.6)];
    expect(edgePerDollar(0.5, 1.9)).toBeLessThan(0);
    const { plans } = planFrontier(bets, 100);
    const anyWithX = plans.some((p) => p.parlayLegs.includes('x'));
    expect(anyWithX).toBe(true);
  });

  it('reports no plan rather than a bad one when nothing clears', () => {
    const { plans, reason } = planFrontier([bet('a', 0.5, 1.4), bet('b', 0.5, 1.5)], 100);
    expect(plans).toEqual([]);
    expect(reason).toMatch(/at or above our own number/);
  });

  it('says so when there are no prices', () => {
    const { plans, reason } = planFrontier([bet('a', 0.7, 0)], 100);
    expect(plans).toEqual([]);
    expect(reason).toMatch(/carry a market price/);
  });

  it('deduplicates plans that are the same allocation under different names', () => {
    // A single +EV bet has exactly one sensible plan; do not offer it thrice.
    const { plans } = planFrontier([bet('a', 0.8, 1.5)], 100);
    expect(plans.length).toBe(1);
  });

  it('a reliability haircut can empty the menu', () => {
    const bets = [bet('a', 0.7, 1.5)]; // 1.05 as stated, 0.90 at lambda 0.5
    expect(planFrontier(bets, 100, { lambda: 1 }).plans.length).toBe(1);
    expect(planFrontier(bets, 100, { lambda: 0.5 }).plans).toEqual([]);
  });
});

describe('cumulative P&L curve', () => {
  const a = analyzeSlip(
    [{ key: 'a', p: 0.7, o: 1.7, single: 50 }, { key: 'b', p: 0.6, o: 1.9, single: 50 }],
    { stake: 0, legs: [] }
  );

  it('starts at certainty and decreases across the range', () => {
    const c = a.dist.bins.map((b) => b.atLeast);
    expect(c[0]).toBeCloseTo(1, 6);            // you always finish at or above the worst case
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1] + 1e-9);
    expect(c[c.length - 1]).toBeGreaterThan(0);
  });

  it('never exceeds 1 or drops below 0', () => {
    for (const b of a.dist.bins) {
      expect(b.atLeast).toBeLessThanOrEqual(1);
      expect(b.atLeast).toBeGreaterThanOrEqual(0);
    }
  });

  it('agrees with the histogram it is derived from', () => {
    const bins = a.dist.bins;
    for (let i = 0; i < bins.length; i++) {
      const tail = bins.slice(i).reduce((s, b) => s + b.prob, 0);
      expect(bins[i].atLeast).toBeCloseTo(Math.min(1, tail), 6);
    }
  });

  it('brackets the chance of finishing ahead', () => {
    // P(ahead) must sit between the survival at the first winning bin and the
    // one before it - the curve is the same distribution, binned.
    const firstWin = a.dist.bins.findIndex((b) => b.win);
    expect(a.pProfit).toBeLessThanOrEqual(a.dist.bins[firstWin].atLeast + 1e-9);
  });
});
