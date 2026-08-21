// Pins the market-gap figures the Parlay builder PUBLISHES to the graded
// record they claim to describe.
//
// This exists because the page said those calls "came in 69% of the time" when
// the record said 55% - a 14-point overstatement that survived only because
// the number was typed into a sentence and never rechecked. Any claim about
// our own record should fail the build when it drifts, not sit there being
// wrong. Tolerances are one rounding step, since the copy shows whole percent.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BAND, BEYOND_CEIL, GAP_FLOOR, GAP_CEIL, bandStats, marketProbOf } from './marketGap';

const track = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'public/data/track_record.json'), 'utf8')
);
const rows = track.matches;
const priced = rows.filter((r) => marketProbOf(r) != null && typeof r.correct === 'boolean');

describe('the published market-gap figures match the record', () => {
  it('agrees on how many graded matches carry a price', () => {
    // Grows as the season does, so this is a floor plus a sanity ceiling
    // rather than an equality - the point is to catch a big divergence.
    expect(priced.length).toBeGreaterThanOrEqual(BAND.pricedGraded - 200);
    expect(BAND.pricedGraded).toBeLessThanOrEqual(rows.length);
  });

  it('agrees on the size of the band it suggests from', () => {
    const s = bandStats(rows);
    expect(s.n).toBeGreaterThan(0);
    expect(Math.abs(s.n - BAND.n)).toBeLessThanOrEqual(60);
  });

  it('agrees on how often those calls actually landed', () => {
    const s = bandStats(rows);
    expect(s.hitRate).toBeCloseTo(BAND.hitRate, 2);
  });

  it('agrees on what the market gave them', () => {
    const s = bandStats(rows);
    expect(s.marketImplied).toBeCloseTo(BAND.marketImplied, 2);
  });

  it('still shows a real edge over the market in that band', () => {
    // The whole reason the builder suggests from this band. If this ever
    // fails, the suggestion needs removing, not renumbering.
    const s = bandStats(rows);
    expect(s.hitRate).toBeGreaterThan(s.marketImplied);
    expect(BAND.hitRate).toBeGreaterThan(BAND.marketImplied);
  });

  it('agrees that past the ceiling the model is wrong, not brave', () => {
    const beyond = bandStats(rows, GAP_CEIL, 1);
    expect(beyond.hitRate).toBeCloseTo(BEYOND_CEIL.hitRate, 2);
    expect(beyond.stated).toBeCloseTo(BEYOND_CEIL.stated, 2);
    // The claim that justifies having a ceiling at all: stated confidence
    // runs well ahead of what those calls actually did.
    expect(beyond.stated).toBeGreaterThan(beyond.hitRate);
  });

  it('the ceiling band really is worse than the suggested band', () => {
    const inBand = bandStats(rows);
    const beyond = bandStats(rows, GAP_CEIL, 1);
    expect(inBand.hitRate).toBeGreaterThan(beyond.hitRate);
  });
});

describe('marketProbOf', () => {
  it('strips the vig and orients to our pick', () => {
    // Even prices: both sides 50% after the vig comes out.
    expect(marketProbOf({ od1: 2, od2: 2, favorite: 'a', p1: 'a' })).toBeCloseTo(0.5, 9);
    // Short price on p1, and we favour p1.
    const p = marketProbOf({ od1: 1.5, od2: 3, favorite: 'a', p1: 'a' });
    expect(p).toBeCloseTo(2 / 3, 9);
    // Same row, but our pick is the other side.
    expect(marketProbOf({ od1: 1.5, od2: 3, favorite: 'b', p1: 'a' })).toBeCloseTo(1 / 3, 9);
  });

  it('returns null without a usable price', () => {
    expect(marketProbOf({ od1: null, od2: 2, favorite: 'a', p1: 'a' })).toBeNull();
    expect(marketProbOf({ od1: 1, od2: 2, favorite: 'a', p1: 'a' })).toBeNull();
  });
});

describe('the gap window itself', () => {
  it('has a floor and a ceiling, in that order', () => {
    expect(GAP_FLOOR).toBeGreaterThan(0);
    expect(GAP_CEIL).toBeGreaterThan(GAP_FLOOR);
  });

  it('flagging any gap at all would be close to meaningless', () => {
    // The justification for having a floor: it fires on about half the card.
    const anyGap = priced.filter((r) => r.favProb - marketProbOf(r) > 0);
    const share = anyGap.length / priced.length;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.7);
  });
});
