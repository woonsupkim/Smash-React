// Seedable RNG. When a seed is set (via simulateBatch's `seed` arg) a given
// matchup produces the exact same probability every run, so the number never
// jitters between reloads. Unseeded, it falls back to Math.random.
let _rng = Math.random;
function _mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulates a single point given server and returner probabilities.
 * @param {number[]} srv - [p1, p2, p3, p4, p5, p6] for server (p6 = ace rate given 1st serve in; optional, defaults to 0 if omitted)
 * @param {number[]} rtn - [p1, p2, p3, p4, p5, p6] for returner
 * @returns {0|1} 0 if server wins, 1 if returner wins
 */
function simulatePoint(srv, rtn) {
  // First serve
  if (_rng() < srv[0]) {
    // Unreturnable ace - the point ends before the returner gets involved at
    // all, which is why this is checked separately from the rally win rate
    // (p5): an ace isn't a function of the returner's skill, but blending
    // it into p5 (as the original model did) made it look like one.
    if (_rng() < srv[5]) return 0;
    // Return first serve
    if (_rng() < rtn[2]) {
      // Rally outcome
      return _rng() < srv[4] ? 0 : 1;
    }
    return 0; // return fails, server wins
  } else {
    // Second serve
    if (_rng() < srv[1]) {
      // Return second serve
      if (_rng() < rtn[3]) {
        return _rng() < srv[4] ? 0 : 1;
      }
      return 0; // return fails, server wins
    }
    return 1; // double fault, returner wins
  }
}

/**
 * Simulates a standard tennis game (with deuce and advantage rules).
 * @param {number[]} srvProb - server probabilities array
 * @param {number[]} rtnProb - returner probabilities array
 * @returns {0|1} 0 if server wins game, 1 if returner wins game
 */
function simulateGame(srvProb, rtnProb) {
  let points = [0, 0];
  while (true) {
    const winner = simulatePoint(srvProb, rtnProb);
    points[winner]++;
    // Check for game win: at least 4 points & 2-point margin
    if ((points[0] >= 4 || points[1] >= 4) && Math.abs(points[0] - points[1]) >= 2) {
      return points[0] > points[1] ? 0 : 1;
    }
  }
}

/**
 * Simulates a 7-point tie-break (first to 7, win by 2), with proper serve alternation.
 * @param {number[]} probA - probabilities for player A
 * @param {number[]} probB - probabilities for player B
 * @param {0|1} initialServer - 0 if A serves first, 1 if B serves first
 * @returns {{winner: 0|1, pointsA: number, pointsB: number}}
 */
function simulateTiebreak(probA, probB, initialServer) {
  let scoreA = 0;
  let scoreB = 0;
  let point = 0;
  while (true) {
    // Determine server for this point:
    let server;
    if (point === 0) {
      server = initialServer;
    } else {
      // After first point, serve alternates every two points
      const cycle = Math.floor((point - 1) / 2) % 2;
      server = cycle === 0 ? 1 - initialServer : initialServer;
    }
    // Simulate the point
    let p;
    if (server === 0) {
      p = simulatePoint(probA, probB);
      if (p === 0) scoreA++; else scoreB++;
    } else {
      p = simulatePoint(probB, probA);
      if (p === 0) scoreB++; else scoreA++;
    }
    point++;
    // Check for tie-break win: at least 7 points and 2-point margin
    if ((scoreA >= 7 || scoreB >= 7) && Math.abs(scoreA - scoreB) >= 2) {
      return { winner: scoreA > scoreB ? 0 : 1, pointsA: scoreA, pointsB: scoreB };
    }
  }
}

/**
 * Simulates a single set, with a tie-break at 6-6 (first to 7 by 2).
 * Returns [gamesA, gamesB, tbLoserPoints] - the third element is the
 * tie-break loser's point count for 7-6 sets, or null when no tie-break
 * was played (so the scoreboard can render e.g. 7-6⁴).
 */
function simulateSet(probA, probB) {
  let gamesA = 0;
  let gamesB = 0;
  let tbLoserPoints = null;
  // Randomize initial server each set
  let server = _rng() < 0.5 ? 0 : 1;

  while (true) {
    // Play a standard game
    const winner = simulateGame(
      server === 0 ? probA : probB,
      server === 0 ? probB : probA
    );
    // Assign game
    if (winner === 0) {
      if (server === 0) gamesA++; else gamesB++;
    } else {
      if (server === 0) gamesB++; else gamesA++;
    }
    // Swap server for next game
    server = 1 - server;

    // Check for set win by two games (including 7-5)
    if ((gamesA >= 6 || gamesB >= 6) && Math.abs(gamesA - gamesB) >= 2) {
      break;
    }
    // Tie-break at 6-6
    if (gamesA === 6 && gamesB === 6) {
      const tb = simulateTiebreak(probA, probB, server);
      if (tb.winner === 0) gamesA++; else gamesB++;
      tbLoserPoints = tb.winner === 0 ? tb.pointsB : tb.pointsA;
      break;
    }
  }

  return [gamesA, gamesB, tbLoserPoints];
}

/**
 * Fast match simulation: returns final winner, sets won, and scores.
 * @param {number} bestOf - 5 (ATP Grand Slam default) or 3 (WTA Grand Slam).
 */
export function simulateMatch(probA, probB, bestOf = 5) {
  const maxSets = bestOf;
  const targetSets = Math.ceil(bestOf / 2);
  const setsWon = [0, 0];
  const setScores = [];

  for (let i = 0; i < maxSets && Math.max(...setsWon) < targetSets; i++) {
    const [ga, gb, tbLoserPoints] = simulateSet(probA, probB);
    setScores.push([ga, gb, tbLoserPoints]);
    if (ga > gb) setsWon[0]++; else setsWon[1]++;
  }

  return {
    winner: setsWon[0] > setsWon[1] ? "A" : "B",
    setsWon,
    setScores,
  };
}

/**
 * Runs N fast simulations and aggregates results for batch display.
 * @param {number} bestOf - 5 (ATP Grand Slam default) or 3 (WTA Grand Slam).
 */
export function simulateBatch(probA, probB, n = 1000, bestOf = 5, seed = null) {
  const prevRng = _rng;
  if (seed != null) _rng = _mulberry32(seed >>> 0);
  try {
    const setsWonAgg = [0, 0];
    const matchWins = [0, 0];
    const lostInWins = [[0, 0, 0], [0, 0, 0]];
    let lastSetScores = [];

    for (let i = 0; i < n; i++) {
      const { setsWon, setScores } = simulateMatch(probA, probB, bestOf);
      setsWonAgg[0] += setsWon[0];
      setsWonAgg[1] += setsWon[1];
      const winner = setsWon[0] > setsWon[1] ? 0 : 1;
      matchWins[winner]++;
      lastSetScores = setScores;
      const lost = Math.min(setsWon[1 - winner], 2);
      lostInWins[winner][lost]++;
    }

    return {
      simCount: n,
      matchWins,
      setsWon: setsWonAgg,
      lostInWins,
      setScores: lastSetScores
    };
  } finally {
    _rng = prevRng; // never leak the seed to other callers (e.g. Dream Brackets)
  }
}

// Stable 32-bit hash of a matchup key, so H2H can derive a seed that is the
// same every time the same two players meet on the same surface.
export function seedFromString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Generator for stepwise (slow) match simulation.
 * Yields detailed events including tie-breaks.
 */
export function* simulateMatchStepwise(probA, probB, playerInfo = { A: {}, B: {} }, bestOf = 5) {
  const targetSets = Math.ceil(bestOf / 2);
  const setsWon = [0, 0];
  const setScores = [];
  let currentSet = 0;
  let games = [0, 0];
  let points = [0, 0];
  let server = _rng() < 0.5 ? 0 : 1;

  while (Math.max(...setsWon) < targetSets) {
    // Regular point. simulatePoint returns 0/1 relative to server/returner,
    // not to player A/B, so it must be remapped back to an absolute player
    // index before being used as a points[]/games[] slot (otherwise, since
    // the server usually wins their own service game, every service game
    // would get incorrectly credited to whichever player happens to occupy
    // index 0 - producing a deterministic sweep instead of a real contest).
    const rawWinner = simulatePoint(
      server === 0 ? probA : probB,
      server === 0 ? probB : probA
    );
    const pointWinner = server === 0 ? rawWinner : 1 - rawWinner;
    points[pointWinner]++;
    yield { type: 'point', set: currentSet+1, games: [...games], points: [...points], server, winner: pointWinner, playerA: playerInfo.A, playerB: playerInfo.B };

    // Check for game end
    if ((points[0] >= 4 || points[1] >= 4) && Math.abs(points[0] - points[1]) >= 2) {
      const gameWinner = points[0] > points[1] ? 0 : 1;
      games[gameWinner]++;
      points = [0, 0];
      yield { type: 'game', set: currentSet+1, games: [...games], gameWinner, playerA: playerInfo.A, playerB: playerInfo.B };
      server = 1 - server;

      // Check for set end or tie-break condition
      if ((games[0] >= 6 || games[1] >= 6) && Math.abs(games[0] - games[1]) >= 2) {
        const setWinner = games[0] > games[1] ? 0 : 1;
        setsWon[setWinner]++;
        setScores.push([...games]);
        yield { type: 'set', set: currentSet+1, setsWon: [...setsWon], setScores: [...setScores], setWinner, playerA: playerInfo.A, playerB: playerInfo.B };
        currentSet++;
        games = [0,0];
        continue;
      }
      if (games[0] === 6 && games[1] === 6) {
        // Tie-break event
        yield { type: 'tiebreak_start', set: currentSet+1, games: [...games], playerA: playerInfo.A, playerB: playerInfo.B };
        const tb = simulateTiebreak(probA, probB, server);
        if (tb.winner === 0) games[0]++; else games[1]++;
        const tbLoserPoints = tb.winner === 0 ? tb.pointsB : tb.pointsA;
        yield { type: 'tiebreak_end', set: currentSet+1, games: [...games], tiebreakWinner: tb.winner, tiebreakPoints: [tb.pointsA, tb.pointsB], playerA: playerInfo.A, playerB: playerInfo.B };
        // conclude set
        const setWinner = games[0] > games[1] ? 0 : 1;
        setsWon[setWinner]++;
        setScores.push([games[0], games[1], tbLoserPoints]);
        yield { type: 'set', set: currentSet+1, setsWon: [...setsWon], setScores: [...setScores], setWinner, playerA: playerInfo.A, playerB: playerInfo.B };
        currentSet++;
        games = [0,0];
      }
    }
  }
  // Match end
  yield { type: 'match', winner: setsWon[0] > setsWon[1] ? 'A' : 'B', setsWon: [...setsWon], setScores: [...setScores], playerA: playerInfo.A, playerB: playerInfo.B };
}
