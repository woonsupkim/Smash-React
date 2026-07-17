/**
 * Forward-test engine - public/data/predictions.json.
 *
 * Unlike the retrospective Track Record (which re-simulates finished matches),
 * this LOCKS a prediction for an upcoming match BEFORE it is played, then grades
 * it once the result lands. That's a leak-free, honest forward record.
 *
 * Each run:
 *   1. Loads the existing predictions.json (never re-predicts a locked match).
 *   2. Grades any 'pending' predictions whose result now appears in the cache.
 *   3. Seeds new 'pending' predictions from ESPN's upcoming schedule for
 *      matches between two roster players, using the same sim+Elo blend the
 *      live app uses.
 *
 * Usage: node buildPredictions.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { matchProb } = require('./lib/analyticProb');
const { predElo, expected } = require('./eloCore');
const { applyCalib } = require('./lib/evalCore');
const { normName, normSurface, matchRoster } = require('./lib/espnParse');
const { matchEvent } = require('./lib/events');
const ENGINE = require('../src/engineConfig.json'); // per tour x surface blend weights

// Which engine is most accurate for each tour x surface (from the backtest).
// Locked predictions use THAT engine, so the forward record is made with the
// model that actually performs best on the given surface, not a fixed blend.
const ACC = (() => {
  const p = path.join(__dirname, '..', 'public', 'data', 'engine_accuracy.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
})();

const LOOKAHEAD_DAYS = 10;
const BROWSER_UA = 'Mozilla/5.0';

const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

function loadTour(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const dir = path.join(__dirname, '..', 'public', 'data', ns);
  const RAW = path.join(__dirname, 'raw', ns);

  const statsBySurface = {};
  const upsetBySurface = {}; // hot-form (7-day half-life) stats, for the Hot Streak engine
  let roster = [];
  for (const [surface, file] of Object.entries(SURFACE_CSV)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { statsBySurface[surface] = new Map(); upsetBySurface[surface] = new Map(); continue; }
    const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
    statsBySurface[surface] = new Map(rows.map((r) => [r.id, r]));
    if (surface === 'hard') roster = rows.map((r) => ({ id: r.id, name: r.name, norm: normName(r.name) }));

    const up = path.join(dir, file.replace('.csv', '_upset.csv'));
    upsetBySurface[surface] = fs.existsSync(up)
      ? new Map(Papa.parse(fs.readFileSync(up, 'utf8'), { header: true }).data.filter((r) => r.id).map((r) => [r.id, r]))
      : new Map();
  }
  const elo = fs.existsSync(path.join(dir, 'elo.json'))
    ? JSON.parse(fs.readFileSync(path.join(dir, 'elo.json'), 'utf8')) : {};

  // Completed matches (short-id pairs) for grading, keyed by sorted pair.
  const idMap = JSON.parse(fs.readFileSync(path.join(RAW, 'player-id-map.json'), 'utf8'));
  const apiToShort = new Map(Object.entries(idMap).map(([sid, aid]) => [String(aid), sid]));
  const completed = new Map();
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    for (const m of (Array.isArray(j) ? j : (j.matches || j.data || []))) {
      if (m.result_type !== 'completed') continue;
      const p1 = apiToShort.get(String(m.player1Id)), p2 = apiToShort.get(String(m.player2Id));
      const w = apiToShort.get(String(m.match_winner));
      if (!p1 || !p2 || !w) continue;
      const key = [p1, p2].sort().join('_');
      if (!completed.has(key)) completed.set(key, []);
      completed.get(key).push({ date: m.date, winner: w, score: m.result || '' });
    }
  }

  return { tour, dir, roster, statsBySurface, upsetBySurface, elo, completed, bestOf: tour === 'wta' ? 3 : 5 };
}

const probsFromRow = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);

// Locked prediction for a matchup on a surface, made with the best-performing
// engine for this tour x surface. bestOf comes from the event (ATP slams are
// best-of-five, everything else best-of-three). Returns { probA, engine }
// (P(a wins) plus the engine used) or null if either player lacks stats.
function predict(ctx, a, b, surface, bestOf) {
  const rowA = ctx.statsBySurface[surface].get(a.id);
  const rowB = ctx.statsBySurface[surface].get(b.id);
  if (!rowA || !rowB) return null;
  const bo = bestOf || ctx.bestOf;

  const best = ACC?.[ctx.tour]?.[surface]?.best || 'smash';

  // Closed-form match probability on the SEASON stats - deterministic by
  // construction, so the locked number equals the live H2H number to the
  // digit with no seeding gymnastics (the H2H engine probability computes
  // the same expression). Kept separate from the hot-form sim below so the
  // Smart Blend and the 'sim' engine always see season stats.
  const pA = probsFromRow(rowA), pB = probsFromRow(rowB);
  const simP = matchProb(pA, pB, bo);

  // The Hot Streak (upset) engine runs the point sim on heavy-recency stats,
  // per-player falling back to the season stats when a player has no hot-form
  // row - exactly what the H2H page's slider seeding does.
  let upsetP = simP;
  if (best === 'upset' && ctx.upsetBySurface) {
    const uA = ctx.upsetBySurface[surface].get(a.id);
    const uB = ctx.upsetBySurface[surface].get(b.id);
    upsetP = matchProb(uA ? probsFromRow(uA) : pA, uB ? probsFromRow(uB) : pB, bo);
  }

  // Missing Elo falls back to the point sim (the convention buildTitleOdds
  // and the client's engine picker both use) - never a hardcoded 0.5, which
  // would lock an arbitrary slot-order "favorite" on elo-best cells.
  const eA = ctx.elo[a.id], eB = ctx.elo[b.id];
  const eloP = (eA && eB) ? expected(predElo(eA, surface), predElo(eB, surface)) : simP;
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankP = 1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale));
  const w = (ENGINE.weights[ctx.tour] && ENGINE.weights[ctx.tour][surface]) || { ws: 0.5, we: 0.5, wr: 0 };
  // Per-tour Platt recalibration (mirrors src/engines.js calibrate):
  // tempers stated confidence, never flips the favorite.
  const calibA = ENGINE.calibration && ENGINE.calibration[ctx.tour] && ENGINE.calibration[ctx.tour].a;
  const smashP = applyCalib(w.ws * simP + w.we * eloP + w.wr * rankP, calibA);

  const probs = { smash: smashP, sim: simP, elo: eloP, rank: rankP, upset: upsetP };
  const engine = probs[best] != null ? best : 'smash';
  return { probA: probs[engine], engine };
}

let fetchFailures = 0;

async function fetchSchedule(league, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${yyyymmdd}`;
  // Retry a couple of times - a swallowed transient failure once cost us the
  // Wimbledon women's final (the WTA fetch hiccupped and silently returned []).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const out = [];
      for (const ev of data.events || []) {
        for (const g of ev.groupings || []) {
          const isWta = /women/i.test(g.grouping?.displayName || '');
          if ((league === 'wta') !== isWta) continue;
          for (const c of g.competitions || []) {
            if (!/scheduled/i.test(c.status?.type?.name || '')) continue;
            const names = (c.competitors || []).map((x) => x?.athlete?.displayName).filter(Boolean);
            if (names.length !== 2) continue;
            out.push({ id: String(c.id), date: c.date, eventName: ev.name, names });
          }
        }
      }
      return out;
    } catch (err) {
      if (attempt === 2) {
        fetchFailures++;
        console.warn(`  ! ${league} ${yyyymmdd} schedule fetch failed: ${err.message}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return [];
}

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function run() {
  const outPath = path.join(__dirname, '..', 'public', 'data', 'predictions.json');
  // NOTE: if this file exists but is corrupt, we WANT the loud crash below -
  // it is the locked forward ledger, and silently restarting it empty would
  // erase the on-the-record history. The workflow keeps the old commit.
  const store = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { predictions: [] };

  // Collapse any pre-existing duplicates (same tour + pair + day), preferring
  // a decided entry over a still-pending one.
  const loadKey = (p) => `${p.tour}|${[p.p1, p.p2].sort().join('_')}|${new Date(p.date).toISOString().slice(0, 10)}`;
  const dedup = new Map();
  for (const p of store.predictions) {
    const k = loadKey(p);
    const prev = dedup.get(k);
    if (!prev || (prev.status === 'pending' && p.status !== 'pending')) dedup.set(k, p);
  }
  store.predictions = [...dedup.values()];

  const ctxByTour = { atp: loadTour('atp'), wta: loadTour('wta') };

  // ── 1. Grade pending predictions ────────────────────────────────────────
  let graded = 0;
  for (const p of store.predictions) {
    if (p.status !== 'pending') continue;
    const ctx = ctxByTour[p.tour];
    const key = [p.p1, p.p2].sort().join('_');
    const results = ctx.completed.get(key) || [];
    const predDate = new Date(p.date);
    const hit = results.find((r) => {
      const d = new Date(r.date);
      return Math.abs(d - predDate) < 5 * 864e5; // within 5 days of the scheduled date
    });
    if (hit) {
      p.status = hit.winner === p.favorite ? 'won' : 'lost';
      p.winner = hit.winner;
      p.score = hit.score;
      p.correct = hit.winner === p.favorite;
      graded++;
    }
  }

  // ── 1b. Refresh still-pending picks with the current best engine ─────────
  // They haven't been played yet, so re-locking them with the best-performing
  // engine for their surface (and any newly tuned weights) is still leak-free.
  let refreshed = 0;
  for (const p of store.predictions) {
    if (p.status !== 'pending') continue;
    const ctx = ctxByTour[p.tour];
    const pred = predict(ctx, { id: p.p1, name: p.name1 }, { id: p.p2, name: p.name2 }, p.surface, p.bestOf);
    if (!pred) continue;
    const { probA, engine } = pred;
    p.probP1 = Math.round(probA * 1000) / 1000;
    p.favorite = probA >= 0.5 ? p.p1 : p.p2;
    p.favName = p.favorite === p.p1 ? p.name1 : p.name2;
    p.favProb = Math.round((probA >= 0.5 ? probA : 1 - probA) * 1000) / 1000;
    p.engine = engine;
    refreshed++;
  }

  // ── 2. Seed new upcoming predictions ────────────────────────────────────
  // Dedupe by matchup identity (tour + player pair + day), NOT the ESPN
  // competition id - ESPN reassigns that id between runs, which would
  // otherwise lock the same match twice.
  const dayKey = (tour, p1, p2, date) =>
    `${tour}|${[p1, p2].sort().join('_')}|${new Date(date).toISOString().slice(0, 10)}`;
  const seen = new Set(store.predictions.map((p) => dayKey(p.tour, p.p1, p.p2, p.date)));

  let added = 0;
  const today = new Date();
  for (const league of ['atp', 'wta']) {
    const ctx = ctxByTour[league];
    for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const games = await fetchSchedule(league, ymd(d));
      for (const g of games) {
        // The events registry is the allowlist: slams + the six combined
        // 1000s. Anything else (exhibitions, 500s, team events) never locks.
        const ev = matchEvent(g.eventName);
        if (!ev) continue;
        const a = matchRoster(g.names[0], ctx.roster);
        const b = matchRoster(g.names[1], ctx.roster);
        if (!a || !b || a.id === b.id) continue;
        const key = dayKey(league, a.id, b.id, g.date);
        if (seen.has(key)) continue;
        const bestOf = ev.bestOf[league] || ctx.bestOf;
        const pred = predict(ctx, a, b, ev.surface, bestOf);
        if (pred == null) continue;
        const { probA, engine } = pred;
        const favorite = probA >= 0.5 ? a.id : b.id;
        const favProb = probA >= 0.5 ? probA : 1 - probA;
        store.predictions.push({
          id: g.id, tour: league, surface: ev.surface, event: ev.label, date: g.date,
          tier: ev.tier, bestOf,
          p1: a.id, p2: b.id, name1: a.name, name2: b.name,
          probP1: Math.round(probA * 1000) / 1000,
          favorite, favName: favorite === a.id ? a.name : b.name,
          favProb: Math.round(favProb * 1000) / 1000,
          engine,
          status: 'pending', lockedAt: new Date().toISOString(),
        });
        seen.add(key);
        added++;
      }
    }
  }

  store.generatedAt = new Date().toISOString();
  store.predictions.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync(outPath, JSON.stringify(store));

  const pending = store.predictions.filter((p) => p.status === 'pending').length;
  const decided = store.predictions.filter((p) => p.status !== 'pending');
  const wins = decided.filter((p) => p.correct).length;
  console.log(`Graded ${graded}, refreshed ${refreshed}, added ${added}. Now ${pending} pending, ${decided.length} decided (${wins} correct).`);
  if (fetchFailures) console.warn(`  ! ${fetchFailures} schedule fetch(es) failed after retries - some upcoming matches may be missing this run.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
