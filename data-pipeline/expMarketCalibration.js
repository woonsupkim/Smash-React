// data-pipeline/expMarketCalibration.js
//
// Is the bookmakers' price systematically wrong, and by how much? Measured
// across every season in the raw cache, on odds and results alone.
//
// WHY THIS AND NOT THE FULL MODEL. The market-anchored fit has three
// coefficients: a and b describe the MARKET's own miscalibration, c describes
// whether our signal adds anything on top. a and b need no model, no surface
// map and no player stats - just a price and a result. So they can be measured
// on the entire raw history rather than the 1,652 priced matches of 2026, and
// they are the part with a real chance of clearing the noise floor.
//
// The 2026-only fit put b at 1.22, meaning prices are too timid and favourites
// win more than they are priced to. That is the favourite-longshot bias, one
// of the most replicated findings in betting markets. But on one season the
// implied edge (~1.2% on heavy favourites) sits far inside a +-4 point error
// bar, so it could not be distinguished from luck. Five seasons of tour tennis
// is roughly ten times the sample, which is what it takes.
//
// TWO GUARDS AGAINST FOOLING OURSELVES:
//
//   1. Fixtures are deduplicated by pair+day. Every match sits in both
//      players' files, so counting raw rows would double everything and halve
//      every error bar - the sample would look twice as good as it is.
//   2. Rows are orientation-symmetrised on a hash of the fixture. The stored
//      side ordering is not random in this data, and a fit on an unbalanced
//      target learns the ordering rather than the tennis. That trap already
//      produced a fraudulent 100% here once.
//
// Usage: node data-pipeline/expMarketCalibration.js
const fs = require('fs');
const path = require('path');

const RAW = [
  { tour: 'atp', dir: path.join(__dirname, 'raw') },
  { tour: 'wta', dir: path.join(__dirname, 'raw', 'women') },
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function collect() {
  const byKey = new Map();
  for (const { tour, dir } of RAW) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('player-id') || f.startsWith('api-') || f.startsWith('tournament')) continue;
      let arr;
      try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      for (const m of arr) {
        const o1 = Number(m.odd1), o2 = Number(m.odd2);
        if (!(o1 > 1) || !(o2 > 1)) continue;
        if (!m.match_winner || !m.player1Id || !m.player2Id || !m.date) continue;
        const day = String(m.date).slice(0, 10);
        if (day < '2019-01-01') continue; // coverage below 50% before this
        // Dedupe by fixture, not by row: the same match lives in both files.
        const key = `${tour}|${[String(m.player1Id), String(m.player2Id)].sort().join('_')}@${day}`;
        if (byKey.has(key)) continue;
        const p1Won = String(m.match_winner) === String(m.player1Id);
        // Symmetrise on a hash of the fixture: deterministic, and carrying no
        // information about who won.
        const h = key.split('').reduce((acc, ch) => ((acc * 31 + ch.charCodeAt(0)) >>> 0), 7);
        const flip = (h & 1) === 1;
        byKey.set(key, {
          tour, day, year: day.slice(0, 4),
          od1: flip ? o2 : o1,
          od2: flip ? o1 : o2,
          y: (flip ? !p1Won : p1Won) ? 1 : 0,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Vig-free probability for side 1, and the market's overround.
function devig(r) {
  const q1 = 1 / r.od1, q2 = 1 / r.od2;
  return { m: q1 / (q1 + q2), over: q1 + q2 - 1 };
}

// logit(p) = a + b*logit(m). Two coefficients, so plain gradient descent is
// ample and keeps the dependency list where it is.
function fit(rows, { iters = 6000, lr = 0.1 } = {}) {
  let a = 0, b = 1;
  const n = rows.length;
  if (!n) return { a, b };
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0;
    for (const r of rows) {
      const p = sigmoid(a + b * r.lm);
      const e = p - r.y;
      ga += e; gb += e * r.lm;
    }
    a -= lr * (ga / n);
    b -= lr * (gb / n);
  }
  return { a, b };
}

// Standard error on b by bootstrap: the coefficient is the whole finding, so
// it needs an interval, not a point.
function bootstrapB(rows, draws = 200) {
  const out = [];
  for (let d = 0; d < draws; d++) {
    const s = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) s[i] = rows[(Math.random() * rows.length) | 0];
    out.push(fit(s, { iters: 1200, lr: 0.2 }).b);
  }
  out.sort((x, y) => x - y);
  return { lo: out[Math.floor(0.025 * draws)], hi: out[Math.floor(0.975 * draws)] };
}

function main() {
  const all = collect().map((r) => ({ ...r, ...devig(r), lm: 0 }));
  for (const r of all) r.lm = logit(r.m);
  console.log(`${all.length} unique priced fixtures, ${all[0].day} to ${all[all.length - 1].day}`);
  const avgOver = all.reduce((s, r) => s + r.over, 0) / all.length;
  console.log(`mean overround ${(100 * avgOver).toFixed(2)}%  (the hurdle any edge has to clear)\n`);

  const years = [...new Set(all.map((r) => r.year))].sort();
  console.log('Per season, does the market misprice? b>1 means favourites are underpriced.\n');
  console.log('  year      n      a        b      favourite hit rate vs implied');
  for (const y of years) {
    const g = all.filter((r) => r.year === y);
    if (g.length < 400) { console.log(`  ${y}  ${String(g.length).padStart(5)}   (thin)`); continue; }
    const w = fit(g);
    // Model-free check: how often does the shorter price win, against what it implied?
    const favImplied = g.reduce((s, r) => s + Math.max(r.m, 1 - r.m), 0) / g.length;
    const favWon = g.filter((r) => (r.m >= 0.5 ? r.y === 1 : r.y === 0)).length / g.length;
    console.log(`  ${y}  ${String(g.length).padStart(5)}   ${w.a.toFixed(3).padStart(6)}   ${w.b.toFixed(3)}      ${(100 * favWon).toFixed(1)}% vs ${(100 * favImplied).toFixed(1)}%  (${((favWon - favImplied) * 100 >= 0 ? '+' : '')}${((favWon - favImplied) * 100).toFixed(1)}pt)`);
  }

  const w = fit(all);
  const ci = bootstrapB(all);
  console.log(`\nPooled: a = ${w.a.toFixed(4)}, b = ${w.b.toFixed(4)}  95% CI on b [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]`);
  console.log(ci.lo > 1
    ? '  b is significantly above 1: the market really does underprice favourites.'
    : ci.hi < 1
      ? '  b is significantly below 1: the market overprices favourites.'
      : '  b is not distinguishable from 1: no measurable miscalibration.');

  // What is it worth after the vig, at the real overround?
  console.log('\nEdge after the actual overround, by vig-free price:');
  console.log('  vig-free   corrected   offered    edge');
  for (const m of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85]) {
    const p = sigmoid(w.a + w.b * logit(m));
    // Split the observed overround proportionally across the two sides.
    const offered = 1 / (m * (1 + avgOver));
    console.log(`   ${(100 * m).toFixed(0)}%       ${(100 * p).toFixed(1)}%      ${offered.toFixed(3)}    ${((p * offered - 1) * 100 >= 0 ? '+' : '')}${((p * offered - 1) * 100).toFixed(2)}%`);
  }

  // Walk-forward: fit on prior seasons, bet the next one.
  console.log('\nWalk-forward by season (fit on everything earlier, bet that season):');
  console.log('  season   bets     ROI       95% CI');
  for (let i = 1; i < years.length; i++) {
    const train = all.filter((r) => r.year < years[i]);
    const test = all.filter((r) => r.year === years[i]);
    if (train.length < 1000 || test.length < 400) continue;
    const wf = fit(train);
    const rets = [];
    for (const r of test) {
      const p = sigmoid(wf.a + wf.b * r.lm);
      const e1 = p * r.od1 - 1, e2 = (1 - p) * r.od2 - 1;
      if (e1 > 0 && e1 >= e2) rets.push(r.y === 1 ? r.od1 - 1 : -1);
      else if (e2 > 0) rets.push(r.y === 0 ? r.od2 - 1 : -1);
    }
    if (!rets.length) { console.log(`  ${years[i]}        0`); continue; }
    const n = rets.length, mean = rets.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, n - 1));
    const se = (100 * sd) / Math.sqrt(n), roi = 100 * mean;
    console.log(`  ${years[i]}   ${String(n).padStart(5)}   ${((roi >= 0 ? '+' : '') + roi.toFixed(1) + '%').padStart(7)}   [${(roi - 1.96 * se).toFixed(1)}%, ${(roi + 1.96 * se).toFixed(1)}%]${roi - 1.96 * se > 0 ? '  SIGNIFICANT' : ''}`);
  }
}

if (require.main === module) main();
module.exports = { collect, fit, devig };
