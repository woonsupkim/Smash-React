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
// Buckets are VENUE days, not UTC ones. A night session finishing at 10:30pm
// in New York is stamped 02:30Z the following day, so UTC bucketing filed it
// under tomorrow: that is how a one-match phantom "Aug 30" appeared in the
// record when Aug 30 had not been played yet. See lib/eventDay.js.
const { eventDay, yesterdayEvent, fmtEventDate } = require('./eventDay');

const dayISOof = eventDay;
const yesterdayISO = yesterdayEvent;
const weekdayOf = (day) => fmtEventDate(day, { weekday: 'long' });

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
      : fmtEventDate(day, { weekday: 'long', month: 'long', day: 'numeric' }),
  };
}

module.exports = { recapDay, yesterdayISO, dayISOof };
