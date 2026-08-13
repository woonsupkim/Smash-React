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
import { edgePerDollar, kellyFraction } from './utils/staking';

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
