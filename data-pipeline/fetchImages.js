/**
 * Auto-fills missing player headshots in src/assets/players/ by looking up
 * each roster player on Wikidata (free/CC-licensed images via Wikimedia
 * Commons) and downloading their photo. Never overwrites an image that
 * already exists — only fills gaps for players who don't have one yet.
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const PLAYERS_DIR = path.join(__dirname, '..', 'src', 'assets', 'players');

function loadRoster() {
  const byId = new Map();
  for (const file of ['smash_us.csv', 'smash_fr.csv', 'smash_wb.csv']) {
    const csvPath = path.join(PUBLIC_DATA_DIR, file);
    if (!fs.existsSync(csvPath)) continue;
    const { data } = Papa.parse(fs.readFileSync(csvPath, 'utf8'), { header: true });
    for (const row of data) {
      if (row.id && row.name) byId.set(row.id, row.name.trim());
    }
  }
  return [...byId.entries()];
}

async function findWikidataImage(name) {
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&type=item&limit=3`;
  const searchRes = await fetch(searchUrl, { headers: { 'User-Agent': 'smash-react-data-pipeline/1.0' } });
  const search = await searchRes.json();
  for (const candidate of search.search || []) {
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${candidate.id}&props=claims&format=json`;
    const entityRes = await fetch(entityUrl, { headers: { 'User-Agent': 'smash-react-data-pipeline/1.0' } });
    const entity = await entityRes.json();
    const claims = entity.entities?.[candidate.id]?.claims;
    const imageClaim = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (imageClaim) return imageClaim; // Commons filename, e.g. "Jannik Sinner 2023.jpg"
  }
  return null;
}

async function downloadCommonsImage(filename, destPath) {
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=400`;
  const res = await fetch(url, { headers: { 'User-Agent': 'smash-react-data-pipeline/1.0' } });
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return true;
}

async function main() {
  if (!fs.existsSync(PLAYERS_DIR)) fs.mkdirSync(PLAYERS_DIR, { recursive: true });
  const roster = loadRoster();

  const missing = roster.filter(([id]) => !fs.existsSync(path.join(PLAYERS_DIR, `${id}.png`)));
  if (missing.length === 0) {
    console.log('Every roster player already has an image.');
    return;
  }

  console.log(`${missing.length} player(s) missing images — looking up on Wikidata...`);
  let found = 0;
  for (const [id, name] of missing) {
    await new Promise((r) => setTimeout(r, 2000)); // be polite to Wikimedia's API
    try {
      const filename = await findWikidataImage(name);
      if (!filename) {
        console.log(`  ${name}: no Wikidata image found`);
        continue;
      }
      const ok = await downloadCommonsImage(filename, path.join(PLAYERS_DIR, `${id}.png`));
      if (ok) {
        found++;
        console.log(`  ${name}: saved (${filename})`);
      } else {
        console.log(`  ${name}: found a filename but download failed`);
      }
    } catch (err) {
      console.log(`  ${name}: error (${err.message})`);
    }
  }
  console.log(`Done. ${found}/${missing.length} images fetched. Remaining players fall back to default.png.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
