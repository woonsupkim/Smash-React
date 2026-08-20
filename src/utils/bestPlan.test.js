// Tests for plan-level staking: reliability adjustment and bestPlan.
//
// The behaviour under test is the one the per-matchup pass got wrong: a leg
// that is -EV on its own can still pay its way inside a combination, and
// filtering legs on their own edge first throws those plans away.
import { describe, it, expect } from 'vitest';
import { reliability, adjustProb, bestPlan, edgePerDollar } from './staking';

const bet = (key, p, o) => ({ key, p, o });

describe('reliability', () => {
  it('is the identity with no record to learn from', () => {
    const r = reliability([]);
    expect(r.lambda).toBe(1);
    expect(r.trusted).toBe(false);
    expect(adjustProb(0.8, r.lambda)).toBe(0.8);
  });

  it('measures accuracy and stated confidence off graded rows only', () => {
    const graded = [
      { favProb: 0.6, status: 'won', correct: true },
      { favProb: 0.6, status: 'lost', correct: false },
      { favProb: 0.8, status: 'pending' },   // ignored: not graded
      { favProb: 0.8, status: 'void' },      // ignored
    ];
    const r = reliability(graded);
    expect(r.n).toBe(2);
    expect(r.accuracy).toBeCloseTo(0.5);
    expect(r.stated).toBeCloseTo(0.6);
  });

  it('shrinks toward 1 when the sample is thin, and less as it grows', () => {
    // A wildly overconfident model: states 90%, lands 50%.
    const row = { favProb: 0.9, status: 'lost', correct: false };
    const win = { favProb: 0.9, status: 'won', correct: true };
    const make = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? win : row));
    const small = reliability(make(10));
    const large = reliability(make(400));
    // Raw lambda is the same in both; the shrunk one is not.
    expect(small.lambdaRaw).toBeCloseTo(large.lambdaRaw, 6);
    expect(small.lambda).toBeGreaterThan(large.lambda); // small sample -> closer to 1
    expect(Math.abs(small.lambda - 1)).toBeLessThan(Math.abs(large.lambda - 1));
  });

  it('never returns an extreme correction', () => {
    const absurd = Array.from({ length: 5000 }, () => ({ favProb: 0.51, status: 'won', correct: true }));
    const r = reliability(absurd);
    expect(r.lambda).toBeLessThanOrEqual(1.5);
    expect(r.lambda).toBeGreaterThanOrEqual(0.5);
  });
});

describe('adjustProb', () => {
  it('pivots on 50%, so it can never flip which side is favoured', () => {
    expect(adjustProb(0.5, 0.6)).toBeCloseTo(0.5);
    expect(adjustProb(0.7, 0.5)).toBeGreaterThan(0.5);
    expect(adjustProb(0.3, 0.5)).toBeLessThan(0.5);
  });

  it('lambda below 1 tempers confidence, above 1 sharpens it', () => {
    expect(adjustProb(0.8, 0.5)).toBeCloseTo(0.65);
    expect(adjustProb(0.8, 1.2)).toBeCloseTo(0.86);
  });

  it('stays a probability at extremes', () => {
    expect(adjustProb(0.999, 1.5)).toBeLessThan(1);
    expect(adjustProb(0.001, 1.5)).toBeGreaterThan(0);
  });
});

describe('bestPlan', () => {
  it('funds a plan whose every instrument is +EV, so plan EV >= 0 by construction', () => {
    const bets = [bet('a', 0.7, 1.7), bet('b', 0.6, 1.9)];
    const plan = bestPlan(bets, 100);
    expect(plan.feasible).toBe(true);
    expect(plan.metrics.ev).toBeGreaterThanOrEqual(0);
    expect(plan.metrics.staked).toBeCloseTo(100, 6);
  });

  it('THE PLAN-LEVEL CASE: uses a -EV leg inside a +EV combination', () => {
    // 'a' alone: 0.7*1.6 = 1.12, +EV. 'b' alone: 0.5*1.9 = 0.95, -EV.
    // Together: 0.35 * 3.04 = 1.064, still +EV. A per-matchup filter drops 'b'
    // entirely and never sees that combination.
    const a = bet('a', 0.7, 1.6);
    const b = bet('b', 0.5, 1.9);
    expect(edgePerDollar(b.p, b.o)).toBeLessThan(0);
    const plan = bestPlan([a, b], 100);
    expect(plan.feasible).toBe(true);
    expect(plan.combo).not.toBeNull();
    expect(plan.combo.legs.sort()).toEqual(['a', 'b']);
    expect(plan.combo.edge).toBeGreaterThan(0);
    // 'b' gets no single stake (rightly), but it is in the funded parlay.
    expect(plan.singles.b || 0).toBe(0);
    expect(plan.parlayStake).toBeGreaterThan(0);
    expect(plan.parlayLegs).toContain('b');
  });

  it('reports infeasible - not a bad plan - when nothing clears its price', () => {
    // Every leg and every combination priced below our number.
    const bets = [bet('a', 0.5, 1.5), bet('b', 0.5, 1.6)];
    const plan = bestPlan(bets, 100);
    expect(plan.feasible).toBe(false);
    expect(plan.metrics.staked).toBe(0);
    expect(plan.parlayStake).toBe(0);
    expect(plan.reason).toMatch(/at or above our own number/);
  });

  it('says so when there are no prices at all', () => {
    const plan = bestPlan([bet('a', 0.7, 0), bet('b', 0.6, 0)], 100);
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toMatch(/carry a market price/);
  });

  it('reports the chance of finishing ahead and a P&L distribution', () => {
    const plan = bestPlan([bet('a', 0.7, 1.7), bet('b', 0.65, 1.8)], 100);
    expect(plan.metrics.pProfit).toBeGreaterThan(0);
    expect(plan.metrics.pProfit).toBeLessThanOrEqual(1);
    const mass = plan.metrics.dist.bins.reduce((s, b) => s + b.prob, 0);
    expect(mass).toBeCloseTo(1, 6);
    expect(plan.metrics.worst).toBeCloseTo(-plan.metrics.staked, 6);
    expect(plan.metrics.best).toBeGreaterThan(0);
  });

  it('a reliability haircut can turn a fundable plan into no plan at all', () => {
    // 0.7*1.5 = 1.05, +EV as stated. At lambda 0.5 the probability drops to
    // 0.6 and 0.6*1.5 = 0.90, so the honest answer becomes "do not stake".
    const bets = [bet('a', 0.7, 1.5)];
    expect(bestPlan(bets, 100, { lambda: 1 }).feasible).toBe(true);
    expect(bestPlan(bets, 100, { lambda: 0.5 }).feasible).toBe(false);
  });

  it('respects the leg cap on parlay search', () => {
    const bets = Array.from({ length: 8 }, (_, i) => bet(`k${i}`, 0.75, 1.5));
    const plan = bestPlan(bets, 100, { maxParlayLegs: 3 });
    expect(plan.combo.n).toBeLessThanOrEqual(3);
  });

  it('stakes nothing when the budget is zero, without claiming a plan', () => {
    const plan = bestPlan([bet('a', 0.7, 1.7)], 0);
    expect(plan.metrics.staked).toBe(0);
    expect(plan.feasible).toBe(true); // a plan exists; it just has no money
  });
});
