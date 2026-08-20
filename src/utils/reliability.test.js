// Tests for the model-reliability layer: how far the model's stated
// confidence is trusted, and how a probability is re-expressed at it.
//
// This sits under every plan the builder offers - it is applied before any
// money is allocated - so it is tested on its own rather than through them.
import { describe, it, expect } from 'vitest';
import { reliability, adjustProb } from './staking';


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
