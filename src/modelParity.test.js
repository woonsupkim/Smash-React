// Guards the "the live number equals the graded number" invariant.
//
// The prediction math is implemented twice - once for the browser
// (src/analyticProb.js, src/engines.js) and once for the pipeline that locks
// and grades predictions (data-pipeline/lib/analyticProb.js, eloCore.js).
// They are kept in sync by hand. This test fails the build the moment they
// drift, which is exactly what silently makes the site show one probability
// and grade a different one.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import * as browserAnalytic from './analyticProb';
import { eloProb } from './engines';
import CONFIG from './engineConfig.json';

const require = createRequire(import.meta.url);
const pipeAnalytic = require('../data-pipeline/lib/analyticProb.js');
const eloCore = require('../data-pipeline/eloCore.js');

// Deterministic pseudo-random point-stat vectors (p1..p6 in a plausible range).
function vec(seed) {
  let s = seed >>> 0;
  const out = [];
  for (let i = 0; i < 6; i++) { s = (s * 1103515245 + 12345) >>> 0; out.push(0.3 + 0.55 * (s / 0xffffffff)); }
  return out;
}

describe('browser <-> pipeline model parity', () => {
  it('matchProb (win probability) is identical for best-of-3 and best-of-5', () => {
    for (let i = 1; i < 60; i++) {
      const a = vec(i), b = vec(i * 31 + 7);
      for (const bo of [3, 5]) {
        expect(browserAnalytic.matchProb(a, b, bo)).toBeCloseTo(pipeAnalytic.matchProb(a, b, bo), 12);
      }
    }
  });

  it('matchDetail (win prob + set-score distribution) is identical, tempered and untempered', () => {
    for (let i = 1; i < 40; i++) {
      const a = vec(i * 5 + 1), b = vec(i * 9 + 3);
      for (const bo of [3, 5]) for (const temp of [1, CONFIG.scoreline?.bo5Temp ?? 2.35]) {
        const db = browserAnalytic.matchDetail(a, b, bo, temp);
        const dp = pipeAnalytic.matchDetail(a, b, bo, temp);
        expect(db.probP1).toBeCloseTo(dp.probP1, 12);
        expect(db.target).toBe(dp.target);
        for (let s = 0; s < 2; s++) {
          expect(db.lossDist[s].length).toBe(dp.lossDist[s].length);
          db.lossDist[s].forEach((v, k) => expect(v).toBeCloseTo(dp.lossDist[s][k], 12));
        }
      }
    }
  });

  it("eloProb uses the pipeline's rho blend (guards the hardcoded-0.5 regression)", () => {
    // Full rating objects (every surface present, like committed elo.json), so
    // the two implementations' blends are directly comparable.
    const mk = (all, hard, clay, grass) => ({ all, hard, clay, grass, n: 50 });
    const cases = [
      [mk(1700, 1720, 1650, 1600), mk(1550, 1500, 1580, 1560), 'hard'],
      [mk(1800, 1750, 1900, 1700), mk(1750, 1770, 1740, 1730), 'clay'],
      [mk(1600, 1620, 1550, 1680), mk(1650, 1600, 1640, 1700), 'grass'],
    ];
    for (const [ra, rb, surface] of cases) {
      expect(eloProb(ra, rb, surface)).toBeCloseTo(eloCore.winProbElo(ra, rb, surface), 10);
    }
  });

  it('rho actually flows from engineConfig into eloProb (not hardcoded)', () => {
    // If eloProb ignored config and hardcoded 0.5, this would only pass when
    // rho happens to be 0.5. Compare against the explicit rho blend formula.
    const rho = CONFIG.elo?.rho ?? 0.5;
    const ra = { all: 1700, hard: 1500, clay: 1500, grass: 1500 };
    const rb = { all: 1500, hard: 1700, clay: 1700, grass: 1700 };
    const predA = rho * ra.all + (1 - rho) * ra.hard;
    const predB = rho * rb.all + (1 - rho) * rb.hard;
    const expected = 1 / (1 + Math.pow(10, (predB - predA) / 400));
    expect(eloProb(ra, rb, 'hard')).toBeCloseTo(expected, 12);
  });
});
