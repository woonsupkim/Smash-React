// Which tournament the share assets call "live".
//
// edge-live-plan picked the event with the MOST graded rows in a 21-day
// window. A finished tournament outvotes the running one for as long as it
// stays in that window, and the bias is doubled because the live event is
// exactly the one whose latest days are not graded yet. With Cincinnati on 95
// graded rows and the US Open on 45, the card headlined CINCINNATI through the
// first week of a slam.
//
// The rule is now ownership of the most recent settled day, which is the same
// majority partition planSettle already uses, so the card and the tournament
// totals cannot name different events for the same day.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'data-pipeline', 'buildShareAssets.js'),
  'utf8'
);

describe('the live event is the most recent one, not the biggest', () => {
  it('resolves it through the shared day-ownership map', () => {
    expect(src).toMatch(/planSettle\.eventDayOwner\(preds\.predictions \|\| \[\]\)/);
  });

  it('never ranks candidate events by how many rows they have', () => {
    // The old bug in one line: tally per event, sort by count, take the top.
    expect(src).not.toMatch(/counts\.set\(m\.event/);
    expect(src).not.toMatch(/\[\.\.\.counts\.entries\(\)\]\s*\.?\s*sort/);
  });

  it('does not reintroduce a fixed lookback window to choose it', () => {
    expect(src).not.toMatch(/21 \* 864e5/);
  });
});

// The day-money card and the results card count different populations on the
// same day: results reads track_record.json (every match the model graded),
// day-money reads the forward ledger and keeps only rows with a stampable
// price. Both are correct; the feed contradicted itself because both said
// "calls". These pin the labels that tell them apart, and the two bases the
// card reports money on.
describe('day-money names its own basis', () => {
  it('labels the count as priced calls, not just calls', () => {
    expect(src).toMatch(/priced calls that landed/);
    expect(src).toMatch(/priced calls landed/);
  });

  it('says the dollar stat includes the stake back', () => {
    expect(src).toMatch(/back on every \$10 staked, stake included/);
  });

  it('keeps the headline on net return, not the gross multiplier', () => {
    // pctOf(run.roi) is net: a losing day must still carry a minus sign.
    expect(src).toMatch(/headline1: pctOf\(run\.roi\)/);
    expect(src).not.toMatch(/headline1: pctOf\(100 \+ run\.roi\)/);
  });
});
