/**
 * Bayesian credible interval for a win-rate estimate, treating each
 * simulated match as a Bernoulli trial - same idea as estimating pi from
 * Monte Carlo points-in-circle. Posterior is Beta(1+wins, 1+losses) under
 * a uniform Beta(1,1) prior; no library dependency, just the standard
 * regularized-incomplete-beta + bisection-inverse numerics (Numerical
 * Recipes' betacf/betai), which are well-behaved for our always >=1
 * shape parameters.
 */

function lgamma(x) {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(x, a, b) {
  const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta function I_x(a, b).
function betainc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

// Inverse of I_x(a, b) via bisection - slower than Newton but can't diverge,
// and this only ever runs a handful of times per simulation, not per point.
function betaInv(p, a, b) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (betainc(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * @param {number} wins
 * @param {number} losses
 * @param {number} level - credible mass, e.g. 0.95 for a 95% interval
 * @returns {{lower: number, upper: number}} proportions in [0, 1]
 */
export function credibleInterval(wins, losses, level = 0.95) {
  const a = 1 + wins;
  const b = 1 + losses;
  const alpha = (1 - level) / 2;
  return {
    lower: betaInv(alpha, a, b),
    upper: betaInv(1 - alpha, a, b),
  };
}

// Width above which the interval is wide enough (relative to a few hundred
// sims) that the point estimate shouldn't be read with much confidence -
// e.g. a 70% estimate from 20 sims (wide CI) reads very differently from a
// 70% estimate from 2000 sims (narrow CI), even though the number is the same.
const WIDE_CI_THRESHOLD = 0.15;

/**
 * Plain-language read on a win probability, bucketed FiveThirtyEight-style,
 * with an "(uncertain)" flag when the credible interval is wide relative to
 * the bucket - i.e. the label reflects both the estimate AND how much to
 * trust it.
 * @param {number} prob - win probability for either side, in [0, 1]
 * @param {number} lower - that side's 95% CI lower bound
 * @param {number} upper - that side's 95% CI upper bound
 * @returns {string}
 */
export function confidenceLabel(prob, lower, upper) {
  const favored = Math.max(prob, 1 - prob);
  let label;
  if (favored < 0.55) label = 'Toss-up';
  else if (favored < 0.65) label = 'Slight favorite';
  else if (favored < 0.80) label = 'Likely';
  else if (favored < 0.95) label = 'Highly likely';
  else label = 'Near-certain';

  const width = upper - lower;
  if (width > WIDE_CI_THRESHOLD) label += ' (uncertain - wide range)';
  return label;
}

/**
 * Flags sample-size reliability issues that should surface as visible warnings
 * in the UI rather than buried in CI text.
 *
 * - 'coinflip': the 95% CI straddles 50%, meaning the simulated "winner"
 *   could easily be the true loser with more trials. Classic small-n artifact:
 *   a player who wins 6/10 sims might win <50% of 1000 sims.
 * - 'wide': CI doesn't cross 50% but is still wide enough to warrant caution.
 * - null: result is reliable.
 *
 * @param {number} wins  - simulated wins for the leading player
 * @param {number} losses - simulated losses for the leading player
 * @returns {'coinflip'|'wide'|null}
 */
export function sampleSizeFlag(wins, losses) {
  if (wins + losses < 1) return null;
  const { lower, upper } = credibleInterval(wins, losses);
  if (lower < 0.5 && upper > 0.5) return 'coinflip';
  if (upper - lower > WIDE_CI_THRESHOLD) return 'wide';
  return null;
}
