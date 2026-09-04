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
const { applyCalib, blendP } = require('./lib/evalCore');
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
  // High-water mark of the RESULTS FEED: the newest completed match we can
  // see. This is what decides whether a missing result means "no result
  // exists" or merely "our data has not caught up" - see the void pass, which
  // must never retire a pick on the strength of data we never fetched.
  let feedLatest = null;
  for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith('.json') && !/surfaces|map|profiles/.test(f))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
    for (const m of (Array.isArray(j) ? j : (j.matches || j.data || []))) {
      if (m.result_type !== 'completed') continue;
      const p1 = apiToShort.get(String(m.player1Id)), p2 = apiToShort.get(String(m.player2Id));
      const w = apiToShort.get(String(m.match_winner));
      if (!p1 || !p2 || !w) continue;
      const t = new Date(m.date).getTime();
      if (!isNaN(t) && (feedLatest == null || t > feedLatest)) feedLatest = t;
      const key = [p1, p2].sort().join('_');
      if (!completed.has(key)) completed.set(key, []);
      completed.get(key).push({ date: m.date, winner: w, score: m.result || '' });
    }
  }

  // Pair-surface head-to-head from the committed graded record: the fourth
  // blend component, same definition buildTrackRecord uses ((wins+1)/(n+2),
  // prior meetings on this surface only). Locked calls only ever look
  // BACKWARD into the record, so this is leak-free by construction. Whether
  // it carries weight is the tuner's earn-your-slot decision, not ours.
  const pairSurf = new Map();
  try {
    const tr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'track_record.json'), 'utf8'));
    for (const m of (tr.matches || [])) {
      if (m.tour !== tour || !m.winner || !m.surface) continue;
      const first = [m.p1, m.p2].sort()[0];
      const k = [m.p1, m.p2].sort().join('_') + '@' + m.surface;
      const h = pairSurf.get(k) || { n: 0, wFirst: 0 };
      h.n++; if (m.winner === first) h.wFirst++;
      pairSurf.set(k, h);
    }
  } catch { /* no record yet - every pairing reads as no history (0.5) */ }

  return { tour, dir, roster, statsBySurface, upsetBySurface, elo, completed, feedLatest, pairSurf, bestOf: tour === 'wta' ? 3 : 5 };
}

const probsFromRow = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);

const VOID_AFTER_DAYS = 6; // beyond the 5-day grading window in run()

/**
 * What to do with a still-pending pick whose match date has passed:
 *   'wait' - still inside the grading window, nothing to decide yet
 *   'hold' - past the window, but the RESULTS FEED has not reached this match,
 *            so a missing result is evidence of nothing. Stay pending.
 *   'void' - past the window AND the feed has moved on without a result, so
 *            the match really did not produce one (walkover, withdrawal, a
 *            name the feed spells differently).
 *
 * Extracted and exported purely so this is testable: the failure mode is
 * silent data loss - a stalled feed retiring real calls as orphans - which no
 * crash or failing build would ever surface.
 *
 * @param {number} predDateMs   scheduled match date
 * @param {number|null} feedLatestMs newest completed result in the cache
 * @param {number} nowMs
 */
function voidVerdict(predDateMs, feedLatestMs, nowMs, voidAfterDays = VOID_AFTER_DAYS) {
  const window = voidAfterDays * 864e5;
  if (!(nowMs - predDateMs > window)) return 'wait';
  if (feedLatestMs == null) return 'hold';
  return feedLatestMs - predDateMs > window ? 'void' : 'hold';
}

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
  const first = [a.id, b.id].sort()[0];
  const hRec = ctx.pairSurf.get([a.id, b.id].sort().join('_') + '@' + surface);
  const pFirst = hRec ? (hRec.wFirst + 1) / (hRec.n + 2) : 0.5;
  const h2hP = a.id === first ? pFirst : 1 - pFirst;
  const smashP = applyCalib(blendP(w, { probP1: simP, eloProbP1: eloP, rankProbP1: rankP, h2hProbP1: h2hP }), calibA);

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

  // Collapse pre-existing duplicates of the SAME match.
  //
  // Identity is tour + player pair + event + year, NOT the scheduled day: in
  // singles a pair meets at most once per event per year, while ESPN slides
  // the scheduled date as a tournament's order of play firms up. Keying on
  // the day re-locked the same match every time it moved (Shapovalov vs
  // Svajda was locked three times, and 28 already-graded matches were
  // double or triple counted in the public record - a real inflation of the
  // forward-test denominator, not a cosmetic glitch).
  //
  // The survivor is the EARLIEST lock: that is the honest "we called it
  // before play" timestamp, and it carries the first lock-odds snapshot.
  // Its date is advanced to the latest schedule so the board stays right.
  const matchKey = (p) => `${p.tour}|${[p.p1, p.p2].sort().join('_')}|${p.event || '?'}|${new Date(p.date).getUTCFullYear()}`;
  const lockTime = (p) => new Date(p.lockedAt || p.date).getTime();
  const dedup = new Map();
  let collapsed = 0;
  for (const p of store.predictions) {
    const k = matchKey(p);
    const prev = dedup.get(k);
    if (!prev) { dedup.set(k, p); continue; }
    collapsed++;
    // Prefer a graded row over a pending one; otherwise the earliest lock.
    const keep = (prev.status !== 'pending' && p.status === 'pending') ? prev
      : (prev.status === 'pending' && p.status !== 'pending') ? p
      : (lockTime(p) < lockTime(prev) ? p : prev);
    const drop = keep === prev ? p : prev;
    // Carry forward whatever the dropped twin knew that the survivor doesn't:
    // the most recent schedule, and any lock-odds captured on the other row.
    if (new Date(drop.date) > new Date(keep.date) && keep.status === 'pending') keep.date = drop.date;
    if (!keep.lockOdd1 && drop.lockOdd1) {
      keep.lockOdd1 = drop.lockOdd1; keep.lockOdd2 = drop.lockOdd2;
      keep.lockOddsAt = drop.lockOddsAt; keep.tCountry = keep.tCountry || drop.tCountry;
    }
    dedup.set(k, keep);
  }
  store.predictions = [...dedup.values()];
  if (collapsed) console.log(`Collapsed ${collapsed} duplicate row(s) of matches already in the ledger.`);

  const ctxByTour = { atp: loadTour('atp'), wta: loadTour('wta') };

  // ── 1. Grade pending predictions ────────────────────────────────────────
  // 'void' rows are reconsidered too. A pick is only ever voided because no
  // result could be found, and that can be wrong for reasons that later fix
  // themselves (a throttled feed, a late-arriving result, a name the feed
  // spelled differently at first). If a result exists NOW, the honest thing
  // is to grade it - the pick itself was still locked before play, so
  // recovering it cannot leak. Without this, any gap in the results feed
  // permanently deletes real calls from the forward record.
  let graded = 0;
  let recovered = 0;
  for (const p of store.predictions) {
    if (p.status !== 'pending' && p.status !== 'void') continue;
    const wasVoid = p.status === 'void';
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
      if (wasVoid) recovered++;
    }
  }
  if (recovered) console.log(`  recovered ${recovered} previously-void prediction(s) whose result has now arrived`);

  // ── 1a. Void orphan pending predictions ─────────────────────────────────
  // A pick whose match never produced a fetchable result - walkover,
  // withdrawal, reschedule, or a name/id the results feed spells differently -
  // would otherwise sit 'pending' forever: lingering on Today with no line on
  // FanDuel, and never counting toward the graded record either way. Once it
  // is past the grading window above with still no result, retire it as
  // 'void' - not a win, not a loss, just closed. Consumers exclude 'void'.
  //
  // The clock that matters is the RESULTS FEED's, not the wall's. Absence of a
  // result only means "no result exists" if our data actually covers the
  // period; if the feed has stalled, absence means nothing at all. Voiding on
  // wall-clock time made an outage indistinguishable from a walkover: when the
  // RapidAPI monthly quota tripped its reserve floor on 2026-08-14 the results
  // feed froze, and the 123 picks played since would have been retired as
  // orphans on a rolling basis - 21 of them the next day, all 123 inside a
  // week - erasing real calls from the forward record for want of data we
  // simply never fetched. Now a pick is only voided once the feed has itself
  // moved VOID_AFTER_DAYS past the match, so a stall holds picks pending (and
  // the grading pass above recovers them when data returns).
  let voided = 0;
  let held = 0;
  for (const p of store.predictions) {
    if (p.status !== 'pending') continue;
    const verdict = voidVerdict(new Date(p.date).getTime(), ctxByTour[p.tour]?.feedLatest, Date.now());
    if (verdict === 'void') { p.status = 'void'; voided++; }
    else if (verdict === 'hold') held++;
  }
  if (voided) console.log(`  voided ${voided} orphan pending prediction(s) past the grading window`);
  if (held) {
    console.warn(
      `  ! HOLDING ${held} pending prediction(s): their matches are past but the results feed has not caught up ` +
      `(newest result: ${Object.entries(ctxByTour).map(([t, c]) => `${t} ${c.feedLatest ? new Date(c.feedLatest).toISOString().slice(0, 10) : 'none'}`).join(', ')}). ` +
      'They stay pending rather than being retired as orphans, and will grade once the feed recovers.'
    );
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
  // Keyed on matchup identity (tour + pair + event + year), NOT the ESPN
  // competition id (reassigned between runs) and NOT the scheduled day
  // (ESPN slides it as the order of play firms up). A match already in the
  // ledger is never re-locked; if its schedule moved, the existing row's
  // date is updated in place so the pick keeps its original lock time.
  const seedKey = (tour, p1, p2, event, date) =>
    `${tour}|${[p1, p2].sort().join('_')}|${event || '?'}|${new Date(date).getUTCFullYear()}`;
  const seen = new Map(store.predictions.map((p) => [matchKey(p), p]));

  let added = 0;
  let rescheduled = 0;
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
        const key = seedKey(league, a.id, b.id, ev.label, g.date);
        const already = seen.get(key);
        if (already) {
          // Same match, new time slot: move the existing lock, never add one.
          if (already.status === 'pending' && already.date !== g.date) {
            already.date = g.date;
            already.id = g.id;
            rescheduled++;
          }
          continue;
        }
        const bestOf = ev.bestOf[league] || ctx.bestOf;
        const pred = predict(ctx, a, b, ev.surface, bestOf);
        if (pred == null) continue;
        const { probA, engine } = pred;
        const favorite = probA >= 0.5 ? a.id : b.id;
        const favProb = probA >= 0.5 ? probA : 1 - probA;
        const row = {
          id: g.id, tour: league, surface: ev.surface, event: ev.label, date: g.date,
          tier: ev.tier, bestOf,
          p1: a.id, p2: b.id, name1: a.name, name2: b.name,
          probP1: Math.round(probA * 1000) / 1000,
          favorite, favName: favorite === a.id ? a.name : b.name,
          favProb: Math.round(favProb * 1000) / 1000,
          engine,
          status: 'pending', lockedAt: new Date().toISOString(),
          // Below the call threshold we LEAN, we do not call: the row locks and
          // grades like any other (the audit trail is the point, and the parlay
          // builder still prices it), but every headline surface excludes it and
          // every call surface shows it as restraint. engineConfig.callThreshold.
          ...(favProb < (ENGINE.callThreshold || 0) ? { noCall: true } : {}),
        };
        store.predictions.push(row);
        seen.set(key, row);
        added++;
      }
    }
  }

  // ── 2b. Capture lock-time market odds (Phase 1 of the Market engine) ────
  // The upcoming-matches endpoint serves live pre-match bookmaker odds on
  // the current plan (~2-3 requests per tour per run). The FIRST time odds
  // appear for a still-pending, not-yet-started prediction they are stamped
  // on the row and never overwritten: that snapshot is "what the market
  // said when WE locked", the honest basis for the future deploy-or-not
  // comparison (closing odds flatter the market; lock-time odds are the
  // fair fight). Failures skip silently - odds are evidence, not a blocker.
  const API_KEY = process.env.RAPIDAPI_KEY;
  let stamped = 0;
  if (API_KEY) {
    const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
    // One page, sized to cover a full slam day on both tours with room
    // to spare. Verified against the live endpoint: limit=200 returns 200.
    const ODDS_LIMIT = 200;
    const pairKey = (a, b) => [normName(a), normName(b)].sort().join('|');
    for (const league of ['atp', 'wta']) {
      const wanted = new Map(); // name-pair key -> pending row still needing odds
      for (const p of store.predictions) {
        if (p.tour === league && p.status === 'pending' && !p.lockOdd1 && new Date(p.date) > new Date()) {
          wanted.set(pairKey(p.name1, p.name2), p);
        }
      }
      if (!wanted.size) continue;
      try {
        const budget = require('./lib/apiBudget');
        // ONE request per tour, no pagination. The provider used to accept
        // `page`, and now rejects it outright:
        //   400 {"message":"property pageNumber should not exist"}
        // Every call carried &page=N, so every call 400d, and the `break`
        // below discarded the response without a word - the whole card went
        // unpriced for two days with a green pipeline and an untouched quota.
        // A single larger limit returns what three pages used to.
        for (let attempt = 0; attempt < 1 && wanted.size; attempt++) {
          budget.guard();
          const url = `https://${HOST}/tennis/v2/ms-api/upcoming/matches/${league}?limit=${ODDS_LIMIT}`;
          const res = await fetch(url, {
            headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
          });
          budget.note(res);
          if (!res.ok) {
            // Loud. Odds are evidence rather than a blocker, so this must not
            // throw - but a silent break is how a contract change hides.
            console.warn(
              `  ! odds capture (${league}) got HTTP ${res.status} from the provider,`
              + ` so ${wanted.size} match(es) go unpriced.`
              + ` ${(await res.text().catch(() => '')).slice(0, 200)}`
            );
            break;
          }
          const list = (await res.json()).matches || [];
          for (const m of list) {
            const key = pairKey(m.player1?.name || '', m.player2?.name || '');
            const row = wanted.get(key);
            if (!row) continue;
            const o1 = Number(m.player1?.odd) || Number(m.odds?.k1) || null;
            const o2 = Number(m.player2?.odd) || Number(m.odds?.k2) || null;
            if (!(o1 > 1) || !(o2 > 1)) continue;
            const p1IsFirst = normName(row.name1) === normName(m.player1?.name || '');
            row.lockOdd1 = p1IsFirst ? o1 : o2;
            row.lockOdd2 = p1IsFirst ? o2 : o1;
            row.lockOddsAt = new Date().toISOString();
            if (m.tournament?.country) row.tCountry = m.tournament.country;
            wanted.delete(key);
            stamped++;
          }
        }
      } catch (err) {
        console.warn(`  odds capture (${league}) failed: ${err.message}`);
      }
    }
  }

  store.generatedAt = new Date().toISOString();
  store.predictions.sort((a, b) => new Date(b.date) - new Date(a.date));
  fs.writeFileSync(outPath, JSON.stringify(store));

  const pending = store.predictions.filter((p) => p.status === 'pending').length;
  const decided = store.predictions.filter((p) => p.status === 'won' || p.status === 'lost');
  const voids = store.predictions.filter((p) => p.status === 'void').length;
  const wins = decided.filter((p) => p.correct).length;
  console.log(`Graded ${graded}, refreshed ${refreshed}, added ${added}, rescheduled ${rescheduled}, lock-odds stamped ${stamped}. Now ${pending} pending, ${decided.length} graded (${wins} correct), ${voids} void.`);
  if (fetchFailures) console.warn(`  ! ${fetchFailures} schedule fetch(es) failed after retries - some upcoming matches may be missing this run.`);
}

// Guarded so the void/grade helpers above can be required by tests without
// firing a full pipeline run (which fetches schedules and rewrites the ledger).
if (require.main === module) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { voidVerdict, VOID_AFTER_DAYS };
