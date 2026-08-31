import { describe, it, expect } from 'vitest';
import { analyzeSlip } from './staking.mjs';
import {
  outcomePairs, lossExceedance, gainExceedance, kellyCheck, simulateBankroll, expectedLosingStreak,
} from './riskLab.mjs';

const slip = [
  { key: 'a', p: 0.72, o: 1.46, single: 30 },
  { key: 'b', p: 0.69, o: 1.47, single: 20 },
  { key: 'c', p: 0.66, o: 1.52, single: 10 },
];
const parlay = { stake: 10, legs: ['a', 'b', 'c'] };
const res = analyzeSlip(slip, parlay);

describe('outcome pairs', () => {
  it('carry the whole probability mass', () => {
    const pairs = outcomePairs(res.dist);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs.reduce((s, x) => s + x.prob, 0)).toBeCloseTo(1, 6);
  });
});

describe('loss exceedance', () => {
  const ladder = lossExceedance(res.dist, [10, 25, 50, 70]);

  it('is monotonically non-increasing: bigger losses are never more likely', () => {
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].prob).toBeLessThanOrEqual(ladder[i - 1].prob + 1e-12);
    }
  });

  it('never exceeds the probability of losing anything at all', () => {
    const pLoseSomething = outcomePairs(res.dist)
      .filter((x) => x.pl < 0).reduce((s, x) => s + x.prob, 0);
    for (const step of ladder) expect(step.prob).toBeLessThanOrEqual(pLoseSomething + 1e-9);
  });

  it('losing more than everything staked is impossible', () => {
    const [beyond] = lossExceedance(res.dist, [res.staked + 1]);
    expect(beyond.prob).toBe(0);
  });
});

describe('kelly check', () => {
  it('flags a slip staked far beyond growth-optimal as ruinous', () => {
    // Same bets, a bankroll far too small for them.
    const c = kellyCheck(slip, 100, { stake: 10, p: res.parlay.p, o: res.parlay.o });
    expect(c.ratio).toBeGreaterThan(2);
    expect(c.band).toBe('ruinous');
    expect(c.exposure).toBeCloseTo(70 / 100, 10);
  });

  it('calls a proportionally tiny slip conservative', () => {
    const c = kellyCheck(slip, 100000, { stake: 10, p: res.parlay.p, o: res.parlay.o });
    expect(c.ratio).toBeLessThan(0.55);
    expect(c.band).toBe('conservative');
  });

  it('reports no Kelly stake at all when nothing beats its price', () => {
    // Every bet -EV: Kelly says stake zero, so no ratio exists.
    const bad = [{ key: 'x', p: 0.4, o: 1.5, single: 25 }];
    const c = kellyCheck(bad, 1000, null);
    expect(c.kellyStake).toBe(0);
    expect(c.ratio).toBeNull();
    expect(c.band).toBe('none');
  });
});

describe('bankroll simulation', () => {
  const sim = simulateBankroll(res.dist, { bankroll: 1000, days: 30, trials: 1500 });

  it('is deterministic for the same slip', () => {
    const again = simulateBankroll(res.dist, { bankroll: 1000, days: 30, trials: 1500 });
    expect(again.p50).toEqual(sim.p50);
    expect(again.riskOfRuin).toBe(sim.riskOfRuin);
  });

  it('keeps its percentile bands in order at every step', () => {
    for (let d = 0; d <= sim.days; d++) {
      expect(sim.p05[d]).toBeLessThanOrEqual(sim.p50[d] + 1e-9);
      expect(sim.p50[d]).toBeLessThanOrEqual(sim.p95[d] + 1e-9);
    }
  });

  it('starts every band at the bankroll', () => {
    expect(sim.p05[0]).toBe(1000);
    expect(sim.p50[0]).toBe(1000);
    expect(sim.p95[0]).toBe(1000);
  });

  it('a +EV slip drifts up in the median but still has losing paths', () => {
    expect(res.ev).toBeGreaterThan(0);
    expect(sim.p50[sim.days]).toBeGreaterThan(1000);
    // The whole point of the panel: positive edge does not mean no bad runs.
    expect(sim.p05[sim.days]).toBeLessThan(1000);
    expect(sim.pDown).toBeGreaterThan(0);
  });

  it('a bankroll too small to survive variance shows real risk of ruin', () => {
    const thin = simulateBankroll(res.dist, { bankroll: 120, days: 60, trials: 1500 });
    expect(thin.riskOfRuin).toBeGreaterThan(0);
    // And a deep one should essentially never bust on the same slip.
    const deep = simulateBankroll(res.dist, { bankroll: 100000, days: 60, trials: 1500 });
    expect(deep.riskOfRuin).toBe(0);
  });

  it('never lets a busted bankroll bet its way back', () => {
    const thin = simulateBankroll(res.dist, { bankroll: 80, days: 40, trials: 400, ruinAt: 0 });
    // Ruin is absorbing, so the 5th percentile cannot climb after it dies.
    for (let d = 1; d <= thin.days; d++) {
      if (thin.p05[d - 1] <= 0) expect(thin.p05[d]).toBeLessThanOrEqual(0);
    }
  });
});

describe('expected losing streak', () => {
  it('grows as losing days get more common', () => {
    const mild = expectedLosingStreak(0.3, 100);
    const rough = expectedLosingStreak(0.6, 100);
    expect(rough).toBeGreaterThan(mild);
  });
  it('declines to answer degenerate inputs', () => {
    expect(expectedLosingStreak(0, 100)).toBeNull();
    expect(expectedLosingStreak(1, 100)).toBeNull();
    expect(expectedLosingStreak(0.5, 1)).toBeNull();
  });
});

describe('gain exceedance', () => {
  const up = gainExceedance(res.dist, [5, 20, 50, res.best]);

  it('is monotonically non-increasing: bigger wins are never more likely', () => {
    for (let i = 1; i < up.length; i++) {
      expect(up[i].prob).toBeLessThanOrEqual(up[i - 1].prob + 1e-12);
    }
  });

  it('winning more than everything can pay is impossible', () => {
    const [beyond] = gainExceedance(res.dist, [res.best + 1]);
    expect(beyond.prob).toBe(0);
  });

  it('mirrors the loss ladder: the two arms cannot both claim the same mass', () => {
    // P(win >= tiny) + P(lose >= tiny) must not exceed 1, since no single
    // outcome is both a win and a loss.
    const [win] = gainExceedance(res.dist, [0.01]);
    const [lose] = lossExceedance(res.dist, [0.01]);
    expect(win.prob + lose.prob).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('agrees with the chance of finishing ahead', () => {
    const [win] = gainExceedance(res.dist, [0.01]);
    // Same question asked two ways, so they must land in the same place.
    expect(Math.abs(win.prob - res.pProfit)).toBeLessThan(0.08);
  });
});

describe('simulation upside', () => {
  const sim = simulateBankroll(res.dist, { bankroll: 1000, days: 30, trials: 1500 });
  it('reports both arms, and they are consistent', () => {
    expect(sim.pUp).toBeGreaterThan(0);
    expect(sim.pDown).toBeGreaterThan(0);
    expect(sim.pUp + sim.pDown).toBeLessThanOrEqual(1 + 1e-9);
    expect(sim.bestCase).toBeGreaterThanOrEqual(sim.finalP95);
    expect(sim.pDouble).toBeLessThanOrEqual(sim.pUp + 1e-9);
  });
});
