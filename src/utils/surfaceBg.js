// src/utils/surfaceBg.js
//
// Which background photo a page wears. Keyed to the surface of the slam that
// is live or up next, which is the same idea the H2H studio and Dream
// Brackets already use - clay through the French run-up, grass at Wimbledon,
// hard for the US and Australian stretches.
//
// Today's Calls and the Risk Lab were the two pages with no photo at
// all: flat panels on a flat background, which is what made them read as
// generated rather than designed next to the rest of the site. They now share
// the same atmosphere, and because it follows the calendar the page changes
// through the season without anyone editing it.
import { liveSlam, nextSlam } from './slamCalendar';

const BY_SURFACE = { clay: 'french-bg', grass: 'wimbledon-bg', hard: 'usopen-bg' };

export function surfaceBgClass(now = new Date()) {
  const slam = liveSlam(now) || nextSlam(now);
  return BY_SURFACE[slam?.surface] || 'usopen-bg';
}
