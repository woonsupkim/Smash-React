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
// 60 days was the best-scoring half-life in npm run backtest (lowest Brier
// score across 600+ historical roster-vs-roster matches) — rerun backtest
// periodically as more match data accumulates and adjust if it changes.
const HALF_LIFE_DAYS = Number(process.argv[2]) || 60;

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
      if (surfaceMap[String(m.tournamentId)] !== wantedSurface) continue;
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
  // "upset" runs use a much shorter half-life, so few players clear the
  // default 200-service-point bar — lower it so heavy-recency mode actually
  // produces usable (if noisier) stats instead of falling back for everyone.
  const minSvpt = suffix === '_upset' ? 60 : 200;
  const surfacesToRun = requestedSurface ? [requestedSurface] : SURFACES;

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const surface of surfacesToRun) {
    const rows = computeForSurface(surface, idMap, surfaceMap, HALF_LIFE_DAYS, minSvpt);
    const outPath = path.join(OUTPUT_DIR, `player_stats_${surface}${suffix}.csv`);
    fs.writeFileSync(outPath, Papa.unparse(rows));
    console.log(`Wrote ${rows.length} players to ${outPath} (surface=${SURFACE_DISPLAY[surface]}, half-life=${HALF_LIFE_DAYS}d)`);
  }
}

main();
