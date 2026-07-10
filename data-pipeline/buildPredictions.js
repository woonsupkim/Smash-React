/**
 * Forward-test engine — public/data/predictions.json.
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
const { winProb } = require('./simCore');
const { predElo, expected } = require('./eloCore');

const SIMS = 1000;
const ELO_WEIGHT = 0.4;
const LOOKAHEAD_DAYS = 10;
const BROWSER_UA = 'Mozilla/5.0';

const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

const normName = (s) => (s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[-–]/g, ' ').replace(/[^a-z\s']/g, '').replace(/\s+/g, ' ').trim();

function normSurface(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s.includes('clay')) return 'clay';
  if (s.includes('grass')) return 'grass';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return null;
}

// Best-effort surface from an ESPN event name (schedule doesn't expose it
// directly). Falls back to hard, the most common surface.
function surfaceFromEventName(name) {
  const n = (name || '').toLowerCase();
  if (/wimbledon|newport|hall of fame|grass|halle|queen|s-hertogenbosch|eastbourne|mallorca|stuttgart/.test(n)) return 'grass';
  if (/roland garros|french open|madrid|rome|monte|bastad|gstaad|hamburg|kitzbuhel|umag|bucharest|clay|barcelona|estoril|munich/.test(n)) return 'clay';
  return 'hard';
}

function loadTour(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const dir = path.join(__dirname, '..', 'public', 'data', ns);
  const RAW = path.join(__dirname, 'raw', ns);

  const statsBySurface = {};
  let roster = [];
  for (const [surface, file] of Object.entries(SURFACE_CSV)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { statsBySurface[surface] = new Map(); continue; }
    const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
    statsBySurface[surface] = new Map(rows.map((r) => [r.id, r]));
    if (surface === 'hard') roster = rows.map((r) => ({ id: r.id, name: r.name, norm: normName(r.name) }));
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

  return { tour, dir, roster, statsBySurface, elo, completed, bestOf: tour === 'wta' ? 3 : 5 };
}

const probsFromRow = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);

function matchRoster(espnName, roster) {
  const norm = normName(espnName);
  let hit = roster.find((p) => p.norm === norm);
  if (hit) return hit;
  const last = norm.split(' ').pop();
  const lastHits = roster.filter((p) => p.norm.split(' ').pop() === last);
  return lastHits.length === 1 ? lastHits[0] : null;
}

// Locked blended prediction for a matchup on a surface.
function predict(ctx, a, b, surface) {
  const rowA = ctx.statsBySurface[surface].get(a.id);
  const rowB = ctx.statsBySurface[surface].get(b.id);
  if (!rowA || !rowB) return null;
  const simP = winProb(probsFromRow(rowA), probsFromRow(rowB), SIMS, ctx.bestOf);
  const eA = ctx.elo[a.id], eB = ctx.elo[b.id];
  let eloP = 0.5;
  if (eA && eB) eloP = expected(predElo(eA, surface), predElo(eB, surface));
  const probA = ELO_WEIGHT * eloP + (1 - ELO_WEIGHT) * simP;
  return probA;
}

let fetchFailures = 0;

async function fetchSchedule(league, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${yyyymmdd}`;
  // Retry a couple of times — a swallowed transient failure once cost us the
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

  // ── 2. Seed new upcoming predictions ────────────────────────────────────
  // Dedupe by matchup identity (tour + player pair + day), NOT the ESPN
  // competition id — ESPN reassigns that id between runs, which would
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
        const a = matchRoster(g.names[0], ctx.roster);
        const b = matchRoster(g.names[1], ctx.roster);
        if (!a || !b || a.id === b.id) continue;
        const key = dayKey(league, a.id, b.id, g.date);
        if (seen.has(key)) continue;
        const surface = surfaceFromEventName(g.eventName);
        const probA = predict(ctx, a, b, surface);
        if (probA == null) continue;
        const favorite = probA >= 0.5 ? a.id : b.id;
        const favProb = probA >= 0.5 ? probA : 1 - probA;
        store.predictions.push({
          id: g.id, tour: league, surface, event: g.eventName, date: g.date,
          p1: a.id, p2: b.id, name1: a.name, name2: b.name,
          probP1: Math.round(probA * 1000) / 1000,
          favorite, favName: favorite === a.id ? a.name : b.name,
          favProb: Math.round(favProb * 1000) / 1000,
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
  console.log(`Graded ${graded}, added ${added}. Now ${pending} pending, ${decided.length} decided (${wins} correct).`);
  if (fetchFailures) console.warn(`  ! ${fetchFailures} schedule fetch(es) failed after retries — some upcoming matches may be missing this run.`);
}

run();
