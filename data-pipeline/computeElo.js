/**
 * Writes public/data/elo.json (and women/elo.json) — current surface-aware
 * Elo ratings for each roster player, computed from the full cached match
 * history. The live H2H page blends these with the point simulation.
 *
 * Usage: node computeElo.js
 */
const fs = require('fs');
const path = require('path');
const { buildTimeline } = require('./eloCore');

function normSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
}

// All completed matches from the cache (roster and non-roster opponents
// alike — a player's rating should reflect every match they played).
function collectMatches(RAW, surfaces) {
  const seen = new Map();
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    for (const m of (Array.isArray(j) ? j : (j.matches || j.data || []))) {
      if (m.result_type !== 'completed') continue;
      const w = String(m.match_winner || '');
      const p1 = String(m.player1Id || ''), p2 = String(m.player2Id || '');
      if (!w || (w !== p1 && w !== p2)) continue;
      const surface = normSurface(surfaces[String(m.tournamentId)]);
      if (!surface) continue;
      if (seen.has(String(m.id))) continue;
      seen.set(String(m.id), { date: m.date, winnerId: w, loserId: w === p1 ? p2 : p1, surface });
    }
  }
  return [...seen.values()];
}

function run(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const RAW = path.join(__dirname, 'raw', ns);
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([shortId, apiId]) => [String(apiId), shortId]));
  const surfaces = JSON.parse(fs.readFileSync(path.join(RAW, 'tournament-surfaces.json'), 'utf8'));

  const ratings = buildTimeline(collectMatches(RAW, surfaces));

  const out = {};
  for (const [apiId, r] of ratings.entries()) {
    const shortId = apiToShort.get(String(apiId));
    if (!shortId) continue; // only export roster players
    out[shortId] = {
      all: Math.round(r.all), hard: Math.round(r.hard), clay: Math.round(r.clay), grass: Math.round(r.grass), n: r.n,
    };
  }

  const dir = path.join(__dirname, '..', 'public', 'data', ns);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'elo.json'), JSON.stringify(out));
  console.log(`  ${tour}: wrote Elo for ${Object.keys(out).length} players`);
  // Sanity: show the top 5 by overall rating
  const top = Object.entries(out).sort((a, b) => b[1].all - a[1].all).slice(0, 5);
  console.log('   top:', top.map(([id, r]) => `${id} ${r.all}`).join(', '));
}

run('atp');
run('wta');
