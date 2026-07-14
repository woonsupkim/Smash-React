/**
 * Closed-form match win probability from the same p1-p6 point model the
 * Monte Carlo simulator uses. Exact expectation, zero simulation noise:
 * 1,000 Monte Carlo draws carry a ~1.5% standard error that randomly flips
 * picks near 50%; this computes the limit the simulation converges to.
 *
 * Mirrors simulator.js semantics exactly:
 *   point:    p1 first-in, p6 ace given in, opponent r3 return-win vs 1st,
 *             p5 server rally-win; p2 second-in, r4 return vs 2nd, else DF
 *   game:     to 4 points win by 2, deuce loop
 *   tiebreak: to 7 win by 2, serve pattern 1-2-2-..., 6-6 pair loop
 *   set:      to 6 games win by 2, alternating serve, tiebreak at 6-6
 *             (started by the set's opening server), opening server random
 *   match:    best of 3/5 independent sets
 */

// P(server wins a point) given server's [p1..p6] and returner's [.., r3, r4, ..].
function pointProb(srv, rtn) {
  const p1 = srv[0], p2 = srv[1], p5 = srv[4], p6 = srv[5] || 0;
  const r3 = rtn[2], r4 = rtn[3];
  const firstIn = p6 + (1 - p6) * (r3 * p5 + (1 - r3));
  const secondIn = r4 * p5 + (1 - r4);
  return p1 * firstIn + (1 - p1) * p2 * secondIn;
}

// P(server holds a game) from the server's point-win probability q.
function gameProb(q) {
  const r = 1 - q;
  const deuce = (q * q) / (1 - 2 * q * r);
  return q ** 4 * (1 + 4 * r + 10 * r * r) + 20 * q ** 3 * r ** 3 * deuce;
}

// P(A wins the tiebreak). qA/qB = point-win prob when A/B serves; starter =
// 0 if A serves point 1. Serve pattern: 1 point, then pairs (mirrors
// simulator.simTiebreak). From 6-6 each pair has one serve each, so the
// win-by-2 loop collapses to a ratio.
function tiebreakProb(qA, qB, starter) {
  const serverAt = (pt) => (pt === 0 ? starter : (Math.floor((pt - 1) / 2) % 2 === 0 ? 1 - starter : starter));
  const winPair = qA * (1 - qB);
  const losePair = (1 - qA) * qB;
  const p66 = winPair + losePair > 0 ? winPair / (winPair + losePair) : 0.5;

  const memo = new Map();
  function P(a, b) {
    if (a === 7) return 1;
    if (b === 7) return 0;
    if (a === 6 && b === 6) return p66;
    const key = a * 8 + b;
    if (memo.has(key)) return memo.get(key);
    const srv = serverAt(a + b);
    const pA = srv === 0 ? qA : 1 - qB; // P(A wins this point)
    // Win-by-2: 7-6 isn't a win; route x-6 scores through 6-6.
    const winA = (a + 1 === 7 && b === 6) ? P(6, 6) : P(a + 1, b);
    const winB = (b + 1 === 7 && a === 6) ? P(6, 6) : P(a, b + 1);
    const v = pA * winA + (1 - pA) * winB;
    memo.set(key, v);
    return v;
  }
  return P(0, 0);
}

// P(A wins a set) given each side's serve point-win prob; opening server
// random (mirrors simulator.simSet).
function setProb(qA, qB) {
  const holdA = gameProb(qA), holdB = gameProb(qB);

  function fromStart(starter) {
    const memo = new Map();
    function P(ga, gb) {
      if (ga === 6 && gb === 6) return tiebreakProb(qA, qB, starter);
      if (ga >= 6 && ga - gb >= 2) return 1;
      if (gb >= 6 && gb - ga >= 2) return 0;
      if (ga === 7) return 1;
      if (gb === 7) return 0;
      const key = ga * 8 + gb;
      if (memo.has(key)) return memo.get(key);
      const server = (ga + gb) % 2 === 0 ? starter : 1 - starter;
      const pAGame = server === 0 ? holdA : 1 - holdB;
      const v = pAGame * P(ga + 1, gb) + (1 - pAGame) * P(ga, gb + 1);
      memo.set(key, v);
      return v;
    }
    return P(0, 0);
  }
  return 0.5 * (fromStart(0) + fromStart(1));
}

// P(A wins the match), best of 3 or 5 independent sets.
function matchProb(probsA, probsB, bestOf = 3) {
  const qA = pointProb(probsA, probsB);
  const qB = pointProb(probsB, probsA);
  const p = setProb(qA, qB), r = 1 - p;
  if (bestOf >= 5) return p ** 3 * (1 + 3 * r + 6 * r * r);
  return p * p * (1 + 2 * r);
}

// Match prob plus the exact set-score distribution (negative binomial over
// independent sets). Shape mirrors the simulator's simSummary: lossDist[0]
// = P(A wins taking-k-sets-from-B is the score), lossDist[1] likewise for B
// - as probabilities rather than sim counts (argmax works the same).
function matchDetail(probsA, probsB, bestOf = 3) {
  const qA = pointProb(probsA, probsB);
  const qB = pointProb(probsB, probsA);
  const p = setProb(qA, qB), r = 1 - p;
  const target = Math.ceil(bestOf / 2);
  const choose = (n, k) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; };
  const distA = [], distB = [];
  for (let k = 0; k < target; k++) {
    distA.push(choose(target - 1 + k, k) * p ** target * r ** k);
    distB.push(choose(target - 1 + k, k) * r ** target * p ** k);
  }
  return { probP1: distA.reduce((s, v) => s + v, 0), target, lossDist: [distA, distB] };
}

module.exports = { pointProb, gameProb, tiebreakProb, setProb, matchProb, matchDetail };
