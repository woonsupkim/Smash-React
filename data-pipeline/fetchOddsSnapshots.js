// data-pipeline/fetchOddsSnapshots.js
//
// Odds snapshots for closing-line value.
//
// The ledger locks each call's odds at first sighting and never overwrites -
// the honest "price we could actually get". But the graded record carries
// only that same single number, so closing-line value (did the market move
// TOWARD our pick after we locked?) has been unmeasurable: verified on
// 2026-08-22, every lock price was byte-identical to the graded price.
//
// This fetcher closes that gap by polling the same upcoming-matches endpoint
// the lock pass uses and appending a snapshot whenever a still-pending,
// already-locked match's odds have MOVED since the last one we kept. Each
// tracked match ends up with its lock price plus a short movement history;
// the last snapshot before play is the best available stand-in for a close.
//
// It is also, deliberately, an instrument for a cheaper discovery: if this
// provider's odds never move at all, the log will show a movement share of
// zero and we will know CLV needs a second odds SOURCE, not more polling -
// before anyone builds a strategy on top of it.
//
// Budget: ~3 pages x 2 tours = ~6 requests per run, guarded by lib/apiBudget
// like every other fetcher. Failures skip silently; snapshots are evidence,
// not a blocker.
//
// Usage: node data-pipeline/fetchOddsSnapshots.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { normName } = require('./lib/espnParse');

const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const API_KEY = process.env.RAPIDAPI_KEY;
const PREDS = path.join(__dirname, '..', 'public', 'data', 'predictions.json');
const OUT = path.join(__dirname, 'output', 'odds_snapshots.json');
const MAX_SNAPS = 24; // per match; a day of hourly polls would still fit

const identity = (a, b, d) => [String(a), String(b)].sort().join('_') + '@' + String(d).slice(0, 10);
const pairKey = (a, b) => [normName(a), normName(b)].sort().join('|');

async function main() {
  if (!API_KEY) { console.log('odds snapshots: no RAPIDAPI_KEY, skipping.'); return; }
  const preds = JSON.parse(fs.readFileSync(PREDS, 'utf8')).predictions || [];
  // Locked, still-pending calls are the tracking set: once a match grades,
  // its history is frozen and the CLV report can read it.
  const tracked = new Map();
  for (const p of preds) {
    if (p.status !== 'pending' || !(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) continue;
    tracked.set(pairKey(p.name1, p.name2), p);
  }
  if (!tracked.size) { console.log('odds snapshots: nothing locked and pending to track.'); return; }

  let store = {};
  try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }

  const budget = require('./lib/apiBudget');
  let seen = 0, appended = 0;
  for (const league of ['atp', 'wta']) {
    try {
      for (let page = 1; page <= 3; page++) {
        budget.guard();
        const res = await fetch(`https://${HOST}/tennis/v2/ms-api/upcoming/matches/${league}?limit=50&page=${page}`, {
          headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': API_KEY },
        });
        budget.note(res);
        if (!res.ok) break;
        const list = (await res.json()).matches || [];
        for (const m of list) {
          const row = tracked.get(pairKey(m.player1?.name || '', m.player2?.name || ''));
          if (!row) continue;
          const o1raw = Number(m.player1?.odd) || Number(m.odds?.k1) || null;
          const o2raw = Number(m.player2?.odd) || Number(m.odds?.k2) || null;
          if (!(o1raw > 1) || !(o2raw > 1)) continue;
          // Store in the LEDGER ROW's orientation (name1/name2), same as the
          // lock pass, so lock and snaps always compare side to side.
          const p1IsFirst = normName(row.name1) === normName(m.player1?.name || '');
          const o1 = p1IsFirst ? o1raw : o2raw;
          const o2 = p1IsFirst ? o2raw : o1raw;
          const key = identity(row.p1, row.p2, row.date);
          const rec = store[key] || {
            tour: row.tour,
            name1: row.name1,
            name2: row.name2,
            date: row.date,
            lock: { o1: row.lockOdd1, o2: row.lockOdd2, at: row.lockOddsAt || null },
            snaps: [],
          };
          seen++;
          const last = rec.snaps[rec.snaps.length - 1] || rec.lock;
          if (Math.abs(o1 - last.o1) > 1e-9 || Math.abs(o2 - last.o2) > 1e-9 || rec.snaps.length === 0) {
            rec.snaps.push({ o1, o2, at: new Date().toISOString() });
            if (rec.snaps.length > MAX_SNAPS) rec.snaps.splice(1, rec.snaps.length - MAX_SNAPS);
            appended++;
          }
          store[key] = rec;
        }
        if (list.length < 50) break;
      }
    } catch (err) {
      console.warn(`odds snapshots (${league}) failed: ${err.message}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(store, null, 1) + '\n');
  const withMove = Object.values(store).filter((r) => r.snaps.some((s) => Math.abs(s.o1 - r.lock.o1) > 1e-9 || Math.abs(s.o2 - r.lock.o2) > 1e-9)).length;
  console.log(`odds snapshots: matched ${seen} tracked match(es), appended ${appended} snapshot(s); `
    + `${Object.keys(store).length} in store, ${withMove} have EVER moved off their lock price.`);
}

if (require.main === module) main();
module.exports = { main, identity };
