// data-pipeline/expReturns.js
//
// The money-framing experiment: if the model will not out-predict the
// bookmakers on frequency (the 2026 benchmark literature says nothing does
// from public pre-match features), what does optimizing for RETURN change?
//
// Two questions, each answered walk-forward with no hindsight:
//
//  1. STAKING POLICY - given the shipped model's probabilities, which betting
//     rule made money out of fold? Flat on everything, flat on +EV only, flat
//     above an edge threshold theta (grid), and fractional Kelly. Settled at
//     the odds on the graded record. This is where "the money edge" actually
//     lives or dies.
//
//  2. RECOMMENDATION OBJECTIVE - the Risk Lab's menu keeps a domination
//     filter (never offer a plan another beats on both chance and expected
//     profit), then must pick ONE to lead with. Chance-first is what ships
//     today; EV-first is the return framing. Both are backfilled with
//     planSettle over every settleable ledger day: same plans, same odds,
//     only the choice rule differs.
//
// Orientation note: track rows are winner-first (p1 = winner). That leaks
// nothing here because no model is being FIT - policies consume the stored
// pre-match probability and the stored odds, and both were written before
// the result. Settlement uses the deployed pick's side and price.
//
// Usage: node data-pipeline/expReturns.js
const path = require('path');
const planSettle = require(path.join(__dirname, 'lib', 'planSettle'));

const track = require(path.join(__dirname, '..', 'public', 'data', 'track_record.json')).matches
  .filter((m) => m.winner && m.od1 > 1 && m.od2 > 1);
const preds = require(path.join(__dirname, '..', 'public', 'data', 'predictions.json')).predictions;

const pickFav = (m) => m.pickFavorite || m.smashFavorite;
const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
const pickProb = (m) => { const r = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1; return Math.max(r, 1 - r); };
const pickOdds = (m) => (pickFav(m) === m.p1 ? m.od1 : m.od2);

const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const inWindow = (m) => MONTHS.includes(String(m.date).slice(0, 7));
const rows = track.filter(inWindow).map((m) => ({
  p: pickProb(m), o: pickOdds(m), won: !!pickCorrect(m), mo: String(m.date).slice(0, 7),
}));

console.log(`Policy backtest window Apr-Aug: ${rows.length} priced graded calls, settled at recorded odds.\n`);
console.log('policy                          bets   staked   P&L      ROI     months up');
function runPolicy(name, stakeFn) {
  let staked = 0, pl = 0, bets = 0;
  const byMo = new Map();
  for (const r of rows) {
    const s = stakeFn(r);
    if (!(s > 0)) continue;
    bets++; staked += s;
    const d = r.won ? s * (r.o - 1) : -s;
    pl += d;
    byMo.set(r.mo, (byMo.get(r.mo) || 0) + d);
  }
  const up = [...byMo.values()].filter((v) => v > 0).length;
  console.log(name.padEnd(30), String(bets).padStart(5), ('$' + staked.toFixed(0)).padStart(8),
    ((pl >= 0 ? '+$' : '-$') + Math.abs(pl).toFixed(0)).padStart(8),
    ((100 * pl / Math.max(1, staked)).toFixed(1) + '%').padStart(8),
    `  ${up}/${byMo.size}`);
  return { pl, staked, bets };
}
runPolicy('flat $1, every priced call', () => 1);
runPolicy('flat $1, +EV only (p*o>1)', (r) => (r.p * r.o > 1 ? 1 : 0));
for (const th of [0.05, 0.10, 0.15, 0.20]) {
  runPolicy(`flat $1, edge > ${(th * 100).toFixed(0)}%`, (r) => (r.p * r.o - 1 > th ? 1 : 0));
}
for (const c of [0.25, 0.5]) {
  runPolicy(`${c}x Kelly of $10 bank/bet`, (r) => {
    const f = (r.p * r.o - 1) / (r.o - 1);
    return f > 0 ? 10 * c * f : 0;
  });
}

// ── 2. Recommendation objective, over the real ledger days ────────────────
(async () => {
  await planSettle.ready();
  const led = preds.filter((m) => m.status === 'won' || m.status === 'lost');
  const days = [...new Set(led.map((m) => String(m.date).slice(0, 10)))].sort();
  const tot = { chance: 0, ev: 0, days: 0 };
  const picksDiffer = [];
  for (const d of days) {
    const s = planSettle.planReturns(preds, d);
    if (!s) continue;
    tot.days++;
    // planReturns marks recommendedId with the shipped rule (chance-first
    // among non-dominated). EV-first re-picks from the same settled plans.
    const settledById = new Map(s.plans.map((p) => [p.id, p]));
    const chancePick = settledById.get(s.recommendedId) || s.plans[0];
    // Rebuild the frontier's metrics to re-choose by EV among non-dominated:
    // settle results carry realized profit; the CHOICE must use the morning's
    // expectations, which planReturns does not export. So re-run the frontier.
    const bets = planSettle.lockedBets(preds, d);
    const history = planSettle.ledgerGraded(preds).filter((m) => String(m.date).slice(0, 10) < d);
    const staking = await planSettle.ready();
    const rel = staking.reliability(history);
    const f = staking.planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), planSettle.PLAN_BUDGET, { lambda: rel.lambda });
    const val = (p) => ({ w: p.metrics?.pProfit ?? -1, e: p.metrics?.ev ?? -Infinity });
    const dominated = (p) => f.plans.some((q) => {
      if (q === p) return false;
      const a = val(p), b = val(q);
      return b.w >= a.w && b.e >= a.e && (b.w > a.w + 1e-9 || b.e > a.e + 1e-9);
    });
    const live = f.plans.filter((p) => !dominated(p));
    const evPickPlan = (live.length ? live : f.plans).reduce((a, b) => (val(b).e > val(a).e ? b : a));
    const evPick = settledById.get(evPickPlan.id) || chancePick;
    tot.chance += chancePick.profit;
    tot.ev += evPick.profit;
    if (evPick.id !== chancePick.id) picksDiffer.push({ d, chance: chancePick, ev: evPick });
  }
  console.log(`\nRecommendation objective, backfilled over ${tot.days} ledger days ($100/day):`);
  console.log(`  chance-first (ships today): ${(tot.chance >= 0 ? '+$' : '-$')}${Math.abs(tot.chance).toFixed(0)}`);
  console.log(`  EV-first (return framing) : ${(tot.ev >= 0 ? '+$' : '-$')}${Math.abs(tot.ev).toFixed(0)}`);
  console.log(`  days where the two rules pick different plans: ${picksDiffer.length}`);
  for (const x of picksDiffer.slice(0, 6)) {
    console.log(`    ${x.d}: chance took ${x.chance.label} (${x.chance.profit >= 0 ? '+' : ''}${x.chance.profit.toFixed(0)}), EV took ${x.ev.label} (${x.ev.profit >= 0 ? '+' : ''}${x.ev.profit.toFixed(0)})`);
  }
})();

// ── 3. Where the +EV money lives, and the price-timing caveat ──────────────
// Run after the async section resolves so output stays ordered.
setTimeout(() => {
  const SLAM = /australian open|french open|roland|wimbledon|us open/i;
  const M1000 = /national bank|miami open|internazionali bnl|mutua madrid|bnp paribas|cincinnati|monte-carlo|rolex shanghai|paris masters/i;
  const cls = (e) => (SLAM.test(e || '') ? 'slam' : M1000.test(e || '') ? 'm1000' : 'tail');
  const winRows = track.filter(inWindow);
  console.log('\n+EV flat $1 by event class (same window):');
  for (const c of ['slam', 'm1000', 'tail']) {
    const g = winRows.filter((m) => cls(m.event) === c)
      .map((m) => ({ p: pickProb(m), o: pickOdds(m), won: !!pickCorrect(m) }))
      .filter((r) => r.p * r.o > 1);
    let pl = 0; for (const r of g) pl += r.won ? r.o - 1 : -1;
    console.log(`  ${c.padEnd(6)} n=${String(g.length).padStart(3)}  ROI ${(100 * pl / Math.max(1, g.length)).toFixed(1)}%`);
  }
  console.log('\nPrice-timing caveat, verified 2026-08-22: the feed carries ONE odds');
  console.log('snapshot per match - every ledger lock price is byte-identical to the');
  console.log('graded record\'s od1/od2. There is no closing line in this data, so');
  console.log('closing-line value is UNMEASURABLE until a second, later snapshot is');
  console.log('captured per match (a small pre-start odds poll would do it), and');
  console.log('none of the ROI above can be attributed to beating the line early.');
}, 4000);

// ── 4. Closing-line value, once the snapshot log has data ──────────────────
setTimeout(() => {
  const fs = require('fs');
  const snapPath = path.join(__dirname, 'output', 'odds_snapshots.json');
  console.log('\nClosing-line value (fetchOddsSnapshots.js log):');
  if (!fs.existsSync(snapPath)) { console.log('  no snapshot log yet - run the fetcher a few tournament days first.'); return; }
  const store = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const key = (a, b, d) => [String(a), String(b)].sort().join('_') + '@' + String(d).slice(0, 10);
  const byKey = new Map(Object.entries(store));
  const graded = preds.filter((m) => (m.status === 'won' || m.status === 'lost') && m.lockOdd1 > 1);
  const strip = (o1, o2, isP1) => { const q1 = 1 / o1, q2 = 1 / o2; const p1 = q1 / (q1 + q2); return isP1 ? p1 : 1 - p1; };
  const clvs = [];
  let moved = 0, tracked = 0;
  for (const m of graded) {
    const rec = byKey.get(key(m.p1, m.p2, m.date));
    if (!rec || !rec.snaps.length) continue;
    tracked++;
    const last = rec.snaps[rec.snaps.length - 1];
    if (Math.abs(last.o1 - rec.lock.o1) > 1e-9 || Math.abs(last.o2 - rec.lock.o2) > 1e-9) moved++;
    clvs.push(strip(last.o1, last.o2, m.favorite === m.p1) - strip(rec.lock.o1, rec.lock.o2, m.favorite === m.p1));
  }
  if (clvs.length < 10) { console.log(`  only ${clvs.length} graded call(s) have snapshots - not enough to read yet (${moved} moved).`); return; }
  const mean = clvs.reduce((s, v) => s + v, 0) / clvs.length;
  const se = Math.sqrt(clvs.reduce((s, v) => s + (v - mean) ** 2, 0) / (clvs.length - 1) / clvs.length);
  console.log(`  n=${clvs.length} graded with snapshots | line ever moved on ${moved} (${(100 * moved / tracked).toFixed(0)}%)`);
  console.log(`  mean CLV ${(100 * mean).toFixed(2)}pts | t vs zero ${(mean / se).toFixed(2)} | positive on ${(100 * clvs.filter((v) => v > 0).length / clvs.length).toFixed(0)}%`);
  console.log('  (CLV > 0 = the market moved toward our pick after we locked. If the moved-share');
  console.log('   stays ~0, this provider has static odds and CLV needs a second source.)');
}, 6000);
