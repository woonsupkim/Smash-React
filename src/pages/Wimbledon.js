// src/pages/Wimbledon.js
import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import {
  Table,
  Button,
  Spinner,
  ProgressBar,
  Form
} from 'react-bootstrap';
import Swal from 'sweetalert2';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import './Wimbledon.css';
import placeholderA from '../assets/players/0a.png';
import placeholderB from '../assets/players/0b.png';

const COLORS = ['#8BC34A', '#E91E63'];  // grass-green & magenta

export default function Wimbledon() {
  const [players, setPlayers] = useState([]);
  const [opts, setOpts] = useState([]);
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [simCount, setSimCount] = useState(1000);

  const [batchResult, setBatchResult] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // load players once
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const roster = data.filter(r => +r.us_rd === 2);
        setPlayers(roster);
        setOpts(roster.map(p => ({ value: p.id, label: p.name, data: p })));
      }
    });
  }, []);

  const showError = () => Swal.fire({
    icon: 'error',
    title: 'Missing player',
    text: 'Please select both Player A and Player B before simulating.',
    confirmButtonColor: '#3085d6'
  });

  // run a fast batch with spinner & fake progress
  const handleFast = () => {
    if (!playerA || !playerB) return showError();

    setIsRunning(true);
    setProgress(0);

    // fake progress bar for UX
    const tick = setInterval(() => setProgress(p => Math.min(100, p + 5)), 100);

    setTimeout(() => {
      const pA = [playerA.p1, playerA.p2, playerA.p3, playerA.p4, playerA.p5].map(Number);
      const pB = [playerB.p1, playerB.p2, playerB.p3, playerB.p4, playerB.p5].map(Number);
      const result = simulateBatch(pA, pB, simCount);
      clearInterval(tick);
      setProgress(100);
      setBatchResult(result);
      setIsRunning(false);
    }, 200 + simCount * 0.5); // adjust as needed
  };

  // slow sim generator (unchanged)
  const handleSlow = () => {
    if (!playerA || !playerB) return showError();
    // ... your existing slow-sim code goes here ...
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setProgress(0);
  };

  // Random pick helper
  const randomPick = side => {
    const pool = players.filter(p => (side === 'A' ? p.id !== playerB?.id : p.id !== playerA?.id));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    side === 'A' ? setPlayerA(pick) : setPlayerB(pick);
  };

  // prepare pie data
  const pieData = batchResult ? [
    { name: playerA.name, value: batchResult.matchWins[0] },
    { name: playerB.name, value: batchResult.matchWins[1] }
  ] : [];

  // prepare bar data
  const lostLabels = ['3–0', '3–1', '3–2'];
  const barData = batchResult ? lostLabels.map((lbl,i) => ({
    name: lbl,
    [playerA.name]: batchResult.lostInWins[0][i] || 0,
    [playerB.name]: batchResult.lostInWins[1][i] || 0
  })) : [];

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator</h3>

        <div className="d-flex justify-content-center mb-3 flex-wrap">

          {/* Player A select */}
          <div className="mx-2">
            <label className="text-white">Player A</label>
            <div className="d-flex">
              <Select
                className="w-75"
                options={opts}
                value={playerA && { value: playerA.id, label: playerA.name }}
                onChange={opt => setPlayerA(opt.data)}
                isDisabled={isRunning}
                placeholder="Type to search..."
              />
              <Button
                className="ms-1"
                variant="light"
                disabled={isRunning}
                onClick={() => randomPick('A')}
                title="Random"
              >🎲</Button>
            </div>
            {playerA
              ? <img src={require(`../assets/players/${playerA.id}.png`)} alt="" className="player-card"/>
              : <img src={placeholderA} alt="" className="player-card placeholder"/>}
          </div>

          {/* Controls */}
          <div className="mx-4 text-start">
            <Form.Group className="mb-2 text-white">
              <Form.Label>Simulations</Form.Label>
              <Form.Select
                value={simCount}
                onChange={e => setSimCount(+e.target.value)}
                disabled={isRunning}
              >
                {[100,500,1000,2000].map(n =>
                  <option key={n} value={n}>{n}</option>
                )}
              </Form.Select>
            </Form.Group>

            <div className="mb-2">
              <Button
                className="me-2 btn-grass"
                onClick={handleFast}
                disabled={isRunning}
              >
                {isRunning ? <><Spinner animation="border" size="sm"/> Fast</> : 'Fast'}
              </Button>
              <Button
                variant="outline-light"
                onClick={handleReset}
                disabled={isRunning}
              >Reset</Button>
            </div>

            {isRunning && (
              <ProgressBar now={progress} label={`${progress}%`} className="mb-3"/>
            )}

            {/* Pie chart */}
            {batchResult && (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    label
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={COLORS[i]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            )}

            {/* Bar chart */}
            {batchResult && (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} margin={{ top: 20, bottom: 20 }}>
                  <XAxis dataKey="name" stroke="#fff"/>
                  <YAxis stroke="#fff"/>
                  <Tooltip/>
                  <Legend wrapperStyle={{ color: '#fff' }}/>
                  <Bar dataKey={playerA?.name} fill={COLORS[0]} />
                  <Bar dataKey={playerB?.name} fill={COLORS[1]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Player B select */}
          <div className="mx-2">
            <label className="text-white">Player B</label>
            <div className="d-flex">
              <Select
                className="w-75"
                options={opts}
                value={playerB && { value: playerB.id, label: playerB.name }}
                onChange={opt => setPlayerB(opt.data)}
                isDisabled={isRunning}
                placeholder="Type to search..."
              />
              <Button
                className="ms-1"
                variant="light"
                disabled={isRunning}
                onClick={() => randomPick('B')}
                title="Random"
              >🎲</Button>
            </div>
            {playerB
              ? <img src={require(`../assets/players/${playerB.id}.png`)} alt="" className="player-card"/>
              : <img src={placeholderB} alt="" className="player-card placeholder"/>}
          </div>
        </div>
      </div>
    </div>
  );
}
