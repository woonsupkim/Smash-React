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

test('stamps bucket by the VENUE day, not the UTC one', () => {
  // 02:30Z is a 10:30pm night session the evening BEFORE at the venue. UTC
  // bucketing filed it under the next day, which is how a phantom one-match
  // day appeared in the record for a day that had not been played yet.
  const { eventDay } = require('./eventDay');
  assert.equal(eventDay('2026-08-31T02:30:00.000Z'), '2026-08-30');
  assert.equal(eventDay('2026-08-31T23:00:00.000Z'), '2026-08-31');

  // The clock here is 8:10pm on Aug 31 at the venue, so yesterday is Aug 30 -
  // and the 02:30Z stamp is what covers it.
  const w = recapDay(['2026-08-31T02:30:00.000Z', '2026-08-31T23:00:00.000Z'], at('2026-09-01T00:10:00Z'));
  assert.equal(w.day, '2026-08-30');
  assert.equal(w.isYesterday, true);
});

test('an evening build does not roll the day forward', () => {
  // The bug the venue day exists to stop: at 8:40pm in New York the UTC
  // clock has already turned over, so a UTC build called TODAY's matches
  // yesterday's and tomorrow's today's.
  assert.equal(yesterdayISO(at('2026-09-02T00:40:00Z')), '2026-08-31');
  assert.equal(yesterdayISO(at('2026-09-01T16:00:00Z')), '2026-08-31');
});

test('nothing to recap returns null rather than a made-up day', () => {
  assert.equal(recapDay([], at('2026-09-01T16:00:00Z')), null);
});

test('the month boundary does not lose a day', () => {
  // Clocks are read at the venue: 12:00Z is 8am there, safely mid-morning.
  assert.equal(yesterdayISO(at('2026-09-01T12:00:00Z')), '2026-08-31');
  assert.equal(yesterdayISO(at('2026-03-01T12:00:00Z')), '2026-02-28');
  assert.equal(yesterdayISO(at('2026-01-01T12:00:00Z')), '2025-12-31');
});

test('a leap day is a real day', () => {
  assert.equal(yesterdayISO(at('2028-03-01T12:00:00Z')), '2028-02-29');
});
