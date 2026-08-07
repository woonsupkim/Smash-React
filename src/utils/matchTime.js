// src/utils/matchTime.js
//
// Pre-match time helpers: "in 3h 20m" countdowns for the Happening Now
// cards and match pages, plus a viewer-local kickoff time.

export function timeUntil(iso, now = Date.now()) {
  const when = new Date(iso);
  const diff = when - now;
  if (Number.isNaN(diff)) return null;
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
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
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
