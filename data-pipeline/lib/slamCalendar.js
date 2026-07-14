/**
 * Grand-slam calendar rules (approximate official scheduling conventions,
 * good to within a day or two, which is all the countdown and off-season
 * projection need):
 *   Australian Open - Monday of the 3rd full week of January (hard)
 *   French Open     - last Sunday of May (clay)
 *   Wimbledon       - last Monday of June (grass)
 *   US Open         - last Monday of August (hard)
 *
 * Mirrored client-side in src/utils/currentSlam.js (nextSlam); keep the two
 * in sync if the rules change.
 */
function nthMonday(year, month, n) {
  const d = new Date(Date.UTC(year, month, 1));
  const offset = (8 - d.getUTCDay()) % 7; // days to first Monday
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
}
function lastWeekday(year, month, weekday) {
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  const back = (d.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month, d.getUTCDate() - back));
}

function slamsForYear(year) {
  return [
    { label: 'Australian Open', surface: 'hard', start: nthMonday(year, 0, 3) },
    { label: 'French Open', surface: 'clay', start: lastWeekday(year, 4, 0) },
    { label: 'Wimbledon', surface: 'grass', start: lastWeekday(year, 5, 1) },
    { label: 'US Open', surface: 'hard', start: lastWeekday(year, 7, 1) },
  ];
}

// First slam starting strictly after `date`.
function nextSlam(date = new Date()) {
  const all = [...slamsForYear(date.getUTCFullYear()), ...slamsForYear(date.getUTCFullYear() + 1)];
  const next = all.find((s) => s.start > date);
  return next ? { label: next.label, surface: next.surface, startsAt: next.start.toISOString() } : null;
}

module.exports = { slamsForYear, nextSlam };
