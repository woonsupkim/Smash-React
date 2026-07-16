/**
 * Shared evaluation primitives for the model pipeline: log-loss scoring,
 * log-loss-objective weight fitting, one-parameter Platt recalibration, and
 * the walk-forward protocol (fit on everything strictly before a fold,
 * predict the fold, never the reverse). Used by tuneWeights.js (production
 * retunes) and experiments.js (model-change validation).
 *
 * Log loss is the objective everywhere: accuracy can't tell a 55% call from
 * a 95% call, log loss is exactly the penalty for stated confidence.
 */
const clampP = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// Mean negative log-likelihood of [{p, won}] where p = P(won side... ) is
// the predicted probability of the outcome coded by `won` (1/0/true/false).
function logLoss(list) {
  if (!list.length) return null;
  let s = 0;
  for (const r of list) {
    const p = clampP(r.p);
    s += -(r.won ? Math.log(p) : Math.log(1 - p));
  }
  return s / list.length;
}

function accuracy(list) {
  if (!list.length) return null;
  return list.filter((r) => (r.p >= 0.5) === !!r.won).length / list.length;
}

// Candidate (ws, we, wr) triples on the simplex ws+we+wr=1.
function weightGrid(step = 0.05) {
  const out = [];
  const n = Math.round(1 / step);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      out.push({ ws: +(i / n).toFixed(3), we: +(j / n).toFixed(3), wr: +((n - i - j) / n).toFixed(3) });
    }
  }
  return out;
}

// Fits blend weights on a training list by log loss. Rows need
// {probP1, eloProbP1, rankProbP1, p1Won}. Optional per-row weights turn
// this into a recency-weighted fit (rolling-window tuner).
function fitWeights(list, step = 0.05, wts = null) {
  let best = null;
  for (const w of weightGrid(step)) {
    let s = 0, W = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const wt = wts ? wts[i] : 1;
      const p = clampP(w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1);
      s += wt * -(m.p1Won ? Math.log(p) : Math.log(1 - p));
      W += wt;
    }
    const ll = s / W;
    if (!best || ll < best.logLoss) best = { ...w, logLoss: ll };
  }
  return best;
}

// One-parameter Platt recalibration: p' = sigmoid(a * logit(p)).
// The intercept is pinned at 0 by symmetry - which side is "p1" is
// arbitrary, so the calibration curve must map 0.5 to 0.5. That also
// guarantees recalibration never flips a pick, only restates confidence.
function applyCalib(p, a) {
  if (!a || a === 1) return p;
  return sigmoid(a * logit(p));
}

// Fits `a` on held-out predictions [{p, won}] by log loss.
function fitCalib(list, gridStep = 0.02, lo = 0.3, hi = 2.0) {
  if (list.length < 100) return 1; // too little signal - identity
  let best = { a: 1, ll: logLoss(list) };
  for (let a = lo; a <= hi + 1e-9; a += gridStep) {
    const ll = logLoss(list.map((r) => ({ p: applyCalib(r.p, a), won: r.won })));
    if (ll < best.ll) best = { a: +a.toFixed(2), ll };
  }
  return best.a;
}

// Chronological folds by calendar quarter ("2025Q3") or month ("2025-07").
function foldKey(date, foldBy = 'quarter') {
  const d = new Date(date);
  if (foldBy === 'month') return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${d.getUTCFullYear()}Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/**
 * Walk-forward evaluation of the blend. For each quarter (after a burn-in
 * of minTrain rows), fits weights per surface on all STRICTLY EARLIER rows
 * (falling back to a tour-wide fit when the surface has fewer than
 * minSurface training rows), then predicts the quarter. Returns the pooled
 * out-of-fold predictions [{p, won, surface, date, ...passthrough}].
 * Rows need {probP1, eloProbP1, rankProbP1, p1Won, surface, date}.
 */
function walkForwardOOF(rows, { minTrain = 150, minSurface = 60, step = 0.05, foldBy = 'quarter' } = {}) {
  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));
  const folds = new Map();
  for (const r of sorted) {
    const k = foldKey(r.date, foldBy);
    if (!folds.has(k)) folds.set(k, []);
    folds.get(k).push(r);
  }
  const keys = [...folds.keys()];
  const oof = [];
  const train = [];
  for (const k of keys) {
    const test = folds.get(k);
    if (train.length >= minTrain) {
      const tourFit = fitWeights(train, step);
      const bySurface = {};
      for (const s of ['hard', 'clay', 'grass']) {
        const list = train.filter((m) => m.surface === s);
        bySurface[s] = list.length >= minSurface ? fitWeights(list, step) : tourFit;
      }
      for (const m of test) {
        const w = bySurface[m.surface] || tourFit;
        oof.push({ ...m, p: w.ws * m.probP1 + w.we * m.eloProbP1 + w.wr * m.rankProbP1, won: m.p1Won ? 1 : 0, fold: k });
      }
    }
    train.push(...test);
  }
  return oof;
}

// Sequentially-calibrated log loss: fold k is recalibrated with `a` fitted
// only on OOF predictions from folds strictly before k. Honest end-to-end.
function sequentialCalibLogLoss(oof) {
  const byFold = new Map();
  for (const r of oof) {
    if (!byFold.has(r.fold)) byFold.set(r.fold, []);
    byFold.get(r.fold).push(r);
  }
  const past = [];
  const scored = [];
  for (const [, list] of byFold) {
    const a = fitCalib(past);
    for (const r of list) scored.push({ p: applyCalib(r.p, a), won: r.won });
    past.push(...list);
  }
  return { logLoss: logLoss(scored), accuracy: accuracy(scored) };
}

// L2-regularized logistic regression WITHOUT an intercept: which side is
// "p1" is arbitrary, so the model must be antisymmetric (every feature must
// flip sign when the players swap), and a zero intercept guarantees
// swap-consistency. Plain gradient descent - the feature count is tiny.
function fitLogistic(X, y, { lambda = 1, iters = 400, lr = 0.5 } = {}) {
  const n = X.length, k = X[0].length;
  let w = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j < k; j++) z += w[j] * X[i][j];
      const e = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < k; j++) g[j] += e * X[i][j];
    }
    for (let j = 0; j < k; j++) w[j] -= lr * (g[j] / n + (lambda / n) * w[j]);
  }
  return w;
}

function predictLogistic(w, x) {
  let z = 0;
  for (let j = 0; j < w.length; j++) z += w[j] * x[j];
  return 1 / (1 + Math.exp(-z));
}

// Bookmaker-implied probability with the vig removed.
function marketProb(o1, o2) {
  if (!(o1 > 1) || !(o2 > 1)) return null;
  const q1 = 1 / o1, q2 = 1 / o2;
  return q1 / (q1 + q2);
}

module.exports = {
  clampP, logit, sigmoid, logLoss, accuracy,
  weightGrid, fitWeights, applyCalib, fitCalib,
  foldKey, walkForwardOOF, sequentialCalibLogLoss, marketProb,
  fitLogistic, predictLogistic,
};
