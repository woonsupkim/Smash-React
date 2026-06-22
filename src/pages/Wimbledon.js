// src/pages/Wimbledon.js

import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import Swal from 'sweetalert2';
import {
  Button,
  Form,
  Spinner,
  ProgressBar,
  OverlayTrigger,
  Tooltip
} from 'react-bootstrap';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip as RechartTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import { credibleInterval, confidenceLabel } from '../credibleInterval';
import './Wimbledon.css';

const playerImgs = require.context(
  '../assets/players',
  false,
  /\.png$/
);

const CLAY_COLOR  = '#3A1C71';
const GREEN_COLOR = '#009B5D';
const VS_COLORS     = ['#3A1C71', '#009B5D'];
const SETBAR_COLORS = ['#009B5D', '#3A1C71'];

const STAT_KEYS = [
  ['p1', '1st Serve In'],
  ['p2', '2nd Serve In'],
  ['p3', '1st Serve Return'],
  ['p4', '2nd Serve Return'],
  ['p5', 'Volley Win'],
  ['p6', 'Ace Rate']
];

const Flowchart = () => (
  <div className="flowchart">
    <div className="step"><strong>1.</strong> Simulate Point</div>
    <div className="arrow">→</div>
    <div className="step"><strong>2.</strong> Resolve Game</div>
    <div className="arrow">→</div>
    <div className="step"><strong>3.</strong> Resolve Set</div>
    <div className="arrow">→</div>
    <div className="step"><strong>4.</strong> Resolve Match</div>
    <div className="loop-container">
      <div className="loop-arrow">⟲</div>
      <div className="loop-label">Repeat N times</div>
      <div className="loop-note">Aggregate results</div>
    </div>
  </div>
);

export default function Wimbledon() {
  // --- state ---
  const [players, setPlayers]             = useState([]);
  const [playerA, setPlayerA]             = useState(null);
  const [playerB, setPlayerB]             = useState(null);
  const [statsA, setStatsA]               = useState({});
  const [statsB, setStatsB]               = useState({});
  const [simCount, setSimCount]           = useState(1000);
  const [isRunning, setIsRunning]         = useState(false);
  const [progress, setProgress]           = useState(0);
  const [batchResult, setBatchResult]     = useState(null);
  const [showResults, setShowResults]     = useState(false);
  const [liveLog, setLiveLog]             = useState([]);
  const [isWatching, setIsWatching]       = useState(false);
  const batchRef                          = useRef({ completed: 0, total: 0 });
  const watchTimeoutRef = useRef(null);
  const commentaryRef = useRef(null);

  // --- load players CSV ---
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_wb.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
  }, []);

  // --- seed stats ---
  useEffect(() => {
    if (!playerA) return;
    const obj = {};
    STAT_KEYS.forEach(([k]) => obj[k] = (playerA[k] || 0) * 100);
    setStatsA(obj);
  }, [playerA]);

  useEffect(() => {
    if (!playerB) return;
    const obj = {};
    STAT_KEYS.forEach(([k]) => obj[k] = (playerB[k] || 0) * 100);
    setStatsB(obj);
  }, [playerB]);

  // stop the watch-match playback loop if the component unmounts mid-match
  useEffect(() => {
    return () => { if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current); };
  }, []);

  // keep the live commentary box scrolled to the newest point as it streams in
  useEffect(() => {
    if (commentaryRef.current) commentaryRef.current.scrollTop = commentaryRef.current.scrollHeight;
  }, [liveLog]);

  // --- reveal charts delay ---
  useEffect(() => {
    if (!batchResult) return;
    setShowResults(false);
    const tid = setTimeout(() => setShowResults(true), 500);
    return () => clearTimeout(tid);
  }, [batchResult]);

  // --- Add Player flow ---
  const handleAddPlayer = async who => {
    const htmlFields = `
      <input id="swal-name" class="swal2-input" placeholder="Name">
      ${STAT_KEYS.map(
        ([key,label]) => `
          <label style="color:#444;margin:4px 0">${label}: <span id="swal-${key}-val">50%</span></label>
          <input id="swal-${key}" type="range" min="0" max="100" value="50"
            class="swal2-range"
            oninput="document.getElementById('swal-${key}-val').innerText = this.value + '%';">
        `
      ).join('')}
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
      p6: form.stats.p6 / 100,
      imageSrc,
      us_rd: 2
    };
    setPlayers(prev => [newPlayer, ...prev]);
    if (who === 'A') setPlayerA(newPlayer);
    else setPlayerB(newPlayer);
  };

  // --- batch driver ---
  const runBatch = (pA, pB, n) => {
    batchRef.current = { completed: 0, total: n };
    setIsRunning(true);
    setProgress(0);

    const acc = { matchWins: [0,0], lostInWins: [[0,0,0],[0,0,0]] };
    const chunk = 50;

    const step = () => {
      const left = batchRef.current.total - batchRef.current.completed;
      const run  = Math.min(chunk, left);
      const res  = simulateBatch(pA, pB, run);

      acc.matchWins[0] += res.matchWins[0];
      acc.matchWins[1] += res.matchWins[1];
      for (let i=0; i<3; i++) {
        acc.lostInWins[0][i] += res.lostInWins[0][i] || 0;
        acc.lostInWins[1][i] += res.lostInWins[1][i] || 0;
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

  const showPlayerError = () => Swal.fire({
    icon: 'error',
    title: 'No Players Selected',
    text: 'Please pick both Player A and Player B!',
    confirmButtonColor: '#3085d6'
  });

  // --- simulate / reset / watch ---
  const handleSimulate = () => {
    if (!playerA || !playerB) return showPlayerError();
    setBatchResult(null);
    setProgress(0);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    runBatch(pA, pB, simCount);
  };

  // Heavy-recency-weighted stats (7-day half-life, precomputed offline in
  // data-pipeline) instead of the default 60-day-calibrated CSV — surfaces
  // hot/cold recent form rather than season-long averages.
  const handleUpsetScenario = () => {
    if (!playerA || !playerB) return showPlayerError();
    setBatchResult(null);
    setProgress(0);
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_wb_upset.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const rowA = data.find(r => r.id === playerA.id);
        const rowB = data.find(r => r.id === playerB.id);
        if (!rowA || !rowB) {
          Swal.fire({
            icon: 'info',
            title: 'Not enough recent data',
            text: 'One or both players have too few recent matches on this surface for an upset scenario — try different players.'
          });
          return;
        }
        const pA = STAT_KEYS.map(([k]) => Number(rowA[k]) || 0);
        const pB = STAT_KEYS.map(([k]) => Number(rowB[k]) || 0);
        runBatch(pA, pB, simCount);
      }
    });
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setStatsA({});
    setStatsB({});
    setProgress(0);
    setIsRunning(false);
    setLiveLog([]);
    setIsWatching(false);
  };

  const randomPick = who => {
    const idx = Math.floor(Math.random() * players.length);
    who === 'A' ? setPlayerA(players[idx]) : setPlayerB(players[idx]);
  };

  const handleWatchMatch = () => {
    if (!playerA || !playerB) return showPlayerError();
    if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    const gen = simulateMatchStepwise(pA, pB, { A: playerA, B: playerB });

    setLiveLog([]);
    setIsWatching(true);
    const advance = () => {
      const { value, done } = gen.next();
      if (done) { watchTimeoutRef.current = null; return setIsWatching(false); }
      setLiveLog(prev => [...prev, value]);
      watchTimeoutRef.current = setTimeout(advance, 400);
    };
    advance();
  };

  // --- tennis scoring helper & event renderer ---
  const tennisPointLabel = (a,b) => {
    const labels = ['Love','15','30','40'];
    if (a>=3 && b>=3) {
      if (a===b)                  return 'Deuce';
      else if (a===b+1)          return `Advantage ${playerA.name}`;
      else if (b===a+1)          return `Advantage ${playerB.name}`;
    }
    return `${labels[a]||'40'}-${labels[b]||'40'}`;
  };

  const renderEvent = ev => {
    switch(ev.type) {
      case 'point': {
        const [pa,pb] = ev.points;
        return `🎾 ${tennisPointLabel(pa,pb)}  (Game: ${ev.games[0]}-${ev.games[1]})`;
      }
      case 'game':
        return `🟩 Game to ${ev.gameWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'tiebreak_start':
        return `⏱ Tie-break begins`;
      case 'tiebreak_end':
        return `✅ Tie-break won by ${ev.tiebreakWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'set':
        return `📦 Set ${ev.set} to ${ev.setWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'match':
        return `🏆 Match won by ${ev.winner==='A'?ev.playerA.name:ev.playerB.name}`;
      default:
        return `🔸 ${ev.type}`;
    }
  };

  // --- dropdown options + chart data + legend + player card render ---
  const buildOptions = () => [
    { value:'add', label:'+ Add Player' },
    ...players.map(p => ({ value:p.id, label:p.name, data:p }))
  ];

  const pieData = batchResult
    ? [
        { name: playerA.name, value: batchResult.matchWins[0] },
        { name: playerB.name, value: batchResult.matchWins[1] }
      ]
    : [];

  const totalWins = batchResult ? (batchResult.matchWins[0] + batchResult.matchWins[1]) : 0;
  const pct = v => totalWins ? Math.round((v / totalWins) * 100) : 0;

  // % of that player's OWN wins won by each scoreline, so the two players'
  // bars are comparable regardless of how lopsided the overall split is.
  const barData = batchResult
    ? ['3–0','3–1','3–2'].map((lbl,i)=>({
        name: lbl,
        [playerA.name]: batchResult.matchWins[0] ? Math.round((batchResult.lostInWins[0][i]||0) / batchResult.matchWins[0] * 100) : 0,
        [playerB.name]: batchResult.matchWins[1] ? Math.round((batchResult.lostInWins[1][i]||0) / batchResult.matchWins[1] * 100) : 0,
      }))
    : [];

  const favoredIdx = batchResult ? (batchResult.matchWins[0] >= batchResult.matchWins[1] ? 0 : 1) : null;
  const favoredName = favoredIdx === 0 ? playerA?.name : playerB?.name;
  const underdogName = favoredIdx === 0 ? playerB?.name : playerA?.name;
  const favoredWins = batchResult ? batchResult.matchWins[favoredIdx] : 0;

  const mostLikelyScoreline = (() => {
    if (!batchResult || !favoredWins) return null;
    const dist = batchResult.lostInWins[favoredIdx];
    let maxIdx = 0;
    for (let i = 1; i < dist.length; i++) if ((dist[i]||0) > (dist[maxIdx]||0)) maxIdx = i;
    return { scoreline: `3–${maxIdx}`, pct: Math.round((dist[maxIdx]||0) / favoredWins * 100) };
  })();

  // Suppressed when neither player is meaningfully favored — calling
  // someone the "underdog" in a true toss-up would be misleading.
  const underdogCompetitiveness = (() => {
    if (!batchResult || !totalWins) return null;
    const favoredShare = favoredWins / totalWins;
    if (Math.abs(favoredShare - 0.5) < 0.05) return null;
    const dist = batchResult.lostInWins[favoredIdx];
    const tookSet = (dist[1]||0) + (dist[2]||0);
    return { name: underdogName, pct: favoredWins ? Math.round(tookSet / favoredWins * 100) : 0 };
  })();

  const renderFixedLegend = () => (
    <ul style={{ display:'flex', justifyContent:'center', listStyle:'none', padding:0, margin:'0.5em 0', color:'#fff' }}>
      <li style={{ margin:'0 1em', display:'flex', alignItems:'center' }}>
        <span style={{ width:12, height:12, backgroundColor:CLAY_COLOR, marginRight:6 }}/>
        {playerA.name}
      </li>
      <li style={{ margin:'0 1em', display:'flex', alignItems:'center' }}>
        <span style={{ width:12, height:12, backgroundColor:GREEN_COLOR, marginRight:6 }}/>
        {playerB.name}
      </li>
    </ul>
  );

  const getPlayerImageSrc = (player) => {
    if (!player) return null;
    if (player.imageSrc) return player.imageSrc; // uploaded data URL

    // only use require.context if the PNG actually exists — calling
    // playerImgs() with an unmatched key throws synchronously and crashes
    // the page (e.g. players whose photo fetch failed/was rate-limited)
    const key = `./${player.id}.png`;
    const keys = playerImgs.keys ? playerImgs.keys() : [];
    if (keys.includes(key)) return playerImgs(key);

    // fallback to a default image in /public (add one if you don’t have it)
    return `${process.env.PUBLIC_URL}/assets/players/default.png`;
  };

  const renderPlayerCard = (player, stats, setStats, _, variant) => (
    <div className="wimbledon">
    <motion.div
      className={`player-card grass-hover ${variant} mt-2 p-3`}
      initial={{ y:20, opacity:0 }}
      animate={{ y:0, opacity:1 }}
      transition={{ duration:0.4 }}
      whileHover={{ scale:1.03, boxShadow:'0 0 12px rgba(0,0,0,0.3)' }}
    >
      <img
        src={getPlayerImageSrc(player)}
        alt={player.name}
        className="img-fluid rounded"
      />
      <h5 className="text-white mt-2">
        {player.us_seed!=null && <span style={{ color:'#888', marginRight:'0.5rem' }}>{player.us_seed}</span>}
        {player.name}
      </h5>
      {STAT_KEYS.map(([k,label],i)=>(
        <motion.div
          key={k}
          className="mb-2"
          initial={{ x:-30, opacity:0 }}
          animate={{ x:0, opacity:1 }}
          transition={{ delay:0.1+i*0.05, duration:0.3 }}
        >
          <Form.Label className="text-white">
            {label}: {Math.round(stats[k]||0)}%
          </Form.Label>
          <Form.Range
            min={0} max={100}
            value={stats[k]||0}
            onChange={e => setStats({ ...stats, [k]: +e.target.value })}
            disabled={isRunning||isWatching}
          />
        </motion.div>
      ))}
    </motion.div>
    </div>
  );

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator</h3>

        <div className="text-light mb-3">
          <OverlayTrigger
            placement="top"
            overlay={<Tooltip>Every match is simulated point-by-point via Monte Carlo</Tooltip>}
          >
            <span>ℹ️ Simulation Method</span>
          </OverlayTrigger>
          <div style={{ marginTop: '1rem' }}><Flowchart /></div>
        </div>

        <div className="d-flex flex-wrap justify-content-center">
          {/* Player A */}
          <div className="mx-3 text-start sim-col">
            <Form.Label className="text-white">Player A</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={buildOptions()}
                value={playerA?{value:playerA.id,label:playerA.name}:null}
                onChange={opt => {
                  if (opt.value==='add') handleAddPlayer('A');
                  else setPlayerA(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning||isWatching}
                styles={{
                  option: p => ({...p,color:'#000'}),
                  singleValue: p => ({...p,color:'#000'})
                }}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={()=>randomPick('A')}
                disabled={isRunning||isWatching}
              >🎲</Button>
            </div>
            {playerA
              ? renderPlayerCard(playerA, statsA, setStatsA, null, 'player-a')
              : <div className="player-card placeholder mt-2 p-3"><h5 className="text-muted">Select Player A</h5></div>
            }
          </div>

          {/* Controls & Charts */}
          <div className="mx-4 text-center sim-col-controls">
            {/* Sim count */}
            <Form.Group controlId="simCount" className="mb-2">
              <Form.Label className="text-white">Simulations</Form.Label>
              <Form.Select
                value={simCount}
                onChange={e=>setSimCount(+e.target.value)}
                disabled={isRunning||isWatching}
              >
                {[100,500,1000,2000].map(n=><option key={n} value={n}>{n}</option>)}
              </Form.Select>
            </Form.Group>

            <div className="mb-3">
              <Button
                className="me-2 btn-grass"
                onClick={handleSimulate}
                disabled={isRunning||isWatching}
              >
                {isRunning
                  ? <><Spinner size="sm" animation="border"/> Running…</>
                  : 'Simulate Matches'}
              </Button>
              <Button
                variant="outline-light"
                className="me-2"
                onClick={handleWatchMatch}
                disabled={isRunning||isWatching}
              >🎾 Watch Match</Button>
              <Button
                variant="warning"
                className="me-2"
                onClick={handleUpsetScenario}
                disabled={isRunning||isWatching}
              >⚡ Upset Scenario</Button>
              <Button
                variant="secondary"
                onClick={handleReset}
                disabled={isRunning||isWatching}
              >Reset</Button>
            </div>

            {isRunning && <ProgressBar now={progress} label={`${progress}%`} variant="success" className="mb-3"/>}

            {/* Pie Chart */}
            <AnimatePresence>
              {batchResult && showResults && (
                <motion.div
                  style={{ marginBottom:'2rem' }}
                  initial={{ scale:0.8, opacity:0 }}
                  animate={{ scale:1, opacity:1 }}
                  exit={{ scale:0.8, opacity:0 }}
                  transition={{ duration:0.5 }}
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        innerRadius={90}
                        outerRadius={100}
                        startAngle={90}
                        endAngle={450}
                        paddingAngle={4}
                        isAnimationActive
                      >
                        {pieData.map((_,i)=><Cell key={i} fill={VS_COLORS[i]}/>)}
                      </Pie>
                      <Legend content={renderFixedLegend} verticalAlign="bottom"/>
                      <RechartTooltip formatter={(v,n)=>([`${v} wins`,n])}/>
                      <text x="50%" y="45%" textAnchor="middle" dominantBaseline="middle" fill="#ccc" fontSize={18} fontWeight="bold">
                        <tspan x="50%" dy="-0.5em">Win</tspan>
                        <tspan x="50%" dy="1.2em">Percentage</tspan>
                      </text>
                      <text x="10%" y="45%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={24} fontWeight="bold">
                        {pct(batchResult.matchWins[0])}%
                      </text>
                      <text x="90%" y="45%" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={24} fontWeight="bold">
                        {pct(batchResult.matchWins[1])}%
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                  {(() => {
                    const { lower, upper } = credibleInterval(batchResult.matchWins[0], batchResult.matchWins[1]);
                    const favProb = favoredWins / totalWins;
                    const [favLower, favUpper] = favoredIdx === 0 ? [lower, upper] : [1 - upper, 1 - lower];
                    return (
                      <>
                        <div className="d-flex justify-content-between px-2" style={{ fontSize: '0.7rem', color: '#aaa', marginTop: '-0.5rem' }}>
                          <span>95% CI: {Math.round(lower*100)}–{Math.round(upper*100)}%</span>
                          <span>95% CI: {Math.round((1-upper)*100)}–{Math.round((1-lower)*100)}%</span>
                        </div>
                        <div className="text-center mt-1" style={{ fontSize: '0.75rem', color: '#ddd' }}>
                          {confidenceLabel(favProb, favLower, favUpper)}
                        </div>
                        {underdogCompetitiveness && (
                          <div className="text-center" style={{ fontSize: '0.7rem', color: '#aaa' }}>
                            Even when {underdogCompetitiveness.name} loses, they take a set {underdogCompetitiveness.pct}% of the time
                          </div>
                        )}
                      </>
                    );
                  })()}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bar Chart */}
            <AnimatePresence>
              {batchResult && showResults && (
                <motion.div
                  style={{ display:'flex', flexDirection:'column', alignItems:'center', marginBottom:'2rem' }}
                  initial={{ scale:0.8, opacity:0 }}
                  animate={{ scale:1, opacity:1 }}
                  exit={{ scale:0.8, opacity:0 }}
                  transition={{ duration:0.5, delay:0.2 }}
                >
                  {mostLikelyScoreline && (
                    <div className="mb-2" style={{ fontSize: '0.8rem', color: '#ddd' }}>
                      Most likely: <strong>{favoredName}</strong> wins <strong>{mostLikelyScoreline.scoreline}</strong> ({mostLikelyScoreline.pct}% of their wins)
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart layout="vertical" data={barData} margin={{ top:5, right:90, bottom:60, left:20 }}>
                      <XAxis type="number" stroke="#fff"/>
                      <YAxis dataKey="name" type="category" stroke="#fff" width={60}/>
                      <RechartTooltip/>
                      <Legend content={renderFixedLegend} verticalAlign="bottom"/>
                      <Bar dataKey={playerA.name} fill={SETBAR_COLORS[1]} barSize={10}/>
                      <Bar dataKey={playerB.name} fill={SETBAR_COLORS[0]} barSize={10}/>
                    </BarChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Live Commentary */}
            {liveLog.length>0 && (
              <div ref={commentaryRef} className="live-commentary text-start mt-3 px-3 text-white" style={{ maxHeight:'220px', overflowY:'auto' }}>
                <h6>Live Match Commentary {isWatching && '(playing...)'}</h6>
                {liveLog.map((ev,i)=>(
                  <motion.div key={i} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{duration:0.3}}>
                    {renderEvent(ev)}
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Player B */}
          <div className="mx-3 text-start sim-col">
            <Form.Label className="text-white">Player B</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select w-75"
                options={buildOptions()}
                value={playerB?{value:playerB.id,label:playerB.name}:null}
                onChange={opt => {
                  if (opt.value==='add') handleAddPlayer('B');
                  else setPlayerB(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning||isWatching}
                styles={{
                  option: p => ({...p,color:'#000'}),
                  singleValue: p => ({...p,color:'#000'})
                }}
              />
              <Button
                variant="light"
                className="ms-1"
                onClick={()=>randomPick('B')}
                disabled={isRunning||isWatching}
              >🎲</Button>
            </div>
            {playerB
              ? renderPlayerCard(playerB, statsB, setStatsB, null, 'player-b')
              : <div className="player-card placeholder mt-2 p-3"><h5 className="text-muted">Select Player B</h5></div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
