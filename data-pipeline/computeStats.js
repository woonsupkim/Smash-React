/**
 * Computes time-decayed p1-p5 serve/return probabilities per player from
 * the cached Matchstat API match histories in data-pipeline/raw/, matching
 * simulator.js's semantics:
 *   p1 = 1st serve in %
 *   p2 = 2nd serve in % (given 1st missed)
 *   p3 = this player's own return-win% against 1st serves (as returner)
 *   p4 = this player's own return-win% against 2nd serves (as returner)
 *   p5 = this player's own rally-win% as server, normalized against the
 *        tour-average returner so it isn't double-counting p1/p2/p3/p4.
 *
 * Usage: node computeStats.js [halfLifeDays]
 * Run `npm run backtest` to find/validate a good halfLifeDays value.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
// 60 days was the best-scoring half-life in npm run backtest (lowest Brier
// score across 600+ historical roster-vs-roster matches) — rerun backtest
// periodically as more match data accumulates and adjust if it changes.
const HALF_LIFE_DAYS = Number(process.argv[2]) || 60;

function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error('Missing data-pipeline/raw/player-id-map.json — run fetch.js first.');
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8')); // ourId -> apiId

  const now = new Date();
  const perPlayer = new Map(); // ourId -> agg
  const tourTotals = emptyAgg();

  for (const [ourId, apiId] of Object.entries(idMap)) {
    const matchFile = path.join(RAW_DIR, `${ourId}.json`);
    if (!fs.existsSync(matchFile)) continue;
    const matches = JSON.parse(fs.readFileSync(matchFile, 'utf8'));

    const agg = perPlayer.get(ourId) || emptyAgg();
    for (const m of matches) {
      accumulateMatch(agg, tourTotals, m, apiId, now, HALF_LIFE_DAYS);
    }
    perPlayer.set(ourId, agg);
  }

  const tourAverages = deriveTourAverages(tourTotals);

  const rows = [];
  for (const [id, agg] of perPlayer.entries()) {
    const probs = deriveProbabilities(agg, tourAverages);
    if (!probs) continue;
    const [p1, p2, p3, p4, p5] = probs;
    rows.push({ id, p1: p1.toFixed(2), p2: p2.toFixed(2), p3: p3.toFixed(2), p4: p4.toFixed(2), p5: p5.toFixed(2) });
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, 'player_stats.csv');
  fs.writeFileSync(outPath, Papa.unparse(rows));
  console.log(`Wrote ${rows.length} players to ${outPath} (half-life=${HALF_LIFE_DAYS}d)`);
}

main();
