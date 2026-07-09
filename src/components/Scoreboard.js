import React from 'react';
import { countryFlagUrl } from './countryFlags';
import './Scoreboard.css';

const POINT_LABELS = ['0', '15', '30', '40'];

// Converts raw point counts into standard tennis scoring text, handling
// deuce/advantage. Returns a [labelA, labelB] pair.
export function tennisPointLabel(a, b) {
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    if (a > b) return ['AD', ''];
    return ['', 'AD'];
  }
  return [POINT_LABELS[a] ?? '40', POINT_LABELS[b] ?? '40'];
}

// Scans a stream of simulateMatchStepwise() events and derives the current
// scoreboard state (completed sets, the set in progress, and live
// game/tiebreak points) — used to render a live-updating scoreboard instead
// of a line-by-line commentary feed.
export function deriveLiveScoreboardState(events) {
  let completedSets = [];
  let liveGames = null;
  let livePoints = null;
  let isTiebreak = false;
  let winner = null;

  for (const ev of events) {
    switch (ev.type) {
      case 'point':
        liveGames = ev.games;
        livePoints = ev.points;
        isTiebreak = ev.games[0] === 6 && ev.games[1] === 6;
        break;
      case 'game':
        liveGames = ev.games;
        livePoints = [0, 0];
        isTiebreak = false;
        break;
      case 'tiebreak_start':
        isTiebreak = true;
        livePoints = [0, 0];
        break;
      case 'tiebreak_end':
        liveGames = ev.games;
        isTiebreak = false;
        livePoints = null;
        break;
      case 'set':
        completedSets = ev.setScores;
        liveGames = null;
        livePoints = null;
        break;
      case 'match':
        completedSets = ev.setScores;
        winner = ev.winner;
        liveGames = null;
        livePoints = null;
        break;
      default:
        break;
    }
  }
  return { completedSets, liveGames, livePoints, isTiebreak, winner };
}

/**
 * Broadcast-style tennis scoreboard: one row per player, one column per
 * completed set, plus an optional live "in progress" column showing the
 * current set's games and (if mid-game) the current point score.
 */
export default function Scoreboard({
  nameA,
  nameB,
  countryA = null,
  countryB = null,
  completedSets = [],
  liveGames = null,
  livePoints = null,
  isTiebreak = false,
  winner = null,
}) {
  const points = livePoints ? tennisPointLabel(livePoints[0], livePoints[1]) : null;
  const flagA = countryFlagUrl(countryA);
  const flagB = countryFlagUrl(countryB);

  return (
    <table className="scoreboard">
      <tbody>
        <tr className={winner === 'A' ? 'sb-winner-row' : ''}>
          <td className="sb-name">
            {flagA && <img src={flagA} alt={countryA} className="sb-flag" />}
            {nameA}{winner === 'A' && <span className="sb-check">✓</span>}
          </td>
          {completedSets.map(([a, b, tb], i) => (
            <td key={i} className={a > b ? 'sb-set-won' : 'sb-set-lost'}>
              {a}{tb != null && a < b && <sup className="sb-tb">{tb}</sup>}
            </td>
          ))}
          {liveGames && <td className="sb-live">{liveGames[0]}</td>}
          {points && <td className="sb-points">{isTiebreak ? livePoints[0] : points[0]}</td>}
        </tr>
        <tr className={winner === 'B' ? 'sb-winner-row' : ''}>
          <td className="sb-name">
            {flagB && <img src={flagB} alt={countryB} className="sb-flag" />}
            {nameB}{winner === 'B' && <span className="sb-check">✓</span>}
          </td>
          {completedSets.map(([a, b, tb], i) => (
            <td key={i} className={b > a ? 'sb-set-won' : 'sb-set-lost'}>
              {b}{tb != null && b < a && <sup className="sb-tb">{tb}</sup>}
            </td>
          ))}
          {liveGames && <td className="sb-live">{liveGames[1]}</td>}
          {points && <td className="sb-points">{isTiebreak ? livePoints[1] : points[1]}</td>}
        </tr>
      </tbody>
    </table>
  );
}
