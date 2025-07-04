// src/pages/Wimbledon.js

import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { simulateMatch, simulateMatchStepwise } from "../utils/simulator";
import PlayerCard from "../components/PlayerCard";

export default function Wimbledon() {
  const [players, setPlayers] = useState([]);
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [result, setResult] = useState(null);
  const [slowGen, setSlowGen] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [pointLog, setPointLog] = useState([]);

  useEffect(() => {
    Papa.parse("/data/smash_us.csv", {
      download: true,
      header: true,
      complete: (res) => {
        const final16 = res.data.filter(p => p.us_rd === "2");
        setPlayers(final16);
      },
    });
  }, []);

  useEffect(() => {
    if (!slowGen) return;
    const interval = setInterval(() => {
      const step = slowGen.next();
      if (step.done) {
        setSlowGen(null);
        return;
      }
      setCurrentPoint(step.value);
      if (step.value.type === "point") {
        setPointLog(prev => [...prev, step.value]);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [slowGen]);

  const handleFastSimulate = () => {
    if (!playerA || !playerB) return;
    const pA = [playerA.p1, playerA.p2, playerA.p3, playerA.p4, playerA.p5].map(Number);
    const pB = [playerB.p1, playerB.p2, playerB.p3, playerB.p4, playerB.p5].map(Number);
    const simResult = simulateMatch(pA, pB);
    setResult(simResult);
  };

  const startSlowMatch = () => {
    if (!playerA || !playerB) return;
    const pA = [playerA.p1, playerA.p2, playerA.p3, playerA.p4, playerA.p5].map(Number);
    const pB = [playerB.p1, playerB.p2, playerB.p3, playerB.p4, playerB.p5].map(Number);
    const generator = simulateMatchStepwise(pA, pB, { A: playerA, B: playerB });
    setPointLog([]);
    setSlowGen(generator);
  };

  const replaySlowMatch = () => {
    if (pointLog.length === 0) return;
    let i = 0;
    setCurrentPoint(pointLog[0]);
    const interval = setInterval(() => {
      i++;
      if (i >= pointLog.length) return clearInterval(interval);
      setCurrentPoint(pointLog[i]);
    }, 500);
  };

  return (
    <div>
      <h1>Wimbledon Match Simulator</h1>

      <div style={{ display: "flex", gap: "2rem" }}>
        <select onChange={e => setPlayerA(players.find(p => p.name === e.target.value))}>
          <option value="">Select Player A</option>
          {players.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>

        <select onChange={e => setPlayerB(players.find(p => p.name === e.target.value))}>
          <option value="">Select Player B</option>
          {players.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <button onClick={handleFastSimulate}>Simulate Match (Fast)</button>
        <button onClick={startSlowMatch} style={{ marginLeft: "1rem" }}>Simulate Match (Slow)</button>
        {pointLog.length > 0 && (
          <button onClick={replaySlowMatch} style={{ marginLeft: "1rem" }}>Replay Match</button>
        )}
      </div>

      {playerA && playerB && (
        <div style={{ display: "flex", gap: "2rem", marginTop: "2rem" }}>
          <PlayerCard player={playerA} side="A" />
          <PlayerCard player={playerB} side="B" />
        </div>
      )}

      {result && (
        <div style={{ marginTop: "2rem" }}>
          <h2>Winner: {result.winner === "A" ? playerA.name : playerB.name}</h2>
          <table border="1" cellPadding="6">
            <thead>
              <tr>
                <th>Set</th>
                <th>{playerA.name}</th>
                <th>{playerB.name}</th>
              </tr>
            </thead>
            <tbody>
              {result.setScores.map((set, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>{set[0]}</td>
                  <td>{set[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {currentPoint && (
        <div style={{ marginTop: "2rem" }}>
          <h3>Live Point</h3>
          <p><strong>Set:</strong> {currentPoint.set}</p>
          <p><strong>Games:</strong> {currentPoint.games[0]} - {currentPoint.games[1]}</p>
          <p><strong>Points:</strong> {currentPoint.points[0]} - {currentPoint.points[1]}</p>
          <p><strong>Last Point Won By:</strong> {currentPoint.winner === 0 ? currentPoint.playerA.name : currentPoint.playerB.name}</p>
        </div>
      )}

      {pointLog.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h3>Point-by-Point Flow</h3>
          <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
            {pointLog.map((pt, i) => (
              <div
                key={i}
                title={`Point ${i + 1}: ${pt.winner === 0 ? pt.playerA.name : pt.playerB.name}`}
                style={{
                  width: "10px",
                  height: "20px",
                  backgroundColor: pt.winner === 0 ? "lime" : "magenta"
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}