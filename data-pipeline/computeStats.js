/**
 * Computes time-decayed p1-p6 serve/return probabilities per player from
 * the cached Matchstat API match histories in data-pipeline/raw/, matching
 * simulator.js's semantics:
 *   p1 = 1st serve in %
 *   p2 = 2nd serve in % (given 1st missed)
 *   p3 = this player's own return-win% against 1st serves (as returner)
 *   p4 = this player's own return-win% against 2nd serves (as returner)
 *   p5 = this player's own rally-win% as server (net of aces), normalized
 *        against the tour-average returner so it isn't double-counting
 *        p1/p2/p3/p4.
 *   p6 = this player's own ace rate given the 1st serve landed in.
 *
 * Run once per surface (Hard/Clay/Grass) since serve/return stats differ
 * meaningfully by court — US Open is Hard, French Open is Clay, Wimbledon
 * is Grass. Each surface gets its own output file and its own tour-average
 * baseline (a player's clay return stats should be compared against the
 * tour's clay average, not blended with hard/grass matches).
 *
 * Usage: node computeStats.js [halfLifeDays] [surface]
 *   surface: hard | clay | grass — omit to compute all three.
 * Run `npm run backtest` to find/validate a good halfLifeDays value.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SURFACES_PATH = path.join(RAW_DIR, 'tournament-surfaces.json');
// Backtesting each surface separately (`node backtest.js <list> <surface>`)
// scores noticeably differently per surface — a single blended half-life
// (150d) was a compromise across all three. Surface-specific best Brier
// scores: hard=270d, clay=365d, grass=270d (grass's season is short and
// annual, so a too-short half-life decays away last year's Wimbledon
// fortnight before this year's rolls around). An explicit CLI arg still
// overrides ALL surfaces (used by build-upset-csv's 7-day recency mode).
const HALF_LIFE_OVERRIDE = process.argv[2] ? Number(process.argv[2]) : null;
const HALF_LIFE_BY_SURFACE = { hard: 270, clay: 365, grass: 270 };

// Grass's short annual season means far fewer matches accumulate real
// decay-weight than hard/clay even with a longer half-life — lower the bar
// so grass coverage isn't gutted by the same 200-point threshold tuned for
// the other two surfaces.
const MIN_SVPT_BY_SURFACE = { hard: 200, clay: 200, grass: 100 };

const SURFACES = ['hard', 'clay', 'grass'];
const SURFACE_DISPLAY = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };

function computeForSurface(surface, idMap, surfaceMap, halfLifeDays, minSvpt) {
  const wantedSurface = SURFACE_DISPLAY[surface];
  const now = new Date();
  const perPlayer = new Map(); // ourId -> agg
  const tourTotals = emptyAgg(); // surface-specific tour average baseline

  for (const [ourId, apiId] of Object.entries(idMap)) {
    const matchFile = path.join(RAW_DIR, `${ourId}.json`);
    if (!fs.existsSync(matchFile)) continue;
    const matches = JSON.parse(fs.readFileSync(matchFile, 'utf8'));

    const agg = perPlayer.get(ourId) || emptyAgg();
    for (const m of matches) {
      // "I.hard" (indoor hard) is a separate label from the API but plays
      // the same as outdoor hard for serve/return purposes — fold it in,
      // otherwise ~half of all hard-court matches are silently dropped.
      const matchSurface = surfaceMap[String(m.tournamentId)];
      const normalizedSurface = matchSurface === 'I.hard' ? 'Hard' : matchSurface;
      if (normalizedSurface !== wantedSurface) continue;
      accumulateMatch(agg, tourTotals, m, apiId, now, halfLifeDays);
    }
    perPlayer.set(ourId, agg);
  }

  const tourAverages = deriveTourAverages(tourTotals);

  const rows = [];
  for (const [id, agg] of perPlayer.entries()) {
    const probs = deriveProbabilities(agg, tourAverages, minSvpt);
    if (!probs) continue;
    const [p1, p2, p3, p4, p5, p6] = probs;
    rows.push({ id, p1: p1.toFixed(2), p2: p2.toFixed(2), p3: p3.toFixed(2), p4: p4.toFixed(2), p5: p5.toFixed(2), p6: p6.toFixed(2) });
  }
  return rows;
}

function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error('Missing data-pipeline/raw/player-id-map.json — run fetch.js first.');
    process.exit(1);
  }
  if (!fs.existsSync(SURFACES_PATH)) {
    console.error('Missing data-pipeline/raw/tournament-surfaces.json — run `npm run fetch-surfaces` first.');
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8')); // ourId -> apiId
  const surfaceMap = JSON.parse(fs.readFileSync(SURFACES_PATH, 'utf8')); // tournamentId -> "Hard"|"Clay"|"Grass"|...

  const requestedSurface = process.argv[3];
  const suffix = process.argv[4] ? `_${process.argv[4]}` : ''; // e.g. "upset" -> player_stats_hard_upset.csv
  const isUpset = suffix === '_upset';
  const surfacesToRun = requestedSurface ? [requestedSurface] : SURFACES;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const surface of surfacesToRun) {
    const halfLifeDays = HALF_LIFE_OVERRIDE ?? HALF_LIFE_BY_SURFACE[surface];
    // "upset" runs use a much shorter half-life, so few players clear the
    // normal per-surface bar — lower it so heavy-recency mode actually
    // produces usable (if noisier) stats instead of falling back for everyone.
    const minSvpt = isUpset ? 60 : MIN_SVPT_BY_SURFACE[surface];
    const rows = computeForSurface(surface, idMap, surfaceMap, halfLifeDays, minSvpt);
    const outPath = path.join(OUTPUT_DIR, `player_stats_${surface}${suffix}.csv`);
    fs.writeFileSync(outPath, Papa.unparse(rows));
    console.log(`Wrote ${rows.length} players to ${outPath} (surface=${SURFACE_DISPLAY[surface]}, half-life=${halfLifeDays}d, minSvpt=${minSvpt})`);
  }
}

main();
