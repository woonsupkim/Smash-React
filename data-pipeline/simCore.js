/**
 * Monte Carlo point-simulation core (mirrors src/simulator.js), shared by the
 * pipeline scripts that need to precompute win probabilities in Node.
 */
function simPoint(srv, rtn) {
  if (Math.random() < srv[0]) {
    if (Math.random() < (srv[5] || 0)) return 0;
    if (Math.random() < rtn[2]) return Math.random() < srv[4] ? 0 : 1;
    return 0;
  }
  if (Math.random() < srv[1]) {
    if (Math.random() < rtn[3]) return Math.random() < srv[4] ? 0 : 1;
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
  const g = [0, 0]; let server = Math.random() < 0.5 ? 0 : 1;
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
function winProb(a, b, n, bestOf) { let w0 = 0; for (let i = 0; i < n; i++) if (simMatch(a, b, bestOf) === 0) w0++; return w0 / n; }

module.exports = { simMatch, winProb };
