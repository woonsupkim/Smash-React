// Tests for the recommended-plan menu and the cumulative P&L curve.
//
// The menu's contract, in order of importance:
//   1. every plan staked so its expected return covers the total staked
//   2. the SPREAD leads - breadth across the card is the point, and a lone
//      single is not advice (it is obvious it has the best win chance)
//   3. selection happens at the plan level, so a short-priced match can be
//      carried by stronger ones rather than filtered out on its own merits
//
// The worked example that defines the spread lives in spreadPlan.test.js.
import { describe, it, expect } from 'vitest';
import { planFrontier, edgePerDollar } from './staking';

const bet = (key, p, o) => ({ key, p, o });
const slate = [
  bet('a', 0.75, 1.6),   // +20% on its own
  bet('b', 0.65, 1.7),   // +10.5%
  bet('c', 0.55, 1.7),   // -6.5% on its own
  bet('d', 0.45, 2.4),   // +8%
];

describe('planFrontier', () => {
  it('every plan it offers has expected return at least the total staked', () => {
    const { plans } = planFrontier(slate, 100);
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      expect(p.metrics.ev).toBeGreaterThanOrEqual(-1e-9);
      expect(p.metrics.ev + p.metrics.staked).toBeGreaterThanOrEqual(p.metrics.staked - 1e-9);
    }
  });

  it('spends the whole budget on each plan', () => {
    for (const p of planFrontier(slate, 250).plans) {
      expect(p.metrics.staked).toBeCloseTo(250, 6);
    }
  });

  it('leads with the spread, and the spread is never a lone bet', () => {
    const { plans } = planFrontier(slate, 100);
    expect(plans[0].id).toBe('spread');
    expect(plans[0].funded).toBeGreaterThan(1);
  });

  it('carries a match that is -EV on its own when the portfolio still covers', () => {
    // 'c' would be dropped by any per-match filter. The spread keeps it as
    // long as the average still returns the stake - that is the plan-level
    // decision, and it is what breadth costs.
    expect(edgePerDollar(0.55, 1.7)).toBeLessThan(0);
    const spread = planFrontier(slate, 100).plans.find((p) => p.id === 'spread');
    expect(spread.singles.c).toBeGreaterThan(0);
    expect(spread.expReturn).toBeGreaterThanOrEqual(spread.metrics.staked - 1e-9);
  });

  it('reports expected winners and expected return in the plan', () => {
    const spread = planFrontier(slate, 100).plans.find((p) => p.id === 'spread');
    expect(spread.expWinners).toBeGreaterThan(0);
    expect(spread.expWinners).toBeLessThanOrEqual(slate.length);
    expect(spread.expReturn).toBeCloseTo(spread.metrics.ev + spread.metrics.staked, 6);
  });

  it('a parlay can carry a leg that is -EV on its own', () => {
    const bets = [bet('x', 0.5, 1.9), bet('y', 0.7, 1.6)];
    expect(edgePerDollar(0.5, 1.9)).toBeLessThan(0);
    const { plans } = planFrontier(bets, 100);
    expect(plans.some((p) => p.parlayLegs.includes('x'))).toBe(true);
  });

  it('still offers the one sensible plan on a single-match card', () => {
    // No spread is possible with one match, but "back it" is still the answer.
    const { plans } = planFrontier([bet('a', 0.8, 1.5)], 100);
    expect(plans.length).toBe(1);
    expect(plans[0].metrics.staked).toBeCloseTo(100, 6);
  });

  it('reports no plan rather than a bad one when nothing covers the stake', () => {
    const { plans, reason } = planFrontier([bet('a', 0.5, 1.4), bet('b', 0.5, 1.5)], 100);
    expect(plans).toEqual([]);
    expect(reason).toMatch(/do not return the stake/);
  });

  it('says so when there are no prices', () => {
    const { plans, reason } = planFrontier([bet('a', 0.7, 0)], 100);
    expect(plans).toEqual([]);
    expect(reason).toMatch(/carry a market price/);
  });

  it('a reliability haircut can empty the menu', () => {
    const bets = [bet('a', 0.7, 1.5)]; // 1.05 as stated, 0.90 at lambda 0.5
    expect(planFrontier(bets, 100, { lambda: 1 }).plans.length).toBe(1);
    expect(planFrontier(bets, 100, { lambda: 0.5 }).plans).toEqual([]);
  });

  it('labels every plan it returns', () => {
    for (const p of planFrontier(slate, 100).plans) {
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.id).toBeTruthy();
    }
  });
});
