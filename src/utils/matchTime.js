// src/utils/matchTime.js
//
// Pre-match time helpers: "in 3h 20m" countdowns for the Happening Now
// cards and match pages, plus a viewer-local kickoff time.

// The tournament's own calendar. A night session finishing at 11pm is that
// day's play, not the next day's, and the order of play is published against
// the venue's date - so that is the calendar every "which day is this match
// on" question is answered in.
export const EVENT_TZ = 'America/New_York';

const VENUE_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: EVENT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const VENUE_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: EVENT_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

/** The YYYY-MM-DD this stamp belongs to at the venue. '' when unparseable. */
export function eventDayOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : VENUE_DAY.format(d);
}

// ESPN stamps MIDNIGHT AT THE VENUE on a match until its order of play is
// published. Those stamps are DATE markers, not real kickoffs - their hour is
// meaningless - so we neither imply a countdown from them nor treat them as a
// real start.
//
// This used to test `getUTCHours() < 5`, an approximation of venue midnight
// that also swallowed every genuine evening match: a real 8:30pm start is
// stamped 00:30Z, read as a placeholder, and then pinned to its UTC date -
// the NEXT day - so last night's night session appeared on today's card.
// Midnight at the venue is the thing being detected, so it is what we test.
export function isPlaceholderTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return VENUE_CLOCK.format(d) === '00:00';
}

export function timeUntil(iso, now = Date.now()) {
  const when = new Date(iso);
  const diff = when - now;
  if (Number.isNaN(diff)) return null;
  // No real clock on a placeholder stamp: say "today", never a false "in 2h".
  if (isPlaceholderTime(when)) return { past: false, today: true, tbd: true, label: 'today' };
  if (diff > 0) {
    const mins = Math.floor(diff / 6e4);
    const h = Math.floor(mins / 60);
    const d = Math.floor(h / 24);
    if (d >= 1) return { past: false, label: `in ${d}d ${h % 24}h` };
    if (h >= 1) return { past: false, label: `in ${h}h ${mins % 60}m` };
    return { past: false, soon: true, label: mins <= 1 ? 'about to start' : `in ${mins}m` };
  }
  // The clock time has passed - but schedules routinely carry a midnight
  // placeholder until the order of play is published, so a match still
  // listed for TODAY is on today's card, not overdue. Only a pick whose
  // DAY has passed with no result is genuinely awaiting one.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (when >= startOfToday) return { past: false, today: true, label: 'today' };
  return { past: true, label: 'awaiting result' };
}

// Is this match on today's card? "Today" has to mean today, not "within 24
// hours" - a 9pm match tomorrow is not on today's card.
//
// The TOURNAMENT's day, not the viewer's and not UTC. This used to compare a
// placeholder's UTC date against the viewer's LOCAL date - two different
// calendars in one equality - so between 8pm and midnight in New York, where
// those calendars disagree, the card silently changed composition: last
// night's 8:30pm match appeared on today's, and genuine next-day matches
// popped in at midnight.
//
// It also means every viewer sees the same card. "What is on today at the US
// Open" has one answer, and it is not a function of where you are reading
// from; the same venue day now drives the site and the share assets both.
export function isToday(iso, now = new Date()) {
  const day = eventDayOf(iso);
  return !!day && day === eventDayOf(now);
}

// A real-timed match that kicked off well over a match-length ago has already
// finished, so it's no longer an upcoming call - drop it from "today" boards.
// Placeholder-timed stamps carry no real clock, so they always stay for their
// scheduled day. Shared by the Today page and the Risk Lab.
const FINISHED_AFTER_MS = 5.5 * 60 * 60 * 1000; // a long best-of-five, plus a buffer
export function stillUpcoming(iso, now = Date.now()) {
  return isPlaceholderTime(iso) || (now - new Date(iso).getTime()) < FINISHED_AFTER_MS;
}

// "Sat, Jul 12 · 11:00 AM" in the visitor's own timezone.
export function localKickoff(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Just the clock time, in the viewer's own timezone: "7:00 PM".
//
// Returns null on a placeholder stamp rather than printing its meaningless
// hour. A schedule that has not published its order of play yet says so; it
// does not invent a 12:00 AM start and let someone plan around it.
export function localStartTime(iso) {
  if (isPlaceholderTime(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// The viewer's own calendar day, spelled out, and the zone the times above
// are printed in. A page whose whole claim is "today" has to say which today
// it means, or a reader landing on cached data has no way to tell.
export function localDayLabel(now = new Date()) {
  return now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function localZoneLabel(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(now);
  const z = parts.find((x) => x.type === 'timeZoneName');
  return z ? z.value : null;
}

// Stable, readable match-page slug: "jannik-sinner-vs-alexander-zverev-177491".
const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const matchSlug = (p) => `${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
export const idFromSlug = (slug) => String(slug || '').split('-').pop();
