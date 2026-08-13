// Independent verification of the staking maths: a Monte Carlo simulation of
// the same slip, checked against the closed-form / enumerated answer.
//
// This exists because the parlay is the easy thing to get wrong. A leg can be
// backed as a single AND sit inside the parlay, so those two payouts are
// CORRELATED, and any approach that treats them separately will get the risk
// (though not the EV) wrong.
import { describe, it, expect } from 'vitest';
import { analyzeSlip, parlayCombo } from './utils/staking';

// Deterministic RNG so a failure is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Simulate the slip match by match, exactly as reality would settle it.
function monteCarlo(bets, parlay, trials, seed) {
  const rand = rng(seed);
  const combo = parlayCombo(bets, parlay?.legs);
  const parlayActive = (parlay?.stake || 0) > 0 && combo.priced;
  let sum = 0, ahead = 0;
  for (let t = 0; t < trials; t++) {
    const win = {};
    for (const b of bets) win[b.key] = rand() < b.p;
    let pl = 0;
    for (const b of bets) {
      if (!(b.single > 0)) continue;
      pl += win[b.key] ? b.single * (b.o - 1) : -b.single;
    }
    if (parlayActive) {
      pl += parlay.legs.every((k) => win[k]) ? parlay.stake * (combo.o - 1) : -parlay.stake;
    }
    sum += pl;
    if (pl > 1e-9) ahead++;
  }
  return { ev: sum / trials, pProfit: ahead / trials };
}

describe('parlay maths, verified against simulation', () => {
  // A leg backed BOTH ways: single on Swiatek and Swiatek inside the parlay.
  const correlated = [
    { key: 'swiatek', p: 0.724, o: 1.46, single: 30 },
    { key: 'shelton', p: 0.688, o: 1.47, single: 10 },
    { key: 'lys', p: 0.662, o: 1.52, single: 0 },
  ];
  const parlay = { stake: 15, legs: ['swiatek', 'shelton', 'lys'] };

  it('combined probability and price are the products of the legs', () => {
    const c = parlayCombo(correlated, parlay.legs);
    expect(c.p).toBeCloseTo(0.724 * 0.688 * 0.662, 12);
    expect(c.o).toBeCloseTo(1.46 * 1.47 * 1.52, 12);
    expect(c.edge).toBeCloseTo(c.p * c.o - 1, 12);
  });

  it('expected value matches simulation even with a leg bet twice', () => {
    const exact = analyzeSlip(correlated, parlay);
    const sim = monteCarlo(correlated, parlay, 400000, 12345);
    // EV is a mean, so it converges fast: 2c on a ~$55 slip is well inside noise.
    expect(sim.ev).toBeCloseTo(exact.ev, 1);
  });

  it('probability of finishing ahead matches simulation', () => {
    const exact = analyzeSlip(correlated, parlay);
    const sim = monteCarlo(correlated, parlay, 400000, 999);
    expect(Math.abs(sim.pProfit - exact.pProfit)).toBeLessThan(0.005);
  });

  it('worst and best cases are the true extremes of the simulation', () => {
    const exact = analyzeSlip(correlated, parlay);
    // Everything loses: you are out exactly what you staked, never more.
    expect(exact.worst).toBeCloseTo(-(30 + 10 + 15), 10);
    // Everything wins: every single pays, and the parlay pays its full price.
    const c = parlayCombo(correlated, parlay.legs);
    expect(exact.best).toBeCloseTo(30 * 0.46 + 10 * 0.47 + 15 * (c.o - 1), 8);
  });

  it('the histogram is a real probability distribution over the P&L range', () => {
    const { dist, worst, best } = analyzeSlip(correlated, parlay);
    expect(dist.bins.reduce((s, b) => s + b.prob, 0)).toBeCloseTo(1, 10);
    expect(dist.lo).toBeCloseTo(worst, 10);
    expect(dist.hi).toBeCloseTo(best, 10);
    // Every bin's win flag must agree with the sign of its own midpoint.
    const span = best - worst;
    dist.bins.forEach((b, i) => {
      const mid = worst + (span * (i + 0.5)) / 15;
      expect(b.win).toBe(mid > 1e-9);
    });
  });

  it('EV is linear: it does not change when legs are correlated', () => {
    // The same money staked, but the parlay swapped for an uncorrelated pair.
    const a = analyzeSlip(correlated, parlay);
    const b = analyzeSlip(correlated, { stake: 15, legs: ['shelton', 'lys'] });
    // Different parlays, so different EV totals - but each must equal the sum
    // of its parts, which is the property that makes EV safe to add up.
    for (const [res, legs] of [[a, parlay.legs], [b, ['shelton', 'lys']]]) {
      const c = parlayCombo(correlated, legs);
      const singlesEv = correlated.reduce((s, x) => s + x.single * (x.p * x.o - 1), 0);
      expect(res.ev).toBeCloseTo(singlesEv + 15 * c.edge, 10);
    }
  });

  it('a parlay of favourites is far less likely than any single leg', () => {
    // The headline honesty check: three ~70% calls do not make a ~70% bet.
    const c = parlayCombo(correlated, parlay.legs);
    expect(c.p).toBeLessThan(0.35);
    for (const b of correlated) expect(c.p).toBeLessThan(b.p);
  });
});
