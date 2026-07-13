// src/utils/currentSlam.js
//
// Which grand slam is contextually "now": the one in progress, or the next
// one coming up. Drives the default surface on H2H and the default
// tournament on Dream Brackets, so during Wimbledon the app opens on grass
// instead of always defaulting to the US Open.
//
// Windows are generous (draw week through finals) and align with the
// data-refresh cron in .github/workflows/refresh-data.yml. The Australian
// Open maps to hard court; the app has no AO bracket, so the US Open stands
// in wherever a tournament (not just a surface) is needed.

const SLAM_CALENDAR = [
  // [monthEnd, dayEnd, surface, tournamentCsv] - active through that date
  [2, 2, 'hard', 'smash_us.csv'],   // Australian Open (through Feb 2)
  [6, 10, 'clay', 'smash_fr.csv'],  // French Open (upcoming/live through Jun 10)
  [7, 15, 'grass', 'smash_wb.csv'], // Wimbledon (through Jul 15)
  [12, 31, 'hard', 'smash_us.csv'], // US Open and the run-up to next AO
];

function pick(now = new Date()) {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return SLAM_CALENDAR.find(([em, ed]) => m < em || (m === em && d <= ed)) || SLAM_CALENDAR[SLAM_CALENDAR.length - 1];
}

export function currentSlamSurface(now) {
  return pick(now)[2];
}

export function currentSlamCsv(now) {
  return pick(now)[3];
}
