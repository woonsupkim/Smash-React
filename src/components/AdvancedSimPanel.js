import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Form, Spinner, ProgressBar } from 'react-bootstrap';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  LabelList
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, Download, X, Check, AlertTriangle, Zap } from 'lucide-react';
import { credibleInterval, confidenceLabel } from '../credibleInterval';
import { generateShareCard } from '../utils/generateShareCard';
import { countryFlagUrl } from './countryFlags';
import Scoreboard, { deriveLiveScoreboardState } from './Scoreboard';
import Chip from './ui/Chip';
import './AdvancedSimPanel.css';

export const STAT_KEYS = [
  ['p1', '1st Serve In'],
  ['p2', '2nd Serve In'],
  ['p3', '1st Serve Return'],
  ['p4', '2nd Serve Return'],
  ['p5', 'Volley Win'],
  ['p6', 'Ace Rate']
];

// Grouped for the slider drawer so twelve controls read as three labeled
// categories instead of one undifferentiated wall.
const STAT_LABELS = Object.fromEntries(STAT_KEYS);
const STAT_SECTIONS = [
  { label: 'Serve', keys: ['p1', 'p2', 'p6'] },
  { label: 'Return', keys: ['p3', 'p4'] },
  { label: 'Rally', keys: ['p5'] },
];

/**
 * Detailed slider/chart panel, collapsed by default under the MatchHero.
 * All simulation logic/state lives in the page (H2H.js, DreamBrackets.js)
 * and is passed in as props - this component is purely presentational.
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
  engine = 'smash',   // labels the detailed sim to match the selected engine
  engineWinProbA = null, // authoritative engine P(A wins) from the shared batch - pie/headline render this so it matches the MatchHero number exactly
  onSimulate,
  onWatchMatch,
  bestOf = 5, // 5 (ATP Grand Slam) or 3 (WTA Grand Slam)
  defaultOpen = false,
  colorA = '#0033A0',
  colorB = '#FFD700',
  colorAText = '#fff',
  colorBText = '#fff',
  simulateButtonColor,
  simulateButtonTextColor,
  tournamentLabel = '',
  surfaceLabel = '',
  surfaceKey = 'hard', // 'hard' | 'clay' | 'grass' - themes the share card
  h2hData = null,      // pairwise career head-to-head map from h2h.json
}) {
  const simColor = simulateButtonColor || colorA;
  const simColorText = simulateButtonTextColor || colorAText;
  const [shareUrl, setShareUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [slidersOpen, setSlidersOpen] = useState(false);
  const resultsRef = useRef(null);

  const handleShare = useCallback(async () => {
    if (!batchResult) return;
    setIsGenerating(true);
    try {
      const totalW = batchResult.matchWins[0] + batchResult.matchWins[1];
      const favIdx = batchResult.matchWins[0] >= batchResult.matchWins[1] ? 0 : 1;
      const favProb = totalW ? batchResult.matchWins[favIdx] / totalW : 0.5;
      const underdogProb = 1 - favProb;

      // P(underdog wins >5 of 10) via binomial
      const binom10 = (() => {
        if (underdogProb <= 0) return 0;
        const p = underdogProb, n = 10;
        let prob = 0;
        for (let k = 6; k <= n; k++) {
          let logC = 0;
          for (let i = 0; i < k; i++) logC += Math.log(n - i) - Math.log(i + 1);
          prob += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
        }
        return Math.min(prob, 1);
      })();

      // Winner's most likely scoreline, e.g. "3–1"
      const tSets = Math.ceil(bestOf / 2);
      const dist = batchResult.lostInWins[favIdx].slice(0, tSets);
      let maxI = 0;
      for (let i = 1; i < dist.length; i++) if ((dist[i] || 0) > (dist[maxI] || 0)) maxI = i;
      const scoreline = `${tSets}–${maxI}`;

      // Career head-to-head from h2h.json (same lookup as MatchHero)
      const h2hRecord = (() => {
        if (!h2hData) return null;
        const [idA, idB] = [playerA.id, playerB.id].sort();
        const rec = h2hData[`${idA}_${idB}`];
        if (!rec) return null;
        const aIsFirst = idA === playerA.id;
        return {
          winsA: aIsFirst ? rec.winsA : rec.winsB,
          winsB: aIsFirst ? rec.winsB : rec.winsA,
        };
      })();

      const canvas = await generateShareCard({
        playerA, playerB,
        winnerName: favIdx === 0 ? playerA.name : playerB.name,
        favShare: favProb,
        scoreline,
        h2hRecord,
        binom10,
        colorA, colorB,
        imageSrcA: getPlayerImageSrc(playerA),
        imageSrcB: getPlayerImageSrc(playerB),
        flagSrcA: countryFlagUrl(playerA.country),
        flagSrcB: countryFlagUrl(playerB.country),
        surfaceKey,
        tournamentLabel, surfaceLabel,
        simCount,
      });
      setShareUrl(canvas.toDataURL('image/png'));
    } finally {
      setIsGenerating(false);
    }
  }, [batchResult, playerA, playerB, colorA, colorB, getPlayerImageSrc, tournamentLabel, surfaceLabel, surfaceKey, h2hData, bestOf, simCount]);

  const handleDownload = () => {
    if (!shareUrl) return;
    const a = document.createElement('a');
    a.href = shareUrl;
    a.download = `smash-${(playerA?.name||'A').replace(/\s+/g,'-')}-vs-${(playerB?.name||'B').replace(/\s+/g,'-')}.png`;
    a.click();
  };

  const handleNativeShare = async () => {
    if (!shareUrl || !navigator.share) return;
    try {
      const blob = await (await fetch(shareUrl)).blob();
      const file = new File([blob], 'smash-prediction.png', { type: 'image/png' });
      await navigator.share({ files: [file], title: 'SMASH! Match Prediction' });
    } catch (_) { /* user cancelled */ }
  };

  const VS_COLORS = [colorA, colorB];
  const SETBAR_COLORS = [colorB, colorA];

  const totalWins = batchResult ? (batchResult.matchWins[0] + batchResult.matchWins[1]) : 0;
  const pct = v => totalWins ? Math.round((v / totalWins) * 100) : 0;

  // Headline win probability: the selected engine's number (passed from the
  // page, derived from this same batch) when available, else the raw point-sim
  // share. Rendering this in the pie keeps it identical to the MatchHero
  // headline above - no more "the top number and the pie disagree".
  const rawProbA = totalWins ? batchResult.matchWins[0] / totalWins : 0;
  const dispProbA = batchResult ? (engineWinProbA != null ? engineWinProbA : rawProbA) : 0;
  const dispPctA = Math.round(dispProbA * 100);
  const dispPctB = 100 - dispPctA;

  const pieData = batchResult
    ? [
        { name: playerA.name, value: dispPctA },
        { name: playerB.name, value: dispPctB }
      ]
    : [];

  // e.g. bestOf=5 -> targetSets=3 -> ['3–0','3–1','3–2']; bestOf=3 -> ['2–0','2–1'].
  const targetSets = Math.ceil(bestOf / 2);
  const scorelineLabels = Array.from({ length: targetSets }, (_, i) => `${targetSets}–${i}`);

  // Likelihood of each exact set outcome across ALL simulations (not just
  // conditional on that player winning) - every bar's % is out of totalWins
  // (= total completed sims), so all bars together sum to ~100%.
  const barData = batchResult
    ? scorelineLabels.map((lbl,i)=>({
        name: lbl,
        [playerA.name]: pct(batchResult.lostInWins[0][i]||0),
        [playerB.name]: pct(batchResult.lostInWins[1][i]||0),
      }))
    : [];

  const favoredIdx = batchResult ? (dispProbA >= 0.5 ? 0 : 1) : null;
  const favoredName = favoredIdx === 0 ? playerA?.name : playerB?.name;
  const underdogName = favoredIdx === 0 ? playerB?.name : playerA?.name;
  const favoredWins = batchResult ? batchResult.matchWins[favoredIdx] : 0;

  const mostLikelyScoreline = (() => {
    if (!batchResult || !favoredWins) return null;
    const dist = batchResult.lostInWins[favoredIdx].slice(0, targetSets);
    let maxIdx = 0;
    for (let i = 1; i < dist.length; i++) if ((dist[i]||0) > (dist[maxIdx]||0)) maxIdx = i;
    return { scoreline: `${targetSets}–${maxIdx}`, pct: pct(dist[maxIdx]||0) };
  })();

  const underdogCompetitiveness = (() => {
    if (!batchResult || !totalWins) return null;
    const favoredShare = favoredWins / totalWins;
    if (Math.abs(favoredShare - 0.5) < 0.05) return null;
    const dist = batchResult.lostInWins[favoredIdx];
    const tookSet = (dist[1]||0) + (dist[2]||0);
    return { name: underdogName, pct: favoredWins ? Math.round(tookSet / favoredWins * 100) : 0 };
  })();

  // Results render below the fold - bring them into view when a run lands
  const hasBatch = !!(batchResult && showResults && liveLog.length === 0);
  useEffect(() => {
    if (hasBatch && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [hasBatch]);

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
        <div className="advanced-panel-card">
          <div className="adv-panel-heading">Detailed simulation</div>
          <div className="adv-controls-col adv-controls-centered">
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

          <AnimatePresence>
            {showBatch && (
              <motion.div
                ref={resultsRef}
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
                        {pieData.map((_,i)=><Cell key={i} fill={VS_COLORS[i]} stroke="none"/>)}
                      </Pie>
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
                        {dispPctA}%
                      </text>
                      <text
                        x="92%" y="50%" textAnchor="middle" dominantBaseline="middle"
                        fill={VS_COLORS[1]} fontSize={16} fontWeight="bold"
                      >
                        {dispPctB}%
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                  {(() => {
                    const { lower, upper } = credibleInterval(batchResult.matchWins[0], batchResult.matchWins[1]);
                    // Confidence framing follows the headline (engine) probability,
                    // not the raw point-sim share, so the badges agree with the pie.
                    const favProb = favoredIdx === 0 ? dispProbA : 1 - dispProbA;
                    const underdogProb = 1 - favProb;
                    const [favLower, favUpper] = favoredIdx === 0 ? [lower, upper] : [1 - upper, 1 - lower];

                    // P(underdog wins >5 of 10 trial matches) via binomial
                    // - flags when, in a short run, the underdog could plausibly
                    // come out ahead despite losing the full simulation.
                    const binom10 = (() => {
                      if (underdogProb <= 0) return 0;
                      const p = underdogProb, n = 10;
                      let prob = 0;
                      // C(n,k) * p^k * (1-p)^(n-k) for k = 6..10
                      for (let k = 6; k <= n; k++) {
                        let logC = 0;
                        for (let i = 0; i < k; i++) logC += Math.log(n - i) - Math.log(i + 1);
                        prob += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
                      }
                      return Math.min(prob, 1);
                    })();

                    return (
                      <div className="adv-ci-caption">
                        <div className="adv-ci-range">
                          <span>95% CI: {Math.round(lower*100)}–{Math.round(upper*100)}%</span>
                          <span>95% CI: {Math.round((1-upper)*100)}–{Math.round((1-lower)*100)}%</span>
                        </div>

                        {/* Confidence badge - based on win rate, not sample size */}
                        {favProb >= 0.70 ? (
                          <Chip tone="positive" block icon={<Check size={12} />}>High confidence</Chip>
                        ) : favProb < 0.60 ? (
                          <Chip tone="warn" block icon={<AlertTriangle size={12} />}>Low confidence · toss-up matchup</Chip>
                        ) : null}

                        {/* Underdog flag - binomial P(underdog wins >5 of 10 games) */}
                        {binom10 >= 0.10 && (
                          <Chip tone="info" block icon={<Zap size={12} />}>
                            Underdog alert · {underdogName} wins a short series {Math.round(binom10 * 100)}% of the time
                          </Chip>
                        )}

                        <div className="adv-confidence-label">{confidenceLabel(favProb, favLower, favUpper)}</div>
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
                  <ResponsiveContainer width="100%" height={148}>
                    <BarChart layout="vertical" data={barData} margin={{ top:2, right:38, bottom:0, left:0 }} barCategoryGap="28%">
                      <XAxis type="number" hide domain={[0, 100]} />
                      <YAxis
                        dataKey="name"
                        type="category"
                        axisLine={false}
                        tickLine={false}
                        width={40}
                        tick={{ fontSize: 12, fill: '#9aa1ab' }}
                      />
                      <Bar dataKey={playerA.name} fill={SETBAR_COLORS[1]} barSize={10} radius={[0,3,3,0]} isAnimationActive={false}>
                        <LabelList dataKey={playerA.name} position="right" fill="#eef1f5" fontSize={11} fontWeight={600} formatter={(v)=> v ? `${v}%` : ''} />
                      </Bar>
                      <Bar dataKey={playerB.name} fill={SETBAR_COLORS[0]} barSize={10} radius={[0,3,3,0]} isAnimationActive={false}>
                        <LabelList dataKey={playerB.name} position="right" fill="#eef1f5" fontSize={11} fontWeight={600} formatter={(v)=> v ? `${v}%` : ''} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="adv-bar-caption">Share of all {totalWins.toLocaleString()} simulations ending at each set score</div>
                  {renderFixedLegend()}
                </div>
              {/* Share button - bottom-right of results row */}
              <div className="adv-share-row">
                <Button
                  size="sm"
                  className="adv-share-btn"
                  onClick={handleShare}
                  disabled={isGenerating}
                >
                  {isGenerating ? 'Generating…' : <><Share2 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />Share Prediction</>}
                </Button>
              </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Share card modal */}
          {shareUrl && (
            <div className="adv-share-overlay" onClick={() => setShareUrl(null)}>
              <div className="adv-share-modal" onClick={e => e.stopPropagation()}>
                <button className="adv-share-close" aria-label="Close" onClick={() => setShareUrl(null)}><X size={18} /></button>
                <img src={shareUrl} alt="Share card preview" className="adv-share-preview" />
                <div className="adv-share-actions">
                  <Button size="sm" className="adv-share-action-btn" onClick={handleDownload}>
                    <Download size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Save Image
                  </Button>
                  {navigator.share && (
                    <Button size="sm" className="adv-share-action-btn" onClick={handleNativeShare}>
                      <Share2 size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Share…
                    </Button>
                  )}
                </div>
                <p className="adv-share-hint">
                  Save the image and share it anywhere.
                  {' '}Made with{' '}
                  <a
                    className="adv-share-link"
                    href={window.location.origin}
                    target="_blank" rel="noopener noreferrer"
                  >
                    {window.location.host}
                  </a>
                </p>
              </div>
            </div>
          )}

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

          {/* Sliders are a secondary "what-if" tool, not a peer of the
              charts - tuck them in a collapsed drawer so the results stay
              the hero of the panel. */}
          <div className="adv-sliders-drawer">
            <button
              type="button"
              className="adv-sliders-toggle"
              onClick={() => setSlidersOpen(o => !o)}
              aria-expanded={slidersOpen}
            >
              {slidersOpen ? '▾' : '▸'} Adjust player stats
              <span className="adv-sliders-hint">drag to explore what-ifs</span>
            </button>
            {slidersOpen && (
              <div className="adv-sliders-row">
                {[[statsA, setStatsA], [statsB, setStatsB]].map(([stats, setStats], col) => (
                  <div className="sim-col" key={col}>
                    <div className="sim-col-name">{col === 0 ? playerA.name : playerB.name}</div>
                    {STAT_SECTIONS.map(section => (
                      <div className="sim-section" key={section.label}>
                        <div className="sim-section-label">{section.label}</div>
                        {section.keys.map(k => (
                          <div className="sim-slider" key={k}>
                            <Form.Label className="sim-slider-label">
                              <span>{STAT_LABELS[k]}</span>
                              <span className="sim-slider-val">{Math.round(stats[k]||0)}%</span>
                            </Form.Label>
                            <Form.Range
                              min={0} max={100}
                              value={stats[k]||0}
                              onChange={e => setStats({ ...stats, [k]: +e.target.value })}
                              disabled={isRunning||isWatching}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
