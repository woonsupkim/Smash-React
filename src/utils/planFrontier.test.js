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

  it('whole-card plans spend the budget; the edge plan spends what the card deserves', () => {
    // The contract changed on tournament evidence (expPlanPolicies.js, 94
    // deploy-tier days): forcing the full budget onto every plan was the
    // 6%-ROI coin-flip experience; the edge plan stakes quarter-Kelly on the
    // +EV calls and keeping the rest IS the recommendation.
    for (const p of planFrontier(slate, 250).plans) {
      if (p.id === 'edge') {
        expect(p.metrics.staked).toBeGreaterThan(0);
        expect(p.metrics.staked).toBeLessThanOrEqual(250 + 1e-6);
      } else {
        expect(p.metrics.staked).toBeCloseTo(250, 6);
      }
    }
  });

  it('leads with the edge plan whenever it stakes; the spread stays on the menu', () => {
    const { plans, recommendedId } = planFrontier(slate, 100);
    expect(recommendedId).toBe('edge');
    const spread = plans.find((p) => p.id === 'spread');
    expect(spread).toBeTruthy();
    expect(spread.funded).toBeGreaterThan(1);
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

  it('still offers sensible plans on a single-match card', () => {
    // No spread is possible with one match. The edge plan sizes the single
    // +EV bet by Kelly; the whole-card option still offers backing it with
    // the full budget for whoever wants full allocation.
    const { plans, recommendedId } = planFrontier([bet('a', 0.8, 1.5)], 100);
    expect(plans.length).toBeGreaterThan(0);
    expect(recommendedId).toBe('edge');
    const edge = plans.find((p) => p.id === 'edge');
    expect(edge.metrics.staked).toBeGreaterThan(0);
    expect(edge.metrics.staked).toBeLessThan(100);
    const whole = plans.find((p) => p.id !== 'edge');
    if (whole) expect(whole.metrics.staked).toBeCloseTo(100, 6);
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
    expect(planFrontier(bets, 100, { lambda: 1 }).plans.length).toBeGreaterThan(0);
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

describe('no plan abandons matches on the card', () => {
  // A card with a deliberate mix: strong value, thin value, and several
  // priced against us. The concentrated plan used to fund only the +EV ones,
  // which on a real 40-match card meant backing 27 and dropping 13.
  const card = Array.from({ length: 20 }, (_, i) => {
    const p = 0.5 + ((i * 11) % 40) / 100;
    // Every fourth match is priced against us on purpose.
    const o = (i % 4 === 0 ? 0.92 : 1.12) / p;
    return { key: `m${i}`, p, o };
  });

  it('every WHOLE-CARD plan backs every priced match; the edge plan is selective by design', () => {
    const f = planFrontier(card, 100, { lambda: 1 });
    expect(f.plans.length).toBeGreaterThan(0);
    const negative = card.filter((b) => b.p * b.o - 1 < 0);
    expect(negative.length).toBeGreaterThan(0);      // the fixture must bite
    for (const plan of f.plans) {
      if (plan.id === 'edge') {
        // The edge plan funds only +EV calls - that selectivity is the whole
        // point (it is the tournament winner, +19.7% vs the spread's +5.1%).
        for (const b of negative) expect(plan.singles[b.key] || 0).toBe(0);
        continue;
      }
      for (const b of card) {
        // eslint-disable-next-line jest/valid-expect
        expect(plan.singles[b.key], `${plan.id} dropped ${b.key}`).toBeGreaterThan(0);
      }
    }
  });

  it('the tilted plan still weights toward the better prices', () => {
    const f = planFrontier(card, 100, { lambda: 1 });
    const sharp = f.plans.find((p) => p.id === 'sharp');
    if (!sharp) return;                               // suppressed as duplicate
    const edge = (b) => b.p * b.o - 1;
    const best = card.reduce((a, b) => (edge(b) > edge(a) ? b : a));
    const worst = card.reduce((a, b) => (edge(b) < edge(a) ? b : a));
    expect(sharp.singles[best.key]).toBeGreaterThan(sharp.singles[worst.key]);
  });

  it('every offered plan clears the cover test it claims to', () => {
    // The page states outright that every plan shown passes this. Carrying
    // negative-edge matches makes that something to check, not assume.
    for (const budget of [25, 100, 500]) {
      for (const plan of planFrontier(card, budget, { lambda: 1 }).plans) {
        // eslint-disable-next-line jest/valid-expect
        expect(plan.expReturn, plan.id).toBeGreaterThanOrEqual(plan.metrics.staked - 1e-9);
      }
    }
  });
});

describe('the parlay length is chosen by the plan, not by the parlay alone', () => {
  // Found by search. On this card the old rule - the candidate with the
  // largest Kelly fraction, scored in isolation - picks a 2-leg parlay, and
  // scoring the shortlist through the actual plan picks a 3-leg one. Without
  // a card that separates them, the change would be untestable.
  const card = [
    { p: 0.9389, o: 1.2856 }, { p: 0.8811, o: 1.2570 }, { p: 0.5224, o: 2.0846 },
    { p: 0.7420, o: 1.6530 }, { p: 0.8080, o: 1.5288 }, { p: 0.7250, o: 1.6959 },
    { p: 0.9057, o: 1.3678 }, { p: 0.5748, o: 2.0868 }, { p: 0.6095, o: 2.0292 },
    { p: 0.7058, o: 1.5758 }, { p: 0.8077, o: 1.3921 }, { p: 0.6781, o: 1.6015 },
  ].map((b, i) => ({ key: `m${i}`, ...b }));

  it('picks the longer parlay when the plan is better for it', () => {
    const sharp = planFrontier(card, 100, { lambda: 1 }).plans.find((p) => p.id === 'sharp');
    expect(sharp).toBeTruthy();
    // Kelly-in-isolation always shortens the parlay, because odds compound
    // faster than edge. Anything past 2 here can only come from plan scoring.
    expect(sharp.parlayLegs.length).toBe(3);
  });

  it('never picks a parlay another length beats on both axes', () => {
    // The property that matters, independent of which length wins: the choice
    // has to survive the same test the plan menu applies to plans.
    for (const budget of [50, 100, 400]) {
      const plans = planFrontier(card, budget, { lambda: 1 }).plans;
      const sharp = plans.find((p) => p.id === 'sharp');
      if (!sharp?.parlayLegs?.length) continue;
      const mine = sharp.metrics;
      // Rebuild the menu at other budgets and confirm nothing dominates it.
      for (const other of plans) {
        if (other === sharp) continue;
        const beatsBoth = other.metrics.pProfit > mine.pProfit + 1e-9
          && other.metrics.ev > mine.ev + 1e-9;
        // A dominated plan may still be OFFERED; it must not be RECOMMENDED.
        if (beatsBoth) {
          expect(planFrontier(card, budget, { lambda: 1 }).recommendedId).not.toBe('sharp');
        }
      }
    }
  });
});
