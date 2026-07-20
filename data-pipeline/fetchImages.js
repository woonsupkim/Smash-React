/**
 * Auto-fills missing player headshots in src/assets/players/ by looking up
 * each roster player on Wikidata (free/CC-licensed images via Wikimedia
 * Commons) and downloading their photo. Never overwrites an image that
 * already exists - only fills gaps for players who don't have one yet.
 *
 * Usage: node fetchImages.js [tour]
 *   tour: atp (default, writes to src/assets/players/) | wta (writes to
 *   src/assets/players-women/, kept separate so a man and woman who share a
 *   surname-derived id never silently collide on the same headshot file).
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const TOUR = process.argv[2] || 'atp';
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data', TOUR === 'wta' ? 'women' : '');
const PLAYERS_DIR = path.join(__dirname, '..', 'src', 'assets', TOUR === 'wta' ? 'players-women' : 'players');

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

const UA = { 'User-Agent': 'smash-react-data-pipeline/1.0' };
const TENNIS_RE = /tennis/i;

// Wikimedia rate-limits by IP and answers with an HTML/text page, which
// used to surface as a JSON parse error ("Unexpected token Y..."). Detect
// the non-JSON answer and wait it out once before giving up.
async function wmJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      if (attempt >= 2) throw new Error(`rate limited (HTTP ${res.status})`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}

// Roster names miss Wikidata labels in predictable ways: CJK names are
// surname-first on Wikidata ("Wang Xinyu" vs roster "Xinyu Wang"), Spanish
// double surnames get shortened ("Daniel Merida Aguilar" -> "Daniel Mérida").
// Try the plausible variants in order.
function nameVariants(name) {
  const parts = name.trim().split(/\s+/);
  const v = [name];
  if (parts.length === 2) v.push(`${parts[1]} ${parts[0]}`);
  if (parts.length >= 3) {
    v.push(parts.slice(0, 2).join(' '));
    v.push(`${parts[0]} ${parts[parts.length - 1]}`);
  }
  return [...new Set(v)];
}

async function findWikidataImage(name) {
  for (const q of nameVariants(name)) {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&format=json&type=item&limit=5`;
    const search = await wmJson(searchUrl);
    // Only accept candidates Wikidata itself describes as tennis-related
    // (or with no description at all but an exact-label match) - a bare
    // name search can hit a same-named politician whose photo we must
    // never ship on a player card.
    const candidates = (search.search || []).filter((c) =>
      TENNIS_RE.test(c.description || '') || (!c.description && (c.label || '').toLowerCase() === q.toLowerCase()));
    for (const candidate of candidates) {
      const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${candidate.id}&props=claims&format=json`;
      const entity = await wmJson(entityUrl);
      const claims = entity.entities?.[candidate.id]?.claims;
      const imageClaim = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (imageClaim) return imageClaim; // Commons filename, e.g. "Jannik Sinner 2023.jpg"
    }
    await new Promise((r) => setTimeout(r, 1200)); // pause between variant queries
  }
  return null;
}

const deburr = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Second source: the player's English Wikipedia article lead image. Some
// players have an infobox photo without a Wikidata P18 claim.
// Two identity guards, both diacritic-insensitive: the article TITLE must
// contain the player's surname (otherwise a "2019 French Open qualifying"
// tournament article can win the search), and the image FILENAME must
// contain some token of the player's name (a tournament article's lead
// image is frequently a photo of a different player entirely).
async function findWikipediaImage(name) {
  const tokens = deburr(name).split(/\s+/).filter((t) => t.length >= 4);
  const surname = deburr(name).split(/\s+/).pop();
  for (const q of nameVariants(name)) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${q} tennis`)}&srlimit=3&format=json`;
    const found = (await wmJson(searchUrl)).query?.search || [];
    for (const hit of found) {
      if (!TENNIS_RE.test(`${hit.title} ${hit.snippet || ''}`)) continue;
      if (!deburr(hit.title).includes(surname)) continue;
      const imgUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=original&titles=${encodeURIComponent(hit.title)}&format=json`;
      const pages = (await wmJson(imgUrl)).query?.pages || {};
      const original = Object.values(pages)[0]?.original?.source;
      if (original && tokens.some((t) => deburr(decodeURIComponent(original)).includes(t))) return original;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}

async function downloadUrl(url, destPath) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return false;
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return true;
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

  // Negative cache: players with no free-licensed image anywhere get a
  // dated marker and are re-checked monthly instead of on every run -
  // Wikimedia rate-limits aggressively and the answer rarely changes daily.
  const NO_IMAGE_PATH = path.join(__dirname, 'raw', TOUR === 'wta' ? 'women' : '', 'no-image.json');
  let noImage = {};
  try { noImage = JSON.parse(fs.readFileSync(NO_IMAGE_PATH, 'utf8')); } catch { /* first run */ }
  const RETRY_MS = 30 * 864e5;
  const recentlyStruckOut = (id) => noImage[id] && (Date.now() - new Date(noImage[id]).getTime()) < RETRY_MS;

  const missing = roster.filter(([id]) => !fs.existsSync(path.join(PLAYERS_DIR, `${id}.png`)) && !recentlyStruckOut(id));
  if (missing.length === 0) {
    console.log('Every roster player has an image or a recent no-image marker.');
    return;
  }

  console.log(`${missing.length} player(s) missing images - looking up on Wikidata...`);
  let found = 0;
  for (const [id, name] of missing) {
    await new Promise((r) => setTimeout(r, 4500)); // be polite to Wikimedia's API - 2s used to get rate-limited after ~20 requests
    // One retry with a much longer backoff on failure (typically a rate-limit
    // HTML page instead of JSON, surfacing as a JSON parse error) - most
    // transient 429s clear within 10s, and this halves how many manual
    // re-invocations a full 50-player run needs.
    let lastErr = null;
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const dest = path.join(PLAYERS_DIR, `${id}.png`);
        const filename = await findWikidataImage(name);
        if (filename) {
          if (await downloadCommonsImage(filename, dest)) {
            found++;
            ok = true;
            console.log(`  ${name}: saved (${filename})`);
          } else {
            console.log(`  ${name}: found a Commons filename but download failed`);
          }
        } else {
          // Wikidata came up empty: try the Wikipedia article lead image.
          const url = await findWikipediaImage(name);
          if (url && (await downloadUrl(url, dest))) {
            found++;
            ok = true;
            console.log(`  ${name}: saved from Wikipedia (${url.split('/').pop()})`);
          } else {
            console.log(`  ${name}: no image on Wikidata or Wikipedia (rechecking in 30 days)`);
            noImage[id] = new Date().toISOString();
            lastErr = null;
            break;
          }
        }
        lastErr = null;
      } catch (err) {
        lastErr = err;
        if (attempt === 1) await new Promise((r) => setTimeout(r, 10000));
      }
    }
    if (lastErr) console.log(`  ${name}: error after retry (${lastErr.message})`);
  }
  try { fs.writeFileSync(NO_IMAGE_PATH, JSON.stringify(noImage, null, 2)); } catch { /* raw dir may be absent locally */ }
  console.log(`Done. ${found}/${missing.length} images fetched. Remaining players fall back to default.png.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
