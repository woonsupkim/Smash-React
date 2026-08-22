// The staking plan the Parlay builder is actually for: a SPREAD across the
// day's card, not a concentrated bet.
//
// The worked example these tests are built from, stated by the product owner:
//
//   "If there are 10 individual matches happening, and my model correctly
//    identifies the winner 70% of the time, if I bet $1 on each of the
//    matches, the maximum I can lose is $10 and I'm expected to win 7 out of
//    the 10 matches. I want to ensure that the potential return from the 7
//    matches will at least be the $10 that I stake."
//
// So the test is on the PORTFOLIO: expected winners x their payout >= total
// staked. With flat stakes that is a condition on the AVERAGE, which is what
// makes it a plan-level question - a match whose own price is slightly short
// can be carried by stronger ones, and excluding it on its own merits (as a
// per-match filter does) throws away breadth for no reason.
import { describe, it, expect } from 'vitest';
import { spreadPlan, planFrontier } from './staking';

// Ten matches, model right 70% of the time, all priced at 1.45.
// 7 winners x $1 x 1.45 = $10.15 against $10 staked - it clears, just.
const ten = (o = 1.45) => Array.from({ length: 10 }, (_, i) => ({ key: `m${i}`, p: 0.7, o }));

describe("the product owner's worked example", () => {
  it('stakes $1 on each of 10 matches and covers the $10 stake', () => {
    const plan = spreadPlan(ten(1.45), 10);
    expect(plan.staked).toBeCloseTo(10, 6);
    expect(plan.count).toBe(10);
    expect(plan.perMatch).toBeCloseTo(1, 6);
    // Expected winners: 10 x 0.7 = 7.
    expect(plan.expWinners).toBeCloseTo(7, 6);
    // Return from those winners must cover the whole stake.
    expect(plan.expReturn).toBeGreaterThanOrEqual(plan.staked);
    expect(plan.expReturn).toBeCloseTo(10.15, 6);
    expect(plan.coversStake).toBe(true);
    // Most you can lose is everything staked, and no more.
    expect(plan.metrics.worst).toBeCloseTo(-10, 6);
  });

  it('reports how many winners it takes to break even', () => {
    const plan = spreadPlan(ten(1.45), 10);
    // $10 staked, each winner returns 1.45 -> need 6.9, so 7 of 10.
    expect(plan.breakEvenWins).toBe(7);
    expect(plan.breakEvenWins).toBeLessThanOrEqual(Math.round(plan.expWinners));
  });

  it('refuses the spread when the prices cannot cover the stake', () => {
    // At 1.30, seven winners return $9.10 against $10 staked.
    const plan = spreadPlan(ten(1.3), 10);
    expect(plan.count).toBe(0);
    expect(plan.coversStake).toBe(false);
  });
});

describe('spreadPlan keeps breadth at the plan level', () => {
  it('carries a short-priced match when stronger ones cover it', () => {
    // Nine strong matches plus one whose own price is against us.
    const bets = [
      ...Array.from({ length: 9 }, (_, i) => ({ key: `s${i}`, p: 0.7, o: 1.8 })),
      { key: 'weak', p: 0.6, o: 1.5 }, // 0.90 alone: -EV
    ];
    const plan = spreadPlan(bets, 100);
    expect(plan.legs).toContain('weak');
    expect(plan.count).toBe(10);
    expect(plan.expReturn).toBeGreaterThanOrEqual(plan.staked);
  });

  it('drops matches only once they stop the portfolio covering its stake', () => {
    const bets = [
      { key: 'good', p: 0.8, o: 1.6 },   // 1.28
      { key: 'ok', p: 0.7, o: 1.5 },     // 1.05
      { key: 'awful', p: 0.2, o: 1.1 },  // 0.22 - no portfolio survives this
    ];
    const plan = spreadPlan(bets, 30);
    expect(plan.legs).not.toContain('awful');
    expect(plan.count).toBe(2);
    expect(plan.expReturn).toBeGreaterThanOrEqual(plan.staked);
  });

  it('takes as many matches as it can while still covering the stake', () => {
    const bets = [
      { key: 'a', p: 0.75, o: 2.0 },
      { key: 'b', p: 0.7, o: 1.6 },
      { key: 'c', p: 0.6, o: 1.6 },
      { key: 'd', p: 0.55, o: 1.6 },
    ];
    const plan = spreadPlan(bets, 100);
    // Adding one more must break the cover; otherwise it should have been kept.
    const all = bets.reduce((s, b) => s + b.p * b.o, 0);
    if (all >= bets.length) expect(plan.count).toBe(bets.length);
    else expect(plan.count).toBeLessThan(bets.length);
    expect(plan.expReturn).toBeGreaterThanOrEqual(plan.staked - 1e-9);
  });

  it('is flat: every staked match carries the same money', () => {
    const plan = spreadPlan(ten(1.5), 250);
    const amounts = Object.values(plan.singles).filter((v) => v > 0);
    expect(amounts.length).toBe(10);
    for (const a of amounts) expect(a).toBeCloseTo(25, 6);
  });

  it('ignores matches with no usable price', () => {
    const bets = [{ key: 'a', p: 0.7, o: 1.6 }, { key: 'b', p: 0.7, o: 0 }];
    const plan = spreadPlan(bets, 100);
    expect(plan.legs).toEqual(['a']);
  });
});

describe('the recommended menu', () => {
  it('offers a spread across the card, not a single bet', () => {
    const { plans } = planFrontier(ten(1.5), 100);
    const spread = plans.find((p) => p.id === 'spread');
    expect(spread).toBeTruthy();
    expect(spread.funded).toBeGreaterThan(1);
    expect(Object.values(spread.singles).filter((v) => v > 0).length).toBe(10);
  });

  it('every plan on the menu still covers its stake in expectation', () => {
    for (const p of planFrontier(ten(1.5), 100).plans) {
      expect(p.metrics.ev + p.metrics.staked).toBeGreaterThanOrEqual(p.metrics.staked - 1e-9);
    }
  });

  it('recommends the edge plan when it stakes, and it is never a lone reckless bet', () => {
    // Policy recommendation, chosen by tournament (expPlanPolicies.js), not
    // by per-day beauty contest: a daily follower needs one consistent rule.
    const { plans, recommendedId } = planFrontier(ten(1.5), 100);
    expect(recommendedId).toBe('edge');
    const edge = plans.find((p) => p.id === 'edge');
    expect(edge.metrics.staked).toBeLessThanOrEqual(100);
    // per-bet cap: no single bet above 20% of budget
    for (const v of Object.values(edge.singles)) expect(v).toBeLessThanOrEqual(20 + 1e-9);
    if (edge.parlayStake) expect(edge.parlayStake).toBeLessThanOrEqual(10 + 1e-9);
  });
});
