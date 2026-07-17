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
const { matchProb } = require('./lib/analyticProb');
const { predElo, expected } = require('./eloCore');
const { normName, matchRoster } = require('./lib/espnParse');
const { SLAMS, findSlamEvent, extractDraw } = require('./lib/espnDraw');
const ENGINE = require('../src/engineConfig.json');

const N_SIM = 2000;

const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

// Best engine per tour x surface, same choice the locked predictions use.
const ACC = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'engine_accuracy.json'), 'utf8')); } catch { return {}; }
})();

// Per-tour Platt recalibration (mirrors src/engines.js calibrate).
const { applyCalib } = require('./lib/evalCore');
function calibrate(p, tour) {
  return applyCalib(p, ENGINE.calibration && ENGINE.calibration[tour] && ENGINE.calibration[tour].a);
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

  const simP = matchProb(probsFromRow(rowA), probsFromRow(rowB), ctx.bestOf);
  const eA = ctx.elo[a.id], eB = ctx.elo[b.id];
  const eloP = eA && eB ? expected(predElo(eA, surface), predElo(eB, surface)) : simP;
  const rankA = Number(rowA.us_seed) || 999, rankB = Number(rowB.us_seed) || 999;
  const rankP = 1 / (1 + Math.pow(10, (Math.log10(rankA) - Math.log10(rankB)) * ENGINE.rankScale));
  const w = (ENGINE.weights[ctx.tour] && ENGINE.weights[ctx.tour][surface]) || { ws: 0.5, we: 0.5, wr: 0 };
  const smashP = calibrate(w.ws * simP + w.we * eloP + w.wr * rankP, ctx.tour);
  const probs = { smash: smashP, sim: simP, elo: eloP, rank: rankP, upset: simP };
  const best = ACC?.[ctx.tour]?.[surface]?.best || 'smash';
  return probs[best] != null ? probs[best] : smashP;
}

// ── Tournament simulation ──────────────────────────────────────────────────
// Also tracks round-by-round survival: advance[playerIdx][r] counts sims
// where the player won their round-r match, so the draw page can show
// "makes the QF 61% / wins it all 24%" for every line of the bracket.
function simulateTitles(ctx, field, surface) {
  // field: [{id, name, rostered}] in draw order, power-of-two length
  const memo = new Map();
  const prob = (a, b) => {
    const key = a.id + '|' + b.id;
    if (!memo.has(key)) memo.set(key, pairProb(ctx, a, b, surface));
    return memo.get(key);
  };
  const nRounds = Math.round(Math.log2(field.length));
  const idx = new Map(field.map((p, i) => [p.id, i]));
  const advance = field.map(() => Array(nRounds).fill(0));
  const titles = new Map(field.map((p) => [p.id, 0]));
  for (let t = 0; t < N_SIM; t++) {
    let cur = field;
    let r = 0;
    while (cur.length > 1) {
      const next = [];
      for (let i = 0; i < cur.length; i += 2) {
        const winner = Math.random() < prob(cur[i], cur[i + 1]) ? cur[i] : cur[i + 1];
        advance[idx.get(winner.id)][r]++;
        next.push(winner);
      }
      cur = next;
      r++;
    }
    titles.set(cur[0].id, titles.get(cur[0].id) + 1);
  }
  const odds = field
    .map((p) => ({ id: p.rostered ? p.id : null, name: p.name, prob: titles.get(p.id) / N_SIM }))
    .sort((a, b) => b.prob - a.prob);
  const survival = advance.map((row) => row.map((c) => Math.round((c / N_SIM) * 1000) / 1000));
  return { odds, survival };
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

  const { odds, survival } = simulateTitles(ctx, field, slam.surface);
  const ranks = ctx.statsBySurface[slam.surface];
  return {
    event: slam.label, tour, surface: slam.surface, status: 'live',
    updatedAt: new Date().toISOString(),
    fieldSize,
    odds: odds.map((o) => ({ ...o, prob: Math.round(o.prob * 1000) / 1000 })),
    draw: {
      field: field.map((p) => ({
        id: p.rostered ? p.id : null,
        name: p.name,
        rank: p.rostered ? (Number(ranks.get(p.id)?.us_seed) || null) : null,
      })),
      survival,
    },
  };
}

// Off-season projection: no live draw, so seed a hypothetical 16-player
// field from the current rankings on the NEXT slam's surface and simulate
// that instead ("road to the US Open"). Standard seeding order (1v16, 8v9,
// ...) so the bracket shape is realistic.
const SEED_ORDER_16 = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
const NEXT_SLAM = require('./lib/slamCalendar');

function buildProjection(tour) {
  const ctx = loadTour(tour);
  const next = NEXT_SLAM.nextSlam(new Date());
  if (!next) return null;
  const rows = [...ctx.statsBySurface[next.surface].values()]
    .map((r) => ({ id: r.id, name: r.name, rank: Number(r.us_seed) || 999 }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 16);
  if (rows.length < 16) return null;
  const field = SEED_ORDER_16.map((seed) => ({ ...rows[seed - 1], rostered: true }));
  const { odds, survival } = simulateTitles(ctx, field, next.surface);
  return {
    event: next.label, tour, surface: next.surface, status: 'projection',
    startsAt: next.startsAt,
    updatedAt: new Date().toISOString(),
    fieldSize: 16,
    odds: odds.map((o) => ({ ...o, prob: Math.round(o.prob * 1000) / 1000 })),
    draw: {
      field: field.map((p) => ({ id: p.id, name: p.name, rank: p.rank })),
      survival,
    },
  };
}

async function run() {
  const outPath = path.join(__dirname, '..', 'public', 'data', 'title_odds.json');
  // A corrupt prior artifact must not kill the run - start fresh instead.
  let prev = { events: {} };
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* first run or corrupt file */ }
  const out = { generatedAt: new Date().toISOString(), events: { ...prev.events } };
  const today = new Date().toISOString().slice(0, 10);

  for (const tour of ['atp', 'wta']) {
    let result = await buildTour(tour);
    if (!result) {
      // Off-season: project the next slam from current rankings instead of
      // going dark ("road to the US Open").
      result = buildProjection(tour);
      if (!result) { console.log(`${tour}: no live slam and no projection possible; keeping previous odds.`); continue; }
      console.log(`${tour}: off-season - projecting ${result.event} from current rankings.`);
    }

    // History: carry it across runs of the SAME event; a new slam starts
    // fresh. A projection that becomes the real tournament keeps its
    // history: that IS the road-to-the-slam tracker.
    const prevEntry = prev.events?.[tour];
    const history = (prevEntry && prevEntry.event === result.event) ? [...(prevEntry.history || [])] : [];

    // A decided slam has no remaining draw to simulate; keep the last live
    // bracket snapshot so the draw page can still show how it ended.
    if (!result.draw && prevEntry && prevEntry.event === result.event && prevEntry.draw) {
      result.draw = prevEntry.draw;
    }
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

run().catch((e) => { console.error(e); process.exit(1); });
