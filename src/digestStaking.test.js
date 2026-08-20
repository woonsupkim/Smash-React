// The digest builder computes "what the plan would have returned yesterday"
// using its own copy of the edge and Kelly formulas, because the pipeline is
// CommonJS and src/utils/staking.js is an ES module that it cannot import.
//
// Two copies of a formula is exactly how this codebase has drifted before
// (see modelParity.test.js, which exists for the same reason on the model
// side). This pins them together: if either copy changes, this fails.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { edgePerDollar, kellyFraction, spreadPlan as appSpreadPlan } from './utils/staking';

// The pipeline copy is not exported, so lift it out of the source and
// evaluate it. Reading the real file is the point: a stale duplicate pasted
// into this test would defeat the whole exercise.
function pipelineCopies() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'data-pipeline', 'buildDigest.js'),
    'utf8'
  );
  const edgeSrc = src.match(/const edgePerDollar = [^;]+;/);
  const kellySrc = src.match(/const kellyFraction = \([\s\S]*?\n\};/);
  if (!edgeSrc || !kellySrc) {
    throw new Error('Could not find the mirrored staking formulas in buildDigest.js');
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${edgeSrc[0]}\n${kellySrc[0]}\nreturn { edgePerDollar, kellyFraction };`)();
}

describe('digest staking parity with src/utils/staking', () => {
  const pipeline = pipelineCopies();

  const cases = [
    [0.6, 2.0], [0.4, 2.0], [0.5, 2.0], [0.724, 1.46], [0.688, 1.47],
    [0.9, 1.05], [0.51, 1.98], [0.33, 3.26], [0.8, 1.0], [0.7, 0], [0, 2.5],
  ];

  it('edgePerDollar agrees on every case', () => {
    for (const [p, o] of cases) {
      expect(pipeline.edgePerDollar(p, o)).toEqual(edgePerDollar(p, o));
    }
  });

  it('kellyFraction agrees on every case', () => {
    for (const [p, o] of cases) {
      expect(pipeline.kellyFraction(p, o)).toEqual(kellyFraction(p, o));
    }
  });

  it('both copies refuse to stake a bet that does not beat its price', () => {
    // The guarantee the digest's "if you had followed the plan" line rests on:
    // only +EV calls ever receive money, in either implementation.
    expect(kellyFraction(0.4, 2.0)).toBe(0);
    expect(pipeline.kellyFraction(0.4, 2.0)).toBe(0);
    expect(kellyFraction(0.5, 2.0)).toBe(0); // exactly break-even is not +EV
    expect(pipeline.kellyFraction(0.5, 2.0)).toBe(0);
  });
});

// ── The spread plan ─────────────────────────────────────────────────────────
// The digest now prints the ACTUAL recommendation, not a description of the
// builder, so its mirrored spreadPlan has to agree with the app's. Behavioural
// parity rather than textual: the two are compared on fixtures, so a rewrite
// that keeps the maths is fine and a rewrite that changes it is not.
describe('spreadPlan parity with src/utils/staking', () => {
  function pipelineSpreadPlan() {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'data-pipeline', 'buildDigest.js'),
      'utf8'
    );
    const parts = [
      /const clampP = [^;]+;/,
      /const adjustProb = \([\s\S]*?\);/,
      /function spreadPlan\([\s\S]*?\n\}/,
    ].map((re) => {
      const m = src.match(re);
      if (!m) throw new Error(`Could not find ${re} in buildDigest.js`);
      return m[0];
    });
    // eslint-disable-next-line no-new-func
    return new Function(`${parts.join('\n')}\nreturn spreadPlan;`)();
  }

  const pipeline = pipelineSpreadPlan();
  const cases = [
    { bets: Array.from({ length: 10 }, (_, i) => ({ key: `m${i}`, p: 0.7, o: 1.45 })), b: 10 },
    { bets: Array.from({ length: 10 }, (_, i) => ({ key: `m${i}`, p: 0.7, o: 1.3 })), b: 10 },
    { bets: [{ key: 'a', p: 0.75, o: 1.6 }, { key: 'b', p: 0.65, o: 1.7 }, { key: 'c', p: 0.55, o: 1.7 }], b: 100 },
    { bets: [{ key: 'a', p: 0.8, o: 1.6 }, { key: 'b', p: 0.7, o: 1.5 }, { key: 'c', p: 0.2, o: 1.1 }], b: 30 },
    { bets: [{ key: 'a', p: 0.7, o: 1.6 }, { key: 'b', p: 0.7, o: 0 }], b: 100 },
  ];

  it('chooses the same matches and the same stake per match', () => {
    for (const { bets, b } of cases) {
      const app = appSpreadPlan(bets, b);
      const pipe = pipeline(bets, b, 1);
      expect(pipe.count).toBe(app.count);
      expect(pipe.perMatch).toBeCloseTo(app.perMatch, 9);
      expect(pipe.rows.map((r) => r.key).sort()).toEqual(app.legs.slice().sort());
    }
  });

  it('agrees on expected winners, expected return and cover', () => {
    for (const { bets, b } of cases) {
      const app = appSpreadPlan(bets, b);
      const pipe = pipeline(bets, b, 1);
      expect(pipe.expWinners).toBeCloseTo(app.expWinners, 9);
      expect(pipe.expReturn).toBeCloseTo(app.expReturn, 9);
      expect(pipe.coversStake).toBe(app.coversStake);
      expect(pipe.staked).toBeCloseTo(app.staked, 9);
    }
  });

  it('agrees on the chance of finishing ahead', () => {
    for (const { bets, b } of cases) {
      const app = appSpreadPlan(bets, b);
      const pipe = pipeline(bets, b, 1);
      if (app.metrics.pProfit == null || pipe.pAhead == null) continue;
      expect(pipe.pAhead).toBeCloseTo(app.metrics.pProfit, 9);
    }
  });

  it('applies the reliability haircut the same way', () => {
    const bets = [{ key: 'a', p: 0.7, o: 1.5 }];
    for (const lambda of [0.6, 1, 1.2]) {
      const app = appSpreadPlan(bets, 100, { lambda });
      const pipe = pipeline(bets, 100, lambda);
      expect(pipe.count).toBe(app.count);
      expect(pipe.expReturn).toBeCloseTo(app.expReturn, 9);
    }
  });
});
