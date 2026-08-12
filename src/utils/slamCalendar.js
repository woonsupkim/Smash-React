// src/utils/slamCalendar.js
//
// The grand-slam calendar, once, for the whole client. This used to be copied
// inline into Home.js, which meant the countdown and anything else that needed
// "is a slam on right now" could drift apart.
//
// Rules mirror data-pipeline/lib/slamCalendar.js exactly (keep the two in step
// if they change):
//   Australian Open - Monday of the 3rd full week of January (hard)
//   French Open     - last Sunday of May (clay)
//   Wimbledon       - last Monday of June (grass)
//   US Open         - last Monday of August (hard)
//
// All arithmetic is UTC, like the pipeline, so the answer cannot slip a day for
// viewers west of UTC.
//
// Note: src/utils/currentSlam.js answers a different question (which roster CSV
// and surface to default a form to) using its own coarse month ranges. It is
// deliberately left alone here; this file is about dates, not defaults.

function nthMonday(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1));
  const offset = (8 - d.getUTCDay()) % 7; // days to the first Monday
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}

function lastWeekday(year, month, weekday) {
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day of the month
  const back = (d.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, d.getUTCDate() - back));
}

export const slamsIn = (y) => [
  { name: 'Australian Open', surface: 'hard', start: nthMonday(y, 0, 3) },
  { name: 'French Open', surface: 'clay', start: lastWeekday(y, 4, 0) },
  { name: 'Wimbledon', surface: 'grass', start: lastWeekday(y, 5, 1) },
  { name: 'US Open', surface: 'hard', start: lastWeekday(y, 7, 1) },
];

// A slam runs from its Monday start to the final on the second Sunday, so the
// event is over once start + 14 days has passed.
export const SLAM_RUN_MS = 14 * 864e5;

// The first slam starting strictly after `now`.
export function nextSlam(now = new Date()) {
  const all = [...slamsIn(now.getFullYear()), ...slamsIn(now.getFullYear() + 1)];
  return all.find((s) => s.start > now);
}

// The most recent slam already underway or finished, with the date it ended.
// Everything from that end date on is "between the slams".
export function prevSlam(now = new Date()) {
  const all = [...slamsIn(now.getFullYear() - 1), ...slamsIn(now.getFullYear())];
  const past = all.filter((s) => s.start <= now);
  const last = past[past.length - 1];
  if (!last) return null;
  return { ...last, end: new Date(last.start.getTime() + SLAM_RUN_MS) };
}

// The slam being played right now, or null between events. Draw week counts:
// brackets get picked before the first ball, so the window opens LEAD_IN_MS
// early rather than on the Monday itself.
const LEAD_IN_MS = 7 * 864e5;
export function liveSlam(now = new Date()) {
  const all = [...slamsIn(now.getFullYear() - 1), ...slamsIn(now.getFullYear()), ...slamsIn(now.getFullYear() + 1)];
  return all.find((s) => {
    const opens = s.start.getTime() - LEAD_IN_MS;
    return now.getTime() >= opens && now.getTime() < s.start.getTime() + SLAM_RUN_MS;
  }) || null;
}
