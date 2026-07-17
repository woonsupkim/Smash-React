/**
 * Resolves each active player's numeric id on the Matchstat Tennis API
 * (RapidAPI) and downloads their recent match history (with per-match
 * serve/return stats) into data-pipeline/raw/.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const TOUR = process.argv[2] || 'atp'; // 'atp' or 'wta'
const RAW_DIR = path.join(__dirname, 'raw', TOUR === 'wta' ? 'women' : '');
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data', TOUR === 'wta' ? 'women' : '');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;
const PAGES_PER_PLAYER = 6; // ~50/page -> up to 300 recent matches (was 2, capped to conserve API quota)
const PAGE_SIZE = 50;
// 20h, deliberately UNDER the 24h daily cron interval: the CI cache restores
// files with their original mtimes, so a 24h threshold would sit exactly on
// the cron boundary and a slightly-early run would skip every player. 20h
// still catches the same-day duplicate-run case (slam-window Mondays).
const MAX_CACHE_AGE_MS = 20 * 60 * 60 * 1000;


function loadActivePlayerNames() {
  const names = new Set();
  for (const file of ['smash_us.csv', 'smash_fr.csv', 'smash_wb.csv']) {
    const csvPath = path.join(PUBLIC_DATA_DIR, file);
    if (!fs.existsSync(csvPath)) continue;
    const { data } = Papa.parse(fs.readFileSync(csvPath, 'utf8'), { header: true });
    for (const row of data) {
      if (row.id && row.name) names.add(JSON.stringify({ id: row.id, name: row.name.trim() }));
    }
  }
  return [...names].map((s) => JSON.parse(s));
}

// Retries transient statuses (rate limit, 5xx) with a growing pause before
// giving up - a quota-blocked or flaky API must not kill the whole refresh.
async function apiGet(urlPath, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://${HOST}${urlPath}`, {
      headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
    });
    if (res.ok) return res.json();
    const transient = [429, 500, 502, 503].includes(res.status);
    if (!transient || attempt >= tries) throw new Error(`${urlPath} -> HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
}

// Names differ slightly between our roster and the API (e.g. "Alex De
// Minaur" vs "Alex Minaur"), so match on last word + first letter rather
// than exact string equality.
function nameKey(name) {
  const parts = String(name || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return `${parts[0][0]}.${parts[parts.length - 1]}`;
}

async function resolveApiIds(players) {
  const cached = fs.existsSync(ID_MAP_PATH) ? JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8')) : {};
  const need = players.filter((p) => !cached[p.id]);
  if (need.length === 0) return cached;

  console.log(`Resolving API ids for ${need.length} players via rankings lookup...`);
  const byKey = new Map();
  let pageNo = 1;
  // Rankings cover the current tour's notable players; paginate until we've
  // matched everyone we need or run out of pages. Non-fatal on API failure:
  // whatever ids are already cached still let the rest of the run proceed
  // (an unresolved player is simply skipped by the fetch loop) - this was
  // the one spot where a quota-blocked API could kill the entire refresh.
  try {
    while (need.some((p) => !byKey.has(nameKey(p.name))) && pageNo <= 30) {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/ranking/singles?pageSize=100&pageNo=${pageNo}`);
      if (!data || data.length === 0) break;
      for (const entry of data) {
        if (entry.player?.name) byKey.set(nameKey(entry.player.name), entry.player.id);
      }
      pageNo++;
    }
  } catch (err) {
    console.warn(`Rankings lookup failed (${err.message}); continuing with ${Object.keys(cached).length} cached ids.`);
  }

  for (const p of need) {
    const apiId = byKey.get(nameKey(p.name));
    if (apiId) cached[p.id] = apiId;
    else console.warn(`  could not resolve API id for ${p.name} (${p.id})`);
  }
  fs.writeFileSync(ID_MAP_PATH, JSON.stringify(cached, null, 2));
  return cached;
}

// Merge freshly fetched matches into the cached history, keyed by match id.
// Fresh data wins for ids present in both (recent matches change: a live
// match completes, a score gets corrected); everything older that the fetch
// didn't reach is preserved forever - history ACCUMULATES across runs
// instead of rolling off at the newest-300 window like the old full
// overwrite did.
function mergeMatches(existing, fetched) {
  const byId = new Map();
  for (const m of existing) byId.set(String(m.id), m);
  for (const m of fetched) byId.set(String(m.id), m);
  return [...byId.values()].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

// Incremental fetch: page through the API newest-first and STOP as soon as
// an entire page is matches we already have - the gap between the cache and
// today is closed, everything older is on disk. A daily/weekly run costs
// 1-2 pages per player instead of the full PAGES_PER_PLAYER; a brand-new
// player (no cache) still bootstraps with the full window.
async function fetchPlayerMatches(ourId, apiId) {
  const dest = path.join(RAW_DIR, `${ourId}.json`);
  if (fs.existsSync(dest) && Date.now() - fs.statSync(dest).mtimeMs < MAX_CACHE_AGE_MS) {
    return null; // fresh cache, skip
  }
  // A corrupt cache file (truncated write, cache-transfer glitch) rebuilds
  // from scratch instead of erroring this player forever.
  let existing = [];
  if (fs.existsSync(dest)) {
    try { existing = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch {
      console.warn(`  corrupt cache for ${ourId}; re-bootstrapping`);
    }
  }
  const knownIds = new Set(existing.map((m) => String(m.id)));
  const isBootstrap = existing.length === 0;

  const fetched = [];
  let pages = 0;
  for (let pageNo = 1; pageNo <= PAGES_PER_PLAYER; pageNo++) {
    const { data, hasNextPage } = await apiGet(
      `/tennis/v2/${TOUR}/player/past-matches/${apiId}?include=stat&pageSize=${PAGE_SIZE}&pageNo=${pageNo}`
    );
    const page = data || [];
    fetched.push(...page);
    pages = pageNo;
    if (!isBootstrap && page.length > 0 && page.every((m) => knownIds.has(String(m.id)))) break;
    if (!hasNextPage) break;
  }

  const merged = mergeMatches(existing, fetched);
  fs.writeFileSync(dest, JSON.stringify(merged));
  const newCount = fetched.filter((m) => !knownIds.has(String(m.id))).length;
  return { pages, newCount, total: merged.length };
}

async function main() {
  if (!API_KEY) {
    console.error('Missing RAPIDAPI_KEY - set it in .env (see .env.example).');
    process.exit(1);
  }
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

  const players = loadActivePlayerNames();
  if (players.length === 0) {
    console.error('No players found in public/data/smash_*.csv.');
    process.exit(1);
  }

  const idMap = await resolveApiIds(players);

  console.log(`Fetching match history for ${players.length} players (tour=${TOUR})...`);
  // Circuit breaker: when the API fails for many players in a row (quota
  // block, outage), stop burning requests - the cache serves this run and
  // the gap closes next run.
  let consecFails = 0;
  for (const p of players) {
    if (consecFails >= 8) {
      console.warn('Aborting match fetch: 8 consecutive failures (API down or quota-blocked). Cached data serves this run.');
      break;
    }
    const apiId = idMap[p.id];
    if (!apiId) continue;
    try {
      const r = await fetchPlayerMatches(p.id, apiId);
      console.log(`  ${p.name}: ${r ? `+${r.newCount} new in ${r.pages} page${r.pages === 1 ? '' : 's'} (${r.total} cached)` : 'cached (fresh)'}`);
      consecFails = 0;
    } catch (err) {
      consecFails++;
      console.warn(`  ${p.name}: failed (${err.message})`);
    }
  }
  console.log('Done.');
}

module.exports = { mergeMatches };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
