// The seeding order is the one piece of bracket maths that has a single
// correct answer, so it gets pinned rather than eyeballed. It replaced a
// hardcoded 16-entry constant; the first test is that swap being exact.
import { describe, it, expect } from 'vitest';
import { seedOrder, buildSeededField, largestPowerOfTwo } from '../data-pipeline/lib/seedOrder';

describe('seedOrder', () => {
  it('reproduces the hardcoded 16-player order it replaced', () => {
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('is a permutation of 1..size for every power of two', () => {
    for (const size of [1, 2, 4, 8, 16, 32, 64, 128]) {
      const o = seedOrder(size);
      expect(o).toHaveLength(size);
      expect([...o].sort((a, b) => a - b)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
    }
  });

  it('keeps the top seeds apart for as long as the draw allows', () => {
    // The defining property: seeds 1 and 2 in opposite halves, 1-4 in
    // separate quarters, 1-8 in separate eighths. If this breaks, the top
    // seed can meet the second seed in round one and every title
    // probability downstream is wrong.
    const size = 128;
    const o = seedOrder(size);
    for (const group of [2, 4, 8, 16]) {
      const block = size / group;
      const blocks = new Set();
      for (let seed = 1; seed <= group; seed++) {
        blocks.add(Math.floor(o.indexOf(seed) / block));
      }
      expect(`top ${group} occupy ${blocks.size} of ${group} blocks`)
        .toBe(`top ${group} occupy ${group} of ${group} blocks`);
    }
  });

  it('rejects a draw size that is not a power of two', () => {
    for (const bad of [0, 3, 17, 100, -8, 2.5]) {
      expect(() => seedOrder(bad)).toThrow(/power of two/);
    }
  });
});

describe('buildSeededField', () => {
  const ranked = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, rank: i + 1 }));

  it('pads a short roster at the WEAKEST seed positions', () => {
    // A real slam draw is 128 and the roster carries about 119, so the gap
    // has to go somewhere. Putting it anywhere but the bottom seeds would
    // hand some top seed an unearned walkover route.
    const field = buildSeededField(ranked(119), 128);
    expect(field).toHaveLength(128);
    const quals = field.filter((p) => p.qualifier);
    expect(quals).toHaveLength(9);
    expect(Math.min(...quals.map((p) => p.seed))).toBeGreaterThan(119);
  });

  it('adds no placeholders when the roster fills the draw', () => {
    expect(buildSeededField(ranked(128), 128).some((p) => p.qualifier)).toBe(false);
  });

  it('lays the field out in draw order, not seed order', () => {
    const field = buildSeededField(ranked(16), 16);
    expect(field.map((p) => p.seed)).toEqual(seedOrder(16));
  });
});

describe('largestPowerOfTwo', () => {
  it('picks the biggest full round a roster can fill', () => {
    expect(largestPowerOfTwo(119)).toBe(64);
    expect(largestPowerOfTwo(128)).toBe(128);
    expect(largestPowerOfTwo(1)).toBe(1);
    expect(largestPowerOfTwo(0)).toBe(0);
  });
});
