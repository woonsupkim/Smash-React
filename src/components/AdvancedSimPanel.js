import React, { useState } from 'react';
import { Button, Form, Spinner, ProgressBar } from 'react-bootstrap';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { credibleInterval, confidenceLabel } from '../credibleInterval';
import { countryFlagUrl } from './countryFlags';
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
  getPlayerImageSrc,
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
  upsetMode,
  setUpsetMode,
  onSimulate,
  onWatchMatch,
  defaultOpen = false,
  colorA = '#0033A0',
  colorB = '#FFD700',
  colorAText = '#fff',
  colorBText = '#fff',
  simulateButtonColor,
  simulateButtonTextColor,
}) {
  const simColor = simulateButtonColor || colorA;
  const simColorText = simulateButtonTextColor || colorAText;
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
    <ul className="adv-legend">
      <li><span style={{ backgroundColor:VS_COLORS[0] }}/>{playerA.name}</li>
      <li><span style={{ backgroundColor:VS_COLORS[1] }}/>{playerB.name}</li>
    </ul>
  );

  if (!playerA || !playerB) return null;

  const showBatch = batchResult && showResults && liveLog.length === 0;
  const showWatch = liveLog.length > 0;
  const live = showWatch ? deriveLiveScoreboardState(liveLog) : null;

  return (
    <div className="advanced-sim-panel mt-4">
      <Button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="advanced-toggle"
      >
        {open ? '▾ Hide Advanced Controls' : '▸ Advanced Controls'}
      </Button>

      {open && (
        <div className="advanced-panel-card mt-3">
          <div className="adv-header">
            <div className="adv-player-col">
              <img src={getPlayerImageSrc(playerA)} alt={playerA.name} className="adv-player-photo" />
              <div className="adv-player-name">
                {countryFlagUrl(playerA.country) && <img src={countryFlagUrl(playerA.country)} alt={playerA.country} className="adv-player-flag" />}
                {playerA.name}
              </div>
              <div className="adv-player-meta">
                {playerA.us_seed != null && playerA.us_seed !== '' && <span>Rank {playerA.us_seed}</span>}
                {playerA.age && <span> &middot; Age {playerA.age}</span>}
              </div>
            </div>

            <div className="adv-controls-col">
              <Form.Group controlId="simCount" className="mb-2">
                <Form.Label className="text-white">Simulations</Form.Label>
                <Form.Select
                  className="dark-select"
                  value={simCount}
                  onChange={e=>setSimCount(+e.target.value)}
                  disabled={isRunning||isWatching}
                >
                  {[100,500,1000,2000].map(n=><option key={n} value={n}>{n}</option>)}
                </Form.Select>
              </Form.Group>

              <div className="advanced-button-row mb-2">
                <Button
                  style={{ background: simColor, borderColor: simColor, color: simColorText }}
                  onClick={onSimulate}
                  disabled={isRunning||isWatching}
                >
                  {isRunning
                    ? <><Spinner size="sm" animation="border"/> Running...</>
                    : 'Simulate Matches'}
                </Button>
                <Button
                  variant="outline-light"
                  style={{ borderColor: colorA, color: '#fff' }}
                  onClick={onWatchMatch}
                  disabled={isRunning||isWatching}
                >Watch Match</Button>
              </div>

              {isRunning && <ProgressBar now={progress} label={`${progress}%`} variant="success" className="mb-2"/>}
            </div>

            <div className="adv-player-col">
              <img src={getPlayerImageSrc(playerB)} alt={playerB.name} className="adv-player-photo" />
              <div className="adv-player-name">
                {countryFlagUrl(playerB.country) && <img src={countryFlagUrl(playerB.country)} alt={playerB.country} className="adv-player-flag" />}
                {playerB.name}
              </div>
              <div className="adv-player-meta">
                {playerB.us_seed != null && playerB.us_seed !== '' && <span>Rank {playerB.us_seed}</span>}
                {playerB.age && <span> &middot; Age {playerB.age}</span>}
              </div>
            </div>
          </div>

          <Form.Check
            type="switch"
            id="upset-mode-toggle"
            className="upset-toggle-switch"
            label="Upset Scenario"
            checked={upsetMode}
            onChange={() => setUpsetMode(v => !v)}
            disabled={isRunning||isWatching}
          />

          <AnimatePresence>
            {showBatch && (
              <motion.div
                className="adv-results-row"
                initial={{ opacity:0 }}
                animate={{ opacity:1 }}
                exit={{ opacity:0 }}
                transition={{ duration:0.4 }}
              >
                <div className="adv-pie-col">
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        innerRadius={55}
                        outerRadius={65}
                        startAngle={90}
                        endAngle={450}
                        paddingAngle={4}
                        isAnimationActive
                      >
                        {pieData.map((_,i)=><Cell key={i} fill={VS_COLORS[i]}/>)}
                      </Pie>
                      <RechartTooltip formatter={(v,n)=>([`${v} wins`,n])}/>
                      <text
                        x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
                        fill="#ccc" fontSize={13} fontWeight="bold"
                      >
                        WIN %
                      </text>
                      <text
                        x="8%" y="50%" textAnchor="middle" dominantBaseline="middle"
                        fill={VS_COLORS[0]} fontSize={16} fontWeight="bold"
                      >
                        {pct(batchResult.matchWins[0])}%
                      </text>
                      <text
                        x="92%" y="50%" textAnchor="middle" dominantBaseline="middle"
                        fill={VS_COLORS[1]} fontSize={16} fontWeight="bold"
                      >
                        {pct(batchResult.matchWins[1])}%
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                  {(() => {
                    const { lower, upper } = credibleInterval(batchResult.matchWins[0], batchResult.matchWins[1]);
                    const favProb = favoredWins / totalWins;
                    const [favLower, favUpper] = favoredIdx === 0 ? [lower, upper] : [1 - upper, 1 - lower];
                    return (
                      <div className="adv-ci-caption">
                        <div className="adv-ci-range">
                          <span>95% CI: {Math.round(lower*100)}–{Math.round(upper*100)}%</span>
                          <span>95% CI: {Math.round((1-upper)*100)}–{Math.round((1-lower)*100)}%</span>
                        </div>
                        {confidenceLabel(favProb, favLower, favUpper)}
                        {underdogCompetitiveness && (
                          <div className="adv-underdog-caption">
                            {underdogCompetitiveness.name} takes a set {underdogCompetitiveness.pct}% of their losses
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="adv-bar-col">
                  {mostLikelyScoreline && (
                    <div className="adv-scoreline-caption">
                      Most likely: <strong>{favoredName}</strong> wins <strong>{mostLikelyScoreline.scoreline}</strong> ({mostLikelyScoreline.pct}%)
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart layout="vertical" data={barData} margin={{ top:0, right:10, bottom:0, left:0 }}>
                      <XAxis type="number" stroke="#999" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" stroke="#999" width={36} tick={{ fontSize: 10 }} />
                      <RechartTooltip/>
                      <Bar dataKey={playerA.name} fill={SETBAR_COLORS[1]} stroke="#fff" strokeWidth={1} barSize={9}/>
                      <Bar dataKey={playerB.name} fill={SETBAR_COLORS[0]} stroke="#fff" strokeWidth={1} barSize={9}/>
                    </BarChart>
                  </ResponsiveContainer>
                  {renderFixedLegend()}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {showWatch && (
            <div className="watch-match-board">
              <h6 className="text-white mb-2">Live Match {isWatching && '(playing...)'}</h6>
              <Scoreboard
                nameA={playerA.name}
                nameB={playerB.name}
                countryA={playerA.country}
                countryB={playerB.country}
                completedSets={live.completedSets}
                liveGames={live.liveGames}
                livePoints={live.livePoints}
                isTiebreak={live.isTiebreak}
                winner={live.winner}
              />
            </div>
          )}

          <div className="adv-sliders-row">
            <div className="sim-col">
              {STAT_KEYS.map(([k,label],i)=>(
                <motion.div
                  key={k}
                  className="mb-2"
                  initial={{ x:-20, opacity:0 }}
                  animate={{ x:0, opacity:1 }}
                  transition={{ delay:0.05+i*0.03, duration:0.25 }}
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
            <div className="sim-col">
              {STAT_KEYS.map(([k,label],i)=>(
                <motion.div
                  key={k}
                  className="mb-2"
                  initial={{ x:20, opacity:0 }}
                  animate={{ x:0, opacity:1 }}
                  transition={{ delay:0.05+i*0.03, duration:0.25 }}
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
