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
import './USOpen.css';
import placeholderA from '../assets/players/0a.png';
import placeholderB from '../assets/players/0b.png';

const playerImgs = require.context(
  '../assets/players',
  false,
  /\.png$/
);

// Color palettes
const VS_COLORS = ['#0033A0', '#FFD700'];
const SETBAR_COLORS = ['#FFD700', '#0033A0'];

// Keys for the five rates
const STAT_KEYS = [
  ['p1', '1st Serve In'],
  ['p2', '2nd Serve In'],
  ['p3', '1st Serve Return'],
  ['p4', '2nd Serve Return'],
  ['p5', 'Volley Win']
];

export default function Wimbledon() {
  const [players, setPlayers] = useState([]);
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [statsA, setStatsA] = useState({});
  const [statsB, setStatsB] = useState({});
  const [simCount, setSimCount] = useState(1000);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchResult, setBatchResult] = useState(null);
  const batchRef = useRef({ completed: 0, total: 0 });

  // --- Load initial players ---
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
  }, []);

  // --- Seed statsA when playerA chosen ---
  useEffect(() => {
    if (!playerA) return;
    const obj = {};
    STAT_KEYS.forEach(([key]) => {
      obj[key] = (playerA[key] || 0) * 100;
    });
    setStatsA(obj);
  }, [playerA]);

  // --- Seed statsB when playerB chosen ---
  useEffect(() => {
    if (!playerB) return;
    const obj = {};
    STAT_KEYS.forEach(([key]) => {
      obj[key] = (playerB[key] || 0) * 100;
    });
    setStatsB(obj);
  }, [playerB]);

  // --- Soft-reset charts & progress when players change ---
  useEffect(() => {
    setBatchResult(null);
    setProgress(0);
  }, [playerA, playerB]);

  // --- Batch simulation driver ---
  const runBatch = (pA, pB, n) => {
    batchRef.current = { completed: 0, total: n };
    setIsRunning(true);
    setProgress(0);

    let acc = {
      matchWins: [0, 0],
      setsWon: [0, 0],
      lostInWins: [[0, 0, 0], [0, 0, 0]]
    };

    const chunkSize = 50;
    const step = () => {
      const left = batchRef.current.total - batchRef.current.completed;
      const run  = Math.min(chunkSize, left);
      const res  = simulateBatch(pA, pB, run);

      // accumulate
      acc.matchWins[0] += res.matchWins[0];
      acc.matchWins[1] += res.matchWins[1];
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

  // --- Simulate button ---
  const handleSimulate = () => {
    if (!playerA || !playerB) return showPlayerError();

    // soft-reset charts & progress
    setBatchResult(null);
    setProgress(0);

    const pA = STAT_KEYS.map(([key]) => (statsA[key] || 0) / 100);
    const pB = STAT_KEYS.map(([key]) => (statsB[key] || 0) / 100);
    runBatch(pA, pB, simCount);
  };

  // --- Reset all ---
  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setStatsA({});
    setStatsB({});
    setProgress(0);
    setIsRunning(false);
  };

  // --- Random pick ---
  const randomPick = who => {
    const idx = Math.floor(Math.random() * players.length);
    who === 'A' ? setPlayerA(players[idx]) : setPlayerB(players[idx]);
  };

  // --- Add Player flow ---
  const handleAddPlayer = async who => {
    const htmlFields = `
      <input id="swal-name" class="swal2-input" placeholder="Name">
      ${STAT_KEYS.map(([key,label]) => `
        <label style="color:#444;margin:4px 0">${label}: <span id="swal-${key}-val">50%</span></label>
        <input id="swal-${key}" type="range" min="0" max="100" value="50"
               class="swal2-range"
               oninput="document.getElementById('swal-${key}-val').innerText = this.value + '%';">
      `).join('')}
      <input type="file" id="swal-file" class="swal2-file" accept="image/*">
    `;
    const { value: form } = await Swal.fire({
      title: 'Add New Player',
      html: htmlFields,
      focusConfirm: false,
      showCancelButton: true,
      preConfirm: () => {
        const name = document.getElementById('swal-name').value;
        if (!name) {
          Swal.showValidationMessage('Name is required');
          return;
        }
        const stats = {};
        STAT_KEYS.forEach(([key]) => {
          stats[key] = +document.getElementById(`swal-${key}`).value;
        });
        const file = document.getElementById('swal-file').files[0] || null;
        return { name, stats, file };
      }
    });
    if (!form) return;

    let imageSrc = null;
    if (form.file) {
      imageSrc = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(form.file);
      });
    }

    const newId = `custom-${Date.now()}`;
    const newPlayer = {
      id: newId,
      name: form.name,
      p1: form.stats.p1 / 100,
      p2: form.stats.p2 / 100,
      p3: form.stats.p3 / 100,
      p4: form.stats.p4 / 100,
      p5: form.stats.p5 / 100,
      imageSrc,
      us_rd: 2
    };

    setPlayers(prev => [newPlayer, ...prev]);
    who === 'A' ? setPlayerA(newPlayer) : setPlayerB(newPlayer);
  };

  // --- Dropdown options (+Add Player) ---
  const buildOptions = () => [
    { value: 'add', label: '+ Add Player' },
    ...players.map(p => ({ value: p.id, label: p.name, data: p }))
  ];

  // --- Chart data ---
  const pieData = batchResult ? [
    { name: playerB.name, value: batchResult.matchWins[1] },
    { name: playerA.name, value: batchResult.matchWins[0] }
  ] : [];

  const barData = batchResult ? ['3–0','3–1','3–2'].map((lbl,i) => ({
    name: lbl,
    [playerA.name]: batchResult.lostInWins[0][i] || 0,
    [playerB.name]: batchResult.lostInWins[1][i] || 0
  })) : [];

  // --- Player card + sliders (with grey seed before name)
  const renderPlayerCard = (player, stats, setStats, placeholder, variant) => {
    const seedNum = player.us_seed != null ? player.us_seed : null;
    return (
      <div className={`player-card grass-hover ${variant} mt-2 p-3`}>
        <img
          src={player.imageSrc ?? (player.id.startsWith('custom-') ? placeholder : playerImgs(`./${player.id}.png`))}
          alt={player.name}
          className="img-fluid rounded"
        />
        <h5 className="text-white mt-2">
          {seedNum != null && (
            <span style={{ color: '#888', marginRight: '0.5rem' }}>{seedNum}</span>
          )}
          {player.name}
        </h5>
        {STAT_KEYS.map(([k,label]) => (
          <Form.Group key={k} className="mb-2">
            <Form.Label className="text-white">
              {label}: {Math.round(stats[k]||0)}%
            </Form.Label>
            <Form.Range
              min={0} max={100} step={1}
              value={stats[k]||0}
              onChange={e => setStats({ ...stats, [k]: +e.target.value })}
              disabled={isRunning}
            />
          </Form.Group>
        ))}
      </div>
    );
  };

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator</h3>
        <div className="d-flex flex-wrap justify-content-center">

          {/* Player A selector + card */}
          <div className="mx-3 text-start" style={{ minWidth:260 }}>
            <Form.Label className="text-white">Player A</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={buildOptions()}
                value={playerA ? { value: playerA.id, label: playerA.name } : null}
                onChange={opt => {
                  if (opt.value === 'add') return handleAddPlayer('A');
                  setPlayerA(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning}
                styles={{
                  option: (b,s) => ({ ...b, color: '#000', backgroundColor: s.isFocused ? '#eee' : 'white' }),
                  singleValue: b => ({ ...b, color: '#000' }),
                  control: b => ({ ...b, opacity: 1 })
                }}
              />
              <Button variant="light" className="ms-1" onClick={() => randomPick('A')} disabled={isRunning}>
                🎲
              </Button>
            </div>
            {playerA
              ? renderPlayerCard(playerA, statsA, setStatsA, placeholderA, 'player-a')
              : (
                <div className="player-card placeholder mt-2 p-3">
                  <img src={placeholderA} className="img-fluid opacity-25" alt="A" />
                  <h5 className="text-muted mt-2">Select Player A</h5>
                </div>
              )}
          </div>

          {/* Controls + Charts */}
          <div className="mx-4 text-center" style={{ minWidth:360 }}>
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
              <Button className="me-2 btn-grass" onClick={handleSimulate} disabled={isRunning}>
                {isRunning
                  ? <><Spinner animation="border" size="sm"/> Running…</>
                  : 'Simulate Matches'}
              </Button>
              <Button variant="secondary" onClick={handleReset} disabled={isRunning} className="ms-2">
                Reset
              </Button>
            </div>

            {isRunning && (
              <ProgressBar now={progress} label={`${progress}%`} variant="success" className="mb-3" />
            )}

            {batchResult && (
              <div style={{ marginBottom: '2rem' }}>
                <ResponsiveContainer width={350} height={300}>
                  <PieChart>
                    <Pie
                      data={[ { name: playerB.name, value: batchResult.matchWins[1] },
                              { name: playerA.name, value: batchResult.matchWins[0] } ]}
                      dataKey="value"
                      innerRadius={90}
                      outerRadius={100}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={4}
                      isAnimationActive={false}
                    >
                      { [0,1].map(i => <Cell key={i} fill={VS_COLORS[i]} />) }
                    </Pie>
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{ color: '#fff' }}
                      payload={pieData.map((entry, idx) => ({
                        value: entry.name,
                        type: 'square',
                        color: VS_COLORS[idx]      // VS_COLORS[0] for A, VS_COLORS[1] for B
                      }))}
                    />
                    <Tooltip formatter={(v,name)=>([`${v} wins`, name])}/>
                    <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#ccc" fontSize={18} fontWeight="bold">
                      <tspan x="50%" dy="-0.5em">Vs</tspan>
                      <tspan x="50%" dy="1.2em">Wins</tspan>
                    </text>
                    <text x="10%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={24} fontWeight="bold">
                      {batchResult.matchWins[0]}
                    </text>
                    <text x="90%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={24} fontWeight="bold">
                      {batchResult.matchWins[1]}
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {batchResult && <h6 className="text-white mb-2">Sets-Won Distribution</h6>}
            {batchResult && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
                <ResponsiveContainer width={350} height={200}>
                  <BarChart layout="vertical" data={ ['3–0','3–1','3–2'].map((lbl,i)=>({
                      name: lbl,
                      [playerA.name]: batchResult.lostInWins[0][i]||0,
                      [playerB.name]: batchResult.lostInWins[1][i]||0
                  })) } margin={{ top:5, right:30, bottom:40, left:20 }}>
                    <XAxis type="number" stroke="#fff" />
                    <YAxis dataKey="name" type="category" stroke="#fff" width={60} />
                    <Tooltip />
                    <Legend verticalAlign="bottom" align="center" wrapperStyle={{ color: '#fff'}} />
                    <Bar dataKey={playerA.name} fill={SETBAR_COLORS[0]} barSize={10} />
                    <Bar dataKey={playerB.name} fill={SETBAR_COLORS[1]} barSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Player B selector + card */}
          <div className="mx-3 text-start" style={{ minWidth:260 }}>
            <Form.Label className="text-white">Player B</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={buildOptions()}
                value={playerB ? { value: playerB.id, label: playerB.name } : null}
                onChange={opt => {
                  if (opt.value === 'add') return handleAddPlayer('B');
                  setPlayerB(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning}
                styles={{
                  option: (b,s) => ({ ...b, color: '#000', backgroundColor: s.isFocused ? '#eee' : 'white' }),
                  singleValue: b => ({ ...b, color: '#000' }),
                  control: b => ({ ...b, opacity: 1 })
                }}
              />
              <Button variant="light" className="ms-1" onClick={() => randomPick('B')} disabled={isRunning}>
                🎲
              </Button>
            </div>
            {playerB
              ? renderPlayerCard(playerB, statsB, setStatsB, placeholderB, 'player-b')
              : (
                <div className="player-card placeholder mt-2 p-3">
                  <img src={placeholderB} className="img-fluid opacity-25" alt="B" />
                  <h5 className="text-muted mt-2">Select Player B</h5>
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
