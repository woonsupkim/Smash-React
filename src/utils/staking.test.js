import { describe, it, expect } from 'vitest';
import { edgePerDollar, kellyFraction, analyzeSlip, recommendStakes, recommendedPlanId } from './staking';

describe('staking math', () => {
  it('edge per dollar is p*o - 1, null without a price', () => {
    expect(edgePerDollar(0.6, 2.0)).toBeCloseTo(0.2, 12);
    expect(edgePerDollar(0.4, 2.0)).toBeCloseTo(-0.2, 12);
    expect(edgePerDollar(0.5, 1.0)).toBeNull();
  });

  it('kelly fraction is edge/(o-1), 0 when not +EV', () => {
    expect(kellyFraction(0.6, 2.0)).toBeCloseTo(0.2, 12);
    expect(kellyFraction(0.4, 2.0)).toBe(0);
  });

  it('analyzeSlip: a single +EV bet gets EV, P(profit) and worst case right', () => {
    const r = analyzeSlip([{ key: 'a', p: 0.6, o: 2.0, single: 10 }], null);
    expect(r.ev).toBeCloseTo(2, 12);       // 10 * 0.2
    expect(r.staked).toBe(10);
    expect(r.pProfit).toBeCloseTo(0.6, 12); // wins 60% -> +$10
    expect(r.worst).toBe(-10);
    expect(r.best).toBeCloseTo(10, 12);
    expect(r.breakEven).toBe(true);
  });

  it('analyzeSlip: EV = sum of single EVs + parlay EV (linear, independent of correlation)', () => {
    const bets = [
      { key: 'a', p: 0.6, o: 2.0, single: 10 },
      { key: 'b', p: 0.7, o: 1.8, single: 0 },
    ];
    const r = analyzeSlip(bets, { stake: 5, legs: ['a', 'b'] });
    const singleEV = 10 * (0.6 * 2.0 - 1);
    const parlayEV = 5 * (0.6 * 0.7 * 2.0 * 1.8 - 1);
    expect(r.ev).toBeCloseTo(singleEV + parlayEV, 10);
    expect(r.staked).toBe(15);
    expect(r.parlay.edge).toBeCloseTo(0.6 * 0.7 * 2.0 * 1.8 - 1, 12);
  });

  it('a -EV slip is flagged, and its worst case is the whole stake', () => {
    const r = analyzeSlip([{ key: 'a', p: 0.4, o: 2.0, single: 20 }], null);
    expect(r.ev).toBeCloseTo(-4, 12);
    expect(r.breakEven).toBe(false);
    expect(r.worst).toBe(-20);
  });

  it('analyzeSlip returns a P&L histogram whose probabilities sum to 1', () => {
    const r = analyzeSlip(
      [{ key: 'a', p: 0.6, o: 2.0, single: 10 }, { key: 'b', p: 0.55, o: 2.1, single: 8 }],
      { stake: 4, legs: ['a', 'b'] }
    );
    expect(r.dist).toBeTruthy();
    expect(r.dist.bins.reduce((s, b) => s + b.prob, 0)).toBeCloseTo(1, 10);
    expect(r.dist.lo).toBe(r.worst);
    expect(r.dist.hi).toBeCloseTo(r.best, 10);
  });

  it('dropping the parlay (no legs) sizes and grades singles only', () => {
    const bets = [
      { key: 'a', p: 0.6, o: 2.0, single: 10 },
      { key: 'b', p: 0.7, o: 1.8, single: 10 },
    ];
    // Same slip, with and without the parlay switched on. Unticking it is
    // modelled as "no legs carry the parlay", which is what the master
    // checkbox does, so the parlay must contribute nothing at all.
    const withPar = analyzeSlip(bets, { stake: 5, legs: ['a', 'b'] });
    const singlesOnly = analyzeSlip(bets, { stake: 0, legs: [] });

    expect(singlesOnly.staked).toBe(20);           // the 5 parlay stake is gone
    expect(singlesOnly.parlay).toBeNull();
    expect(singlesOnly.ev).toBeCloseTo(10 * (0.6 * 2 - 1) + 10 * (0.7 * 1.8 - 1), 10);
    expect(singlesOnly.worst).toBe(-20);
    expect(singlesOnly.best).toBeCloseTo(10 * 1.0 + 10 * 0.8, 10);
    expect(withPar.staked).toBe(25);

    // Budget mode: with no parlay legs the recommender can only fund singles.
    const rec = recommendStakes(bets, [], 100);
    expect(rec.parlay).toBe(0);
    expect((rec.singles.a || 0) + (rec.singles.b || 0)).toBeCloseTo(100, 6);
  });

  it('recommendStakes puts the whole budget on +EV bets, nothing on -EV', () => {
    const bets = [
      { key: 'a', p: 0.6, o: 2.0 },  // +EV, kelly 0.2
      { key: 'b', p: 0.4, o: 2.0 },  // -EV, kelly 0
    ];
    const rec = recommendStakes(bets, ['a', 'b'], 100);
    expect(rec.singles.a).toBeCloseTo(100, 6); // all budget to the only +EV bet
    expect(rec.singles.b || 0).toBe(0);
    expect(rec.parlay).toBe(0); // parlay a+b is -EV (0.24*4-1<0)
    expect(rec.anyPositive).toBe(true);

    // Guarantee: the recommended slip is break-even or better.
    const staked = analyzeSlip(
      bets.map((b) => ({ ...b, single: rec.singles[b.key] || 0 })),
      { stake: rec.parlay, legs: ['a', 'b'] }
    );
    expect(staked.breakEven).toBe(true);
  });
});

// The P&L analysis used to be a 2^n walk over every win/lose combination,
// capped at 16 matches. Past the cap it returned null and the plan cards
// printed "0.0% to win". It is now a convolution over a quantised P&L grid,
// so these pin the two things that had to survive the swap: it still agrees
// with brute force where brute force can run, and it keeps working past the
// size where brute force cannot.
describe('analyzeSlip scales past the old 16-match enumeration cap', () => {
  // Independent reference implementation: the exact enumeration that was
  // removed. Deliberately written the slow, obvious way.
  const bruteForce = (bets, parlay) => {
    const combo = parlay ? bets.filter((b) => parlay.legs.includes(b.key)) : [];
    const comboOdds = combo.reduce((s, b) => s * b.o, 1);
    const active = (parlay?.stake || 0) > 0 && combo.length >= 2;
    let pPos = 0;
    for (let mask = 0; mask < (1 << bets.length); mask++) {
      let prob = 1, pl = 0;
      const win = {};
      bets.forEach((b, i) => {
        const w = (mask >> i) & 1;
        win[b.key] = !!w;
        prob *= w ? b.p : 1 - b.p;
        if (b.single > 0) pl += w ? b.single * (b.o - 1) : -b.single;
      });
      if (active) pl += parlay.legs.every((k) => win[k]) ? parlay.stake * (comboOdds - 1) : -parlay.stake;
      if (pl > 1e-9) pPos += prob;
    }
    return pPos;
  };

  const card = (n, seed = 1) => Array.from({ length: n }, (_, i) => {
    // Spread of favourites and coin-flips at prices that are not all winners,
    // so the zero-crossing is somewhere interesting rather than at an extreme.
    const p = 0.5 + (((i * 7 + seed) % 45) / 100);
    return { key: `m${i}`, p, o: 1 / p + (((i % 5) - 2) * 0.06), single: 2.5 };
  });

  it('matches brute force on a 12-match card of singles', () => {
    const bets = card(12);
    expect(analyzeSlip(bets, null).pProfit).toBeCloseTo(bruteForce(bets, null), 6);
  });

  it('matches brute force with a parlay riding on top of the singles', () => {
    const bets = card(10, 3);
    const parlay = { stake: 5, legs: ['m0', 'm1', 'm2'] };
    expect(analyzeSlip(bets, parlay).pProfit).toBeCloseTo(bruteForce(bets, parlay), 6);
  });

  it('matches brute force when parlay legs carry no single of their own', () => {
    // The two-track state has to be driven by leg outcomes, not by stakes.
    const bets = card(9, 5).map((b, i) => (i < 3 ? { ...b, single: 0 } : b));
    const parlay = { stake: 8, legs: ['m0', 'm1', 'm2'] };
    expect(analyzeSlip(bets, parlay).pProfit).toBeCloseTo(bruteForce(bets, parlay), 6);
  });

  it('returns a real probability for a full 40-match tour day', () => {
    const r = analyzeSlip(card(40), null);
    expect(r.pProfit).not.toBeNull();
    expect(r.pProfit).toBeGreaterThan(0.01);
    expect(r.pProfit).toBeLessThan(0.999);
    expect(r.dist).not.toBeNull();
    const mass = r.dist.bins.reduce((s, b) => s + b.prob, 0);
    expect(mass).toBeCloseTo(1, 6);          // it is still a distribution
  });

  it('does not anchor the chart or the downside to "everything loses"', () => {
    // The old page led with -$100 as the downside and plotted from it, which
    // left over half the chart empty: losing all 40 has a probability with
    // twenty zeros after the point.
    const r = analyzeSlip(card(40), null);
    expect(r.worst).toBeCloseTo(-100, 6);          // the extreme still exists
    expect(r.dist.lo).toBeGreaterThan(r.worst);    // but nothing is drawn from it
    expect(r.dist.clipped).toBe(true);
    // A 19-in-20 bad day is a small fraction of the stake, not all of it.
    expect(r.pcts.p05).toBeGreaterThan(r.worst / 2);
    expect(r.pcts.p05).toBeLessThan(r.pcts.p50);
    expect(r.pcts.p50).toBeLessThan(r.pcts.p95);
    // No dead space: with the axis clipped, the end bins carry real mass.
    const live = r.dist.bins.filter((b) => b.prob > 1e-4).length;
    expect(live).toBeGreaterThan(10);
  });

  it('recommends a plan that nothing else beats on both axes', () => {
    const plans = [
      { id: 'spread', metrics: { pProfit: 0.756, ev: 7.24 } },
      { id: 'spreadPlus', metrics: { pProfit: 0.798, ev: 9.07 } },
      { id: 'sharp', metrics: { pProfit: 0.901, ev: 17.71 } },
    ];
    // The real numbers off a 40-match card: sharp beats both others on chance
    // AND on expected profit, so recommending the spread was indefensible.
    expect(recommendedPlanId(plans)).toBe('sharp');
    // With a genuine trade-off, lead with the chance of finishing ahead.
    expect(recommendedPlanId([
      { id: 'safe', metrics: { pProfit: 0.90, ev: 4 } },
      { id: 'rich', metrics: { pProfit: 0.55, ev: 20 } },
    ])).toBe('safe');
    expect(recommendedPlanId([])).toBeNull();
  });

  it('is stable as the card grows, with no cliff at 16', () => {
    for (const n of [15, 16, 17, 18]) {
      const r = analyzeSlip(card(n), null);
      expect(r.pProfit).not.toBeNull();
      expect(r.pProfit).toBeGreaterThan(0);
    }
    const before = analyzeSlip(card(16), null).pProfit;
    const after = analyzeSlip(card(17), null).pProfit;
    expect(Math.abs(after - before)).toBeLessThan(0.25);
  });
});
