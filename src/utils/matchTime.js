// src/utils/matchTime.js
//
// Pre-match time helpers: "in 3h 20m" countdowns for the Happening Now
// cards and match pages, plus a viewer-local kickoff time.

// ESPN stamps a midnight-ish UTC placeholder time on a match until its order
// of play is published. Those stamps are DATE markers, not real kickoffs -
// their hour is meaningless - so we neither imply a countdown from them nor
// let them slip a calendar day across timezones. Real kickoffs for the tours
// this app covers are >= 05:00 UTC; anything earlier is treated as a
// placeholder (a rare real late-night match is only ever KEPT by this, never
// wrongly hidden).
export function isPlaceholderTime(iso) {
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getUTCHours() < 5;
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

// Is this match on the viewer's calendar day? "Today" has to mean today,
// not "within 24 hours" - a 9pm match tomorrow is not on today's card.
//
// Deliberately the VIEWER's local day, not UTC and not the tournament's:
// the page is called Today, and the visitor's own calendar is the only one
// they can check it against. Caveat worth knowing: schedules often carry a
// midnight placeholder until the order of play is published, so a match
// stamped 04:00 UTC can land on the previous evening for viewers well west
// of the venue. The placeholder is the imprecise part, not this test.
export function isToday(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  if (isPlaceholderTime(d)) {
    // Compare the placeholder's UTC calendar date to the viewer's date, so a
    // match the schedule intends for "the 11th" shows on the 11th for everyone,
    // instead of slipping onto the 10th's card for viewers west of the venue.
    return d.getUTCFullYear() === now.getFullYear()
      && d.getUTCMonth() === now.getMonth()
      && d.getUTCDate() === now.getDate();
  }
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

// A real-timed match that kicked off well over a match-length ago has already
// finished, so it's no longer an upcoming call - drop it from "today" boards.
// Placeholder-timed stamps carry no real clock, so they always stay for their
// scheduled day. Shared by the Today page and the Parlay builder.
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

// Stable, readable match-page slug: "jannik-sinner-vs-alexander-zverev-177491".
const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const matchSlug = (p) => `${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
export const idFromSlug = (slug) => String(slug || '').split('-').pop();
