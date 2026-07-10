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
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

if (!API_KEY) {
  console.error('Missing RAPIDAPI_KEY - set it in .env (see .env.example).');
  process.exit(1);
}

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

async function apiGet(urlPath) {
  const res = await fetch(`https://${HOST}${urlPath}`, {
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
  });
  if (!res.ok) throw new Error(`${urlPath} -> HTTP ${res.status}`);
  return res.json();
}

// Names differ slightly between our roster and the API (e.g. "Alex De
// Minaur" vs "Alex Minaur"), so match on last word + first letter rather
// than exact string equality.
function nameKey(name) {
  const parts = name.trim().toLowerCase().split(/\s+/);
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
  // matched everyone we need or run out of pages.
  while (need.some((p) => !byKey.has(nameKey(p.name))) && pageNo <= 30) {
    const { data } = await apiGet(`/tennis/v2/${TOUR}/ranking/singles?pageSize=100&pageNo=${pageNo}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (entry.player?.name) byKey.set(nameKey(entry.player.name), entry.player.id);
    }
    pageNo++;
  }

  for (const p of need) {
    const apiId = byKey.get(nameKey(p.name));
    if (apiId) cached[p.id] = apiId;
    else console.warn(`  could not resolve API id for ${p.name} (${p.id})`);
  }
  fs.writeFileSync(ID_MAP_PATH, JSON.stringify(cached, null, 2));
  return cached;
}

async function fetchPlayerMatches(ourId, apiId) {
  const dest = path.join(RAW_DIR, `${ourId}.json`);
  if (fs.existsSync(dest) && Date.now() - fs.statSync(dest).mtimeMs < MAX_CACHE_AGE_MS) {
    return false; // fresh cache, skip
  }
  const matches = [];
  for (let pageNo = 1; pageNo <= PAGES_PER_PLAYER; pageNo++) {
    const { data, hasNextPage } = await apiGet(
      `/tennis/v2/${TOUR}/player/past-matches/${apiId}?include=stat&pageSize=${PAGE_SIZE}&pageNo=${pageNo}`
    );
    matches.push(...(data || []));
    if (!hasNextPage) break;
  }
  fs.writeFileSync(dest, JSON.stringify(matches));
  return true;
}

async function main() {
  if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

  const players = loadActivePlayerNames();
  if (players.length === 0) {
    console.error('No players found in public/data/smash_*.csv.');
    process.exit(1);
  }

  const idMap = await resolveApiIds(players);

  console.log(`Fetching match history for ${players.length} players (tour=${TOUR})...`);
  for (const p of players) {
    const apiId = idMap[p.id];
    if (!apiId) continue;
    try {
      const fetched = await fetchPlayerMatches(p.id, apiId);
      console.log(`  ${p.name}: ${fetched ? 'fetched' : 'cached (fresh)'}`);
    } catch (err) {
      console.warn(`  ${p.name}: failed (${err.message})`);
    }
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
