/**
 * Season Rewind - public/data/season_rewind.json (+ frozen archives in
 * public/data/seasons/<year>.json at rollover).
 *
 * One JSON the /season page can render as the year-in-review: headline
 * accuracy with the bookie comparison, month-by-month accuracy, the ten
 * boldest correct calls, the worst miss owned honestly, per-engine season
 * accuracy, and each tour's title-odds journey. Rebuilt every refresh (it
 * is cheap and derived), so the CURRENT season's page is always live; on
 * the first run of a new year the previous year's file is archived first
 * and never touched again - that frozen file IS the evergreen page.
 *
 * Usage: node data-pipeline/buildSeasonRewind.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'season_rewind.json');
const ARCHIVE_DIR = path.join(DATA, 'seasons');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Keep a card-sized copy of a ledger row - the page needs names and the
// story, not the full engine breakdown.
function slim(m) {
  const pick = m.pickFavorite ?? m.smashFavorite;
  const pickIsP1 = pick === m.p1;
  return {
    id: m.id, tour: m.tour, surface: m.surface, date: m.date, event: m.event || null,
    p1: m.p1, p2: m.p2, name1: m.name1, name2: m.name2,
    winner: m.winner, score: m.score || null,
    pick, prob: round3(pickProb(m)),
    pickRank: pickIsP1 ? m.rankA ?? null : m.rankB ?? null,
    oppRank: pickIsP1 ? m.rankB ?? null : m.rankA ?? null,
  };
}
const pickProb = (m) => {
  const p1 = m.pickProbP1 ?? m.smashProbP1 ?? m.probP1;
  return (m.pickFavorite ?? m.smashFavorite) === m.p1 ? p1 : 1 - p1;
};
const pickCorrect = (m) => m.pickCorrect ?? m.smashCorrect;
const round3 = (x) => Math.round(x * 1000) / 1000;

function main() {
  const year = new Date().getUTCFullYear();

  // ── Rollover FIRST: freeze last year's rewind the moment the year turns,
  // even while the new season's track record is still empty - otherwise the
  // archive would wait for the first graded match of the new season.
  const prev = readJson(OUT);
  if (prev && prev.year && prev.year !== year) {
    if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dest = path.join(ARCHIVE_DIR, `${prev.year}.json`);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, JSON.stringify(prev));
      console.log(`Archived the ${prev.year} season to public/data/seasons/${prev.year}.json`);
    }
  }

  const track = readJson(path.join(DATA, 'track_record.json'));
  if (!track || !Array.isArray(track.matches) || track.matches.length === 0) {
    console.log('No track record yet; skipping season rewind.');
    return;
  }

  const matches = track.matches.filter((m) => m.winner && (m.pickFavorite || m.smashFavorite));
  const correct = matches.filter((m) => pickCorrect(m));

  // Bookie comparison on rows that carry closing odds.
  const oddsRows = matches.filter((m) => m.od1 && m.od2 && m.oddFav);
  const disagreements = oddsRows.filter((m) => (m.pickFavorite ?? m.smashFavorite) !== m.oddFav);

  // Month-by-month accuracy (UTC months).
  const monthly = [];
  for (let mo = 0; mo < 12; mo++) {
    const ms = matches.filter((m) => new Date(m.date).getUTCMonth() === mo);
    if (!ms.length) continue;
    monthly.push({ month: mo + 1, n: ms.length, correct: ms.filter((m) => pickCorrect(m)).length });
  }

  // Boldest correct calls. The deployed pick is by construction the model's
  // favorite (prob >= 50%), so "lowest probability" would just surface coin
  // flips - boldness here means backing the RANKING underdog and being
  // right, ranked by how big the rank deficit was.
  const rankGap = (m) => {
    const pick = m.pickFavorite ?? m.smashFavorite;
    const pickIsP1 = pick === m.p1;
    const pr = pickIsP1 ? m.rankA : m.rankB;
    const or = pickIsP1 ? m.rankB : m.rankA;
    return pr && or ? pr - or : -Infinity; // positive = we backed the worse-ranked player
  };
  const best = correct
    .filter((m) => rankGap(m) > 0)
    .sort((a, b) => rankGap(b) - rankGap(a))
    .slice(0, 10)
    .map(slim);

  // The miss we own: the most confident call that lost.
  const worst = matches
    .filter((m) => !pickCorrect(m))
    .sort((a, b) => pickProb(b) - pickProb(a))
    .slice(0, 1)
    .map(slim)[0] || null;

  // Per-engine season accuracy from the ledger itself (all-surface, all-tour).
  const engines = [
    ['Smart Blend', 'smashCorrect'],
    ['Point Engine', 'correct'],
    ['Form (Elo)', 'eloCorrect'],
    ['Rankings', 'rankCorrect'],
    ['Upset Lens', 'upsetCorrect'],
  ].map(([label, field]) => {
    const graded = matches.filter((m) => typeof m[field] === 'boolean');
    return { label, n: graded.length, correct: graded.filter((m) => m[field]).length };
  }).filter((e) => e.n > 0);

  // Title journeys: how each tour's slam favorite story ended.
  const titleOdds = readJson(path.join(DATA, 'title_odds.json'));
  const journeys = {};
  for (const tour of ['atp', 'wta']) {
    const e = titleOdds?.events?.[tour];
    if (!e || !e.history?.length) continue;
    const champion = e.status === 'final' ? e.odds?.[0]?.name : null;
    const first = e.history[0], last = e.history[e.history.length - 1];
    journeys[tour] = {
      event: e.event,
      status: e.status,
      champion,
      openDate: first.date,
      openOdds: champion != null && first.odds ? round3(first.odds[champion] ?? 0) : null,
      finalDate: last.date,
      days: e.history.length,
    };
  }

  const out = {
    year,
    generatedAt: new Date().toISOString(),
    headline: {
      n: matches.length,
      correct: correct.length,
      odds: {
        n: oddsRows.length,
        us: oddsRows.filter((m) => pickCorrect(m)).length,
        market: oddsRows.filter((m) => m.oddCorrect).length,
        disagreements: disagreements.length,
        usOnSplits: disagreements.filter((m) => pickCorrect(m)).length,
      },
    },
    monthly,
    best,
    worst,
    engines,
    journeys,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote season_rewind.json: ${year}, ${matches.length} matches, ${best.length} best calls, ${monthly.length} months.`);
}

main();
