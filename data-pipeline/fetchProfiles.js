/**
 * Fetches birthday (-> age) for each roster player, for the H2H hero
 * ("World No. X, Age Y, ITA"). Country is already cached in match records
 * (countryAcr) so it doesn't need its own fetch — this is just the one
 * field (age) that genuinely needs a fresh API call.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOUR = process.argv[2] || 'atp';
const RAW_DIR = path.join(__dirname, 'raw', TOUR === 'wta' ? 'women' : '');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const OUT_PATH = path.join(RAW_DIR, 'player-profiles.json');
const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;

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

function ageFromBirthday(birthday) {
  if (!birthday) return null;
  const dob = new Date(birthday);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasNotHadBirthdayYet = now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (hasNotHadBirthdayYet) age--;
  return age;
}

async function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error('Missing data-pipeline/raw/player-id-map.json — run fetch.js first.');
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8')); // ourId -> apiId
  const cache = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : {};

  const ids = Object.keys(idMap);
  const missing = ids.filter((id) => !cache[id]);
  console.log(`${ids.length} roster players, ${missing.length} need a profile lookup.`);

  for (const ourId of missing) {
    const apiId = idMap[ourId];
    try {
      const { data } = await apiGet(`/tennis/v2/${TOUR}/player/profile/${apiId}`);
      const age = ageFromBirthday(data?.birthday);
      cache[ourId] = { age, birthday: data?.birthday || null };
      console.log(`  ${ourId}: age ${age}`);
    } catch (err) {
      console.warn(`  ${ourId}: failed (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 300)); // be polite to the API
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(cache, null, 2));
  console.log(`Saved profiles for ${Object.keys(cache).length} players to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
