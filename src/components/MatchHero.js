import React, { useState, useMemo, useEffect } from 'react';
import { Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import { simulateMatch, simulateBatch } from '../simulator';
import { STAT_KEYS } from './AdvancedSimPanel';
import { countryFlagUrl } from './countryFlags';
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
  playerA,
  playerB,
  selectorA,
  selectorB,
  surfaceLabel,
  surfaceKey, // 'hard' | 'clay' | 'grass' — matches year_w/year_l on the row
  accentColor,
  accentTextColor = '#fff',
  h2hData,
  getPlayerImageSrc,
}) {
  const [scoreline, setScoreline] = useState(null);
  const [isRolling, setIsRolling] = useState(false);
  const bothPicked = !!(playerA && playerB);

  // Picking either player resets the previous roll — otherwise a stale
  // scoreline from the old matchup stays on screen next to the new pair.
  useEffect(() => {
    setScoreline(null);
    setIsRolling(false);
  }, [playerA?.id, playerB?.id]);

  // Model's estimated win probability (500-trial average) — this is a
  // statistical estimate, not a guarantee, which is why a single
  // "Simulate Match" roll below can still go the other way, especially
  // when the percentages are close together.
  const winProb = useMemo(() => {
    if (!bothPicked) return 0.5;
    const res = simulateBatch(probsFromRow(playerA), probsFromRow(playerB), QUICK_ESTIMATE_SIMS);
    return res.matchWins[0] / QUICK_ESTIMATE_SIMS;
  }, [playerA, playerB, bothPicked]);

  const favoredIsA = winProb >= 0.5;
  const pctA = Math.round(winProb * 100);
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
    return `${w}-${l}`;
  };

  // Recent form (last 10 matches, any surface) is a per-player fact — unlike
  // head-to-head, it doesn't depend on these two players having met before.
  const recentForm = (player) => {
    const w = player.recent_w, l = player.recent_l;
    if (w === undefined || w === '' || l === undefined || l === '') return null;
    return `${w}-${l}`;
  };

  const rollMatch = () => {
    setIsRolling(true);
    setTimeout(() => {
      const res = simulateMatch(probsFromRow(playerA), probsFromRow(playerB));
      setScoreline(res);
      setIsRolling(false);
    }, 250);
  };

  const chips = bothPicked ? [
    {
      label: `${surfaceLabel} record (this yr)`,
      a: yearRecord(playerA) || '—',
      b: yearRecord(playerB) || '—',
    },
    {
      label: 'Recent form (last 10)',
      a: recentForm(playerA) || '—',
      b: recentForm(playerB) || '—',
    },
    {
      label: 'Head-to-head (career)',
      a: h2h ? `${h2h.winsA}` : '0',
      b: h2h ? `${h2h.winsB}` : '0',
    },
  ] : [];

  return (
    <div className="match-hero" style={{ '--hero-accent': accentColor }}>
      {title && <h3 className="match-hero-title" style={{ '--accent': accentColor }}>{title}</h3>}
      <div className="match-hero-context">
        {surfaceLabel} &middot; Best of 5
      </div>

      <div className="match-hero-main">
        <PlayerCol player={playerA} getPlayerImageSrc={getPlayerImageSrc} align="left" selector={selectorA} />

        <div className="match-hero-center">
          {bothPicked ? (
            <>
              <div className="match-hero-vs">VS</div>
              <OverlayTrigger
                placement="top"
                overlay={
                  <Tooltip>
                    Average outcome of {QUICK_ESTIMATE_SIMS} simulated matches using each player's
                    serve/return stats. A statistical estimate, not a guarantee.
                  </Tooltip>
                }
              >
                <div className="match-hero-bar-label-top">Modeled win probability ⓘ</div>
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
            <div className="match-hero-vs-placeholder">VS</div>
          )}
        </div>

        <PlayerCol player={playerB} getPlayerImageSrc={getPlayerImageSrc} align="right" selector={selectorB} />
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

function PlayerCol({ player, getPlayerImageSrc, align, selector }) {
  const flagUrl = player ? countryFlagUrl(player.country) : null;
  return (
    <div className={`match-hero-player ${align}`}>
      {selector && <div className="match-hero-selector">{selector}</div>}
      {player ? (
        <>
          <img src={getPlayerImageSrc(player)} alt={player.name} className="match-hero-photo" />
          <div className="match-hero-name">{player.name}</div>
          <div className="match-hero-meta">
            {player.us_seed != null && player.us_seed !== '' && <span>Rank {player.us_seed}</span>}
            {player.country && (
              <span className="match-hero-flag-wrap">
                {' · '}
                {flagUrl
                  ? <img src={flagUrl} alt={player.country} className="match-hero-flag" />
                  : player.country}
              </span>
            )}
            {player.age && <span> &middot; Age {player.age}</span>}
          </div>
        </>
      ) : (
        <div className="match-hero-photo match-hero-photo-placeholder" />
      )}
    </div>
  );
}
