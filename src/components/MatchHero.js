import React, { useState, useMemo } from 'react';
import { Button } from 'react-bootstrap';
import { motion, AnimatePresence } from 'framer-motion';
import { simulateMatch, simulateBatch } from '../simulator';
import { STAT_KEYS } from './AdvancedSimPanel';
import { countryFlag } from './countryFlags';
import './MatchHero.css';

const MUTED_COLOR = '#8a8f98';
const QUICK_ESTIMATE_SIMS = 500;

function probsFromRow(row) {
  return STAT_KEYS.map(([k]) => Number(row[k]) || 0);
}

/**
 * Broadcast-graphic style matchup hero: context bar, two player cards,
 * center VS + favorite-colored probability bar, comparison chips, and a
 * re-rollable single-match "Simulate Match" prediction.
 */
export default function MatchHero({
  playerA,
  playerB,
  surfaceLabel,
  surfaceKey, // 'hard' | 'clay' | 'grass' — matches year_w/year_l on the row
  accentColor,
  accentTextColor = '#fff',
  h2hData,
  getPlayerImageSrc,
}) {
  const [scoreline, setScoreline] = useState(null);
  const [isRolling, setIsRolling] = useState(false);

  // Model's estimated win probability (500-trial average) — this is a
  // statistical estimate, not a guarantee, which is why a single
  // "Simulate Match" roll below can still go the other way, especially
  // when the percentages are close together.
  const winProb = useMemo(() => {
    if (!playerA || !playerB) return 0.5;
    const res = simulateBatch(probsFromRow(playerA), probsFromRow(playerB), QUICK_ESTIMATE_SIMS);
    return res.matchWins[0] / QUICK_ESTIMATE_SIMS;
  }, [playerA, playerB]);

  const favoredIsA = winProb >= 0.5;
  const pctA = Math.round(winProb * 100);
  const pctB = 100 - pctA;

  const h2h = useMemo(() => {
    if (!playerA || !playerB || !h2hData) return null;
    const [idA, idB] = [playerA.id, playerB.id].sort();
    const key = `${idA}_${idB}`;
    const rec = h2hData[key];
    if (!rec) return null;
    const aIsFirst = idA === playerA.id;
    return {
      winsA: aIsFirst ? rec.winsA : rec.winsB,
      winsB: aIsFirst ? rec.winsB : rec.winsA,
      recentFormA: aIsFirst ? rec.recentFormA : rec.recentFormB,
      recentFormB: aIsFirst ? rec.recentFormB : rec.recentFormA,
    };
  }, [playerA, playerB, h2hData]);

  if (!playerA || !playerB) return null;

  const yearRecord = (player) => {
    const w = player.year_w, l = player.year_l;
    if (w === undefined || w === '' || l === undefined || l === '') return null;
    return `${w}-${l}`;
  };

  const rollMatch = () => {
    setIsRolling(true);
    setTimeout(() => {
      const res = simulateMatch(probsFromRow(playerA), probsFromRow(playerB));
      const winnerName = res.winner === 'A' ? playerA.name : playerB.name;
      const setsText = res.setScores.map(([a,b]) => `${a}-${b}`).join(', ');
      setScoreline({ winnerName, setsText });
      setIsRolling(false);
    }, 250);
  };

  const chips = [
    {
      label: `${surfaceLabel} record (this yr)`,
      a: yearRecord(playerA) || '—',
      b: yearRecord(playerB) || '—',
    },
    {
      label: 'Recent form (last 10)',
      a: h2h?.recentFormA || '—',
      b: h2h?.recentFormB || '—',
    },
    {
      label: 'Head-to-head (career)',
      a: h2h ? `${h2h.winsA}` : '0',
      b: h2h ? `${h2h.winsB}` : '0',
    },
    {
      label: '1st Serve %',
      a: `${Math.round((Number(playerA.p1)||0) * 100)}%`,
      b: `${Math.round((Number(playerB.p1)||0) * 100)}%`,
    },
  ];

  return (
    <div className="match-hero" style={{ '--hero-accent': accentColor }}>
      <div className="match-hero-context">
        {surfaceLabel} &middot; Best of 5
      </div>

      <div className="match-hero-main">
        <PlayerCol player={playerA} getPlayerImageSrc={getPlayerImageSrc} align="left" />

        <div className="match-hero-center">
          <div className="match-hero-vs">VS</div>
          <div className="match-hero-bar-label-top">Modeled win probability</div>
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
            {isRolling ? 'Simulating…' : scoreline ? '🔁 Simulate Again' : '🎾 Simulate Match'}
          </Button>

          <AnimatePresence>
            {scoreline && !isRolling && (
              <motion.div
                className="match-hero-scoreline"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
              >
                <strong>{scoreline.winnerName}</strong> wins, {scoreline.setsText}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="match-hero-disclaimer">
            One simulated match — the underdog can still win, especially in a close matchup.
          </div>
        </div>

        <PlayerCol player={playerB} getPlayerImageSrc={getPlayerImageSrc} align="right" />
      </div>

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
    </div>
  );
}

function PlayerCol({ player, getPlayerImageSrc, align }) {
  return (
    <div className={`match-hero-player ${align}`}>
      <img src={getPlayerImageSrc(player)} alt={player.name} className="match-hero-photo" />
      <div className="match-hero-name">{player.name}</div>
      <div className="match-hero-meta">
        {player.us_seed != null && player.us_seed !== '' && <span>Rank {player.us_seed}</span>}
        {player.country && <span> &middot; {countryFlag(player.country)} {player.country}</span>}
        {player.age && <span> &middot; Age {player.age}</span>}
      </div>
    </div>
  );
}
