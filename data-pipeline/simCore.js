/**
 * Monte Carlo point-simulation core (mirrors src/simulator.js), shared by the
 * pipeline scripts that need to precompute win probabilities in Node.
 *
 * The RNG-consumption order here is byte-for-byte the same as src/simulator.js,
 * so seeding both with the same key produces identical probabilities. That is
 * what lets the locked prediction shown on Home equal the live H2H number.
 */
let _rng = Math.random;
function _mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function simPoint(srv, rtn) {
  if (_rng() < srv[0]) {
    if (_rng() < (srv[5] || 0)) return 0;
    if (_rng() < rtn[2]) return _rng() < srv[4] ? 0 : 1;
    return 0;
  }
  if (_rng() < srv[1]) {
    if (_rng() < rtn[3]) return _rng() < srv[4] ? 0 : 1;
    return 0;
  }
  return 1;
}
function simGame(s, r) {
  const p = [0, 0];
  while (true) { p[simPoint(s, r)]++; if ((p[0] >= 4 || p[1] >= 4) && Math.abs(p[0] - p[1]) >= 2) return p[0] > p[1] ? 0 : 1; }
}
function simTiebreak(a, b, srv) {
  const s = [0, 0]; let pt = 0;
  while (true) {
    const server = pt === 0 ? srv : (Math.floor((pt - 1) / 2) % 2 === 0 ? 1 - srv : srv);
    const w = server === 0 ? simPoint(a, b) : simPoint(b, a);
    if (server === 0) { if (w === 0) s[0]++; else s[1]++; } else { if (w === 0) s[1]++; else s[0]++; }
    pt++;
    if ((s[0] >= 7 || s[1] >= 7) && Math.abs(s[0] - s[1]) >= 2) return s[0] > s[1] ? 0 : 1;
  }
}
function simSet(a, b) {
  const g = [0, 0]; let server = _rng() < 0.5 ? 0 : 1;
  while (true) {
    const w = simGame(server === 0 ? a : b, server === 0 ? b : a);
    if (w === 0) { if (server === 0) g[0]++; else g[1]++; } else { if (server === 0) g[1]++; else g[0]++; }
    server = 1 - server;
    if ((g[0] >= 6 || g[1] >= 6) && Math.abs(g[0] - g[1]) >= 2) break;
    if (g[0] === 6 && g[1] === 6) { if (simTiebreak(a, b, server) === 0) g[0]++; else g[1]++; break; }
  }
  return g[0] > g[1] ? 0 : 1;
}
function simMatch(a, b, bestOf) {
  const target = Math.ceil(bestOf / 2); const won = [0, 0];
  while (Math.max(won[0], won[1]) < target) won[simSet(a, b)]++;
  return won[0] > won[1] ? 0 : 1;
}
function winProb(a, b, n, bestOf, seed) {
  const prev = _rng;
  if (seed != null) _rng = _mulberry32(seed >>> 0);
  try {
    let w0 = 0;
    for (let i = 0; i < n; i++) if (simMatch(a, b, bestOf) === 0) w0++;
    return w0 / n;
  } finally {
    _rng = prev;
  }
}

module.exports = { simMatch, winProb, seedFromString };
