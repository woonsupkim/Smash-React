const test = require('node:test');
const assert = require('node:assert');
const { recapDay, yesterdayISO } = require('./recapDay');

const at = (iso) => new Date(iso);

test('yesterday is the day before the BUILD, not the last row in the file', () => {
  // The bug this exists to stop: a build on Sept 1 whose data reaches Aug 31
  // used to label whichever day was last, unanchored from when it ran.
  const w = recapDay(['2026-08-29', '2026-08-30', '2026-08-31'], at('2026-09-01T16:00:00Z'));
  assert.equal(w.day, '2026-08-31');
  assert.equal(w.isYesterday, true);
  assert.equal(w.cap, 'YESTERDAY');
  assert.equal(w.poss, "yesterday's");
  assert.equal(w.long, 'yesterday');
});

test('a later day in the file never outranks the day before the build', () => {
  // Results can arrive for a day that has not finished in UTC terms; the
  // recap is still about yesterday.
  const w = recapDay(['2026-08-31', '2026-09-01'], at('2026-09-01T16:00:00Z'));
  assert.equal(w.day, '2026-08-31');
  assert.equal(w.isYesterday, true);
});

test('when the feed is behind it falls back, and stops saying yesterday', () => {
  // Aug 30 and 31 missing: the honest answer is Saturday's card, named.
  const w = recapDay(['2026-08-28', '2026-08-29'], at('2026-09-01T16:00:00Z'));
  assert.equal(w.day, '2026-08-29');
  assert.equal(w.isYesterday, false);
  assert.equal(w.cap, 'SATURDAY');
  assert.equal(w.poss, "Saturday's");
  assert.equal(w.long, 'Saturday, August 29');
});

test('full ISO stamps bucket by their UTC day', () => {
  const w = recapDay(['2026-08-31T02:30:00.000Z', '2026-08-31T23:00:00.000Z'], at('2026-09-01T00:10:00Z'));
  assert.equal(w.day, '2026-08-31');
  assert.equal(w.isYesterday, true);
});

test('nothing to recap returns null rather than a made-up day', () => {
  assert.equal(recapDay([], at('2026-09-01T16:00:00Z')), null);
});

test('the month boundary does not lose a day', () => {
  assert.equal(yesterdayISO(at('2026-09-01T00:05:00Z')), '2026-08-31');
  assert.equal(yesterdayISO(at('2026-03-01T12:00:00Z')), '2026-02-28');
  assert.equal(yesterdayISO(at('2026-01-01T12:00:00Z')), '2025-12-31');
});
