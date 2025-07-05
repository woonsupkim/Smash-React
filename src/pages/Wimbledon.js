// src/pages/Wimbledon.js
import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import Swal from 'sweetalert2';
import {
  Button,
  Form,
  Spinner,
  ProgressBar
} from 'react-bootstrap';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LabelList,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis
} from 'recharts';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import './Wimbledon.css';
import placeholderA from '../assets/players/0a.png';
import placeholderB from '../assets/players/0b.png';

const playerImgs = require.context('../assets/players', false, /\.png$/);

// Color palettes
const VS_COLORS     = ['#1E88E5', '#FDD835'];
const SETBAR_COLORS = ['#1E88E5', '#FDD835'];

export default function Wimbledon() {
  const [players, setPlayers]         = useState([]);
  const [playerA, setPlayerA]         = useState(null);
  const [playerB, setPlayerB]         = useState(null);
  const [simCount, setSimCount]       = useState(1000);

  const [isRunning, setIsRunning]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [batchResult, setBatchResult] = useState(null);

  const [pointGen, setPointGen]       = useState(null);
  const [pointLog, setPointLog]       = useState([]);

  const batchRef = useRef({ completed: 0, total: 0 });

  // 1) load players once
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
  }, []);

  // 2) stepwise slow sim
  useEffect(() => {
    if (!pointGen) return;
    const timer = setInterval(() => {
      const { value, done } = pointGen.next();
      if (done) {
        clearInterval(timer);
        setIsRunning(false);
      } else {
        setPointLog(log => [...log, value]);
      }
    }, 20);
    return () => clearInterval(timer);
  }, [pointGen]);

  // 3) fast batch with progress
  const runBatch = (pA, pB, n) => {
    batchRef.current = { completed: 0, total: n };
    setIsRunning(true);
    setProgress(0);

    let acc = {
      matchWins: [0, 0],
      setsWon:   [0, 0],
      lostInWins:[ [0,0,0], [0,0,0] ]
    };

    const chunkSize = 50;
    const step = () => {
      const left = batchRef.current.total - batchRef.current.completed;
      const run  = Math.min(chunkSize, left);
      const res  = simulateBatch(pA, pB, run);

      for (let i = 0; i < 2; i++) {
        acc.matchWins[i] += res.matchWins[i];
        acc.setsWon[i]   += res.setsWon[i];
      }
      for (let i = 0; i < 3; i++) {
        acc.lostInWins[0][i] += res.lostInWins[0][i] || 0;
        acc.lostInWins[1][i] += res.lostInWins[1][i] || 0;
      }

      batchRef.current.completed += run;
      setProgress(
        Math.round(100 * batchRef.current.completed / batchRef.current.total)
      );

      if (batchRef.current.completed < batchRef.current.total) {
        setTimeout(step, 10);
      } else {
        setBatchResult(acc);
        setIsRunning(false);
      }
    };

    step();
  };

  const showPlayerError = () => {
    Swal.fire({
      icon: 'error',
      title: 'No Players Selected',
      text: 'Please pick both Player A and Player B!',
      confirmButtonColor: '#3085d6'
    });
  };

  const handleFast = () => {
    if (!playerA || !playerB) return showPlayerError();
    const pA = [playerA.p1,playerA.p2,playerA.p3,playerA.p4,playerA.p5].map(Number);
    const pB = [playerB.p1,playerB.p2,playerB.p3,playerB.p4,playerB.p5].map(Number);
    runBatch(pA, pB, simCount);
    setPointLog([]); 
    setPointGen(null);
  };

  const handleSlow = () => {
    if (!playerA || !playerB) return showPlayerError();
    const pA = [playerA.p1,playerA.p2,playerA.p3,playerA.p4,playerA.p5].map(Number);
    const pB = [playerB.p1,playerB.p2,playerB.p3,playerB.p4,playerB.p5].map(Number);
    setBatchResult(null);
    setPointLog([]);
    setPointGen(simulateMatchStepwise(pA, pB));
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setPointGen(null);
    setPointLog([]);
    setProgress(0);
    setIsRunning(false);
  };

  const randomPick = who => {
    const pick = players[Math.floor(Math.random() * players.length)];
    who === 'A' ? setPlayerA(pick) : setPlayerB(pick);
  };

  const opts = players.map(p => ({ value: p.id, label: p.name, data: p }));

  // chart data
  const pieData = batchResult
    ? [
        { name: playerB.name, value: batchResult.matchWins[1] },
        { name: playerA.name, value: batchResult.matchWins[0] }
      ]
    : [];

  const barData = batchResult
    ? ['3–0','3–1','3–2'].map((lbl,i) => ({
        name: lbl,
        [playerA.name]: batchResult.lostInWins[0][i] || 0,
        [playerB.name]: batchResult.lostInWins[1][i] || 0
      }))
    : [];

  // old style stat bars
  const renderProgress = (label, pct) => (
    <div className="text-start text-white mb-2">
      <strong>{label}</strong>
      <ProgressBar
        now={pct}
        label={`${Math.round(pct)}%`}
        variant="success"
        style={{ backgroundColor: 'rgba(0,0,0,0.2)' }}
      />
    </div>
  );
  const renderPlayerCard = player => (
    <div className="player-card grass-hover mt-2 p-3">
      <img
        src={playerImgs(`./${player.id}.png`)}
        alt={player.name}
        className="img-fluid rounded"
      />
      <h5 className="text-white mt-2">{player.name}</h5>
      {renderProgress('1st Serve In',  player.p1 * 100)}
      {renderProgress('2nd Serve In',  player.p2 * 100)}
      {renderProgress('1st Return In', player.p3 * 100)}
      {renderProgress('2nd Return In', player.p4 * 100)}
      {renderProgress('Volley Win',     player.p5 * 100)}
    </div>
  );

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator</h3>
        <div className="d-flex flex-wrap justify-content-center">

          {/* Player A */}
          <div className="mx-3 text-start">
            <Form.Label className="text-white">Player A</Form.Label>
            <div className="d-flex">
              <Select
                className="react-select w-75"
                options={opts}
                value={playerA && { value: playerA.id, label: playerA.name }}
                onChange={opt => setPlayerA(opt.data)}
                placeholder="Type to search…"
                isDisabled={isRunning}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={() => randomPick('A')}
                disabled={isRunning}
              >🎲</Button>
            </div>
            {playerA
              ? renderPlayerCard(playerA)
              : (
                <div className="player-card placeholder mt-2 p-3">
                  <img src={placeholderA} className="img-fluid opacity-25" alt="A"/>
                  <h5 className="text-muted mt-2">Select Player A</h5>
                </div>
              )}
          </div>

          {/* Controls & Charts */}
          <div className="mx-4 text-center">
            <Form.Group controlId="simCount" className="mb-2">
              <Form.Label className="text-white">Simulations</Form.Label>
              <Form.Select
                value={simCount}
                onChange={e => setSimCount(+e.target.value)}
                disabled={isRunning}
              >
                {[100,500,1000,2000].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <div className="mb-3">
              <Button
                className="me-2 btn-grass"
                onClick={handleFast}
                disabled={isRunning}
              >{isRunning
                ? <><Spinner animation="border" size="sm"/> Running…</>
                : 'Fast'}
              </Button>
              <Button
                variant="outline-light"
                onClick={handleSlow}
                disabled={isRunning}
              >Slow</Button>
              <Button
                variant="secondary"
                className="ms-2"
                onClick={handleReset}
                disabled={isRunning}
              >Reset</Button>
            </div>

            {isRunning && (
              <ProgressBar
                now={progress}
                label={`${progress}%`}
                variant="success"
                className="mb-3"
              />
            )}

            {/* 1) Doughnut with counts outside & centered text */}
            {batchResult && (
              <div style={{ marginBottom: '2rem' }}>
                <ResponsiveContainer width={350} height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={60}
                      outerRadius={100}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={4}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={VS_COLORS[i]} />
                      ))}
                      {/* show raw counts outside each slice */}
                      <LabelList
                        dataKey="value"
                        position="outside"
                        formatter={v => v}
                        fill="#fff"
                        fontSize={14}
                      />
                    </Pie>
                    <Tooltip
                      formatter={(value,name) => [`${value} wins`, name]}
                      wrapperStyle={{ color:'#fff' }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{ color:'#fff' }}
                    />

                    {/* center text “Vs Wins” */}
                    <text
                      x="50%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#ccc"
                      fontSize={18}
                      fontWeight="bold"
                    >
                      Vs Wins
                    </text>

                    {/* Player A’s total on left */}
                    <text
                      x="25%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff"
                      fontSize={20}
                      fontWeight="bold"
                    >
                      {batchResult.matchWins[0]}
                    </text>

                    {/* Player B’s total on right */}
                    <text
                      x="75%"
                      y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff"
                      fontSize={20}
                      fontWeight="bold"
                    >
                      {batchResult.matchWins[1]}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 2) Horizontal bar chart */}
            {batchResult && (
              <div style={{ marginLeft: '3rem' }}>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart
                    layout="vertical"
                    data={barData}
                    margin={{ top:5, right:30, left:30, bottom:5 }}
                  >
                    <XAxis type="number" stroke="#fff" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="#fff"
                      width={60}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ color:'#fff' }} />
                    <Bar dataKey={playerA.name} fill={SETBAR_COLORS[0]} barSize={10}/>
                    <Bar dataKey={playerB.name} fill={SETBAR_COLORS[1]} barSize={10}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Player B */}
          <div className="mx-3 text-start">
            <Form.Label className="text-white">Player B</Form.Label>
            <div className="d-flex">
              <Select
                className="react-select w-75"
                options={opts}
                value={playerB && { value: playerB.id, label: playerB.name }}
                onChange={opt => setPlayerB(opt.data)}
                placeholder="Type to search…"
                isDisabled={isRunning}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={() => randomPick('B')}
                disabled={isRunning}
              >🎲</Button>
            </div>
            {playerB
              ? renderPlayerCard(playerB)
              : (
                <div className="player-card placeholder mt-2 p-3">
                  <img src={placeholderB} className="img-fluid opacity-25" alt="B"/>
                  <h5 className="text-muted mt-2">Select Player B</h5>
                </div>
              )}
          </div>

        </div>
      </div>
    </div>
  );
}
