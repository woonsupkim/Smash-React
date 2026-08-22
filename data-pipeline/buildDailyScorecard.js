/**
 * Daily scorecard - public/data/daily_scorecard.json.
 *
 * The pipeline's self-marketing artifact, regenerated after every refresh:
 *   - yesterday: how the model scored on the most recent day of results
 *     (called X of Y, upsets caught against the bookies, the boldest call).
 *   - season: the running public record.
 *   - upsetWatch: upcoming locked picks where the model defies the world
 *     rankings, each with a plain-language reason. Feeds the Home page
 *     badges and the optional social webhook post.
 *
 * Usage: node buildDailyScorecard.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const DATA = path.join(__dirname, '..', 'public', 'data');

function loadRanks(tour) {
  const dir = tour === 'wta' ? path.join(DATA, 'women') : DATA;
  const p = path.join(dir, 'smash_us.csv');
  if (!fs.existsSync(p)) return new Map();
  const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
  return new Map(rows.map((r) => [r.id, Number(r.us_seed) || null]));
}

// An "upset pick" means the model backs a player the rankings say should
// LOSE, by a margin that actually means something. Ranking numbers are noisy
// and compress badly: #69 vs #76 is a coin flip dressed up as a gap, while
// #26 vs #98 is a genuine call against the form book. So materiality is a
// RATIO (the same log-scale the rank engine itself uses) plus a floor on the
// raw gap, and both must clear. Without this the badge fired on almost any
// pick and stopped meaning anything.
const UPSET_RATIO = 2;   // the underdog's number must be at least double
const UPSET_MIN_GAP = 10; // ...and at least this many places back
const isUpsetPick = (favRank, oppRank) =>
  !!favRank && !!oppRank && favRank >= oppRank * UPSET_RATIO && favRank - oppRank >= UPSET_MIN_GAP;

// Plain-language reason for an against-the-rankings call, keyed on the
// engine that locked it.
function upsetReason(p, favRank, oppRank) {
  const surface = p.surface;
  const gap = `#${favRank} over #${oppRank}`;
  switch (p.engine) {
    case 'elo': return `Recent ${surface}-court form outweighs the ranking gap (${gap}).`;
    case 'upset': return `Red-hot in the last few weeks; the ranking hasn't caught up (${gap}).`;
    case 'sim': return `The point-by-point numbers on ${surface} favor the lower seed (${gap}).`;
    default: return `Form, matchup, and ${surface}-court numbers all lean against the ranking (${gap}).`;
  }
}

function run() {
  const track = JSON.parse(fs.readFileSync(path.join(DATA, 'track_record.json'), 'utf8'));
  const preds = fs.existsSync(path.join(DATA, 'predictions.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'predictions.json'), 'utf8'))
    : { predictions: [] };
  const ranks = { atp: loadRanks('atp'), wta: loadRanks('wta') };

  const ENGINE = require('../src/engineConfig.json');
  const allMs = track.matches || [];
  // Retrospective no-call rule (mirrors src/utils/deployedPick.pickNoCall,
  // pinned by noCall.test.js): published claims grade calls only.
  const rowProb = (m) => { const r = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1; return Math.max(r, 1 - r); };
  const ms = allMs.filter((m) => rowProb(m) >= (ENGINE.callThreshold || 0));
  // Deployed-call accessors: the pick made by the best engine for each
  // match's tour x surface (annotated by buildTrackRecord), with a Smart
  // Blend fallback for rows that predate the annotation.
  const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
  const pickFav = (m) => m.pickFavorite || m.smashFavorite;
  const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);

  const season = {
    n: ms.length,
    correct: ms.filter((m) => pickCorrect(m)).length,
    acc: ms.length ? Math.round((ms.filter((m) => pickCorrect(m)).length / ms.length) * 100) : 0,
  };

  // "Yesterday" = the most recent day with completed matches in the record.
  const latestDate = ms.reduce((max, m) => (m.date > max ? m.date : max), '');
  const day = latestDate.slice(0, 10);
  const dayMatches = ms.filter((m) => m.date.slice(0, 10) === day);
  const fav = (m) => (pickFav(m) === m.p1 ? m.name1 : m.name2);
  const dog = (m) => (pickFav(m) === m.p1 ? m.name2 : m.name1);
  const favProb = (m) => Math.max(pickProbP1(m), 1 - pickProbP1(m));

  const hits = dayMatches.filter((m) => pickCorrect(m));
  const beatBookies = hits.filter((m) => m.oddCorrect === false);
  // Boldest correct call = lowest stated confidence that still hit.
  const boldest = hits.length ? hits.reduce((b, m) => (favProb(m) < favProb(b) ? m : b)) : null;
  // The miss we own = highest stated confidence that missed.
  const misses = dayMatches.filter((m) => !pickCorrect(m));
  const worstMiss = misses.length ? misses.reduce((w, m) => (favProb(m) > favProb(w) ? m : w)) : null;

  const yesterday = {
    date: day,
    n: dayMatches.length,
    correct: hits.length,
    beatBookies: beatBookies.map((m) => ({
      tour: m.tour, call: `${fav(m)} over ${dog(m)}`, prob: Math.round(favProb(m) * 100),
    })),
    boldest: boldest ? { call: `${fav(boldest)} over ${dog(boldest)}`, prob: Math.round(favProb(boldest) * 100) } : null,
    worstMiss: worstMiss ? { call: `${fav(worstMiss)} (we said ${Math.round(favProb(worstMiss) * 100)}%)`, winner: dog(worstMiss) } : null,
  };

  // Upset watch: pending picks where the model backs a materially
  // worse-ranked player. Sorted by ranking gap; top 3.
  const upsetWatch = (preds.predictions || [])
    .filter((p) => p.status === 'pending')
    .map((p) => {
      const favId = p.favorite;
      const oppId = favId === p.p1 ? p.p2 : p.p1;
      const favRank = ranks[p.tour]?.get(favId);
      const oppRank = ranks[p.tour]?.get(oppId);
      if (!isUpsetPick(favRank, oppRank)) return null;
      return {
        id: p.id, tour: p.tour, surface: p.surface, event: p.event, date: p.date,
        favName: p.favName,
        oppName: favId === p.p1 ? p.name2 : p.name1,
        favProb: p.favProb, favRank, oppRank,
        reason: upsetReason(p, favRank, oppRank),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.favRank - b.oppRank) - (a.favRank - a.oppRank))
    .slice(0, 3);

  // Ready-to-post text for the optional social webhook.
  const lines = [];
  if (dayMatches.length) {
    lines.push(`Yesterday's scorecard (${day}): called ${hits.length} of ${dayMatches.length} winners.`);
    if (beatBookies.length) lines.push(`Beat the bookies on: ${beatBookies.map((m) => m.call).join('; ')}.`);
    if (worstMiss) lines.push(`The one we own: ${yesterday.worstMiss.call} lost.`);
  }
  lines.push(`Season: ${season.correct.toLocaleString()} of ${season.n.toLocaleString()} winners called (${season.acc}%), every call public.`);
  for (const u of upsetWatch) {
    lines.push(`Upset watch: ${u.favName} (#${u.favRank}) over #${u.oppRank} ${u.oppName} at ${Math.round(u.favProb * 100)}%. ${u.reason}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    yesterday,
    season,
    upsetWatch,
    postText: lines.join('\n'),
  };
  const outPath = path.join(DATA, 'daily_scorecard.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath}`);
  console.log(out.postText);
}

run();
