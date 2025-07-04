// src/utils/simulator.js

export function simulateMatch(probMatrixA, probMatrixB) {
  const maxSets = 5;
  const targetSets = 3;
  let setsWon = [0, 0];
  const setScores = [];

  const simulateSet = () => {
    let games = [0, 0];
    let server = Math.random() < 0.5 ? 0 : 1;

    while (games[0] < 6 && games[1] < 6) {
      const winner = simulateGame(
        server === 0 ? probMatrixA : probMatrixB,
        server === 0 ? probMatrixB : probMatrixA
      );
      games[winner]++;
      server = 1 - server;
    }

    return games;
  };

  const simulateGame = (srv, rtn) => {
    let points = [0, 0];
    while (Math.max(...points) < 4) {
      const winner = simulatePoint(srv, rtn);
      points[winner]++;
    }
    return points[0] > points[1] ? 0 : 1;
  };

  const simulatePoint = (srv, rtn) => {
    if (Math.random() < srv[0]) {
      if (Math.random() < rtn[2]) {
        return Math.random() < srv[4] ? 0 : 1;
      } else return 0;
    } else {
      if (Math.random() < srv[1]) {
        if (Math.random() < rtn[3]) {
          return Math.random() < srv[4] ? 0 : 1;
        } else return 0;
      } else return 1;
    }
  };

  for (let i = 0; i < maxSets && Math.max(...setsWon) < targetSets; i++) {
    const [ga, gb] = simulateSet();
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

export function* simulateMatchStepwise(pA, pB, playerInfo = { A: {}, B: {} }) {
  const maxSets = 5;
  const targetSets = 3;
  let setsWon = [0, 0];
  const setScores = [];
  let currentSet = 0;
  let games = [0, 0];
  let points = [0, 0];
  let server = Math.random() < 0.5 ? 0 : 1;

  const simulatePoint = (srv, rtn) => {
    if (Math.random() < srv[0]) {
      if (Math.random() < rtn[2]) {
        return Math.random() < srv[4] ? 0 : 1;
      } else return 0;
    } else {
      if (Math.random() < srv[1]) {
        if (Math.random() < rtn[3]) {
          return Math.random() < srv[4] ? 0 : 1;
        } else return 0;
      } else return 1;
    }
  };

  while (Math.max(...setsWon) < targetSets) {
    const winner = simulatePoint(
      server === 0 ? pA : pB,
      server === 0 ? pB : pA
    );
    points[winner]++;

    yield {
      type: "point",
      set: currentSet + 1,
      games: [...games],
      points: [...points],
      server,
      winner,
      playerA: playerInfo.A,
      playerB: playerInfo.B,
    };

    if (points[0] >= 4 || points[1] >= 4) {
      const gameWinner = points[0] > points[1] ? 0 : 1;
      games[gameWinner]++;
      points = [0, 0];
      server = 1 - server;

      yield {
        type: "game",
        set: currentSet + 1,
        games: [...games],
        gameWinner,
        playerA: playerInfo.A,
        playerB: playerInfo.B,
      };

      if (games[0] >= 6 || games[1] >= 6) {
        const setWinner = games[0] > games[1] ? 0 : 1;
        setsWon[setWinner]++;
        setScores.push([...games]);
        games = [0, 0];
        currentSet++;

        yield {
          type: "set",
          set: currentSet,
          setsWon: [...setsWon],
          setScores: [...setScores],
          setWinner,
          playerA: playerInfo.A,
          playerB: playerInfo.B,
        };
      }
    }
  }

  yield {
    type: "match",
    winner: setsWon[0] > setsWon[1] ? "A" : "B",
    setsWon,
    setScores,
    playerA: playerInfo.A,
    playerB: playerInfo.B,
  };
}
