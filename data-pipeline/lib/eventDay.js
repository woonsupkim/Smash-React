// data-pipeline/lib/eventDay.js
//
// One notion of "what day is it" for the whole pipeline.
//
// The share builder had three incompatible ones at once:
//
//   1. `fmtDate`  formatted with no timeZone, so it printed the BUILD MACHINE's
//      local day. A match stamped 2026-09-02T02:30:00Z rendered as "Sep 1" for
//      a builder in New York and "Sep 2" for CI in UTC.
//   2. `String(date).slice(0, 10)` bucketed by the UTC calendar day, so that
//      same match counted as Sep 2.
//   3. `new Date(p.date).getTime() >= NOW` had no notion of a day at all.
//
// So selection and labelling could disagree about one match, and did: the
// story cards were built from Sep 2 rows and captioned "the full slate for
// Sep 1".
//
// The tours this app covers schedule in the VENUE's local day - a night
// session finishing at 11pm is still that day's play, not the next day's, and
// the US Open's own order of play says so. Eastern is the right zone for a
// US-Open-centric app; it is one constant here rather than a guess repeated
// at each call site.
const EVENT_TZ = process.env.EVENT_TZ || 'America/New_York';

const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** ISO stamp (or YYYY-MM-DD) -> the YYYY-MM-DD it belongs to at the venue. */
function eventDay(v) {
  if (v == null) return '';
  const s = String(v);
  // A bare date is already a day; parsing it would re-introduce the timezone
  // shift this function exists to remove.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : DAY_FMT.format(d);
}

const todayEvent = (now = new Date()) => eventDay(now.toISOString());

/** The day before `day`, as a calendar step (never an hour arithmetic one). */
function prevDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - 864e5);
  return t.toISOString().slice(0, 10);
}

const yesterdayEvent = (now = new Date()) => prevDay(todayEvent(now));

/**
 * Format a day or stamp for display, always at the venue. Callers that used
 * toLocaleDateString directly printed whatever zone the builder happened to
 * run in, which is why CI and a local rebuild disagreed.
 */
function fmtEventDate(v, opts = { month: 'short', day: 'numeric' }) {
  const day = eventDay(v);
  if (!day) return '';
  // Noon at the venue: far enough from either midnight that no DST shift can
  // move the rendered day.
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

module.exports = { EVENT_TZ, eventDay, todayEvent, yesterdayEvent, prevDay, fmtEventDate };
