// Tests for the forward ledger's void decision.
// Run: node --test data-pipeline/*.test.js data-pipeline/lib/*.test.js
//
// This guards against SILENT DATA LOSS, which is why it is worth a test at
// all: a pick wrongly retired as an orphan disappears from the forward record
// without any crash, failing build, or log to notice. It happened for real -
// the RapidAPI monthly quota tripped its reserve floor on 2026-08-14, the
// results feed froze, and every pick played afterwards was on course to be
// voided for want of data that was never fetched.
const test = require('node:test');
const assert = require('node:assert');
const { voidVerdict, VOID_AFTER_DAYS } = require('./buildPredictions');

const DAY = 864e5;
const now = Date.parse('2026-08-20T12:00:00Z');
const at = (iso) => Date.parse(iso);

test('a match still inside the grading window is left alone', () => {
  assert.strictEqual(voidVerdict(at('2026-08-19T12:00:00Z'), at('2026-08-20T00:00:00Z'), now), 'wait');
  assert.strictEqual(voidVerdict(at('2026-08-16T12:00:00Z'), at('2026-08-20T00:00:00Z'), now), 'wait');
});

test('a healthy feed that moved past the match voids it', () => {
  // Match on the 10th, feed has results through the 20th, still no result for
  // it: a genuine walkover or withdrawal.
  assert.strictEqual(voidVerdict(at('2026-08-10T00:00:00Z'), at('2026-08-20T00:00:00Z'), now), 'void');
});

test('a STALLED feed never voids, however long the wall clock runs on', () => {
  // The real incident: feed frozen at 2026-08-14, matches played after it.
  // Matches still inside the window read 'wait'; those past it read 'hold'.
  // The property that matters is that NONE of them is ever 'void'.
  const feed = at('2026-08-14T05:00:00Z');
  const played = ['2026-08-14T05:00:00Z', '2026-08-16T00:00:00Z', '2026-08-18T00:00:00Z'];
  for (const d of played) {
    assert.notStrictEqual(voidVerdict(at(d), feed, now), 'void', `${d} must never be voided`);
  }
  // Specifically: past the window with a frozen feed is 'hold', not 'void',
  // and it stays 'hold' no matter how much later we look.
  assert.strictEqual(voidVerdict(at(played[0]), feed, now), 'hold');
  assert.strictEqual(voidVerdict(at(played[0]), feed, now + 90 * DAY), 'hold');
});

test('an empty feed never voids anything', () => {
  assert.strictEqual(voidVerdict(at('2026-01-01T00:00:00Z'), null, now), 'hold');
});

test('the boundary is the feed clock, not the wall clock', () => {
  const pred = at('2026-08-01T00:00:00Z');
  // Wall clock is far past the window in both cases; only the feed differs.
  const stalled = pred + VOID_AFTER_DAYS * DAY;          // exactly at the edge
  const moved = pred + VOID_AFTER_DAYS * DAY + 1;        // just past it
  assert.strictEqual(voidVerdict(pred, stalled, now), 'hold');
  assert.strictEqual(voidVerdict(pred, moved, now), 'void');
});

test('a feed running BEHIND the match date can never void it', () => {
  // Pathological but possible after a cache restore: feed older than the pick.
  assert.strictEqual(voidVerdict(at('2026-08-10T00:00:00Z'), at('2026-07-01T00:00:00Z'), now), 'hold');
});

test('wall-clock voiding would have erased the real incident (regression)', () => {
  // The old rule was `now - predDate > window`, with no feed check at all.
  const oldRule = (predDateMs) => (now - predDateMs > VOID_AFTER_DAYS * DAY ? 'void' : 'wait');
  const frozenFeed = at('2026-08-14T05:00:00Z');
  const played = at('2026-08-14T05:00:00Z');
  assert.strictEqual(oldRule(played), 'void', 'the old rule did void it');
  assert.strictEqual(voidVerdict(played, frozenFeed, now), 'hold', 'the new rule holds it');
});
