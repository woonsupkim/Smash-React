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

// Retries transient statuses (rate limit, 5xx) with a growing pause before
// giving up - keep in step with the same helper in fetch.js.
async function apiGet(urlPath, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://${HOST}${urlPath}`, {
      headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
    });
    if (res.ok) return res.json();
    const transient = [429, 500, 502, 503].includes(res.status);
    if (!transient || attempt >= tries) throw new Error(`HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
}

function collectTournamentIds() {
  const ids = new Set();
  const files = fs.readdirSync(RAW_DIR).filter(
    (f) => f.endsWith('.json') && f !== 'player-id-map.json' && f !== 'tournament-surfaces.json' && f !== 'player-profiles.json' && f !== 'tournament-names.json'
  );
  for (const f of files) {
    // One truncated cache file (a killed run mid-write) must not take down
    // the whole surface resolution - skip it; the next fetch repairs it.
    let matches;
    try { matches = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8')); } catch {
      console.warn(`  skipping corrupt cache file ${f}`);
      continue;
    }
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
// 150 (was 300): halves the daily API spend of the backfill window - the
// monthly quota is 10k requests and this loop is the biggest consumer.
const NAME_BACKFILL_PER_RUN = 150;

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

  // Circuit breaker shared by both loops: a run of consecutive failures
  // means the API is down or quota-blocked - stop burning requests, write
  // what we have, and let the next run resume where this one stopped.
  let consecFails = 0;
  const CIRCUIT = 8;
  // Volume cap for the surface loop: on a cold/evicted raw cache, `missing`
  // can be ~2,000 tournaments - without a cap, a run where the API keeps
  // SUCCEEDING would burn the whole monthly quota in one go. Converges over
  // a handful of runs like the name backfill.
  const SURFACE_LOOKUPS_PER_RUN = 400;
  let surfaceLookups = 0;

  for (const id of missing) {
    if (surfaceLookups >= SURFACE_LOOKUPS_PER_RUN) {
      console.warn(`Pausing surface lookups at ${SURFACE_LOOKUPS_PER_RUN} this run (${missing.length - surfaceLookups} left for next run).`);
      break;
    }
    surfaceLookups++;
    if (consecFails >= CIRCUIT) {
      console.warn(`Aborting surface lookups: ${CIRCUIT} consecutive failures (API down or quota-blocked). Resuming next run.`);
      break;
    }
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/tournament/info/${id}`);
      cache[String(id)] = data?.court?.name || 'Unknown';
      const nm = extractName(data);
      // Cache the name EVEN WHEN NULL: a successful lookup with no name in
      // the payload will never grow one - without the null marker these ids
      // were re-queried every single run, forever (a real quota leak).
      names[String(id)] = nm;
      consecFails = 0;
      console.log(`  tournament ${id}: ${cache[String(id)]}${nm ? ` (${nm})` : ''}`);
    } catch (err) {
      // Don't cache THROWN failures (rate limiting, outages) - those are
      // worth retrying next run.
      consecFails++;
      console.warn(`  tournament ${id}: failed (${err.message}), will retry next run`);
    }
    await new Promise((r) => setTimeout(r, 1500)); // be polite to the API
  }

  // Name backfill for tournaments whose surface was cached before names
  // existed. Capped per run; converges over a handful of refreshes (null
  // markers included, so a no-name tournament is looked up exactly once).
  const nameless = ids.filter((id) => String(id) in cache && !(String(id) in names)).slice(0, NAME_BACKFILL_PER_RUN);
  if (nameless.length) console.log(`Backfilling names for ${nameless.length} tournaments (of ${ids.filter((id) => !(String(id) in names)).length} without one)...`);
  for (const id of nameless) {
    if (consecFails >= CIRCUIT) {
      console.warn(`Aborting name backfill: ${CIRCUIT} consecutive failures (API down or quota-blocked). Resuming next run.`);
      break;
    }
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/tournament/info/${id}`);
      names[String(id)] = extractName(data);
      consecFails = 0;
    } catch {
      consecFails++; // retry on a later run
    }
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
