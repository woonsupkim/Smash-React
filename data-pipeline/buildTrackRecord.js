/**
 * Builds public/data/track_record.json — every completed 2026 French Open and
 * Wimbledon singles match (main draw) where BOTH players are in the SMASH
 * roster, for both tours. The frontend re-simulates each matchup client-side
 * and compares the model's pick against the actual result.
 *
 * Match data comes from the per-player caches in data-pipeline/raw/ — each
 * match appears in both players' files, so results are deduped by match id.
 *
 * Usage: node buildTrackRecord.js
 */
const fs = require('fs');
const path = require('path');

// Tournament ids per tour (identified from the cached match data itself:
// the clay/grass tournaments with the largest match volume in the Slam
// date windows, cross-checked against tournament-surfaces.json).
const SLAMS = {
  atp: { fr: '21329', wb: '21337' },
  wta: { fr: '16725', wb: '16733' },
};

// Matchstat roundIds: 1-3 qualifying, then main draw.
const ROUND_LABELS = {
  4: 'Round 1', 5: 'Round 2', 6: 'Round 3', 7: 'Round of 16',
  8: 'Round of 16', 9: 'Quarterfinal', 10: 'Semifinal', 11: 'Final', 12: 'Final',
};

function collect(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const RAW = path.join(__dirname, 'raw', ns);
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([shortId, apiId]) => [String(apiId), shortId]));
  const slamIds = new Set(Object.values(SLAMS[tour]));
  const tourneyById = Object.fromEntries(Object.entries(SLAMS[tour]).map(([k, v]) => [v, k]));

  const out = new Map(); // matchId -> record
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    const matches = Array.isArray(j) ? j : (j.matches || j.data || []);
    for (const m of matches) {
      const tid = String(m.tournamentId || m.tournament?.id || '');
      if (!slamIds.has(tid)) continue;
      if (m.result_type !== 'completed') continue;
      if ((m.roundId || 0) < 4) continue; // skip qualifying
      const p1 = apiToShort.get(String(m.player1Id));
      const p2 = apiToShort.get(String(m.player2Id));
      if (!p1 || !p2) continue; // only roster-vs-roster
      if (out.has(String(m.id))) continue;
      out.set(String(m.id), {
        id: String(m.id),
        tour,
        tourney: tourneyById[tid], // 'fr' | 'wb'
        date: m.date,
        round: ROUND_LABELS[m.roundId] || `Round ${m.roundId}`,
        roundId: m.roundId,
        p1, p2,
        name1: m.player1?.name || p1,
        name2: m.player2?.name || p2,
        winner: apiToShort.get(String(m.match_winner)),
        score: m.result || '',
      });
    }
  }
  return [...out.values()];
}

const records = [...collect('atp'), ...collect('wta')]
  .sort((a, b) => new Date(a.date) - new Date(b.date));

const summary = {};
for (const r of records) {
  const k = `${r.tour}-${r.tourney}`;
  summary[k] = (summary[k] || 0) + 1;
}
console.log('Matches collected:', summary);

const outPath = path.join(__dirname, '..', 'public', 'data', 'track_record.json');
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), matches: records }, null, 1));
console.log(`Wrote ${records.length} matches to ${outPath}`);
