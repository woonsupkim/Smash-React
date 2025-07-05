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
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis
} from 'recharts';
import { simulateBatch } from '../simulator';
import './Wimbledon.css';
import placeholderA from '../assets/players/0a.png';
import placeholderB from '../assets/players/0b.png';

const playerImgs = require.context('../assets/players', false, /\.png$/);

// Color palettes
const VS_COLORS     = ['#1E88E5', '#FDD835'];
const SETBAR_COLORS = ['#1E88E5', '#FDD835'];

// Keys for the five rates
const STAT_KEYS = [
  ['p1', '1st Serve Win'],
  ['p2', '2nd Serve Win'],
  ['p3', '1st Return Win'],
  ['p4', '2nd Return Win'],
  ['p5', 'Volley Win']
];

export default function Wimbledon() {
  const [players, setPlayers]         = useState([]);
  const [playerA, setPlayerA]         = useState(null);
  const [playerB, setPlayerB]         = useState(null);
  const [statsA, setStatsA]           = useState({});
  const [statsB, setStatsB]           = useState({});
  const [simCount, setSimCount]       = useState(1000);

  const [isRunning, setIsRunning]     = useState(false);
  const [progress, setProgress]       = useState(0);
  const [batchResult, setBatchResult] = useState(null);

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

  // whenever playerA changes, seed statsA from their csv values
  useEffect(() => {
    if (!playerA) return;
    const obj = {};
    STAT_KEYS.forEach(([key]) => {
      obj[key] = Number(playerA[key]) * 100;
    });
    setStatsA(obj);
  }, [playerA]);

  // whenever playerB changes, seed statsB
  useEffect(() => {
    if (!playerB) return;
    const obj = {};
    STAT_KEYS.forEach(([key]) => {
      obj[key] = Number(playerB[key]) * 100;
    });
    setStatsB(obj);
  }, [playerB]);

  // fast batch with progress
  const runBatch = (pA, pB, n) => {
    batchRef.current = { completed: 0, total: n };
    setIsRunning(true);
    setProgress(0);

    let acc = {
      matchWins: [0,0],
      setsWon:   [0,0],
      lostInWins:[ [0,0,0],[0,0,0] ]
    };

    const chunkSize = 50;
    const step = () => {
      const left = batchRef.current.total - batchRef.current.completed;
      const run  = Math.min(chunkSize, left);
      const res  = simulateBatch(pA, pB, run);

      acc.matchWins[0] += res.matchWins[0];
      acc.matchWins[1] += res.matchWins[1];
      acc.setsWon[0]   += res.setsWon[0];
      acc.setsWon[1]   += res.setsWon[1];
      for (let i=0; i<3; i++){
        acc.lostInWins[0][i] += res.lostInWins[0][i]||0;
        acc.lostInWins[1][i] += res.lostInWins[1][i]||0;
      }

      batchRef.current.completed += run;
      setProgress(Math.round(100 * batchRef.current.completed / batchRef.current.total));

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

  // “Simulate Matches” button
  const handleSimulate = () => {
    if (!playerA || !playerB) return showPlayerError();
    // read slider stats as probabilities
    const pA = STAT_KEYS.map(([key]) => statsA[key] / 100);
    const pB = STAT_KEYS.map(([key]) => statsB[key] / 100);
    runBatch(pA, pB, simCount);
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setStatsA({});
    setStatsB({});
    setProgress(0);
    setIsRunning(false);
  };

  const randomPick = who => {
    const idx = Math.floor(Math.random() * players.length);
    who==='A' ? setPlayerA(players[idx]) : setPlayerB(players[idx]);
  };

  const opts = players.map(p => ({
    value: p.id,
    label: p.name,
    data: p
  }));

  // charts data
  const pieData = batchResult
    ? [
        { name: playerB.name, value: batchResult.matchWins[1] },
        { name: playerA.name, value: batchResult.matchWins[0] }
      ]
    : [];

  const barData = batchResult
    ? ['3–0','3–1','3–2'].map((lbl,i) => ({
        name: lbl,
        [playerA.name]: batchResult.lostInWins[0][i]||0,
        [playerB.name]: batchResult.lostInWins[1][i]||0
      }))
    : [];

  // player card + sliders
  const renderPlayerCard = (player, stats, setStats) => (
    <div className="player-card grass-hover mt-2 p-3">
      <img
        src={playerImgs(`./${player.id}.png`)}
        alt={player.name}
        className="img-fluid rounded"
      />
      <h5 className="text-white mt-2">{player.name}</h5>
      {STAT_KEYS.map(([key,label]) => (
        <Form.Group key={key} className="mb-2">
          <Form.Label className="text-white">
            {label}: {Math.round(stats[key]||0)}%
          </Form.Label>
          <Form.Range
            min={0}
            max={100}
            step={1}
            value={stats[key]||0}
            onChange={e => setStats({
              ...stats,
              [key]: +e.target.value
            })}
            disabled={isRunning}
          />
        </Form.Group>
      ))}
    </div>
  );

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator</h3>
        <div className="d-flex flex-wrap justify-content-center">

          {/* Player A */}
          <div className="mx-3 text-start" style={{ minWidth: 260 }}>
            <Form.Label className="text-white">Player A</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={opts}
                value={playerA && { value: playerA.id, label: playerA.name }}
                onChange={opt => setPlayerA(opt.data)}
                placeholder="Type to search…"
                isDisabled={isRunning}
                styles={{
                  option: (base, state) => ({
                    ...base,
                    color: '#000',
                    backgroundColor: state.isFocused ? '#eee' : 'white',
                  }),
                  singleValue: base => ({ ...base, color: '#000' }),
                  control: base => ({ ...base, opacity: 1 })
                }}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={()=>randomPick('A')}
                disabled={isRunning}
              >🎲</Button>
            </div>
            {playerA
              ? renderPlayerCard(playerA, statsA, setStatsA)
              : (
                <div className="player-card placeholder mt-2 p-3">
                  <img src={placeholderA} className="img-fluid opacity-25" alt="A"/>
                  <h5 className="text-muted mt-2">Select Player A</h5>
                </div>
              )}
          </div>

          {/* Controls & Charts */}
          <div className="mx-4 text-center" style={{ minWidth: 360 }}>
            <Form.Group controlId="simCount" className="mb-2">
              <Form.Label className="text-white">Simulations</Form.Label>
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

            <div className="mb-3">
              <Button
                className="me-2 btn-grass"
                onClick={handleSimulate}
                disabled={isRunning}
              >
                {isRunning
                  ? <><Spinner animation="border" size="sm"/> Running…</>
                  : 'Simulate Matches'}
              </Button>
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

            {/* Doughnut */}
            {batchResult && (
              <div style={{ marginBottom: '2rem' }}>
                <ResponsiveContainer width={350} height={300}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={90}
                      outerRadius={100}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={4}
                      isAnimationActive={false}
                    >
                      {pieData.map((_,i)=>
                        <Cell key={i} fill={VS_COLORS[i]} />
                      )}
                    </Pie>
                    <Legend verticalAlign="bottom" wrapperStyle={{ color:'#fff' }}/>
                    <Tooltip formatter={(v,name)=>[`${v} wins`, name]} />
                    {/* center label */}
                    <text
                      x="50%" y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#ccc"
                      fontSize={18} fontWeight="bold"
                    >
                      <tspan x="50%" dy="-0.5em">Vs</tspan>
                      <tspan x="50%" dy="1.2em">Wins</tspan>
                    </text>
                    {/* outside totals */}
                    <text
                      x="10%" y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff" fontSize={24} fontWeight="bold"
                    >
                      {batchResult.matchWins[0]}
                    </text>
                    <text
                      x="90%" y="50%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#fff" fontSize={24} fontWeight="bold"
                    >
                      {batchResult.matchWins[1]}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Bar Chart Title */}
            {batchResult && <h6 className="text-white mb-2">Sets-Won Distribution</h6>}

            {/* Horizontal Bar Chart */}
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
                    <Legend wrapperStyle={{ color:'#fff' }}/>
                    <Bar dataKey={playerA.name} fill={SETBAR_COLORS[0]} barSize={10}/>
                    <Bar dataKey={playerB.name} fill={SETBAR_COLORS[1]} barSize={10}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Player B */}
          <div className="mx-3 text-start" style={{ minWidth: 260 }}>
            <Form.Label className="text-white">Player B</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={opts}
                value={playerB && { value: playerB.id, label: playerB.name }}
                onChange={opt => setPlayerB(opt.data)}
                placeholder="Type to search…"
                isDisabled={isRunning}
                styles={{
                  option: (base, state) => ({
                    ...base,
                    color: '#000',
                    backgroundColor: state.isFocused ? '#eee' : 'white',
                  }),
                  singleValue: base => ({ ...base, color: '#000' }),
                  control: base => ({ ...base, opacity: 1 })
                }}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={()=>randomPick('B')}
                disabled={isRunning}
              >🎲</Button>
            </div>
            {playerB
              ? renderPlayerCard(playerB, statsB, setStatsB)
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
