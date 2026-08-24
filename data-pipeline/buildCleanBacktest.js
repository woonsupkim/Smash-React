// data-pipeline/buildCleanBacktest.js
//
// A HELD-OUT dataset: every 2026 match scored with a probability that could
// have been computed the morning of the match, and nothing else.
//
// WHY THIS EXISTS. Everything downstream of track_record.json is fitted on
// probabilities that were recomputed at the end of the season. That barely
// changes the headline accuracy - on 209 matches joined to the forward ledger
// the resimulated model is 1.5 points better and no more confident - but it
// reorders matches at the margin, and the margin is where a call threshold and
// a staking rule both live. The consequence was visible: the bookmakers'
// favourite beat its own vig-free price by +7.2pt on our called matches and
// undershot by 6.8pt on our passes, a 14-point split that outcome-blind data
// cannot produce. On the forward ledger the same split is +4.6 and +4.2.
//
// So the tuning inputs were quietly circular, and the backtests they produced
// (edge plan +18.4%) ran three times the forward result (+5.6%). Rather than
// keep discounting contaminated numbers, this rebuilds the evidence.
//
// WHAT "CLEAN" MEANS HERE, precisely:
//   - the FIXTURE LIST comes from track_record.json, which is safe: who
//     played, when, on what, at what price, and who won are recorded facts,
//     not model output. Only the probability there is resimulated, and the
//     probability is exactly what this file replaces.
//   - serve/return stats are aggregated from a player's matches strictly
//     BEFORE the match date, with the test match excluded by id. Aggregated
//     across surfaces rather than filtered to one: a player has hundreds of
//     hard-court points behind them and maybe twenty grass matches ever, and
//     the clean data can decide later whether the specificity was worth the
//     sample. Surface still selects the blend weights.
//   - Elo is read from elo_history at the last rating stamped before the date
//   - rank is the player's position in the as-of Elo table, not today's seed
//   - odds and results are facts recorded at the time, not model output
//   - rows are ORIENTATION-SYMMETRISED. track_record is winner-first, so a
//     naive fit on it learns "always 1" and scores a fraudulent 100%. The side
//     is chosen by a hash of the fixture: deterministic, and independent of
//     the result.
//
// Nothing here can see a result before it predicts it. That is the whole
// point, and it is why this file can be trusted to tune against where
// track_record cannot.
//
// Usage: node data-pipeline/buildCleanBacktest.js [tour] [--out FILE]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { emptyAgg, accumulateMatch, deriveProbabilities, deriveTourAverages } = require('./lib/probabilities');

const TOUR = process.argv[2] === 'wta' ? 'wta' : 'atp';
const RAW_DIR = path.join(__dirname, 'raw', TOUR === 'wta' ? 'women' : '');
const DATA_DIR = path.join(__dirname, '..', 'public', 'data', TOUR === 'wta' ? 'women' : '');
const ID_MAP_PATH = path.join(RAW_DIR, 'player-id-map.json');
const SURFACES_PATH = path.join(RAW_DIR, 'tournament-surfaces.json');
const ENGINE = require('../src/engineConfig.json');
const OUT = process.env.CLEAN_OUT || path.join(__dirname, 'output', `clean_backtest_${TOUR}.json`);

// Matches this many days into the season before we trust a player's history.
// Below it the as-of aggregate is mostly tour average and the "prediction" is
// really a prior, which would flatter the early months.
const MIN_PRIOR_MATCHES = 8;
const SIMS = 400;
// Recency weighting on the serve/return aggregate. Overridable so the clean
// data can choose it rather than inheriting a guess: HALF_LIFE=90 node ...
const HALF_LIFE = Number(process.env.HALF_LIFE) || 365;

const normalizeSurface = (s) => (s === 'I.hard' ? 'Hard' : s);
const SURF_KEY = { Hard: 'hard', Clay: 'clay', Grass: 'grass' };

function loadSimulator() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'simulator.js'), 'utf8').replace(/^export /gm, '');
  const tmp = path.join(os.tmpdir(), `sim-clean-${Date.now()}.cjs`);
  fs.writeFileSync(tmp, `${src}\nmodule.exports = { simulateBatch };\n`);
  const m = require(tmp);
  fs.unlinkSync(tmp);
  return m;
}

const matchCache = new Map();
function loadMatches(ourId) {
  if (!matchCache.has(ourId)) {
    const f = path.join(RAW_DIR, `${ourId}.json`);
    matchCache.set(ourId, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
  }
  return matchCache.get(ourId);
}

// Elo as of a date: the last rating stamped strictly before it. elo_history is
// built by replaying matches in order, so every entry is already a
// point-in-time value - no reconstruction needed, just do not read forward.
function eloAsOf(history, id, dateISO) {
  const series = history[id];
  if (!Array.isArray(series) || !series.length) return null;
  let out = null;
  for (const [d, r] of series) {
    if (d >= dateISO) break;
    out = r;
  }
  return out;
}

function main() {
  if (!fs.existsSync(ID_MAP_PATH)) {
    console.error(`No ${path.relative(process.cwd(), ID_MAP_PATH)}; run fetch.js ${TOUR} first.`);
    process.exit(1);
  }
  const idMap = JSON.parse(fs.readFileSync(ID_MAP_PATH, 'utf8'));
  const surfaceMap = fs.existsSync(SURFACES_PATH) ? JSON.parse(fs.readFileSync(SURFACES_PATH, 'utf8')) : {};
  const eloHistory = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'elo_history.json'), 'utf8'));
  const { simulateBatch } = loadSimulator();
  const apiToOur = new Map(Object.entries(idMap).map(([o, a]) => [String(a), o]));

  // Fixtures from the graded record. Facts only - the probability column
  // there is the thing being replaced, so it is never read.
  // track_record is ONE combined file carrying a `tour` field, unlike
  // elo_history which has a women/ mirror. Reading it from DATA_DIR worked
  // for ATP by accident and had no WTA file to find.
  const TRACK = path.join(__dirname, '..', 'public', 'data', 'track_record.json');
  const track = JSON.parse(fs.readFileSync(TRACK, 'utf8')).matches || [];
  // Raw rows give the API match id, needed to exclude the test match from its
  // own history. Keyed by pair+day, the same identity the repo uses elsewhere.
  const rawById = new Map();
  for (const [ourId, apiId] of Object.entries(idMap)) {
    for (const m of loadMatches(ourId)) {
      if (!m.id || !m.date) continue;
      const day = String(m.date).slice(0, 10);
      if (day < '2026-01-01') continue;
      const oppApi = String(m.player1Id) === String(apiId) ? m.player2Id : m.player1Id;
      const oppOur = apiToOur.get(String(oppApi));
      if (!oppOur) continue;
      rawById.set([ourId, oppOur].sort().join('_') + '@' + day, String(m.id));
    }
  }
  const fixtures = [];
  for (const m of track) {
    if (!m.p1 || !m.p2 || !m.date || !m.winner) continue;
    if (!idMap[m.p1] || !idMap[m.p2]) continue;
    if (m.tour && m.tour !== TOUR) continue;
    const day = String(m.date).slice(0, 10);
    if (day < '2026-01-01') continue;
    const surface = m.surface;
    if (!['hard', 'clay', 'grass'].includes(surface)) continue;
    fixtures.push({
      id: rawById.get([m.p1, m.p2].sort().join('_') + '@' + day) || null,
      day, surface, p1: m.p1, p2: m.p2,
      p1Won: m.winner === m.p1,
      od1: Number(m.od1) > 1 ? Number(m.od1) : null,
      od2: Number(m.od2) > 1 ? Number(m.od2) : null,
      event: m.event || null,
    });
  }
  fixtures.sort((a, b) => (a.day < b.day ? -1 : 1));
  console.log(`${TOUR.toUpperCase()}: ${fixtures.length} graded 2026 fixtures between two rostered players`);

  // Tour averages from pre-2026 history only, so they carry no in-season
  // information either. One set across surfaces, matching how the stats
  // below are aggregated.
  const cutoff = new Date('2026-01-01');
  const tourAverages = (() => {
    const totals = emptyAgg();
    for (const [ourId, apiId] of Object.entries(idMap)) {
      for (const m of loadMatches(ourId)) {
        if (String(m.date).slice(0, 10) >= '2026-01-01') continue;
        accumulateMatch(emptyAgg(), totals, m, apiId, cutoff, HALF_LIFE);
      }
    }
    return deriveTourAverages(totals);
  })();

  const statsAsOf = (ourId, excludeId, asOf) => {
    const agg = emptyAgg();
    let n = 0;
    for (const m of loadMatches(ourId)) {
      if (excludeId && String(m.id) === String(excludeId)) continue;
      if (new Date(m.date) >= asOf) continue; // STRICTLY before
      accumulateMatch(agg, null, m, idMap[ourId], asOf, HALF_LIFE);
      n++;
    }
    return n >= MIN_PRIOR_MATCHES ? deriveProbabilities(agg, tourAverages) : null;
  };

  const rows = [];
  let skipped = 0;
  for (const f of fixtures) {
    const asOf = new Date(`${f.day}T00:00:00Z`);
    const a = statsAsOf(f.p1, f.id, asOf);
    const b = statsAsOf(f.p2, f.id, asOf);
    if (!a || !b) { skipped++; continue; }

    const { matchWins } = simulateBatch(a, b, SIMS, 3);
    const simP1 = matchWins[0] / SIMS;

    const e1 = eloAsOf(eloHistory, f.p1, f.day);
    const e2 = eloAsOf(eloHistory, f.p2, f.day);
    if (e1 == null || e2 == null) { skipped++; continue; }
    const eloP1 = 1 / (1 + 10 ** ((e2 - e1) / 400));

    // Rank position from the as-of Elo table, not today's seeding. Using the
    // current seed would import end-of-season knowledge through the back door
    // on the one component meant to be independent of form.
    const board = Object.keys(eloHistory)
      .map((id) => [id, eloAsOf(eloHistory, id, f.day)])
      .filter(([, r]) => r != null)
      .sort((x, y) => y[1] - x[1]);
    const pos = new Map(board.map(([id], i) => [id, i + 1]));
    const r1 = pos.get(f.p1), r2 = pos.get(f.p2);
    if (!r1 || !r2) { skipped++; continue; }
    const rankP1 = 1 / (1 + 10 ** ((Math.log10(r1) - Math.log10(r2)) * ENGINE.rankScale));

    const w = ENGINE.weights?.[TOUR]?.[f.surface];
    if (!w) { skipped++; continue; }
    const blendP1 = w.ws * simP1 + w.we * eloP1 + w.wr * rankP1;

    // ORIENTATION. track_record stores every row winner-first, so p1 is the
    // winner in 100% of rows. Accuracy survives that (it is a symmetric
    // question: how often is our favourite p1), but anything that FITS on the
    // rows sees a target that never varies and learns "always 1" - a
    // fraudulent 100%. Emitting winner-first would hand that trap to every
    // future consumer of this file.
    //
    // So the side is decided by a hash of the fixture: deterministic, so the
    // artifact is reproducible, and independent of the result, so it carries
    // no information. Roughly half the rows come out flipped.
    const h = `${f.p1}|${f.p2}|${f.day}`.split('').reduce((a, ch) => ((a * 31 + ch.charCodeAt(0)) >>> 0), 7);
    const flip = (h & 1) === 1;
    rows.push({
      id: f.id, day: f.day, tour: TOUR, surface: f.surface, event: f.event,
      p1: flip ? f.p2 : f.p1,
      p2: flip ? f.p1 : f.p2,
      p1Won: flip ? !f.p1Won : f.p1Won,
      od1: flip ? f.od2 : f.od1,
      od2: flip ? f.od1 : f.od2,
      simP1: +(flip ? 1 - simP1 : simP1).toFixed(4),
      eloP1: +(flip ? 1 - eloP1 : eloP1).toFixed(4),
      rankP1: +(flip ? 1 - rankP1 : rankP1).toFixed(4),
      probP1: +(flip ? 1 - blendP1 : blendP1).toFixed(4),
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    _comment: 'Walk-forward held-out set. Every probability computed from data strictly before its match date.',
    builtAt: new Date().toISOString(),
    tour: TOUR,
    halfLife: HALF_LIFE,
    simsPerMatch: SIMS,
    minPriorMatches: MIN_PRIOR_MATCHES,
    rows,
  }, null, 0));
  const priced = rows.filter((r) => r.od1 && r.od2).length;
  console.log(`  scored ${rows.length} (skipped ${skipped} for thin history), ${priced} with odds -> ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main();
module.exports = { eloAsOf };
