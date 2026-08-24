// data-pipeline/expMarketAnchored.js
//
// MARKET-ANCHORED MODEL. Start from the bookmakers' price and predict where it
// is wrong, instead of trying to out-forecast it from scratch.
//
// WHY. On clean walk-forward data the from-scratch model gets 64.8% where the
// market's favourite gets 70.9%, and where we disagree with them we win about
// a third of the time. Filtering to confident calls closes the accuracy gap,
// but only because we converge on picking the same player they do - at a 0.75
// cutoff both sides post an identical ROI, because both sides are the same
// bet. There is no independent edge to harvest, so the value has to come from
// knowing WHEN their number is off, not from having a better number.
//
// THE MODEL. Everything in logit space, where "the market plus an adjustment"
// is addition:
//
//   logit(p) = a + b*logit(m) + c*(logit(o) - logit(m))
//
//   m = the market's vig-free probability for player 1
//   o = our own model's probability for player 1
//   a, b = the market's own miscalibration. b < 1 means its prices are too
//          extreme and should be shrunk toward the middle; b > 1 the reverse.
//          This alone captures the favourite-longshot bias, which is the one
//          effect in this data that is real, documented and not ours.
//   c = how much our disagreement with the market is worth. c = 0 says we add
//       nothing to the price. c < 0 says our disagreements are actively
//       anti-predictive, which the from-scratch results suggest is possible.
//
// The point of writing it this way is that the fit ANSWERS the question rather
// than assuming it. A model that could only ever agree with the market would
// be useless; a model that ignores it has already been tried.
//
// WHY THIS SAMPLE CAN SAY ANYTHING. Predicting the winner from scratch is a
// high-variance target: 1,650 bets buys a +-4 point error bar on ROI, and
// every effect measured so far sits inside it. Predicting the RESIDUAL against
// a price that is already 70% accurate is a much lower-variance target, so the
// same data resolves far smaller effects. That is the whole argument for doing
// it this way and not merely a modelling preference.
//
// Fitted walk-forward: each month is predicted by coefficients fitted only on
// months before it. Nothing here sees its own answer.
//
// Usage: node data-pipeline/expMarketAnchored.js
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output');
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function load(tour) {
  const f = path.join(OUT_DIR, `clean_backtest_${tour}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).rows;
}

// Vig-free market probability for p1, and our own model's, as features.
function featurise(rows) {
  return rows
    .filter((r) => r.od1 > 1 && r.od2 > 1 && typeof r.probP1 === 'number')
    .map((r) => {
      const q1 = 1 / r.od1, q2 = 1 / r.od2;
      const m = q1 / (q1 + q2);
      return {
        ...r,
        m,
        lm: logit(m),
        // Our disagreement with the price, in logit space. Centred on the
        // market, so a model that agrees exactly contributes zero.
        d: logit(r.probP1) - logit(m),
        y: r.p1Won ? 1 : 0,
      };
    });
}

// Logistic regression by gradient descent. Three coefficients on a few
// thousand rows does not need anything cleverer, and a hand-rolled fit keeps
// the dependency list where it is.
function fitLogit(rows, { iters = 4000, lr = 0.08, l2 = 1e-4 } = {}) {
  let a = 0, b = 1, c = 0; // start AT the market: b=1, c=0, a=0
  const n = rows.length;
  if (!n) return { a, b, c };
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0, gc = 0;
    for (const r of rows) {
      const p = sigmoid(a + b * r.lm + c * r.d);
      const e = p - r.y;
      ga += e; gb += e * r.lm; gc += e * r.d;
    }
    a -= lr * (ga / n);
    b -= lr * (gb / n + l2 * b);
    c -= lr * (gc / n + l2 * c);
  }
  return { a, b, c };
}

const predict = ({ a, b, c }, r) => sigmoid(a + b * r.lm + c * r.d);

// Return per dollar staked, with the standard error, because every headline in
// this project has turned out to live inside its own error bar.
function roiOf(bets) {
  if (!bets.length) return { n: 0, roi: 0, se: 0 };
  const xs = bets.map((x) => x.ret);
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  return { n, roi: 100 * mean, se: (100 * sd) / Math.sqrt(n) };
}

function main() {
  const rows = featurise([...load('atp'), ...load('wta')])
    .sort((x, y) => (x.day < y.day ? -1 : 1));
  if (!rows.length) {
    console.error('No clean backtest found. Run buildCleanBacktest.js for both tours first.');
    process.exit(1);
  }
  const months = [...new Set(rows.map((r) => r.day.slice(0, 7)))].sort();
  console.log(`Market-anchored fit on ${rows.length} clean priced matches, ${months.length} months.\n`);

  // ── What the coefficients say, fitted on everything (reported, not used
  //    for scoring - the walk-forward below is what counts).
  const full = fitLogit(rows);
  console.log('Coefficients on the full set (descriptive):');
  console.log(`  a = ${full.a.toFixed(4)}   intercept`);
  console.log(`  b = ${full.b.toFixed(4)}   market slope   ${full.b < 0.97 ? '(<1: prices too extreme, shrink them)' : full.b > 1.03 ? '(>1: prices too timid)' : '(~1: market well calibrated)'}`);
  console.log(`  c = ${full.c.toFixed(4)}   our signal     ${full.c > 0.05 ? '(>0: our disagreement adds information)' : full.c < -0.05 ? '(<0: our disagreement is ANTI-predictive)' : '(~0: we add nothing to the price)'}`);

  // ── Walk-forward scoring.
  const variants = {
    'market alone (b=1, c=0)': () => ({ a: 0, b: 1, c: 0 }),
    'market recalibrated (c=0)': (tr) => { const w = fitLogit(tr.map((r) => ({ ...r, d: 0 }))); return { ...w, c: 0 }; },
    'market + our signal': (tr) => fitLogit(tr),
  };
  const scored = {};
  for (const name of Object.keys(variants)) scored[name] = { ll: 0, n: 0, corr: 0, bets: [] };

  const EDGE = 0.02; // stake only when the model beats the price by 2 points
  for (const mo of months) {
    const train = rows.filter((r) => r.day.slice(0, 7) < mo);
    const test = rows.filter((r) => r.day.slice(0, 7) === mo);
    if (train.length < 300 || !test.length) continue;
    for (const [name, fit] of Object.entries(variants)) {
      const w = fit(train);
      const s = scored[name];
      for (const r of test) {
        const p = predict(w, r);
        s.n++;
        s.ll += -(r.y * Math.log(clamp(p, 1e-6, 1 - 1e-6)) + (1 - r.y) * Math.log(clamp(1 - p, 1e-6, 1 - 1e-6)));
        if ((p >= 0.5) === (r.y === 1)) s.corr++;
        // Stake whichever side the model rates above its own price.
        const evP1 = p * r.od1 - 1;
        const evP2 = (1 - p) * r.od2 - 1;
        if (evP1 > EDGE && evP1 >= evP2) s.bets.push({ ret: r.y === 1 ? r.od1 - 1 : -1 });
        else if (evP2 > EDGE) s.bets.push({ ret: r.y === 0 ? r.od2 - 1 : -1 });
      }
    }
  }

  console.log('\nWalk-forward (each month predicted by months before it):\n');
  console.log('  variant                      n     acc    log loss   bets    ROI        95% CI');
  for (const [name, s] of Object.entries(scored)) {
    const r = roiOf(s.bets);
    const lo = r.roi - 1.96 * r.se, hi = r.roi + 1.96 * r.se;
    console.log(
      '  ' + name.padEnd(28),
      String(s.n).padStart(4),
      ' ' + (100 * s.corr / s.n).toFixed(1) + '%',
      '  ' + (s.ll / s.n).toFixed(4),
      '  ' + String(r.n).padStart(4),
      ' ' + ((r.roi >= 0 ? '+' : '') + r.roi.toFixed(1) + '%').padStart(7),
      '  [' + lo.toFixed(1) + '%, ' + hi.toFixed(1) + '%]' + (lo > 0 ? '  SIGNIFICANT' : '')
    );
  }
}

if (require.main === module) main();
module.exports = { fitLogit, featurise, logit, sigmoid };
