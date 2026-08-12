import { describe, it, expect } from 'vitest';
import { edgePerDollar, kellyFraction, analyzeSlip, recommendStakes } from './staking';

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
