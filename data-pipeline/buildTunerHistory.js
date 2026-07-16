/**
 * Prior-season component probabilities for the rolling-window tuner -
 * data-pipeline/output/tuner_history.json.
 *
 * The season's track_record.json only covers the current year, but the
 * tuner trains on a 24-month recency-weighted window (validated: +1.2pt
 * ATP walk-forward accuracy vs season-only, and no January cold start).
 * This emits the SAME component fields the tuner reads from the track
 * record - point sim, Elo, rankings - for intra-roster matches from
 * (now - 730 days) up to the season boundary.
 *
 * Leak hygiene matches the retrospective record's standards: serve/return
 * stats are aggregated point-in-time (only matches strictly before each
 * prediction date), the Elo is replayed chronologically, and rankings use
 * the current CSVs (the same accepted approximation the track record uses).
 *
 * Runs in the refresh workflow after the track record; the retune workflow
 * only READS the committed artifact, so it needs no raw data itself.
 *
 * Usage: node buildTunerHistory.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');
const { buildTimeline, predElo, expected, parseSets } = require('./eloCore');
const { matchProb } = require('./lib/analyticProb');
const ENGINE = require('../src/engineConfig.json');

const WINDOW_DAYS = 730;
const HALF_LIFE = { hard: 270, clay: 365, grass: 270 };
const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };
const SURFACE_DISPLAY = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
const normSurf = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
};

function buildTour(tour, seasonStart, windowStart) {
  const RAW = path.join(__dirname, 'raw', tour === 'wta' ? 'women' : '');
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToOur = new Map(Object.entries(idMap).map(([o, a]) => [String(a), o]));
  const surfaceMap = JSON.parse(fs.readFileSync(path.join(RAW, 'tournament-surfaces.json'), 'utf8'));
  const files = new Map();
  for (const ourId of Object.keys(idMap)) {
    const f = path.join(RAW, `${ourId}.json`);
    if (fs.existsSync(f)) files.set(ourId, JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  const ranks = {};
  for (const [s, file] of Object.entries(SURFACE_CSV)) {
    const p = path.join(__dirname, '..', 'public', 'data', tour === 'wta' ? 'women' : '', file);
    ranks[s] = new Map();
    if (fs.existsSync(p)) {
      for (const r of Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data) {
        if (r.id) ranks[s].set(r.id, Number(r.us_seed) || 999);
      }
    }
  }

  // Candidate cases: intra-roster completed matches inside the window,
  // strictly before the season boundary (the season file covers the rest).
  const seen = new Set();
  const cases = [];
  for (const [, matches] of files) {
    for (const m of matches) {
      if (m.result_type !== 'completed' || !m.date || seen.has(String(m.id))) continue;
      if (m.date < windowStart || m.date >= seasonStart) continue;
      const p1 = apiToOur.get(String(m.player1Id)), p2 = apiToOur.get(String(m.player2Id));
      if (!p1 || !p2) continue;
      const w = String(m.match_winner || '');
      if (!w || (w !== String(m.player1Id) && w !== String(m.player2Id))) continue;
      const surface = normSurf(surfaceMap[String(m.tournamentId)]);
      if (!surface) continue;
      seen.add(String(m.id));
      cases.push({ m, p1, p2, surface });
    }
  }

  // Per-surface tour averages (constant snapshot, as the backtest uses).
  const tourAvgs = {};
  for (const s of ['hard', 'clay', 'grass']) {
    const totals = emptyAgg();
    for (const [ourId, matches] of files) {
      const apiId = idMap[ourId];
      for (const m of matches) {
        const ms = surfaceMap[String(m.tournamentId)];
        if ((ms === 'I.hard' ? 'Hard' : ms) !== SURFACE_DISPLAY[s]) continue;
        accumulateMatch(emptyAgg(), totals, m, apiId, new Date(), HALF_LIFE[s]);
      }
    }
    tourAvgs[s] = deriveTourAverages(totals);
  }

  function aggAsOf(ourId, excludeId, asOf, surface) {
    const apiId = idMap[ourId];
    const agg = emptyAgg();
    for (const m of files.get(ourId) || []) {
      if (m.id === excludeId) continue;
      const ms = surfaceMap[String(m.tournamentId)];
      if ((ms === 'I.hard' ? 'Hard' : ms) !== SURFACE_DISPLAY[surface]) continue;
      accumulateMatch(agg, null, m, apiId, asOf, HALF_LIFE[surface]);
    }
    return agg;
  }

  // Leak-free pre-match Elo via chronological replay of everything.
  const timeline = new Map();
  for (const [, matches] of files) {
    for (const m of matches) {
      if (m.result_type !== 'completed') continue;
      const id = String(m.id);
      if (timeline.has(id)) continue;
      const w = String(m.match_winner || '');
      const a = String(m.player1Id || ''), b = String(m.player2Id || '');
      if (!w || (w !== a && w !== b)) continue;
      const surface = normSurf(surfaceMap[String(m.tournamentId)]);
      if (!surface) continue;
      const { setsW, setsL } = parseSets(m.result, w === a);
      timeline.set(id, { id, date: m.date, winnerId: w, loserId: w === a ? b : a, surface, setsW, setsL });
    }
  }
  const caseIds = new Set(cases.map((c) => String(c.m.id)));
  const preElo = new Map();
  buildTimeline([...timeline.values()], (mm, rw, rl) => {
    if (caseIds.has(mm.id)) preElo.set(mm.id, { winnerId: mm.winnerId, we: predElo(rw, mm.surface), le: predElo(rl, mm.surface) });
  });

  const rows = [];
  for (const { m, p1, p2, surface } of cases) {
    const asOf = new Date(m.date);
    const pa = deriveProbabilities(aggAsOf(p1, m.id, asOf, surface), tourAvgs[surface], 200);
    const pb = deriveProbabilities(aggAsOf(p2, m.id, asOf, surface), tourAvgs[surface], 200);
    if (!pa || !pb) continue;
    const pe = preElo.get(String(m.id));
    if (!pe) continue;

    const p1Won = String(m.match_winner) === String(m.player1Id);
    const boSets = parseSets(m.result, p1Won).setsW;
    const bestOf = boSets >= 3 ? 5 : boSets === 2 ? 3 : (tour === 'wta' ? 3 : 5);
    const rankA = ranks[surface].get(p1) || 999;
    const rankB = ranks[surface].get(p2) || 999;
    const eloProbP1 = pe.winnerId === String(m.player1Id)
      ? expected(pe.we, pe.le)
      : expected(pe.le, pe.we);
    const r3 = (x) => Math.round(x * 1000) / 1000;
    rows.push({
      id: String(m.id), tour, date: m.date, surface, bestOf, p1Won,
      probP1: r3(matchProb(pa, pb, bestOf)),
      eloProbP1: r3(eloProbP1),
      rankProbP1: r3(1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale))),
      od1: Number(m.odd1) > 1 ? Number(m.odd1) : null,
      od2: Number(m.odd2) > 1 ? Number(m.odd2) : null,
    });
  }
  console.log(`  ${tour}: ${rows.length} prior-window matches (of ${cases.length} candidates)`);
  return rows;
}

function run() {
  const now = new Date();
  const seasonStart = `${now.getUTCFullYear()}-01-01`;
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 864e5).toISOString();
  console.log(`Tuner history window: ${windowStart.slice(0, 10)} to ${seasonStart} (season file covers the rest)`);
  const matches = [...buildTour('atp', seasonStart, windowStart), ...buildTour('wta', seasonStart, windowStart)];
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'tuner_history.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), windowDays: WINDOW_DAYS, seasonStart, matches,
  }));
  console.log(`Wrote ${matches.length} matches to output/tuner_history.json`);
}

run();
