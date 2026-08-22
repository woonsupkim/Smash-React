// data-pipeline/expFeatures.js
//
// Feature-engineering experiment: does anything the engines DON'T already
// encode move the walk-forward needle on the deduped record?
//
// Motivation: the 2026 unified tennis benchmark (Analytics 5(3):22) finds
// tuned Elo at 65.9%, the best classical ML at 66.3%, and deep nets inside a
// 0.07pt band - and concludes the binding constraint is FEATURE RICHNESS,
// not the algorithm. Our shipped blend walks forward at ~66.7% on this
// record, i.e. at that frontier. So the only honest way past it is new
// information, and this script is the harness for auditioning it.
//
// Features tried (all computed leak-free, from matches strictly before the
// row being predicted, and expressed as p1-minus-p2 differences):
//   rest      days since each player's previous graded match (capped 30)
//   load14    matches played in the last 14 days
//   sets14    sets played in the last 14 days
//   pairSurf  prior meetings between the pair on this surface (win share,
//             shrunk toward 0.5 by sample)
// Blocked, not faked: retirement/walkover history (voided upstream of the
// graded record, so no marker survives to learn from) and handedness splits
// (no handedness field in any committed data file).
//
// Protocol, identical to the stacking experiment that preceded this:
//   - orientation SYMMETRIZED. track_record stores every row winner-first,
//     so any model fit on its raw labels "learns" 100% by predicting p1.
//     Each row is flipped deterministically by id hash; all probabilities
//     and features mirror with it.
//   - per tour x surface logistic stack of [logit(sim), logit(elo),
//     logit(rank)] plus the candidate features, cells under 150 rows fall
//     back to tour, then to all.
//   - walk-forward by month, Apr..Aug: train strictly before, score the
//     month. No decay (a 45/90/180-day half-life grid all lost to none).
//
// Verdict lives in the run output; this file exists so the next "can't we
// just add features" conversation starts from a reproducible number instead
// of a hunch.
//
// Usage: node data-pipeline/expFeatures.js
const path = require('path');

const rowsRaw = require(path.join(__dirname, '..', 'public', 'data', 'track_record.json')).matches
  .filter((m) => m.winner && typeof m.probP1 === 'number' && typeof m.eloProbP1 === 'number' && typeof m.rankProbP1 === 'number');

const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const lg = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const sig = (z) => 1 / (1 + Math.exp(-z));

// Chronological player history for the schedule features, built once over
// the UNFLIPPED rows (history is orientation-free: it is per player).
const sorted = [...rowsRaw].sort((a, b) => new Date(a.date) - new Date(b.date));
const setsOf = (score) => (String(score || '').match(/\d+-\d+/g) || []).length;
const histBy = new Map(); // playerId -> [{t, sets}]
for (const m of sorted) {
  for (const id of [m.p1, m.p2]) {
    if (!histBy.has(id)) histBy.set(id, []);
    histBy.get(id).push({ t: new Date(m.date).getTime(), sets: setsOf(m.score) });
  }
}
const sched = (id, t) => {
  const h = histBy.get(id) || [];
  let rest = 30, load = 0, sets = 0;
  for (const e of h) {
    if (e.t >= t) break;
    rest = Math.min(30, (t - e.t) / 864e5);
    if (t - e.t <= 14 * 864e5) { load++; sets += e.sets; }
  }
  return { rest, load, sets };
};
// Pair-surface record BEFORE t, shrunk toward 0.5 (k=2 pseudo-meetings).
const pairKey = (a, b, s) => [a, b].sort().join('_') + '@' + s;
const pairHist = new Map(); // key -> [{t, winner}]
for (const m of sorted) {
  const k = pairKey(m.p1, m.p2, m.surface);
  if (!pairHist.has(k)) pairHist.set(k, []);
  pairHist.get(k).push({ t: new Date(m.date).getTime(), winner: m.winner });
}
const pairSurf = (p1, p2, s, t) => {
  const h = (pairHist.get(pairKey(p1, p2, s)) || []).filter((e) => e.t < t);
  const w1 = h.filter((e) => e.winner === p1).length;
  return (w1 + 1) / (h.length + 2); // 0.5 with no history
};

const rows = rowsRaw.map((m) => {
  const flip = hash(m.id) % 2 === 1;
  const t = new Date(m.date).getTime();
  const [A, B] = flip ? [m.p2, m.p1] : [m.p1, m.p2];
  const f = (p) => (flip ? 1 - p : p);
  const sA = sched(A, t), sB = sched(B, t);
  return {
    tour: m.tour, surface: m.surface, date: m.date, t,
    sim: f(m.probP1), elo: f(m.eloProbP1), rank: f(m.rankProbP1),
    dRest: (sA.rest - sB.rest) / 10,
    dLoad: (sA.load - sB.load) / 3,
    dSets: (sA.sets - sB.sets) / 6,
    pairS: lg(pairSurf(A, B, m.surface, t)),
    y: flip ? 0 : 1,
  };
}).sort((a, b) => a.t - b.t);

function fitLogit(X, y, iters = 500, lr = 0.6) {
  const d = X[0].length; let b = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const e = sig(X[i].reduce((s, x, j) => s + x * b[j], 0)) - y[i];
      for (let j = 0; j < d; j++) g[j] += e * X[i][j];
    }
    for (let j = 0; j < d; j++) b[j] -= lr * g[j] / X.length;
  }
  return b;
}

const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];
const cellOf = (m) => m.tour + '_' + m.surface;
function run(name, feat) {
  let n = 0, c = 0, ll = 0;
  for (const mo of MONTHS) {
    const test = rows.filter((m) => String(m.date).slice(0, 7) === mo);
    const train = rows.filter((m) => String(m.date).slice(0, 7) < mo);
    if (!test.length || train.length < 300) continue;
    const byCell = {};
    for (const m of test) (byCell[cellOf(m)] = byCell[cellOf(m)] || []).push(m);
    for (const [cell, list] of Object.entries(byCell)) {
      let tr = train.filter((m) => cellOf(m) === cell);
      if (tr.length < 150) tr = train.filter((m) => m.tour === cell.split('_')[0]);
      if (tr.length < 150) tr = train;
      const beta = fitLogit(tr.map(feat), tr.map((m) => m.y));
      for (const m of list) {
        const p = sig(feat(m).reduce((s, x, j) => s + x * beta[j], 0));
        n++; if ((p >= 0.5) === (m.y === 1)) c++;
        ll -= m.y * Math.log(clamp(p)) + (1 - m.y) * Math.log(1 - clamp(p));
      }
    }
  }
  console.log(name.padEnd(34), 'acc', (100 * c / n).toFixed(1) + '%', 'LL', (ll / n).toFixed(4), `(n=${n})`);
}

// Baseline: the shipped blend's own stored probability on the same rows.
{
  let bn = 0, bc = 0, bll = 0;
  for (const m of rowsRaw) {
    const mo = String(m.date).slice(0, 7);
    if (!MONTHS.includes(mo)) continue;
    const flip = hash(m.id) % 2 === 1;
    const p = flip ? 1 - m.smashProbP1 : m.smashProbP1;
    const y = flip ? 0 : 1;
    bn++; if ((p >= 0.5) === (y === 1)) bc++;
    bll -= y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p));
  }
  console.log('shipped smash blend'.padEnd(34), 'acc', (100 * bc / bn).toFixed(1) + '%', 'LL', (bll / bn).toFixed(4), `(n=${bn})`);
}
run('stack: engines only', (m) => [1, lg(m.sim), lg(m.elo), lg(m.rank)]);
run('  + rest', (m) => [1, lg(m.sim), lg(m.elo), lg(m.rank), m.dRest]);
run('  + load14 + sets14', (m) => [1, lg(m.sim), lg(m.elo), lg(m.rank), m.dLoad, m.dSets]);
run('  + pair-surface H2H', (m) => [1, lg(m.sim), lg(m.elo), lg(m.rank), m.pairS]);
run('  + all four', (m) => [1, lg(m.sim), lg(m.elo), lg(m.rank), m.dRest, m.dLoad, m.dSets, m.pairS]);
run('features WITHOUT engines (control)', (m) => [1, m.dRest, m.dLoad, m.dSets, m.pairS]);
