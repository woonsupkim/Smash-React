// The hindsight guard on the call-threshold tuner.
//
// The cutoffs are derived from track_record.json, which is RESIMULATED: its
// probabilities are computed with end-of-season stats. That barely moves the
// level (on 209 identical matches the resim is 1.5 points more accurate and no
// more confident) but it reorders matches at the boundary, and the tuner's
// entire rule is about the marginal band. So the input needs a test, and the
// bookmakers supply one: their vig-free price is fixed before the match, so on
// any outcome-blind subset it should calibrate the same way. Split by our own
// call/no-call classification:
//
//   forward ledger  calls +4.6pt  no-calls +4.2pt   (indistinguishable)
//   resimulated     calls +7.2pt  no-calls -6.8pt   (14pt apart, 5.4 sigma)
//
// A market cannot be wrong in two opposite directions at once, so the split is
// ours. These tests pin the guard that catches it.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import CUTOFFS from './data/callThresholds.json';
import CONFIG from './engineConfig.json';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the hindsight guard', () => {
  it('runs, and records its verdict alongside the cutoffs', () => {
    expect(CUTOFFS.source).toMatch(/resimulated/i);
    expect(CUTOFFS.hindsightGuard).toBeTruthy();
    expect(typeof CUTOFFS.hindsightGuard.passed).toBe('boolean');
    expect(typeof CUTOFFS.hindsightGuard.spreadSigma).toBe('number');
  });

  it('holds every cutoff at or above the global default while the input fails', () => {
    // The bias makes marginal bands look better than they are, so the sweep
    // stops too low. A failing input must never be allowed to LOWER a cutoff
    // below the default, which was not derived from the boundary and so is not
    // exposed to the same fault. On the current record this lifts atp|clay,
    // which the contaminated sweep had put at 0.54.
    if (CUTOFFS.hindsightGuard.passed === false) {
      const floor = CONFIG.callThreshold;
      for (const [cell, v] of Object.entries(CUTOFFS.cells)) {
        expect(`${cell}: ${v} >= ${floor}`).toBe(`${cell}: ${Math.max(v, floor)} >= ${floor}`);
      }
    }
  });

  it('keeps the guard wired into the tuner rather than merely defined', () => {
    const src = read('data-pipeline/tuneCallThreshold.js');
    expect(src).toMatch(/marketSplitCheck\(all, thresholdOf\)/);
    // It must actually gate the output, not just print a warning.
    expect(src).toMatch(/if \(!check\.ok\)/);
    expect(src).toMatch(/cells\[key\] = fallback/);
  });

  it('judges the SPREAD between groups, not either group alone', () => {
    // Both groups show the market's own favourite-longshot bias (+4pt or so on
    // clean data). Testing one group in isolation would fire on that and flag
    // honest data forever; only the difference between them is our fault.
    const src = read('data-pipeline/tuneCallThreshold.js');
    expect(src).toMatch(/const spread = calls\.gap - passes\.gap/);
  });

  it('can graduate a cell to clean data, and shows how far off each one is', () => {
    // The point of the guard is not to sit there forever. The tuner reads the
    // forward ledger per cell and uses it the moment that cell has enough
    // outcome-blind rows, which is what makes "re-derive as we collect more"
    // actually true - the resimulated record only ever gets bigger, never
    // cleaner. Hard courts are closest; clay and grass wait for next season's
    // swings, since the ledger began mid-season.
    expect(CUTOFFS.perCellSource).toBeTruthy();
    expect(CUTOFFS.cleanRowsNeeded).toBeGreaterThan(0);
    for (const cell of Object.keys(CUTOFFS.perCellSource)) {
      expect(['forward', 'resimulated']).toContain(CUTOFFS.perCellSource[cell]);
      expect(typeof CUTOFFS.cleanRowsAvailable[cell]).toBe('number');
    }
    const src = read('data-pipeline/tuneCallThreshold.js');
    expect(src).toMatch(/const useClean = cellClean\.length >= MIN_CELL/);
    // A cell already on clean data must not be floored by a guard that is
    // detecting contamination in a source it does not read.
    expect(src).toMatch(/if \(source\[key\] === 'forward'\) continue;/);
  });

  it('says the backtest is an upper bound wherever it is published', () => {
    // The plan backtest reads the same resimulated record and currently
    // reports roughly three times the forward return, so the number cannot
    // travel without that context.
    const backtest = JSON.parse(read('src/data/planBacktest.json'));
    expect(backtest.source).toMatch(/resimulated/i);
    expect(backtest.caveat).toMatch(/upper bound/i);
    expect(read('src/components/StakingPlan.js')).toMatch(/upper bound/i);
  });
});
