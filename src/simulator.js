/**
 * Simulates a single point given server and returner probabilities.
 * @param {number[]} srv - [p1, p2, p3, p4, p5] for server
 * @param {number[]} rtn - [p1, p2, p3, p4, p5] for returner
 * @returns {0|1} 0 if server wins, 1 if returner wins
 */
function simulatePoint(srv, rtn) {
  // First serve
  if (Math.random() < srv[0]) {
    // Return first serve
    if (Math.random() < rtn[2]) {
      // Rally outcome
      return Math.random() < srv[4] ? 0 : 1;
    }
    return 0; // return fails, server wins
  } else {
    // Second serve
    if (Math.random() < srv[1]) {
      // Return second serve
      if (Math.random() < rtn[3]) {
        return Math.random() < srv[4] ? 0 : 1;
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
 * @returns {0|1} 0 if player A wins tie-break, 1 if player B wins
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
      return scoreA > scoreB ? 0 : 1;
    }
  }
}

/**
 * Simulates a single set, with a tie-break at 6-6 (first to 7 by 2).
 * Returns [gamesA, gamesB].
 */
function simulateSet(probA, probB) {
  let gamesA = 0;
  let gamesB = 0;
  // Randomize initial server each set
  let server = Math.random() < 0.5 ? 0 : 1;

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
      const tbWinner = simulateTiebreak(probA, probB, server);
      if (tbWinner === 0) gamesA++; else gamesB++;
      break;
    }
  }

  return [gamesA, gamesB];
}

/**
 * Fast match simulation: returns final winner, sets won, and scores.
 */
export function simulateMatch(probA, probB) {
  const maxSets = 5;
  const targetSets = 3;
  const setsWon = [0, 0];
  const setScores = [];

  for (let i = 0; i < maxSets && Math.max(...setsWon) < targetSets; i++) {
    const [ga, gb] = simulateSet(probA, probB);
    setScores.push([ga, gb]);
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
 */
export function simulateBatch(probA, probB, n = 1000) {
  const setsWonAgg = [0, 0];
  const matchWins = [0, 0];
  const lostInWins = [[0, 0, 0], [0, 0, 0]];
  let lastSetScores = [];

  for (let i = 0; i < n; i++) {
    const { setsWon, setScores } = simulateMatch(probA, probB);
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
}

/**
 * Generator for stepwise (slow) match simulation.
 * Yields detailed events including tie-breaks.
 */
export function* simulateMatchStepwise(probA, probB, playerInfo = { A: {}, B: {} }) {
  const targetSets = 3;
  const setsWon = [0, 0];
  const setScores = [];
  let currentSet = 0;
  let games = [0, 0];
  let points = [0, 0];
  let server = Math.random() < 0.5 ? 0 : 1;

  while (Math.max(...setsWon) < targetSets) {
    // Regular point
    const pointWinner = simulatePoint(
      server === 0 ? probA : probB,
      server === 0 ? probB : probA
    );
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
        const tbWinner = simulateTiebreak(probA, probB, server);
        if (tbWinner === 0) games[0]++; else games[1]++;
        yield { type: 'tiebreak_end', set: currentSet+1, games: [...games], tiebreakWinner: tbWinner, playerA: playerInfo.A, playerB: playerInfo.B };
        // conclude set
        const setWinner = games[0] > games[1] ? 0 : 1;
        setsWon[setWinner]++;
        setScores.push([...games]);
        yield { type: 'set', set: currentSet+1, setsWon: [...setsWon], setScores: [...setScores], setWinner, playerA: playerInfo.A, playerB: playerInfo.B };
        currentSet++;
        games = [0,0];
      }
    }
  }
  // Match end
  yield { type: 'match', winner: setsWon[0] > setsWon[1] ? 'A' : 'B', setsWon: [...setsWon], setScores: [...setScores], playerA: playerInfo.A, playerB: playerInfo.B };
}
