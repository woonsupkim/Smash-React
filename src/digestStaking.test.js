// The digest used to carry hand-copied versions of the staking formulas -
// "the pipeline is CommonJS and cannot import the ES module" - and this file
// pinned the copies to the originals. The copies still drifted in the way a
// formula-parity test cannot catch: the app moved to a scored plan menu and
// the digest kept faithfully mirroring the OLD recommendation, and its
// reliability filter expected ledger fields it was never given, so lambda
// silently read 1.0 forever.
//
// staking.mjs is importable from Node now and buildDigest runs the real
// module, so what this file pins today is the ABSENCE of copies: the moment
// someone pastes a staking formula back into the digest, this fails and sends
// them to the import instead.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'data-pipeline', 'buildDigest.js'),
  'utf8'
);

describe('the digest runs the real staking module, not a mirror', () => {
  it('imports staking.mjs', () => {
    expect(src).toMatch(/import\(pathToFileURL\(.*staking\.mjs/);
    expect(src).toMatch(/staking = await stakingReady/);
  });

  it('carries no local reimplementation of the staking maths', () => {
    // Declarations, not mentions: comments may (and do) tell the story.
    expect(src).not.toMatch(/const edgePerDollar\s*=/);
    expect(src).not.toMatch(/const kellyFraction\s*=/);
    expect(src).not.toMatch(/function spreadPlan\s*\(/);
    expect(src).not.toMatch(/function reliability\s*\(/);
    expect(src).not.toMatch(/const adjustProb\s*=/);
  });

  it('builds plans and reliability from the ledger, not the track record', () => {
    // The builder only offers plans over locked calls, so both the haircut
    // and any settlement must come from predictions.json rows. Settling from
    // the track record would price a plan that never existed on the site.
    expect(src).toMatch(/staking\.reliability\(ledgerGraded\(preds\)\)/);
    expect(src).toMatch(/planReturns\(preds,/);
    expect(src).not.toMatch(/planReturns\(ydayAll/);
  });
});
