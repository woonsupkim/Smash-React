// src/pages/Wimbledon.js
import React, { useState, useEffect } from "react";
import Papa from "papaparse";
import { simulateBatch, simulateMatchStepwise } from "../utils/simulator";
import PlayerCard from "../components/PlayerCard";
import "./Wimbledon.css";

export default function Wimbledon() {
  const [players, setPlayers] = useState([]);
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const [slowGen, setSlowGen] = useState(null);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [pointLog, setPointLog] = useState([]);

  // Load player data
  useEffect(() => {
    Papa.parse("/data/smash_us.csv", {
      download: true,
      header: true,
      complete: (res) => {
        const final16 = res.data.filter(p => p.us_rd === "2");
        setPlayers(final16);
      }
    });
  }, []);

  // Stepwise simulation effect
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
    }, 200);
    return () => clearInterval(interval);
  }, [slowGen]);

  // Fast batch simulate
  const handleFastSimulate = () => {
    if (!playerA || !playerB) return;
    const pA = [playerA.p1,playerA.p2,playerA.p3,playerA.p4,playerA.p5].map(Number);
    const pB = [playerB.p1,playerB.p2,playerB.p3,playerB.p4,playerB.p5].map(Number);
    const result = simulateBatch(pA, pB, 1000);
    setBatchResult(result);
  };

  // Start slow simulation
  const startSlowMatch = () => {
    if (!playerA || !playerB) return;
    const pA = [playerA.p1,playerA.p2,playerA.p3,playerA.p4,playerA.p5].map(Number);
    const pB = [playerB.p1,playerB.p2,playerB.p3,playerB.p4,playerB.p5].map(Number);
    const gen = simulateMatchStepwise(pA, pB, { A: playerA, B: playerB });
    setPointLog([]);
    setCurrentPoint(null);
    setSlowGen(gen);
  };

  // Replay recorded slow match
  const replaySlowMatch = () => {
    if (!pointLog.length) return;
    let idx = 0;
    setCurrentPoint(pointLog[0]);
    const iv = setInterval(() => {
      idx++;
      if (idx >= pointLog.length) {
        clearInterval(iv);
        return;
      }
      setCurrentPoint(pointLog[idx]);
    }, 200);
  };

  return (
    <div className="wimbledon-page">
      <h1>Wimbledon Match Simulator</h1>

      <div className="selectors">
        <select onChange={e => setPlayerA(players.find(p => p.name === e.target.value))}>
          <option value="">Select Player A</option>
          {players.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>

        <select onChange={e => setPlayerB(players.find(p => p.name === e.target.value))}>
          <option value="">Select Player B</option>
          {players.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
      </div>

      <div className="buttons">
        <button onClick={handleFastSimulate}>1000× Fast Simulate</button>
        <button onClick={startSlowMatch}>Slow Simulate</button>
        {pointLog.length > 0 && <button onClick={replaySlowMatch}>Replay</button>}
      </div>

      {playerA && playerB && (
        <div className="cards">
          <PlayerCard player={playerA} side="A" />
          <PlayerCard player={playerB} side="B" />
        </div>
      )}

      {/* Batch Results */}
      {batchResult && (
        <div className="batch-results">
          <div className="match-summary">
            <div className="won-box">
              <h3>Matches Won</h3>
              <p className="count green">{batchResult.setsWon[0]}</p>
              <p className="pct green">{Math.round(100*batchResult.setsWon[0]/1000)}%</p>
            </div>

            <div className="sets-lost">
              <h3>Sets Lost in Wins</h3>
              {batchResult.lostInWins[0].map((cnt,i) => (
                <div key={i} className="row">
                  <span className="label">{i}</span>
                  <div className="bar green" style={{ width: `${cnt/batchResult.maxLost*100}%` }}>{cnt}</div>
                  <div className="bar magenta" style={{ width: `${batchResult.lostInWins[1][i]/batchResult.maxLost*100}%` }}>{batchResult.lostInWins[1][i]}</div>
                </div>
              ))}
            </div>

            <div className="won-box">
              <h3>Matches Won</h3>
              <p className="count magenta">{batchResult.setsWon[1]}</p>
              <p className="pct magenta">{Math.round(100*batchResult.setsWon[1]/1000)}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Live / Recorded Points */}
      {currentPoint?.type === "point" && (
        <div className="live-point">
          <h3>Live Point</h3>
          <p>Set {currentPoint.set}</p>
          <p>Games {currentPoint.games[0]}–{currentPoint.games[1]}</p>
          <p>Points {currentPoint.points[0]}–{currentPoint.points[1]}</p>
          <p>Won by {currentPoint.winner === 0 ? currentPoint.playerA.name : currentPoint.playerB.name}</p>
        </div>
      )}

      {pointLog.length > 0 && (
        <div className="point-log">
          <h3>Point-by-Point Flow</h3>
          <ul>
            {pointLog.map((pt,i) => (
              <li key={i}>
                Set {pt.set}, {pt.games[0]}–{pt.games[1]}, {pt.points[0]}–{pt.points[1]} by {pt.winner===0?pt.playerA.name:pt.playerB.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
