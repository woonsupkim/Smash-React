// data-pipeline/lib/recapDay.js
//
// "Yesterday", said only when it is true.
//
// Three recap cards each picked their own "last day": the graded record for
// the results card, the settled ledger for the money card, the graded picks
// for the unexpected one. Each took whatever day happened to be last in its
// own file and printed it under the word "Yesterday". On a build run Sept 1
// whose results feed had only reached Aug 29, every one of them called
// three-day-old matches yesterday's - and the three could disagree with each
// other about which day that was.
//
// This resolves the day the same way for all of them: the day before the
// build when there are results for it, otherwise the most recent day there
// ARE results for, flagged so the copy can name it instead of lying.
//
// UTC buckets, matching the timeZone: 'UTC' that every date stamp on these
// cards already formats in.
const dayISOof = (v) => String(v).slice(0, 10);

const yesterdayISO = (now = new Date()) =>
  dayISOof(new Date(Date.parse(`${dayISOof(now.toISOString())}T00:00:00Z`) - 864e5).toISOString());

const weekdayOf = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/**
 * @param days iterable of ISO stamps or YYYY-MM-DD strings that have
 *             something to show.
 * @param now  injectable clock, so this is testable and so a build that
 *             straddles midnight resolves one day rather than two.
 * @returns {{day, isYesterday, cap, poss, long}|null} null when there is
 *          nothing at all to recap.
 */
function recapDay(days, now = new Date()) {
  const want = yesterdayISO(now);
  const have = [...new Set([...days].map(dayISOof))].filter(Boolean).sort();
  if (!have.length) return null;
  const day = have.includes(want) ? want : have[have.length - 1];
  const isYesterday = day === want;
  return {
    day,
    isYesterday,
    // For a headline: "YESTERDAY", or the weekday it actually was.
    cap: isYesterday ? 'YESTERDAY' : weekdayOf(day).toUpperCase(),
    // For running prose: "yesterday's calls", or "Saturday's calls".
    poss: isYesterday ? "yesterday's" : `${weekdayOf(day)}'s`,
    // For a caption that has room to be unambiguous.
    long: isYesterday
      ? 'yesterday'
      : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
  };
}

module.exports = { recapDay, yesterdayISO, dayISOof };
