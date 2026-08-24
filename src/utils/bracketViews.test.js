// The bracket windowing arithmetic.
//
// Dream Brackets could only ever build a tournament's closing rounds, because
// a full draw drawn as one column is unusable - 64 slots is 32 first-round
// boxes, about 4,200px, and 128 is twice that. It now renders a quarter at a
// time, which means every column has to be sliced out of the whole draw at
// the right offset. Get the halving wrong and a quarter shows someone else's
// subtree, silently and plausibly, which is the reason this is pinned.
import { describe, it, expect } from 'vitest';
import { bracketViews, SEGMENT_ABOVE } from './bracketViews';

describe('bracketViews', () => {
  it('leaves a small draw as a single view', () => {
    // Small brackets must render exactly as they did before segmentation.
    for (const slots of [2, 4, 8, 16]) {
      const v = bracketViews(slots);
      expect(v).toHaveLength(1);
      expect(v[0]).toMatchObject({ roundFrom: 0, slotStart: 0, slotCount: slots, terminal: 'champion' });
    }
    expect(SEGMENT_ABOVE).toBe(16);
  });

  it('splits a big draw into four quarters plus the finals', () => {
    const v = bracketViews(64);
    expect(v.map((x) => x.id)).toEqual(['q0', 'q1', 'q2', 'q3', 'finals']);
    expect(v.slice(0, 4).map((x) => x.slotStart)).toEqual([0, 16, 32, 48]);
    for (const q of v.slice(0, 4)) {
      expect(q.slotCount).toBe(16);
      expect(q.roundFrom).toBe(0);
      // Only one view may crown anyone.
      expect(q.terminal).toBe('semifinalist');
    }
  });

  it('starts the finals view at the round holding the four quarter winners', () => {
    // rounds[r] has slots/2^r entries, so the round with exactly 4 players is
    // log2(quarterSize). Off by one here and the finals view reads the
    // quarter-finalists (8) or the finalists (2) instead of the semis.
    for (const slots of [32, 64, 128]) {
      const finals = bracketViews(slots).at(-1);
      const quarterSize = slots / 4;
      expect(finals.roundFrom).toBe(Math.log2(quarterSize));
      expect(slots / 2 ** finals.roundFrom).toBe(4);
      expect(finals.slotCount).toBe(4);
      expect(finals.terminal).toBe('champion');
    }
  });

  it('covers the whole draw exactly once, with no gap or overlap', () => {
    for (const slots of [32, 64, 128]) {
      const quarters = bracketViews(slots).filter((v) => v.id.startsWith('q'));
      const covered = quarters.flatMap((q) => Array.from({ length: q.slotCount }, (_, i) => q.slotStart + i));
      expect(new Set(covered).size).toBe(slots);
      expect(Math.min(...covered)).toBe(0);
      expect(Math.max(...covered)).toBe(slots - 1);
    }
  });

  it('keeps each quarter inside its own subtree as the rounds halve', () => {
    // This is the property the render depends on: at view column c, a quarter
    // reads slotStart/2^c for slotCount/2^c entries. Quarter 2 of a 64 draw
    // must walk 16-31, then 8-15, then 4-7, 2-3, and finally the single
    // index 1 - never straying into a neighbour's players.
    const q = bracketViews(64)[1];
    const walk = [];
    for (let c = 0; c <= Math.log2(q.slotCount); c++) {
      walk.push([q.slotStart / 2 ** c, q.slotCount / 2 ** c]);
    }
    expect(walk).toEqual([[16, 16], [8, 8], [4, 4], [2, 2], [1, 1]]);
    // Every offset stays a whole number, or a slice would straddle a match.
    for (const [start, len] of walk) {
      expect(Number.isInteger(start)).toBe(true);
      expect(Number.isInteger(len)).toBe(true);
    }
  });
});
