/**
 * Championship odds - public/data/title_odds.json.
 *
 * Finds the grand slam that's live (or just finished), reconstructs the
 * remaining draw from ESPN's open scoreboard API, and simulates the rest of
 * the tournament N times with the same engine that locks match predictions.
 * Each run appends a dated snapshot per tour, so the odds carry their own
 * history ("Sinner 34% -> 41% after the quarterfinals").
 *
 * Off-season runs leave the previous tournament's final odds untouched.
 *
 * Usage: node buildTitleOdds.js
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { winProb, seedFromString } = require('./simCore');
const { predElo, expected } = require('./eloCore');
const { normName, matchRoster } = require('./lib/espnParse');
const ENGINE = require('../src/engineConfig.json');

const N_SIM = 2000;
const PAIR_SIMS = 500;
const BROWSER_UA = 'Mozilla/5.0';

const SLAMS = [
  { pattern: /australian open/i, label: 'Australian Open', surface: 'hard' },
  { pattern: /roland garros|french open/i, label: 'French Open', surface: 'clay' },
  { pattern: /wimbledon/i, label: 'Wimbledon', surface: 'grass' },
  { pattern: /us open/i, label: 'US Open', surface: 'hard' },
];
const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

// Best engine per tour x surface, same choice the locked predictions use.
const ACC = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'engine_accuracy.json'), 'utf8')); } catch { return {}; }
})();

// Per-tour calibration shrink (mirrors src/engines.js shrinkTail).
function shrinkTail(p, tour) {
  const s = ENGINE.tailShrink && ENGINE.tailShrink[tour];
  if (!s) return p;
  const fav = Math.max(p, 1 - p);
  if (fav <= s.knee) return p;
  const shrunk = s.knee + (fav - s.knee) * s.factor;
  return p >= 0.5 ? shrunk : 1 - shrunk;
}

// ── Roster/stats context (subset of buildPredictions.loadTour) ────────────
function loadTour(tour) {
  const ns = tour === 'wta' ? 'women' : '';
  const dir = path.join(__dirname, '..', 'public', 'data', ns);
  const statsBySurface = {};
  let roster = [];
  for (const [surface, file] of Object.entries(SURFACE_CSV)) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) { statsBySurface[surface] = new Map(); continue; }
    const rows = Papa.parse(fs.readFileSync(p, 'utf8'), { header: true }).data.filter((r) => r.id);
    statsBySurface[surface] = new Map(rows.map((r) => [r.id, r]));
    if (surface === 'hard') roster = rows.map((r) => ({ id: r.id, name: r.name, norm: normName(r.name) }));
  }
  const eloPath = path.join(dir, 'elo.json');
  const elo = fs.existsSync(eloPath) ? JSON.parse(fs.readFileSync(eloPath, 'utf8')) : {};
  return { tour, roster, statsBySurface, elo, bestOf: tour === 'wta' ? 3 : 5 };
}

const probsFromRow = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);

// P(a beats b) with the best engine for this tour x surface (mirrors
// buildPredictions.predict, minus the hot-form branch: title odds always use
// season stats for stability across a fortnight).
function pairProb(ctx, a, b, surface) {
  const rowA = a.rostered ? ctx.statsBySurface[surface].get(a.id) : null;
  const rowB = b.rostered ? ctx.statsBySurface[surface].get(b.id) : null;
  // Unrostered players (qualifiers/wildcards without stats): treated as heavy
  // underdogs vs a rostered player, a coin flip vs each other.
  if (!rowA && !rowB) return 0.5;
  if (!rowA) return 0.2;
  if (!rowB) return 0.8;

  const seedKey = [a.id, b.id].sort().join('_') + '|title|' + surface + '|' + ctx.tour;
  const simP = winProb(probsFromRow(rowA), probsFromRow(rowB), PAIR_SIMS, ctx.bestOf, seedFromString(seedKey));
  const eA = ctx.elo[a.id], eB = ctx.elo[b.id];
  const eloP = eA && eB ? expected(predElo(eA, surface), predElo(eB, surface)) : simP;
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankP = 1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale));
  const w = (ENGINE.weights[ctx.tour] && ENGINE.weights[ctx.tour][surface]) || { ws: 0.5, we: 0.5, wr: 0 };
  const smashP = shrinkTail(w.ws * simP + w.we * eloP + w.wr * rankP, ctx.tour);
  const probs = { smash: smashP, sim: simP, elo: eloP, rank: rankP, upset: simP };
  const best = ACC?.[ctx.tour]?.[surface]?.best || 'smash';
  return probs[best] != null ? probs[best] : smashP;
}

// ── ESPN: find the live/most recent slam and its remaining field ──────────
async function fetchScoreboard(league, yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard?dates=${yyyymmdd}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

async function findSlamEvent(league) {
  const today = new Date();
  for (let back = 0; back <= 16; back++) {
    const d = new Date(today); d.setDate(d.getDate() - back);
    const data = await fetchScoreboard(league, ymd(d));
    const ev = data?.events?.find((e) => SLAMS.some((s) => s.pattern.test(e.name || '')) && e.groupings?.length);
    if (ev) return ev;
  }
  return null;
}

// Draw-ordered rounds from ESPN's grouping (same feeder-chaining trick as
// api/espn-bracket.js): returns { fields: Map(size -> [names in draw order]),
// champion } where names may include 'TBD'.
function extractDraw(event, tour) {
  const groupingName = tour === 'wta' ? /women's singles/i : /men's singles/i;
  const grouping = event.groupings.find((g) => groupingName.test(g.grouping?.displayName || ''));
  if (!grouping?.competitions?.length) return null;
  const mainDraw = grouping.competitions.filter((c) => !/qualifying/i.test(c.round?.displayName || ''));

  const byRound = new Map();
  for (const c of mainDraw) {
    const key = c.round?.displayName || '?';
    if (!byRound.has(key)) byRound.set(key, []);
    byRound.get(key).push(c);
  }
  const sortedComps = (m) => [...(m.competitors || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const compName = (c) => (c?.athlete?.displayName || c?.athlete?.fullName || '').trim();

  const orderRound = (current, orderedNext) => {
    if (!orderedNext) return current;
    const used = new Set();
    const slots = new Array(current.length).fill(null);
    orderedNext.forEach((nm, k) => {
      if (!nm) return;
      sortedComps(nm).forEach((c, j) => {
        const name = compName(c);
        if (!name || /^tbd$/i.test(name)) return;
        const feeder = current.find((m) => !used.has(m.id) && sortedComps(m).some((x) => compName(x) === name));
        if (feeder && 2 * k + j < slots.length) { slots[2 * k + j] = feeder; used.add(feeder.id); }
      });
    });
    const rest = current.filter((m) => !used.has(m.id));
    for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = rest.shift();
    return slots;
  };

  const roundsBySize = [...byRound.values()].sort((a, b) => a.length - b.length);
  const fields = new Map();
  let champion = null;
  let ordered = null;
  for (const round of roundsBySize) {
    ordered = orderRound(round, ordered);
    const names = [];
    for (const m of ordered) {
      for (const c of sortedComps(m)) {
        const nm = compName(c);
        names.push(nm && !/^tbd$/i.test(nm) ? nm : 'TBD');
      }
    }
    fields.set(names.length, names);
    if (round.length === 1) {
      const w = sortedComps(round[0]).find((c) => c.winner === true || c.winner === 'true');
      if (w) champion = compName(w);
    }
  }
  return { fields, champion };
}

// ── Tournament simulation ──────────────────────────────────────────────────
function simulateTitles(ctx, field, surface) {
  // field: [{id, name, rostered}] in draw order, power-of-two length
  const memo = new Map();
  const prob = (a, b) => {
    const key = a.id + '|' + b.id;
    if (!memo.has(key)) memo.set(key, pairProb(ctx, a, b, surface));
    return memo.get(key);
  };
  const titles = new Map(field.map((p) => [p.id, 0]));
  for (let t = 0; t < N_SIM; t++) {
    let cur = field;
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(Math.random() < prob(cur[i], cur[i + 1]) ? cur[i] : cur[i + 1]);
      }
      cur = next;
    }
    titles.set(cur[0].id, titles.get(cur[0].id) + 1);
  }
  return field
    .map((p) => ({ id: p.rostered ? p.id : null, name: p.name, prob: titles.get(p.id) / N_SIM }))
    .sort((a, b) => b.prob - a.prob);
}

async function buildTour(tour) {
  const ctx = loadTour(tour);
  const event = await findSlamEvent(tour);
  if (!event) return null;
  const slam = SLAMS.find((s) => s.pattern.test(event.name));
  const draw = extractDraw(event, tour);
  if (!draw) return null;

  // Debug hook: TITLE_ODDS_SIM_FROM=16 simulates from that round size even
  // when the tournament is decided - for testing the sim path off-season.
  const simFrom = Number(process.env.TITLE_ODDS_SIM_FROM) || 0;

  if (draw.champion && !simFrom) {
    const hit = matchRoster(draw.champion, ctx.roster);
    return {
      event: slam.label, tour, surface: slam.surface, status: 'final',
      updatedAt: new Date().toISOString(),
      champion: { id: hit?.id || null, name: hit?.name || draw.champion },
      odds: [{ id: hit?.id || null, name: hit?.name || draw.champion, prob: 1 }],
      fieldSize: 1,
    };
  }

  // Deepest fully-known round = the current remaining field.
  const sizes = [...draw.fields.keys()].sort((a, b) => a - b);
  let fieldNames = null, fieldSize = null;
  for (const size of sizes) {
    if (simFrom && size < simFrom) continue;
    const names = draw.fields.get(size);
    if (names.every((n) => n !== 'TBD')) { fieldNames = names; fieldSize = size; break; }
  }
  if (!fieldNames || fieldSize > 128) return null;

  const field = fieldNames.map((n, i) => {
    const hit = matchRoster(n, ctx.roster);
    return hit
      ? { id: hit.id, name: hit.name, rostered: true }
      : { id: `x${i}:${n}`, name: n, rostered: false };
  });

  const odds = simulateTitles(ctx, field, slam.surface);
  return {
    event: slam.label, tour, surface: slam.surface, status: 'live',
    updatedAt: new Date().toISOString(),
    fieldSize,
    odds: odds.map((o) => ({ ...o, prob: Math.round(o.prob * 1000) / 1000 })),
  };
}

async function run() {
  const outPath = path.join(__dirname, '..', 'public', 'data', 'title_odds.json');
  const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { events: {} };
  const out = { generatedAt: new Date().toISOString(), events: { ...prev.events } };
  const today = new Date().toISOString().slice(0, 10);

  for (const tour of ['atp', 'wta']) {
    const result = await buildTour(tour);
    if (!result) { console.log(`${tour}: no live slam found; keeping previous odds.`); continue; }

    // History: carry it across runs of the SAME event; a new slam starts fresh.
    const prevEntry = prev.events?.[tour];
    const history = (prevEntry && prevEntry.event === result.event) ? [...(prevEntry.history || [])] : [];
    const snapshot = {
      date: today,
      fieldSize: result.fieldSize,
      odds: Object.fromEntries(result.odds.slice(0, 10).map((o) => [o.name, o.prob])),
    };
    const dupIdx = history.findIndex((h) => h.date === today);
    if (dupIdx >= 0) history[dupIdx] = snapshot; else history.push(snapshot);
    out.events[tour] = { ...result, history };
    const top = result.odds.slice(0, 3).map((o) => `${o.name} ${(o.prob * 100).toFixed(0)}%`).join(', ');
    console.log(`${tour}: ${result.event} ${result.status} (field of ${result.fieldSize}) -> ${top}`);
  }

  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath}`);
}

run();
