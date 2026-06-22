import React, { useState } from 'react';
import { Button, Form, Spinner, ProgressBar } from 'react-bootstrap';
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
import { credibleInterval, confidenceLabel } from '../credibleInterval';
import Scoreboard, { deriveLiveScoreboardState } from './Scoreboard';
import './AdvancedSimPanel.css';

export const STAT_KEYS = [
  ['p1', '1st Serve In'],
  ['p2', '2nd Serve In'],
  ['p3', '1st Serve Return'],
  ['p4', '2nd Serve Return'],
  ['p5', 'Volley Win'],
  ['p6', 'Ace Rate']
];

/**
 * Detailed slider/chart panel, collapsed by default under the MatchHero.
 * All simulation logic/state lives in the page (USOpen/FrenchOpen/Wimbledon)
 * and is passed in as props — this component is purely presentational.
 * Only one result view shows at a time: a batch "Simulate Matches" run
 * clears any in-progress Watch Match state, and vice versa (enforced by the
 * page-level handlers that own batchResult/liveLog).
 */
export default function AdvancedSimPanel({
  playerA,
  playerB,
  statsA,
  setStatsA,
  statsB,
  setStatsB,
  simCount,
  setSimCount,
  isRunning,
  progress,
  batchResult,
  showResults,
  liveLog,
  isWatching,
  onSimulate,
  onUpsetScenario,
  onWatchMatch,
  defaultOpen = false,
  colorA = '#0033A0',
  colorB = '#FFD700',
}) {
  const [open, setOpen] = useState(defaultOpen);
  const VS_COLORS = [colorA, colorB];
  const SETBAR_COLORS = [colorB, colorA];

  const pieData = batchResult
    ? [
        { name: playerA.name, value: batchResult.matchWins[0] },
        { name: playerB.name, value: batchResult.matchWins[1] }
      ]
    : [];

  const totalWins = batchResult ? (batchResult.matchWins[0] + batchResult.matchWins[1]) : 0;
  const pct = v => totalWins ? Math.round((v / totalWins) * 100) : 0;

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
        <span style={{ width:12, height:12, backgroundColor:VS_COLORS[0], marginRight:6 }}/>
        {playerA.name}
      </li>
      <li style={{ margin:'0 1em', display:'flex', alignItems:'center' }}>
        <span style={{ width:12, height:12, backgroundColor:VS_COLORS[1], marginRight:6 }}/>
        {playerB.name}
      </li>
    </ul>
  );

  if (!playerA || !playerB) return null;

  const showBatch = batchResult && showResults && liveLog.length === 0;
  const showWatch = liveLog.length > 0;
  const live = showWatch ? deriveLiveScoreboardState(liveLog) : null;

  return (
    <div className="advanced-sim-panel mt-4">
      <Button
        variant="outline-light"
        size="sm"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="advanced-toggle"
      >
        {open ? '▾ Hide Advanced Controls' : '▸ Advanced Controls (sliders, charts, upset scenario, watch match)'}
      </Button>

      {open && (
        <div className="advanced-panel-card mt-3">
          <div className="d-flex flex-wrap justify-content-center">
            {/* Player A sliders */}
            <div className="mx-3 text-start sim-col">
              <h6 className="text-white">{playerA.name}</h6>
              {STAT_KEYS.map(([k,label],i)=>(
                <motion.div
                  key={k}
                  className="mb-2"
                  initial={{ x:-30, opacity:0 }}
                  animate={{ x:0, opacity:1 }}
                  transition={{ delay:0.1+i*0.05, duration:0.3 }}
                >
                  <Form.Label className="text-white">
                    {label}: {Math.round(statsA[k]||0)}%
                  </Form.Label>
                  <Form.Range
                    min={0} max={100}
                    value={statsA[k]||0}
                    onChange={e => setStatsA({ ...statsA, [k]: +e.target.value })}
                    disabled={isRunning||isWatching}
                  />
                </motion.div>
              ))}
            </div>

            {/* Controls & Charts */}
            <div className="mx-4 text-center sim-col-controls">
              <Form.Group controlId="simCount" className="mb-3">
                <Form.Label className="text-white">Simulations</Form.Label>
                <Form.Select
                  value={simCount}
                  onChange={e=>setSimCount(+e.target.value)}
                  disabled={isRunning||isWatching}
                >
                  {[100,500,1000,2000].map(n=><option key={n} value={n}>{n}</option>)}
                </Form.Select>
              </Form.Group>

              <div className="advanced-button-row mb-3">
                <Button
                  className="btn-grass"
                  onClick={onSimulate}
                  disabled={isRunning||isWatching}
                >
                  {isRunning
                    ? <><Spinner size="sm" animation="border"/> Running…</>
                    : 'Simulate Matches'}
                </Button>
                <Button
                  variant="outline-light"
                  onClick={onWatchMatch}
                  disabled={isRunning||isWatching}
                >🎾 Watch Match</Button>
                <Button
                  variant="warning"
                  onClick={onUpsetScenario}
                  disabled={isRunning||isWatching}
                >⚡ Upset Scenario</Button>
              </div>

              {isRunning && <ProgressBar now={progress} label={`${progress}%`} variant="success" className="mb-3"/>}

              <AnimatePresence>
                {showBatch && (
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

              <AnimatePresence>
                {showBatch && (
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

              {showWatch && (
                <div className="watch-match-board mt-3">
                  <h6 className="text-white">Live Match {isWatching && '(playing...)'}</h6>
                  <Scoreboard
                    nameA={playerA.name}
                    nameB={playerB.name}
                    completedSets={live.completedSets}
                    liveGames={live.liveGames}
                    livePoints={live.livePoints}
                    isTiebreak={live.isTiebreak}
                    winner={live.winner}
                  />
                </div>
              )}
            </div>

            {/* Player B sliders */}
            <div className="mx-3 text-start sim-col">
              <h6 className="text-white">{playerB.name}</h6>
              {STAT_KEYS.map(([k,label],i)=>(
                <motion.div
                  key={k}
                  className="mb-2"
                  initial={{ x:30, opacity:0 }}
                  animate={{ x:0, opacity:1 }}
                  transition={{ delay:0.1+i*0.05, duration:0.3 }}
                >
                  <Form.Label className="text-white">
                    {label}: {Math.round(statsB[k]||0)}%
                  </Form.Label>
                  <Form.Range
                    min={0} max={100}
                    value={statsB[k]||0}
                    onChange={e => setStatsB({ ...statsB, [k]: +e.target.value })}
                    disabled={isRunning||isWatching}
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
