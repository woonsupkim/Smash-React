import React, { useState, useCallback } from 'react';
import { Button, Form, Spinner, ProgressBar, OverlayTrigger, Tooltip } from 'react-bootstrap';
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
import { generateShareCard } from '../utils/generateShareCard';
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
 * All simulation logic/state lives in the page (H2H.js, DreamBrackets.js)
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
  upsetDisabledReason = null, // non-null disables the toggle, shown on hover
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
  surfaceKey = 'hard', // 'hard' | 'clay' | 'grass' — themes the share card
  h2hData = null,      // pairwise career head-to-head map from h2h.json
}) {
  const simColor = simulateButtonColor || colorA;
  const simColorText = simulateButtonTextColor || colorAText;
  const [open, setOpen] = useState(defaultOpen);
  const [shareUrl, setShareUrl] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

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

  const shareCaption = batchResult && playerA && playerB
    ? `My sim says ${batchResult.matchWins[0] >= batchResult.matchWins[1] ? playerA.name : playerB.name} beats ` +
      `${batchResult.matchWins[0] >= batchResult.matchWins[1] ? playerB.name : playerA.name}. ` +
      `${simCount.toLocaleString()} matches simulated on SMASH! ⚡ ${window.location.origin}`
    : '';

  // Instagram has no web share intent — on mobile the native share sheet
  // lists it as a target; on desktop we save the image, copy the caption,
  // and open Instagram so the user can attach it to a post/story.
  const handleInstagram = async () => {
    if (!shareUrl) return;
    try {
      const blob = await (await fetch(shareUrl)).blob();
      const file = new File([blob], 'smash-prediction.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: shareCaption });
        return;
      }
    } catch (_) { /* fall through to manual flow */ }
    handleDownload();
    try { await navigator.clipboard.writeText(shareCaption); } catch (_) { /* ignore */ }
    window.open('https://www.instagram.com', '_blank', 'noopener');
  };
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

  // e.g. bestOf=5 -> targetSets=3 -> ['3–0','3–1','3–2']; bestOf=3 -> ['2–0','2–1'].
  const targetSets = Math.ceil(bestOf / 2);
  const scorelineLabels = Array.from({ length: targetSets }, (_, i) => `${targetSets}–${i}`);

  // Likelihood of each exact set outcome across ALL simulations (not just
  // conditional on that player winning) — every bar's % is out of totalWins
  // (= total completed sims), so all bars together sum to ~100%.
  const barData = batchResult
    ? scorelineLabels.map((lbl,i)=>({
        name: lbl,
        [playerA.name]: pct(batchResult.lostInWins[0][i]||0),
        [playerB.name]: pct(batchResult.lostInWins[1][i]||0),
      }))
    : [];

  const favoredIdx = batchResult ? (batchResult.matchWins[0] >= batchResult.matchWins[1] ? 0 : 1) : null;
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

          {upsetDisabledReason ? (
            <OverlayTrigger placement="top" overlay={<Tooltip>{upsetDisabledReason}</Tooltip>}>
              <span className="upset-toggle-switch upset-toggle-disabled-wrap">
                <Form.Check
                  type="switch"
                  id="upset-mode-toggle"
                  label="Upset Scenario"
                  checked={false}
                  onChange={() => {}}
                  disabled
                />
              </span>
            </OverlayTrigger>
          ) : (
            <Form.Check
              type="switch"
              id="upset-mode-toggle"
              className="upset-toggle-switch"
              label="Upset Scenario"
              checked={upsetMode}
              onChange={() => setUpsetMode(v => !v)}
              disabled={isRunning||isWatching}
            />
          )}

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
                        {pieData.map((_,i)=><Cell key={i} fill={VS_COLORS[i]} stroke="none"/>)}
                      </Pie>
                      <RechartTooltip
                        contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, maxWidth: 190 }}
                        labelStyle={{ color: '#fff', fontWeight: 700, marginBottom: 4, whiteSpace: 'normal' }}
                        itemStyle={{ color: '#ddd', whiteSpace: 'normal' }}
                        formatter={(v,n)=>([`${pct(v)}% win probability (${v} of ${totalWins} simulations)`, n])}
                        wrapperStyle={{ transform: 'translateX(-90px)', pointerEvents: 'none' }}
                      />
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
                    const underdogProb = 1 - favProb;
                    const [favLower, favUpper] = favoredIdx === 0 ? [lower, upper] : [1 - upper, 1 - lower];

                    // P(underdog wins >5 of 10 trial matches) via binomial
                    // — flags when, in a short run, the underdog could plausibly
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

                        {/* Confidence badge — based on win rate, not sample size */}
                        {favProb >= 0.70 ? (
                          <div className="adv-flag adv-flag--confident">✓ High confidence</div>
                        ) : favProb < 0.60 ? (
                          <div className="adv-flag adv-flag--warn">⚠ Low confidence — toss-up matchup</div>
                        ) : null}

                        {/* Underdog flag — binomial P(underdog wins >5 of 10 games) */}
                        {binom10 >= 0.10 && (
                          <div className="adv-flag adv-flag--underdog">
                            ⚡ Underdog alert — {underdogName} wins a short series {Math.round(binom10 * 100)}% of the time
                          </div>
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
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart layout="vertical" data={barData} margin={{ top:0, right:10, bottom:0, left:0 }}>
                      <XAxis type="number" stroke="#999" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" stroke="#999" width={36} tick={{ fontSize: 10 }} />
                      <RechartTooltip
                        cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                        contentStyle={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6 }}
                        labelStyle={{ color: '#fff', fontWeight: 700, marginBottom: 4 }}
                        itemStyle={{ color: '#ddd' }}
                        labelFormatter={(label) => `Final score: ${label}`}
                        formatter={(value, name) => [`${value}% of all simulations`, name]}
                        wrapperStyle={{ transform: 'translateX(100px) translateY(-55px)', pointerEvents: 'none' }}
                      />
                      <Bar dataKey={playerA.name} fill={SETBAR_COLORS[1]} barSize={9}/>
                      <Bar dataKey={playerB.name} fill={SETBAR_COLORS[0]} barSize={9}/>
                    </BarChart>
                  </ResponsiveContainer>
                  {renderFixedLegend()}
                </div>
              {/* Share button — bottom-right of results row */}
              <div className="adv-share-row">
                <Button
                  size="sm"
                  className="adv-share-btn"
                  onClick={handleShare}
                  disabled={isGenerating}
                >
                  {isGenerating ? 'Generating…' : '↗ Share Prediction'}
                </Button>
              </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Share card modal */}
          {shareUrl && (
            <div className="adv-share-overlay" onClick={() => setShareUrl(null)}>
              <div className="adv-share-modal" onClick={e => e.stopPropagation()}>
                <button className="adv-share-close" onClick={() => setShareUrl(null)}>✕</button>
                <img src={shareUrl} alt="Share card preview" className="adv-share-preview" />
                <div className="adv-share-actions">
                  <Button size="sm" className="adv-share-action-btn" onClick={handleDownload}>
                    ↓ Save Image
                  </Button>
                  {navigator.share && (
                    <Button size="sm" className="adv-share-action-btn" onClick={handleNativeShare}>
                      ↗ Share…
                    </Button>
                  )}
                  <Button size="sm" className="adv-share-action-btn adv-share-instagram" onClick={handleInstagram}>
                    📸 Instagram
                  </Button>
                </div>
                <p className="adv-share-hint">
                  Instagram saves the image and copies the caption, then attach it to your post.
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
