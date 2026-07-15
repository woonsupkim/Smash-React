/**
 * Match records only carry a tournamentId, not a surface. This resolves
 * each unique tournamentId seen across all cached player match histories
 * to its court surface (Hard/Clay/Grass/...) via the Matchstat API's
 * tournament/info endpoint, and caches the result so computeStats.js can
 * filter matches by surface per tournament (US Open->Hard, French->Clay,
 * Wimbledon->Grass) instead of lumping all surfaces together.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOUR = process.argv[2] || 'atp';
const RAW_DIR = path.join(__dirname, 'raw', TOUR === 'wta' ? 'women' : '');
const OUT_PATH = path.join(RAW_DIR, 'tournament-surfaces.json');
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;

if (!API_KEY) {
  console.error('Missing RAPIDAPI_KEY - set it in .env (see .env.example).');
  process.exit(1);
}

async function apiGet(urlPath) {
  const res = await fetch(`https://${HOST}${urlPath}`, {
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function collectTournamentIds() {
  const ids = new Set();
  const files = fs.readdirSync(RAW_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'player-id-map.json' && f !== 'tournament-surfaces.json' && f !== 'player-profiles.json'
  );
  for (const f of files) {
    const matches = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    for (const m of matches) {
      if (m.tournamentId) ids.add(m.tournamentId);
    }
  }
  return [...ids];
}

// Tournament display names live in a sibling cache (separate file so the
// surface map's shape - consumed by half the pipeline - never changes).
// The match log uses these to label each row with its event.
const NAMES_PATH = path.join(RAW_DIR, 'tournament-names.json');
// Backfilling ~2,000 historical tournaments at 1.5s per lookup would take
// ~50 minutes in one run; cap per run and let it converge over a few runs.
const NAME_BACKFILL_PER_RUN = 300;

function extractName(data) {
  const n = data?.name || data?.title || data?.tournament?.name || null;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}

async function main() {
  const cache = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};
  const names = fs.existsSync(NAMES_PATH) ? JSON.parse(fs.readFileSync(NAMES_PATH, 'utf8')) : {};
  const ids = collectTournamentIds();
  const missing = ids.filter((id) => !(String(id) in cache));
  console.log(`${ids.length} unique tournaments referenced across cached matches, ${missing.length} need a surface lookup.`);

  for (const id of missing) {
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/tournament/info/${id}`);
      cache[String(id)] = data?.court?.name || 'Unknown';
      const nm = extractName(data);
      if (nm) names[String(id)] = nm;
      console.log(`  tournament ${id}: ${cache[String(id)]}${nm ? ` (${nm})` : ''}`);
    } catch (err) {
      // Don't cache failures (e.g. rate limiting) as "Unknown" - that would
      // permanently skip retrying them on the next run. Just leave them out
      // of the cache so they're picked up again next time.
      console.warn(`  tournament ${id}: failed (${err.message}), will retry next run`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // be polite to the API
  }

  // Name backfill for tournaments whose surface was cached before names
  // existed. Capped per run; converges over a handful of refreshes.
  const nameless = ids.filter((id) => String(id) in cache && !(String(id) in names)).slice(0, NAME_BACKFILL_PER_RUN);
  if (nameless.length) console.log(`Backfilling names for ${nameless.length} tournaments (of ${ids.filter((id) => !(String(id) in names)).length} without one)...`);
  for (const id of nameless) {
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/tournament/info/${id}`);
      const nm = extractName(data);
      if (nm) names[String(id)] = nm;
    } catch { /* retry on a later run */ }
    await new Promise((r) => setTimeout(r, 1500));
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 2));
  fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2));
  console.log(`Saved surface map for ${Object.keys(cache).length} tournaments (+${Object.keys(names).length} names) to ${RAW_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
