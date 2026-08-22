// The no-call ledger contract. A coin flip below engineConfig.callThreshold
// locks with noCall: true - graded for audit, priced by the parlay builder,
// NEVER counted as a call. These pin the three behaviors that must not
// drift apart, because excluded-by-negation is this repo's documented bug
// class (a void once counted as a miss and understated the record by five
// points; a no-call counted as a call would inflate it the same way).
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import CONFIG from './engineConfig.json';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the no-call threshold', () => {
  it('exists, is a coin-flip band, and stays below the leans tier', () => {
    expect(CONFIG.callThreshold).toBeGreaterThan(0.5);
    expect(CONFIG.callThreshold).toBeLessThanOrEqual(0.65);
  });

  it('is applied at lock time in buildPredictions', () => {
    const src = read('data-pipeline/buildPredictions.js');
    expect(src).toMatch(/favProb < \(ENGINE\.callThreshold \|\| 0\)/);
    expect(src).toMatch(/noCall: true/);
  });
});

describe('headline surfaces count calls only', () => {
  // The exact forward-record filter, replicated. Rows: one call won, one
  // call lost, one NO-CALL won, one void. Correct answer: 1 of 2.
  const rows = [
    { status: 'won', correct: true },
    { status: 'lost', correct: false },
    { status: 'won', correct: true, noCall: true },
    { status: 'void', correct: false },
  ];
  const decided = rows.filter((p) => (p.status === 'won' || p.status === 'lost') && !p.noCall);

  it('a graded no-call never enters the forward record', () => {
    expect(decided.length).toBe(2);
    expect(decided.filter((p) => p.correct).length).toBe(1);
  });

  it('every headline consumer carries the flag check', () => {
    for (const f of ['src/pages/Home.js', 'src/pages/TrackRecord.js', 'data-pipeline/buildDigest.js', 'data-pipeline/buildShareAssets.js', 'data-pipeline/checkGuardrails.js']) {
      expect(read(f), f).toMatch(/&& !p(r)?\.noCall/);
    }
  });
});

describe('the staking universe still includes no-calls', () => {
  it('Parlay legs filter on status only (the builder bets edges, not calls)', () => {
    const src = read('src/pages/Parlay.js');
    // The legs selection must NOT exclude noCall...
    expect(src).toMatch(/status === 'pending' && isToday\(p\.date\) && stillUpcoming\(p\.date\)/);
    // ...while the "most confident" suggestions must.
    expect(src).toMatch(/filter\(\(x\) => !x\.noCall\)/);
  });

  it('plan settlement ignores the flag entirely', () => {
    expect(read('data-pipeline/lib/planSettle.js')).not.toMatch(/noCall/);
  });
});
