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
import {
  planFrontier, edgePerDollar, analyzeSlip, expectedLogGrowth, cappedProb, adjustProb, EDGE_CAP,
} from './staking';

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
      if (p.id === 'edge' || p.id === 'best') {
        expect(p.metrics.staked).toBeGreaterThan(0);
        expect(p.metrics.staked).toBeLessThanOrEqual(250 + 1e-6);
      } else {
        expect(p.metrics.staked).toBeCloseTo(250, 6);
      }
    }
  });

  it('leads with the searched plan, and the policy plans stay on the menu', () => {
    // The recommendation used to be pinned to the edge policy unconditionally.
    // It won on return per dollar risked and lost on the thing a daily
    // follower actually experiences: on a thin card its middle outcome was a
    // loss. `best` is searched against that bar directly.
    const { plans, recommendedId } = planFrontier(slate, 100);
    expect(recommendedId).toBe('best');
    for (const id of ['spread', 'edge']) {
      expect(plans.some((p) => p.id === id)).toBe(true);
    }
    const spread = plans.find((p) => p.id === 'spread');
    expect(spread.funded).toBeGreaterThan(1);
  });

  it('the recommended plan finishes up on a typical day', () => {
    // The headline promise, and the reason the objective was rewritten. A
    // right-skewed plan can carry a healthy average while losing on most
    // individual days; somebody following it every morning lives the median.
    const { plans, recommendedId } = planFrontier(slate, 100);
    const rec = plans.find((p) => p.id === recommendedId);
    expect(rec.metrics.pcts.p50).toBeGreaterThan(0);
    expect(rec.metrics.ev).toBeGreaterThan(0);
  });

  it('the recommended plan keeps a bad day inside its ceiling', () => {
    // One day in twenty is worse than p05. Growth alone will commit most of
    // the budget once it has enough independent +EV bets; this is what stops
    // it, and it is a constraint rather than a weight so it can be checked.
    for (const budget of [50, 100, 400]) {
      const { plans, recommendedId } = planFrontier(slate, budget);
      const rec = plans.find((p) => p.id === recommendedId);
      expect(rec.metrics.pcts.p05).toBeGreaterThanOrEqual(-budget * 0.15 - 1e-6);
      expect(rec.metrics.staked).toBeLessThan(budget);
    }
  });

  it('the recommended plan spreads rather than piling onto one match', () => {
    // Sizing each bet at its own Kelly fraction INDEPENDENTLY is what makes
    // this true: an earlier version spread a fixed total, so every extra bet
    // was funded by taking money off the best one and widening always looked
    // like a loss.
    const wide = Array.from({ length: 8 }, (_, i) => bet(`w${i}`, 0.62 + i * 0.02, 1.9 - i * 0.05));
    const { plans, recommendedId } = planFrontier(wide, 100);
    const rec = plans.find((p) => p.id === recommendedId);
    const funded = Object.values(rec.singles).filter((v) => v > 0).length;
    expect(funded).toBeGreaterThan(1);
  });

  it('carries a parlay only when the whole day is better for it', () => {
    // "You may not even have a parlay" is a real outcome, not a formality:
    // no parlay is one of the candidates and it wins on most cards.
    const { plans, recommendedId } = planFrontier(slate, 100);
    const rec = plans.find((p) => p.id === recommendedId);
    if (rec.parlayStake > 0) {
      expect(rec.parlayLegs.length).toBeGreaterThan(1);
      // Never more than the parlay cap: it is correlated with its own legs.
      expect(rec.parlayStake).toBeLessThanOrEqual(100 * 0.05 + 1e-6);
    } else {
      expect(rec.parlayLegs).toEqual([]);
    }
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
    expect(recommendedId).toBe('best');
    const rec = plans.find((p) => p.id === 'best');
    expect(rec.metrics.staked).toBeGreaterThan(0);
    expect(rec.metrics.staked).toBeLessThan(100);
    const whole = plans.find((p) => p.id !== 'edge' && p.id !== 'best');
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
      if (plan.id === 'edge' || plan.id === 'best') {
        // Both selective plans fund only +EV calls. For the recommendation
        // that is not a policy preference but arithmetic: a leg priced
        // against us lowers the median and the growth rate at every size.
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
    // faster than edge. Anything past 2 here can only come from plan scoring,
    // and that is the whole claim - the exact count was never the point. It
    // was pinned at 3 and moved to 6 when the edge cap landed, which is a
    // change in what the legs are worth, not in who chooses them.
    expect(sharp.parlayLegs.length).toBeGreaterThan(2);
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

  it('never recommends a worse plan on a bigger budget', () => {
    // A larger budget can always replicate a smaller plan and hold the
    // difference in cash, so the recommendation's expected profit must never
    // fall as the budget grows. It did, badly: the edge plan's per-bet
    // minimum was a flat $0.50 while every other quantity in it was a
    // fraction of the budget, so the flat term decided WHICH bets the plan
    // contained. On a two-bet card sized at 4.6% and 3.3% of budget it
    // funded nothing under $11, one bet to $15, and both from $16 - and the
    // recommendation inverted across a single dollar: $10 staked the whole
    // budget for an expected +1.91, $11 staked fifty cents for +0.13.
    //
    // Asserted on the CARD, not on one budget, because the fault was
    // invisible at the $100 default and only appeared at small budgets a
    // user is free to type in.
    const card = [
      { key: 'a', p: 0.525, o: 2.39 },
      { key: 'b', p: 0.715, o: 1.49 },
      { key: 'c', p: 0.61, o: 1.95 },
    ];
    for (const lambda of [0.8, 1, 1.2]) {
      let prev = null;
      for (const budget of [2, 5, 8, 9, 10, 11, 16, 25, 50, 100, 250]) {
        const f = planFrontier(card, budget, { lambda });
        if (!f.plans.length) continue;
        const rec = f.plans.find((pl) => pl.id === f.recommendedId) || f.plans[0];
        const ev = rec.metrics.ev;
        if (prev) {
          // A few percent of slack, and no more. The recommendation is chosen
          // on expected growth with a typical-day gate, and both are read off
          // analyzeSlip's P&L distribution, which is binned on an absolute
          // dollar grid: at an $8 budget the stakes are cents and the median
          // estimate can wobble by a bin between one budget and the next.
          // That is quantisation, not the fault this test exists for, which
          // was a plan that inverted from staking the whole budget to staking
          // fifty cents across a single dollar - a 93% collapse.
          const floor = prev.ev * 0.95;
          // eslint-disable-next-line jest/valid-expect
          expect(ev, `lambda ${lambda}, $${prev.budget} -> $${budget}`).toBeGreaterThanOrEqual(floor);
        }
        prev = { budget, ev };
      }
    }
  });

  it('scales the recommendation with the budget, near enough linearly', () => {
    // The real guarantee behind the test above, and the one the old fault
    // broke outright: every quantity in the search is a fraction of the
    // budget, so the plan a follower is shown has the same shape at every
    // budget and doubling the budget doubles the expected profit. Checked
    // across a 25x range, where a quantisation wobble cannot hide.
    const card = [
      { key: 'a', p: 0.525, o: 2.39 },
      { key: 'b', p: 0.715, o: 1.49 },
      { key: 'c', p: 0.61, o: 1.95 },
    ];
    const evAt = (budget) => {
      const f = planFrontier(card, budget, { lambda: 1 });
      const rec = f.plans.find((pl) => pl.id === f.recommendedId) || f.plans[0];
      return rec.metrics.ev;
    };
    const small = evAt(10);
    const large = evAt(250);
    expect(small).toBeGreaterThan(0);
    expect(large / small).toBeGreaterThan(25 * 0.9);
    expect(large / small).toBeLessThan(25 * 1.1);
  });

  it('recommends the same plan SHAPE at every budget', () => {
    // The sizing policy is entirely fractions of budget, so which bets are
    // funded is a property of the bets. If this ever fails, some absolute
    // dollar term has crept back into the sizing.
    const card = [
      { key: 'a', p: 0.525, o: 2.39 },
      { key: 'b', p: 0.715, o: 1.49 },
      { key: 'c', p: 0.61, o: 1.95 },
    ];
    const shapeAt = (budget) => {
      const f = planFrontier(card, budget, { lambda: 1 });
      const rec = f.plans.find((pl) => pl.id === f.recommendedId) || f.plans[0];
      return [
        rec.id,
        Object.keys(rec.singles || {}).filter((k) => rec.singles[k] > 0).sort().join(','),
        (rec.parlayLegs || []).length,
      ].join('|');
    };
    const base = shapeAt(100);
    for (const budget of [5, 8, 9, 11, 20, 50, 250, 1000]) {
      expect(`$${budget}: ${shapeAt(budget)}`).toBe(`$${budget}: ${base}`);
    }
  });
});

describe('expected log growth', () => {
  it('prefers the same edge spread over one concentrated punt', () => {
    // The property the whole objective rests on. Four independent +EV bets at
    // a modest size grow a bankroll faster than the same money on one of
    // them, and log growth is what sees that; expected value alone cannot,
    // because both have the same mean.
    const bets = Array.from({ length: 4 }, (_, i) => ({ key: `b${i}`, p: 0.65, o: 1.7 }));
    const spread = analyzeSlip(bets.map((b) => ({ ...b, single: 5 })), null);
    const punt = analyzeSlip(bets.map((b, i) => ({ ...b, single: i === 0 ? 20 : 0 })), null);
    expect(spread.staked).toBeCloseTo(punt.staked, 9);
    expect(spread.ev).toBeCloseTo(punt.ev, 6);          // identical on average
    expect(expectedLogGrowth(spread.dist, 100))
      .toBeGreaterThan(expectedLogGrowth(punt.dist, 100));
  });

  it('turns down once a plan is over-sized, which is what caps the search', () => {
    const bets = Array.from({ length: 4 }, (_, i) => ({ key: `b${i}`, p: 0.65, o: 1.7 }));
    const at = (stake) => expectedLogGrowth(
      analyzeSlip(bets.map((b) => ({ ...b, single: stake })), null).dist, 100
    );
    // Sane, then greedy, then ruinous. Growth has to peak in the middle.
    expect(at(6)).toBeGreaterThan(at(1));
    expect(at(6)).toBeGreaterThan(at(24));
  });

  it('is minus infinity when an outcome can take more than the bankroll', () => {
    // Staking more than you hold. log(0) is undefined and the honest answer
    // is that no growth rate exists, not a large negative number.
    const bets = [{ key: 'a', p: 0.6, o: 2, single: 150 }];
    expect(expectedLogGrowth(analyzeSlip(bets, null).dist, 100)).toBe(-Infinity);
    // Staking the whole bankroll is survivable-adjacent rather than ruin in
    // the binned distribution, so it scores badly but finitely.
    const all = [{ key: 'a', p: 0.6, o: 2, single: 100 }];
    const g = expectedLogGrowth(analyzeSlip(all, null).dist, 100);
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBeLessThan(0);
  });

  it('reads the same whatever the bankroll is measured in', () => {
    // Growth is a rate, so scaling stakes and bankroll together must not move
    // it. This is why the recommendation has the same shape at every budget.
    const bets = [{ key: 'a', p: 0.7, o: 1.6 }, { key: 'b', p: 0.64, o: 1.85 }];
    const g = (k) => expectedLogGrowth(
      analyzeSlip(bets.map((b) => ({ ...b, single: 8 * k })), null).dist, 100 * k
    );
    expect(g(1)).toBeCloseTo(g(10), 3);
  });
});

describe('the edge cap', () => {
  it('never lets a bet be sized on more edge than the cap allows', () => {
    // The record says edges past ~10% are mostly estimation error, and Kelly
    // sizing scales with edge, so without this the biggest stakes land on the
    // least reliable numbers.
    for (const [p, o] of [[0.63, 2.0], [0.9, 1.5], [0.75, 1.9], [0.55, 2.4]]) {
      const capped = cappedProb(p, o, { lambda: 1 });
      expect(capped * o - 1).toBeLessThanOrEqual(EDGE_CAP + 1e-9);
    }
  });

  it('leaves an honest edge alone', () => {
    // Only the extremes are shrunk. A bet already inside the cap must come
    // through untouched, or the cap is just a second reliability haircut.
    const p = 0.70, o = 1.55;                       // edge 8.5%, inside the cap
    expect(p * o - 1).toBeLessThan(EDGE_CAP);
    expect(cappedProb(p, o, { lambda: 1 })).toBeCloseTo(p, 9);
  });

  it('never raises a probability, and composes with the reliability haircut', () => {
    for (const lambda of [0.8, 1, 1.2]) {
      for (const [p, o] of [[0.63, 2.0], [0.70, 1.55], [0.86, 1.22]]) {
        const capped = cappedProb(p, o, { lambda });
        expect(capped).toBeLessThanOrEqual(adjustProb(p, lambda) + 1e-12);
        expect(capped * o - 1).toBeLessThanOrEqual(EDGE_CAP + 1e-9);
      }
    }
  });

  it('is a no-op with no cap, and safe on an unpriced bet', () => {
    expect(cappedProb(0.63, 2.0, { lambda: 1, edgeCap: Infinity })).toBeCloseTo(0.63, 9);
    expect(cappedProb(0.63, 0, { lambda: 1 })).toBeCloseTo(0.63, 9);
  });

  it('holds every bet the recommendation funds inside the cap', () => {
    // The property that actually matters: not that the helper works, but that
    // no plan the page offers is sized on an edge we do not trust.
    const wild = [
      { key: 'a', p: 0.63, o: 2.4 },   // claims +51%
      { key: 'b', p: 0.70, o: 1.55 },  // claims +8.5%
      { key: 'c', p: 0.80, o: 1.45 },  // claims +16%
      { key: 'd', p: 0.66, o: 1.62 },  // claims +7%
    ];
    const { plans, recommendedId } = planFrontier(wild, 100);
    const rec = plans.find((p) => p.id === recommendedId);
    expect(rec).toBeTruthy();
    for (const [key, stake] of Object.entries(rec.singles)) {
      if (!(stake > 0)) continue;
      const bet = wild.find((b) => b.key === key);
      const used = cappedProb(bet.p, bet.o, { lambda: 1 });
      expect(used * bet.o - 1).toBeLessThanOrEqual(EDGE_CAP + 1e-9);
    }
  });
});
