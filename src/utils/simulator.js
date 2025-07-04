// src/utils/simulator.js

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
 * Simulates a single game (first to 4 points, no advantage).
 */
function simulateGame(srvProb, rtnProb) {
  const points = [0, 0];
  while (Math.max(points[0], points[1]) < 4) {
    const winner = simulatePoint(srvProb, rtnProb);
    points[winner]++;
  }
  return points[0] > points[1] ? 0 : 1;
}

/**
 * Simulates a single set, including tie-break logic matching the original R code.
 * Returns an array [gamesA, gamesB].
 */
function simulateSet(probA, probB) {
  let gamesA = 0;
  let gamesB = 0;
  let server = Math.random() < 0.5 ? 0 : 1;

  while (true) {
    // Simulate one game
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
    // Swap server
    server = 1 - server;

    // Standard set win (6-X with X<=4)
    if ((gamesA === 6 && gamesB <= 4) || (gamesB === 6 && gamesA <= 4)) {
      break;
    }
    // Tie-break scenarios
    if (gamesA === 6 && gamesB === 5) {
      const r6 = Math.random();
      if (r6 < 0.75) {
        const r7 = Math.random();
        gamesB = r7 < 0.33 ? 6 : 5;
        gamesA = 7;
      } else {
        gamesA = 6;
        gamesB = 7;
      }
      break;
    }
    if (gamesB === 6 && gamesA === 5) {
      const r6 = Math.random();
      if (r6 < 0.75) {
        const r7 = Math.random();
        gamesA = r7 < 0.33 ? 6 : 5;
        gamesB = 7;
      } else {
        gamesB = 6;
        gamesA = 7;
      }
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
    if (ga > gb) setsWon[0]++;
    else setsWon[1]++;
  }

  return {
    winner: setsWon[0] > setsWon[1] ? "A" : "B",
    setsWon,
    setScores,
  };
}

/**
 * Runs N fast simulations and aggregates results for batch display.
 * @param {number[]} probA
 * @param {number[]} probB
 * @param {number} n number of simulations
 * @returns {{ simCount: number, setsWon: number[], lostInWins: number[][], maxLost: number, setScores: number[][] }}
 */
export function simulateBatch(probA, probB, n = 1000) {
  const setsWonAgg = [0, 0];
  const lostInWins = [[0, 0, 0], [0, 0, 0]];
  let lastSetScores = [];

  for (let i = 0; i < n; i++) {
    const { setsWon, setScores } = simulateMatch(probA, probB);
    setsWonAgg[0] += setsWon[0];
    setsWonAgg[1] += setsWon[1];
    lastSetScores = setScores;
    const winnerIdx = setsWon[0] > setsWon[1] ? 0 : 1;
    const lost = winnerIdx === 0 ? setsWon[1] : setsWon[0];
    if (lost <= 2) lostInWins[winnerIdx][lost]++;
  }

  const maxLost = Math.max(...lostInWins[0], ...lostInWins[1]);
  return { simCount: n, setsWon: setsWonAgg, lostInWins, maxLost, setScores: lastSetScores };
}

/**
 * Generator for stepwise (slow) match simulation.
 * Yields { type, set, games, points, server, winner, ... } events.
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
    // Play a point
    const winner = simulatePoint(
      server === 0 ? probA : probB,
      server === 0 ? probB : probA
    );
    points[winner]++;
    yield { type: 'point', set: currentSet+1, games: [...games], points: [...points], server, winner, playerA: playerInfo.A, playerB: playerInfo.B };

    // Check game end
    if (points[0]>=4 || points[1]>=4) {
      const gameWinner = points[0]>points[1]?0:1;
      games[gameWinner]++;
      points = [0,0];
      server = 1-server;
      yield { type:'game', set:currentSet+1, games:[...games], gameWinner, playerA:playerInfo.A, playerB:playerInfo.B };

      // Check set end
      const [ga, gb] = games;
      if ((ga===6&&gb<=4)||(gb===6&&ga<=4)||ga===7||gb===7) {
        const setWinner = ga>gb?0:1;
        setsWon[setWinner]++;
        setScores.push([...games]);
        games=[0,0];
        currentSet++;
        yield { type:'set', set:currentSet, setsWon:[...setsWon], setScores:[...setScores], setWinner, playerA:playerInfo.A, playerB:playerInfo.B };
      }
    }
  }
  yield { type:'match', winner: setsWon[0]>setsWon[1]?'A':'B', setsWon:[...setsWon], setScores:[...setScores], playerA:playerInfo.A, playerB:playerInfo.B };
}
