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

const RAW_DIR = path.join(__dirname, 'raw');
const OUT_PATH = path.join(RAW_DIR, 'tournament-surfaces.json');
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;
const TOUR = 'atp';

if (!API_KEY) {
  console.error('Missing RAPIDAPI_KEY — set it in .env (see .env.example).');
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
    (f) => f.endsWith('.json') && f !== 'player-id-map.json' && f !== 'tournament-surfaces.json'
  );
  for (const f of files) {
    const matches = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    for (const m of matches) {
      if (m.tournamentId) ids.add(m.tournamentId);
    }
  }
  return [...ids];
}

async function main() {
  const cache = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};
  const ids = collectTournamentIds();
  const missing = ids.filter((id) => !(String(id) in cache));
  console.log(`${ids.length} unique tournaments referenced across cached matches, ${missing.length} need a surface lookup.`);

  for (const id of missing) {
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/tournament/info/${id}`);
      cache[String(id)] = data?.court?.name || 'Unknown';
      console.log(`  tournament ${id}: ${cache[String(id)]}`);
    } catch (err) {
      // Don't cache failures (e.g. rate limiting) as "Unknown" — that would
      // permanently skip retrying them on the next run. Just leave them out
      // of the cache so they're picked up again next time.
      console.warn(`  tournament ${id}: failed (${err.message}), will retry next run`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // be polite to the API
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 2));
  console.log(`Saved surface map for ${Object.keys(cache).length} tournaments to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
