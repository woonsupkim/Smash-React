// The parlay page's central claim, pinned.
//
// The claim is deliberately NOT "we return more". On clean walk-forward data
// no strategy out-returns another to significance - every interval overlaps -
// and asserting a return edge is exactly what the contaminated backtests did.
// The claim is that a bet needing four things to happen busts far more often
// than the same money spread out, which is arithmetic rather than an edge and
// therefore holds in any sample.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import RISK from './data/riskBacktest.json';
import { analyzeSlip, adjustProb } from './utils/staking';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the risk claim', () => {
  it('is measured on held-out data and says so', () => {
    expect(RISK.source).toMatch(/walk-forward/i);
    expect(RISK.caveat).toMatch(/NOT significant/i);
    expect(RISK.strategies.plan.days).toBeGreaterThan(100);
  });

  it('holds in the direction the page states it', () => {
    const { plan, par3, par4, single } = RISK.strategies;
    // The whole product rests on this ordering.
    expect(plan.wipeoutPct).toBeLessThan(par4.wipeoutPct);
    expect(plan.wipeoutPct).toBeLessThan(par3.wipeoutPct);
    expect(plan.wipeoutPct).toBeLessThan(single.wipeoutPct);
    // And on the drawdown being smaller, not merely the wipeout rate.
    expect(Math.abs(plan.maxDrawdown)).toBeLessThan(Math.abs(par4.maxDrawdown));
    expect(plan.dailySd).toBeLessThan(par4.dailySd);
  });

  it('does not let the page claim a return advantage anywhere', () => {
    // If someone later adds "and it returns more", this fails. The data does
    // not support it and the caveat in the artifact says so.
    const src = read('src/components/StakingPlan.js');
    const swing = src.slice(src.indexOf('stake-swing'), src.indexOf('stake-swing-note') + 900);
    expect(swing).not.toMatch(/returns more|higher return|beats the market/i);
    expect(src).toMatch(/not claiming to make you more/i);
  });

  it('prices busting as every match losing, which a parlay leg cannot rescue', () => {
    // Two 60% picks, both backed. Ending with nothing needs both to lose.
    const p = 0.6, lam = 1;
    const bets = [
      { key: 'a', p, o: 1.8, single: 10 },
      { key: 'b', p, o: 1.8, single: 10 },
    ];
    const slip = analyzeSlip(bets, { stake: 0, legs: [] });
    const expectedBust = (1 - adjustProb(p, lam)) ** 2;
    expect(expectedBust).toBeCloseTo(0.16, 4);
    // The slip's worst case is losing all of it, and that is what bust means.
    expect(slip.worst).toBeCloseTo(-20, 6);
  });

  it('a parlay of the same legs busts far more often than backing them singly', () => {
    // Four 70% legs: singles bust at 0.3^4 = 0.81%, the parlay at 1-0.7^4 = 76%.
    const p = 0.7, n = 4;
    const singlesBust = (1 - p) ** n;
    const parlayBust = 1 - p ** n;
    expect(singlesBust).toBeCloseTo(0.0081, 4);
    expect(parlayBust).toBeCloseTo(0.7599, 4);
    expect(parlayBust / singlesBust).toBeGreaterThan(90);
  });
});

// The two receipt strips on the parlay page now carry a naive-money line. The
// live ledger currently has that naive parlay AHEAD of the plan on dollars,
// because 17 days cannot separate returns. The strip is only honest if it
// prints that number at full size and says out loud that it is noise, so both
// halves are pinned here.
describe('the receipts state the naive money honestly', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/Parlay.js'), 'utf8');

  it('reuses the comparison panel\'s leg count so the two never disagree', () => {
    expect(src).toMatch(/const NAIVE_LEGS = 4;/);
  });

  it('reports the naive stake and its bust days, not just its return', () => {
    expect(src).toMatch(/naiveStaked/);
    expect(src).toMatch(/naiveBustDays/);
  });

  it('never hides the naive return behind a favourable framing', () => {
    // No conditional that would show the naive figure only when it is losing.
    expect(src).not.toMatch(/naiveTotal\s*<\s*0\s*&&/);
    expect(src).not.toMatch(/naiveRoi\s*<\s*0\s*&&/);
  });

  it('says the return gap is luck and the bust count is not', () => {
    expect(src).toMatch(/ahead today is luck/);
    expect(src).toMatch(/left nothing is not/);
  });
});

