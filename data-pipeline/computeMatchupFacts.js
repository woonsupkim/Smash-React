/**
 * Computes the "broadcast graphic" facts for the new H2H hero, all from
 * data already cached in data-pipeline/raw/ - no new API calls:
 *   - per-player, per-surface win-loss record for the CURRENT calendar year
 *     (merged into each smash_*.csv by buildTournamentCsv.js)
 *   - per-player "recent form" (last 10 matches, any surface)
 *   - pairwise head-to-head record for every pair of rostered players who
 *     have actually played each other (since both players' full match
 *     histories are cached, any match between two rostered players shows
 *     up in both - across either player's cache it's the same match)
 *
 * Usage: node computeMatchupFacts.js [tour]
 *   tour: atp (default) | wta - namespaces raw/output/public paths under women/.
 */
const fs = require('fs');
const path = require('path');

const TOUR = process.argv[2] || 'atp';
const NS = TOUR === 'wta' ? 'women' : '';
const RAW_DIR = path.join(__dirname, 'raw', NS);
const OUTPUT_DIR = path.join(__dirname, 'output', NS);
const PUBLIC_DATA_DIR = path.join(__dirname, '..', 'public', 'data', NS);
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SURFACES_PATH = path.join(RAW_DIR, 'tournament-surfaces.json');

const SURFACE_DISPLAY = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
const RECENT_FORM_N = 10;

function loadMatches(ourId) {
  const file = path.join(RAW_DIR, `${ourId}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Names a fixture independently of whatever id the feed last gave it.
// Returns null when the row lacks what it takes to identify a match, so the
// caller skips it rather than lumping every malformed row under one key.
function fixtureKey(m) {
  if (!m || !m.player1Id || !m.player2Id || !m.date) return null;
  const pair = [String(m.player1Id), String(m.player2Id)].sort().join('_');
  return `${pair}@${String(m.date).slice(0, 10)}`;
}

function didWin(match, apiId) {
  return String(match.match_winner) === String(apiId);
}

function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error('Missing data-pipeline/raw/player-id-map.json - run fetch.js first.');
    process.exit(1);
  }
  if (!fs.existsSync(SURFACES_PATH)) {
    console.error('Missing data-pipeline/raw/tournament-surfaces.json - run fetch-surfaces first.');
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8')); // ourId -> apiId
  const surfaceMap = JSON.parse(fs.readFileSync(SURFACES_PATH, 'utf8')); // tournamentId -> "Hard"|"Clay"|"Grass"|...
  const apiToOur = new Map(Object.entries(idMap).map(([ourId, apiId]) => [String(apiId), ourId]));
  const currentYear = new Date().getUTCFullYear(); // UTC like the rest of the pipeline

  // --- per-player year record by surface + recent form ---
  const yearRecordBySurface = {}; // ourId -> { hard: {w,l}, clay: {w,l}, grass: {w,l} }
  const recentForm = {}; // ourId -> { w, l } over last N matches, any surface

  const country = {}; // ourId -> "ITA" etc, pulled from the player's own side of any cached match

  for (const [ourId, apiId] of Object.entries(idMap)) {
    const allMatches = loadMatches(ourId);
    const matches = allMatches
      .filter((m) => m.date && m.match_winner != null)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); // most recent first

    const sample = allMatches.find((m) => m.player1 || m.player2);
    if (sample) {
      const isPlayer1 = String(sample.player1Id) === String(apiId);
      country[ourId] = (isPlayer1 ? sample.player1?.countryAcr : sample.player2?.countryAcr) || null;
    }

    const record = { hard: { w: 0, l: 0 }, clay: { w: 0, l: 0 }, grass: { w: 0, l: 0 } };
    for (const m of matches) {
      if (new Date(m.date).getUTCFullYear() !== currentYear) continue;
      // "I.hard" (indoor hard) is a separate API label from outdoor "Hard"
      // but is the same court surface for stats purposes - fold it in.
      const rawSurface = surfaceMap[String(m.tournamentId)];
      const surfaceDisplay = rawSurface === 'I.hard' ? 'Hard' : rawSurface;
      const surfaceKey = Object.keys(SURFACE_DISPLAY).find((k) => SURFACE_DISPLAY[k] === surfaceDisplay);
      if (!surfaceKey) continue;
      if (didWin(m, apiId)) record[surfaceKey].w++;
      else record[surfaceKey].l++;
    }
    yearRecordBySurface[ourId] = record;

    const recent = matches.slice(0, RECENT_FORM_N);
    let w = 0, l = 0;
    for (const m of recent) {
      if (didWin(m, apiId)) w++; else l++;
    }
    recentForm[ourId] = { w, l };
  }

  // merge in age from fetchProfiles.js's cache, if present
  const profilesPath = path.join(RAW_DIR, 'player-profiles.json');
  const profiles = fs.existsSync(profilesPath) ? JSON.parse(fs.readFileSync(profilesPath, 'utf8')) : {};

  const playerFacts = {}; // ourId -> { country, age, yearRecord: {hard,clay,grass}, recentForm: {w,l} }
  for (const ourId of Object.keys(idMap)) {
    playerFacts[ourId] = {
      country: country[ourId] || null,
      age: profiles[ourId]?.age ?? null,
      yearRecord: yearRecordBySurface[ourId],
      recentForm: recentForm[ourId],
    };
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'player_facts.json'), JSON.stringify(playerFacts, null, 2));
  console.log(`Wrote combined facts (country/age/year-record/recent-form) for ${Object.keys(playerFacts).length} players.`);

  // --- pairwise head-to-head ---
  const h2h = {}; // "id1_id2" (sorted) -> { winsA, winsB, recentFormA, recentFormB } where A=id1, B=id2 alphabetically
  const seenMatchIds = new Set(); // fixture keys, not feed ids
  let dupFixtures = 0; // same fixture seen again under a different feed id
  let unkeyable = 0;   // rows too malformed to name a fixture
  let rowsRead = 0;

  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      rowsRead++;
      // Deduped by FIXTURE, not by match id.
      //
      // The id is not a stable name for a match. fetch.js keeps history
      // forever ("history ACCUMULATES across runs") and merges on match id,
      // so when the API re-issues a fixture under a new id, the cache keeps
      // both copies and a Set of ids cannot tell them apart. That is how
      // Collignon vs Van Assche came to read 22-0 against a true 3-0, and
      // Bonzi vs Riedi 14-0 against 2-0: every extra copy names the same
      // winner, so the record stays lopsided while the count inflates.
      // Re-fetching the same four players fresh reproduced the correct
      // numbers from this identical code, which is what pinned it on the
      // cache rather than the arithmetic.
      //
      // Only pairs whose meetings are RECENT were affected - those are the
      // fixtures that sit inside the fetch window run after run and so get
      // re-issued. Alcaraz vs Sinner, mostly older meetings, was already
      // right, which is why this survived so long.
      //
      // Two singles players do not meet twice on one calendar day, so
      // pair+day names a fixture exactly. Same shape as the match-identity
      // key buildTrackRecord already uses. Verified against 1,165 fetched
      // rows: no legitimate match collapses.
      const fixture = fixtureKey(m);
      if (!fixture) { unkeyable++; continue; }
      if (seenMatchIds.has(fixture)) { dupFixtures++; continue; }
      if (!m.match_winner) continue;
      const oppApiId = String(m.player1Id) === String(apiId) ? m.player2Id : m.player1Id;
      const oppOurId = apiToOur.get(String(oppApiId));
      if (!oppOurId) continue; // opponent isn't in our roster - skip (can't label both sides)
      seenMatchIds.add(fixture);

      const [idA, idB] = [ourId, oppOurId].sort();
      const key = `${idA}_${idB}`;
      if (!h2h[key]) h2h[key] = { winsA: 0, winsB: 0 };
      const aIsOurId = idA === ourId;
      const ourIdWon = didWin(m, apiId);
      if (aIsOurId === ourIdWon) h2h[key].winsA++;
      else h2h[key].winsB++;
    }
  }

  // attach recent form for both sides of every pair, for the comparison chip
  for (const key of Object.keys(h2h)) {
    const [idA, idB] = key.split('_');
    h2h[key].recentFormA = recentForm[idA] ? `${recentForm[idA].w}-${recentForm[idA].l}` : null;
    h2h[key].recentFormB = recentForm[idB] ? `${recentForm[idB].w}-${recentForm[idB].l}` : null;
  }

  // THE GUARD. Not a plausibility heuristic - those cannot work here. A
  // 0-12 sweep is a real record (De Minaur has never beaten Sinner) and a
  // 22-0 was a fabricated one, and no rule on the shape of the output can
  // tell those apart. What CAN be measured is the cause: duplicate fixtures
  // arriving under different feed ids. A healthy cache produces a handful,
  // from a player's two files describing their shared matches. A churning
  // one produces a flood, and that is the thing that inflated the records.
  //
  // Loud on purpose. The old failure was silent for months because nothing
  // in the pipeline had an opinion about how much duplication is normal.
  const half = rowsRead ? dupFixtures / rowsRead : 0;
  const stats = `${rowsRead} rows read, ${dupFixtures} duplicate fixtures collapsed (${(100 * half).toFixed(1)}%), ${unkeyable} unkeyable`;
  // Each pair is legitimately seen twice, once from each player's file, so a
  // duplicate share near half is expected. Well past that means the feed is
  // re-issuing ids and the merge in fetch.js is banking the copies.
  if (half > 0.75) {
    console.warn(`  WARNING: ${stats}. Above 75% means fixtures are arriving under changing ids faster than both-sides accounting explains - head-to-head counts may be inflated. Check mergeMatches in fetch.js.`);
  } else {
    console.log(`  ${stats}`);
  }

  const h2hPath = path.join(PUBLIC_DATA_DIR, 'h2h.json');
  fs.writeFileSync(h2hPath, JSON.stringify(h2h));
  console.log(`Wrote ${Object.keys(h2h).length} head-to-head pairs to ${h2hPath}`);

  // --- freshness metadata, shown on the Home page ---
  let mostRecentMatchDate = null;
  for (const ourId of Object.keys(idMap)) {
    for (const m of loadMatches(ourId)) {
      if (!m.date) continue;
      if (!mostRecentMatchDate || new Date(m.date) > new Date(mostRecentMatchDate)) {
        mostRecentMatchDate = m.date;
      }
    }
  }
  const refreshMetaPath = path.join(PUBLIC_DATA_DIR, 'refresh-meta.json');
  fs.writeFileSync(
    refreshMetaPath,
    JSON.stringify({ refreshedAt: new Date().toISOString(), mostRecentMatchDate })
  );
  console.log(`Wrote ${refreshMetaPath} (refreshed now, most recent match ${mostRecentMatchDate}).`);
}

// Only run as the entry point, so the fixture key can be imported and pinned
// by a test. It is the piece with one correct answer and a history of being
// got wrong.
if (require.main === module) main();

module.exports = { fixtureKey };
