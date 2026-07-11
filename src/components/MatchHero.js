import React, { useState, useMemo, useEffect } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import { simulateMatch, simulateBatch } from '../simulator';
import { STAT_KEYS } from './AdvancedSimPanel';
import { countryFlagUrl } from './countryFlags';
import { pickEngineProb, eloProb as eloProbFn, ENGINE_LABELS } from '../engines';
import EngineSelector from './ui/EngineSelector';
import Scoreboard from './Scoreboard';
import './MatchHero.css';
const MUTED_COLOR = '#8a8f98';
const QUICK_ESTIMATE_SIMS = 500;

function probsFromRow(row) {
  return STAT_KEYS.map(([k]) => Number(row[k]) || 0);
}

/**
 * Broadcast-graphic style matchup card: title, player selectors positioned
 * directly above each player's photo, center VS + favorite-colored
 * probability bar, comparison chips, and a re-rollable single-match
 * "Simulate Match" prediction. Always renders (even before both players are
 * picked) so the selectors, title, and hero live in one continuous card.
 */
export default function MatchHero({
  title,
  logo,
  badge = null, // small pill under the context line (e.g. "Matchup of the day")
  surfaceSelector = null, // tournament/surface dropdown, rendered under the title
  playerA,
  playerB,
  selectorA,
  selectorB,
  surfaceLabel,
  surfaceKey, // 'hard' | 'clay' | 'grass' - matches year_w/year_l on the row
  bestOf = 5, // 5 (ATP Grand Slam) or 3 (WTA Grand Slam)
  accentColor,
  accentTextColor = '#fff',
  h2hData,
  getPlayerImageSrc,
  statsA = null,   // seeded slider stats (0-100 per key) - reflect the engine's stat source
  statsB = null,
  poolLoading = false, // roster CSV still parsing - show skeleton placeholders
  eloData = null,     // { id: {all,hard,clay,grass} } - surface form ratings
  tour = 'atp',       // 'atp' | 'wta' - selects the tuned engine weights
  engine = 'smash',   // which prediction engine drives the headline number
  setEngine = null,   // enables the engine selector when provided
  engineDisabled = {}, // { engineId: reason } - greys out that engine
  recommendedEngine = null, // engine id to badge "Recommended" (best for surface)
  winProbOverride = null, // authoritative engine P(A wins) from the page's shared batch - keeps the headline identical to the detailed panel
}) {
  const [scoreline, setScoreline] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const bothPicked = !!(playerA && playerB);

  // Prefer the page-seeded stats (which flip to heavy-recency values when
  // Upset Scenario is on) over the raw CSV row, so the probability bar and
  // Simulate Match respond to the toggle.
  const statsReady = (s) => s && STAT_KEYS.some(([k]) => s[k] > 0);
  const probsA = statsReady(statsA) ? STAT_KEYS.map(([k]) => (statsA[k] || 0) / 100) : (playerA ? probsFromRow(playerA) : null);
  const probsB = statsReady(statsB) ? STAT_KEYS.map(([k]) => (statsB[k] || 0) / 100) : (playerB ? probsFromRow(playerB) : null);
  const probsKeyA = probsA ? probsA.join(',') : '';
  const probsKeyB = probsB ? probsB.join(',') : '';

  // Picking either player (or changing the underlying stats, e.g. toggling
  // Upset Scenario) resets the previous roll - a stale scoreline from the
  // old stats shouldn't linger.
  useEffect(() => {
    setScoreline(null);
    setIsRolling(false);
  }, [playerA?.id, playerB?.id, probsKeyA, probsKeyB]);

  // Model's estimated win probability (500-trial average) - this is a
  // statistical estimate, not a guarantee, which is why a single
  // "Simulate Match" roll below can still go the other way, especially
  // when the percentages are close together.
  const winProb = useMemo(() => {
    if (!bothPicked || !probsA || !probsB) return 0.5;
    const res = simulateBatch(probsA, probsB, QUICK_ESTIMATE_SIMS, bestOf);
    return res.matchWins[0] / QUICK_ESTIMATE_SIMS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothPicked, probsKeyA, probsKeyB, bestOf]);

  // Selected engine's P(A wins). winProb already reflects the engine's stat
  // source (the page seeds hot-form stats for the Hot Streak engine), so the
  // Point Sim and Hot Streak engines just use it directly; the others blend.
  const displayProb = useMemo(() => {
    if (!bothPicked) return 0.5;
    // Prefer the page's shared batch-derived engine probability so the
    // headline and the detailed panel below show the exact same number.
    if (winProbOverride != null) return winProbOverride;
    const elo = eloData ? eloProbFn(eloData[playerA.id], eloData[playerB.id], surfaceKey) : null;
    return pickEngineProb(
      engine,
      { sim: winProb, upsetSim: winProb, elo, rankA: playerA.us_seed, rankB: playerB.us_seed },
      tour, surfaceKey
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothPicked, winProb, eloData, playerA, playerB, surfaceKey, tour, engine, winProbOverride]);

  const favoredIsA = displayProb >= 0.5;
  const pctA = Math.round(displayProb * 100);
  const pctB = 100 - pctA;

  const h2h = useMemo(() => {
    if (!bothPicked || !h2hData) return null;
    const [idA, idB] = [playerA.id, playerB.id].sort();
    const key = `${idA}_${idB}`;
    const rec = h2hData[key];
    if (!rec) return null;
    const aIsFirst = idA === playerA.id;
    return {
      winsA: aIsFirst ? rec.winsA : rec.winsB,
      winsB: aIsFirst ? rec.winsB : rec.winsA,
    };
  }, [playerA, playerB, h2hData, bothPicked]);

  const yearRecord = (player) => {
    const w = player.year_w, l = player.year_l;
    if (w === undefined || w === '' || l === undefined || l === '') return null;
    return `${w}–${l}`; // en-dash, consistent with scorelines/CIs
  };

  // Recent form (last 10 matches, any surface) is a per-player fact - unlike
  // head-to-head, it doesn't depend on these two players having met before.
  const recentForm = (player) => {
    const w = player.recent_w, l = player.recent_l;
    if (w === undefined || w === '' || l === undefined || l === '') return null;
    return `${w}–${l}`; // en-dash, consistent with scorelines/CIs
  };

  const rollMatch = () => {
    setIsRolling(true);
    setTimeout(() => {
      const res = simulateMatch(probsA, probsB, bestOf);
      setScoreline(res);
      setIsRolling(false);
    }, 250);
  };

  const chips = bothPicked ? [
    {
      label: `${surfaceLabel} record (this yr)`,
      a: yearRecord(playerA) || '–',
      b: yearRecord(playerB) || '–',
    },
    {
      label: 'Recent form (last 10)',
      a: recentForm(playerA) || '–',
      b: recentForm(playerB) || '–',
    },
    {
      label: 'Head-to-head (career)',
      a: h2h ? `${h2h.winsA}` : '0',
      b: h2h ? `${h2h.winsB}` : '0',
    },
  ] : [];

  return (
    <div className="match-hero" style={{ '--hero-accent': accentColor }}>
      {title && (
        <h3 className="match-hero-title" style={{ '--accent': accentColor }}>
          {logo && <img src={logo} alt="" className="match-hero-title-logo" />}
          {title}
        </h3>
      )}
      <div className="match-hero-context">
        {surfaceLabel} &middot; Best of {bestOf}
      </div>
      {badge && <div className="match-hero-badge"><span className="match-hero-badge-dot" />{badge}</div>}
      {surfaceSelector && <div className="match-hero-surface-select">{surfaceSelector}</div>}

      <div className="match-hero-main">
        <PlayerCol player={playerA} getPlayerImageSrc={getPlayerImageSrc} align="left" selector={selectorA} poolLoading={poolLoading} favored={bothPicked && favoredIsA} />

        <div className="match-hero-center">
          {bothPicked ? (
            <>
              {setEngine && (
                <EngineSelector engine={engine} setEngine={setEngine} disabled={engineDisabled} recommended={recommendedEngine} />
              )}

              <OverlayTrigger
                placement="top"
                overlay={
                  <Tooltip>
                    From the {ENGINE_LABELS[engine] || 'Smart Blend'} engine, averaged over{' '}
                    {QUICK_ESTIMATE_SIMS.toLocaleString()} simulated matches. A statistical estimate,
                    not a guarantee.
                  </Tooltip>
                }
              >
                <div className="match-hero-bar-label-top">Win probability ⓘ</div>
              </OverlayTrigger>
              <div className="match-hero-bar">
                <div
                  className="match-hero-bar-fill a"
                  style={{
                    width: `${pctA}%`,
                    background: favoredIsA ? accentColor : MUTED_COLOR,
                  }}
                />
                <div
                  className="match-hero-bar-fill b"
                  style={{
                    width: `${pctB}%`,
                    background: !favoredIsA ? accentColor : MUTED_COLOR,
                  }}
                />
              </div>
              <div className="match-hero-bar-labels">
                <span style={{ color: favoredIsA ? accentColor : MUTED_COLOR, fontWeight: favoredIsA ? 700 : 400 }}>{pctA}%</span>
                <span style={{ color: !favoredIsA ? accentColor : MUTED_COLOR, fontWeight: !favoredIsA ? 700 : 400 }}>{pctB}%</span>
              </div>

              <Button
                className="mt-3"
                style={{ background: accentColor, borderColor: accentColor, color: accentTextColor }}
                onClick={rollMatch}
                disabled={isRolling}
              >
                {isRolling ? 'Simulating...' : scoreline ? 'Simulate Again' : 'Simulate Match'}
              </Button>

              <AnimatePresence>
                {scoreline && !isRolling && (
                  <motion.div
                    className="match-hero-scoreline"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                  >
                    <Scoreboard
                      nameA={playerA.name}
                      nameB={playerB.name}
                      countryA={playerA.country}
                      countryB={playerB.country}
                      completedSets={scoreline.setScores}
                      winner={scoreline.winner}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="match-hero-disclaimer">
                One simulated match. The underdog can still win, especially in a close matchup.
              </div>
            </>
          ) : (
            <div className="match-hero-vs-placeholder">Pick two players</div>
          )}
        </div>

        <PlayerCol player={playerB} getPlayerImageSrc={getPlayerImageSrc} align="right" selector={selectorB} poolLoading={poolLoading} favored={bothPicked && !favoredIsA} />
      </div>

      {bothPicked && (
        <div className="match-hero-chips">
          {chips.map((c) => (
            <div className="match-hero-chip" key={c.label}>
              <div className="chip-label">{c.label}</div>
              <div className="chip-values">
                <span>{c.a}</span>
                <span className="chip-sep">vs</span>
                <span>{c.b}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerCol({ player, getPlayerImageSrc, align, selector, poolLoading, favored = false }) {
  const flagUrl = player ? countryFlagUrl(player.country) : null;
  return (
    <div className={`match-hero-player ${align}${favored ? ' favored' : ''}`}>
      {selector && <div className="match-hero-selector">{selector}</div>}
      {player ? (
        <>
          <div className="match-hero-photo-wrap">
            <img src={getPlayerImageSrc(player)} alt={player.name} className={`match-hero-photo${favored ? ' favored' : ''}`} />
            {favored && <span className="match-hero-fav-badge">Favored</span>}
          </div>
          <div className="match-hero-name">
            {flagUrl
              ? <img src={flagUrl} alt={player.country} className="match-hero-flag" />
              : null}
            {player.name}
          </div>
          <div className="match-hero-meta">
            {player.us_seed != null && player.us_seed !== '' && <span>Rank {player.us_seed}</span>}
            {player.age && <span> &middot; Age {player.age}</span>}
          </div>
        </>
      ) : (
        <div className={`match-hero-photo match-hero-photo-placeholder${poolLoading ? ' skeleton' : ''}`} />
      )}
    </div>
  );
}
