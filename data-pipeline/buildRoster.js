/**
 * Replaces the player roster in public/data/smash_*.csv with the current
 * ATP top-N singles ranking (default 50), keeping each tournament's us_rd value at 2 (the round the
 * UI currently filters/displays) and using rank position as the seed.
 * p1-p5 are left blank here — run `npm run refresh-stats` afterward to fill
 * them in from real match data.
 *
 * Usage: node buildRoster.js [topN]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;
const TOUR = 'atp';
const TOP_N = Number(process.argv[2]) || 50;
const TARGET_FILES = ['smash_us.csv', 'smash_fr.csv', 'smash_wb.csv'];

if (!API_KEY) {
  console.error('Missing RAPIDAPI_KEY — set it in .env (see .env.example).');
  process.exit(1);
}

async function apiGet(urlPath) {
  const res = await fetch(`https://${HOST}${urlPath}`, {
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
  });
  if (!res.ok) throw new Error(`${urlPath} -> HTTP ${res.status}`);
  return res.json();
}

// A few players' compound surnames don't fold to the same 5-letter id our
// generic scheme would produce as the ids already used for their existing
// manually-downloaded images in src/assets/players/. Override those so the
// images keep matching.
const ID_OVERRIDES = {
  'Alex De Minaur': 'demin',
  'Felix Auger Aliassime': 'auger',
};

function makeId(fullName, lastName, used) {
  const base = (ID_OVERRIDES[fullName] || lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 5)) || 'plyr';
  let id = base;
  let n = 1;
  while (used.has(id)) {
    id = `${base}${n}`;
    n++;
  }
  used.add(id);
  return id;
}

async function fetchTopPlayers(n) {
  const players = [];
  let pageNo = 1;
  while (players.length < n) {
    const { data } = await apiGet(`/tennis/v2/${TOUR}/ranking/singles?pageSize=100&pageNo=${pageNo}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      if (players.length >= n) break;
      if (entry.player?.name) players.push({ rank: entry.position, name: entry.player.name.trim() });
    }
    pageNo++;
    if (pageNo > 10) break;
  }
  return players.slice(0, n);
}

async function main() {
  console.log(`Fetching ATP top ${TOP_N} singles ranking...`);
  const topPlayers = await fetchTopPlayers(TOP_N);
  if (topPlayers.length === 0) {
    console.error('Could not fetch rankings.');
    process.exit(1);
  }

  const used = new Set();
  const roster = topPlayers.map(({ rank, name }) => {
    const parts = name.split(/\s+/);
    const first = parts[0];
    const last = parts.slice(1).join(' ') || parts[0];
    return {
      id: makeId(name, last.split(' ').pop(), used),
      name,
      first,
      last,
      us_seed: rank,
      us_rd: 2,
      p1: '', p2: '', p3: '', p4: '', p5: '',
    };
  });

  for (const file of TARGET_FILES) {
    const csvPath = path.join(PUBLIC_DATA_DIR, file);
    fs.writeFileSync(csvPath, Papa.unparse(roster));
    console.log(`  wrote ${roster.length} players to ${file}`);
  }
  console.log('Done. Run `npm run refresh-stats` to populate p1-p5 from real match data.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
