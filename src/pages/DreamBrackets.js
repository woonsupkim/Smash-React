// src/pages/DreamBrackets.js
import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import Swal from 'sweetalert2';
import {
  Button,
  Form,
  Spinner,
  ProgressBar
} from 'react-bootstrap';
import './DreamBrackets.css';
import { simulateBatch } from '../simulator';

const playerImgs = require.context('../assets/players', false, /\.png$/);

// Plain gray-circle SVG, used when a player has no headshot and the
// public/assets/players/default.png fallback isn't present in this env.
const BLANK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%23555"/><circle cx="16" cy="12" r="6" fill="%23999"/><path d="M4 30c0-7 5-11 12-11s12 4 12 11" fill="%23999"/></svg>'
);

const getPlayerImageSrc = (player) => {
  if (!player) return BLANK_AVATAR;
  const key = `./${player.id}.png`;
  const keys = playerImgs.keys ? playerImgs.keys() : [];
  if (keys.includes(key)) return playerImgs(key);
  return `${process.env.PUBLIC_URL}/assets/players/default.png`;
};

const TOURNAMENTS = [
  { value: 'smash_fr.csv', label: 'French Open', bgClass: 'french-bg', accentVar: '--accent-fr-a' },
  { value: 'smash_wb.csv', label: 'Wimbledon', bgClass: 'wimbledon-bg', accentVar: '--accent-wb-a' },
  { value: 'smash_us.csv', label: 'US Open', bgClass: 'usopen-bg', accentVar: '--accent-us-a' },
];

// Each stage's slot count, plus the round labels from that starting point
// all the way through to the champion.
const STAGES = [
  { value: 'r16', label: 'Round of 16', slots: 16, roundLabels: ['ROUND OF 16', 'QUARTER-FINALS', 'SEMI-FINALS', 'FINAL', 'CHAMPION'] },
  { value: 'qf', label: 'Quarter-Finals', slots: 8, roundLabels: ['QUARTER-FINALS', 'SEMI-FINALS', 'FINAL', 'CHAMPION'] },
  { value: 'sf', label: 'Semi-Finals', slots: 4, roundLabels: ['SEMI-FINALS', 'FINAL', 'CHAMPION'] },
  { value: 'final', label: 'Final', slots: 2, roundLabels: ['FINAL', 'CHAMPION'] },
];

const SIMS_PER_MATCHUP_OPTIONS = [1, 10, 500, 1000];
const DEFAULT_SIMS_PER_MATCHUP = 1000;

// Bracket-tree geometry constants. Match box height needs to comfortably
// fit 2 competitor rows (avatar+name, or a react-select control) plus the
// "vs" divider and card padding; the champion box only needs 1 row.
const MATCH_BOX_H = 112;
const CHAMPION_BOX_H = 90;
const LEAF_GAP = 20;
const CONNECTOR_W = 32;

const pairUp = (arr) => {
  const pairs = [];
  for (let i = 0; i < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
  return pairs;
};

// Computes the vertical center of every match box in every round, purely
// from the bracket's shape (slot count) — independent of which players are
// picked. Round 0's matches are evenly spaced leaves; every later round's
// match center is the midpoint of the two matches that feed it, recursing
// up to the final. This is what lets a connector line land exactly between
// its two feeders and exactly on the next round's box, and lets the
// champion box end up vertically centered on the whole bracket.
function buildBracketGeometry(slotCount) {
  const numMatchCols = Math.log2(slotCount); // e.g. 16 slots -> 4 match-columns before Champion
  const leafMatchCount = slotCount / 2;
  const slotH = MATCH_BOX_H + LEAF_GAP;
  const totalHeight = leafMatchCount * slotH;

  const matchCentersByCol = [
    Array.from({ length: leafMatchCount }, (_, i) => i * slotH + slotH / 2),
  ];
  for (let col = 1; col < numMatchCols; col++) {
    const prev = matchCentersByCol[col - 1];
    matchCentersByCol.push(
      Array.from({ length: prev.length / 2 }, (_, m) => (prev[2 * m] + prev[2 * m + 1]) / 2)
    );
  }

  return { totalHeight, numMatchCols, matchCentersByCol };
}

// One elbow (two matches merging into one) or, for the last gap into the
// champion box, one straight passthrough line.
function buildConnectorPath(feeders, outputs, width) {
  const mid = width / 2;
  const straight = feeders.length === outputs.length;
  let d = '';
  outputs.forEach((_, m) => {
    if (straight) {
      d += `M0,${feeders[m]} H${width} `;
    } else {
      const y1 = feeders[2 * m];
      const y2 = feeders[2 * m + 1];
      d += `M0,${y1} H${mid} M0,${y2} H${mid} M${mid},${y1} V${y2} M${mid},${(y1 + y2) / 2} H${width} `;
    }
  });
  return d;
}

export default function DreamBrackets() {
  const [tournament, setTournament] = useState(TOURNAMENTS[0].value);
  const [stage, setStage] = useState(STAGES[1].value); // default to Quarter-Finals, as before
  const stageConfig = STAGES.find(s => s.value === stage);
  const tournamentConfig = TOURNAMENTS.find(t => t.value === tournament);
  const geometry = buildBracketGeometry(stageConfig.slots);

  const [slots, setSlots] = useState(Array(stageConfig.slots).fill(null));
  const [playersPool, setPlayersPool] = useState([]);
  const [simsPerMatch, setSimsPerMatch] = useState(DEFAULT_SIMS_PER_MATCHUP);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // rounds[0] is always the user's slot picks; each subsequent entry is that
  // round's winners, ending with a single champion in the last round.
  const [rounds, setRounds] = useState([]);

  const resetBracketState = (slotCount) => {
    setSlots(Array(slotCount).fill(null));
    setRounds([]);
    setProgress(0);
    setIsRunning(false);
  };

  // load & normalize CSV into playersPool whenever the tournament changes
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/' + tournament, {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayersPool(
          data
            .filter(r => Number(r.us_rd) === 2)
            .map(r => ({
              ...r,
              probabilities: [
                Number(r.p1),
                Number(r.p2),
                Number(r.p3),
                Number(r.p4),
                Number(r.p5),
                Number(r.p6) || 0,
              ],
            }))
        );
      }
    });
    // switching tournaments invalidates any picks/results from the old draw
    resetBracketState(stageConfig.slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament]);

  // switching the starting stage changes the slot count — reset picks/results
  const handleStageChange = (value) => {
    setStage(value);
    const next = STAGES.find(s => s.value === value);
    resetBracketState(next.slots);
  };

  // update a single slot
  const handleSlotChange = (idx, player) => {
    const next = [...slots];
    next[idx] = player;
    setSlots(next);
  };

  // fill every slot with a random, non-duplicate set of players from the pool
  const handleRandomizeAll = () => {
    if (playersPool.length < slots.length) {
      Swal.fire({
        icon: 'error',
        title: 'Not enough players',
        text: `Need at least ${slots.length} players in the pool to randomize this bracket.`
      });
      return;
    }
    const shuffled = [...playersPool].sort(() => Math.random() - 0.5);
    setSlots(shuffled.slice(0, slots.length));
    setRounds([]); // clear any stale simulation results from before the slots changed
    setProgress(0);
  };

  // options for a given slot exclude players already chosen in the other slots
  const optionsForSlot = (idx) => {
    const chosenElsewhere = new Set(
      slots.filter((_, i) => i !== idx).filter(Boolean).map(p => p.id)
    );
    return playersPool
      .filter(pl => !chosenElsewhere.has(pl.id))
      .map(pl => ({ value: pl.id, label: pl.name, data: pl }));
  };

  // core bracket simulation
  const runDreamBracket = () => {
    if (slots.some(s => s === null)) {
      Swal.fire({
        icon: 'error',
        title: `Fill all ${slots.length} spots`,
        text: `Please pick a player for each ${stageConfig.label} slot.`
      });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setRounds([slots]);

    // batch-sim winner picker for pairs
    const pickWinners = (arr) => {
      const winners = [];
      for (let i = 0; i < arr.length; i += 2) {
        const A = arr[i], B = arr[i+1];
        const { matchWins } = simulateBatch(
          A.probabilities,
          B.probabilities,
          simsPerMatch
        );
        winners.push(matchWins[0] > matchWins[1] ? A : B);
      }
      return winners;
    };

    const totalStages = Math.log2(slots.length); // e.g. 16 slots -> 4 rounds to crown a champion
    let stepNum = 0;
    let temp = slots;

    const step = () => {
      stepNum += 1;
      temp = pickWinners(temp);
      setRounds(prev => [...prev, temp]);

      setProgress(Math.round((stepNum / totalStages) * 100));

      if (stepNum < totalStages) {
        setTimeout(step, 300);
      } else {
        setIsRunning(false);
      }
    };

    setTimeout(step, 300);
  };

  const handleReset = () => resetBracketState(stageConfig.slots);

  const selectStyles = {
    option: (base, state) => ({
      ...base,
      color: '#000',
      backgroundColor: state.isFocused ? '#eee' : '#fff',
    }),
    control: base => ({ ...base, opacity: 1 }),
    singleValue: base => ({ ...base, color: '#000' }),
  };

  const renderCompetitor = (p, { colIdx, globalSlotIdx, isWinner, isLoser }) => {
    const competitorClass = `competitor${isWinner ? ' winner' : ''}${isLoser ? ' loser' : ''}`;
    if (colIdx === 0) {
      return (
        <div className={`${competitorClass} editable`}>
          <Select
            options={optionsForSlot(globalSlotIdx)}
            value={p ? { value: p.id, label: p.name } : null}
            onChange={opt => handleSlotChange(globalSlotIdx, opt.data)}
            isDisabled={isRunning}
            styles={selectStyles}
            placeholder={`Slot ${globalSlotIdx + 1}`}
          />
          {isWinner || isLoser ? <span className="bracket-result-tag">{isWinner ? '✓' : '✗'}</span> : null}
        </div>
      );
    }
    return (
      <div className={competitorClass}>
        <img className="player-avatar" src={getPlayerImageSrc(p)} alt="" />
        <span className="competitor-name">{p ? p.name : '—'}</span>
        {isWinner && <span className="bracket-result-tag">✓</span>}
      </div>
    );
  };

  return (
    <div className={`page-background ${tournamentConfig.bgClass}`} style={{ '--bracket-accent': `var(${tournamentConfig.accentVar})` }}>
      <div className="dream-brackets-page bracket-overlay">
        <h3>Bracket Simulator</h3>

        <div className="mb-3 bracket-controls text-start d-flex flex-wrap gap-3">
          <Form.Select
            value={tournament}
            onChange={e => setTournament(e.target.value)}
            disabled={isRunning}
            style={{ maxWidth: 260 }}
          >
            {TOURNAMENTS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Form.Select>

          <Form.Select
            value={stage}
            onChange={e => handleStageChange(e.target.value)}
            disabled={isRunning}
            style={{ maxWidth: 260 }}
          >
            {STAGES.map(s => (
              <option key={s.value} value={s.value}>Start at {s.label}</option>
            ))}
          </Form.Select>

          <Form.Select
            value={simsPerMatch}
            onChange={e => setSimsPerMatch(Number(e.target.value))}
            disabled={isRunning}
            style={{ maxWidth: 220 }}
          >
            {SIMS_PER_MATCHUP_OPTIONS.map(n => (
              <option key={n} value={n}>{n} sim{n === 1 ? '' : 's'}/match</option>
            ))}
          </Form.Select>
        </div>

        <div className="mb-3 bracket-controls text-start">
          <Button
            variant="success"
            onClick={runDreamBracket}
            disabled={isRunning}
            className="me-2"
          >
            {isRunning
              ? <><Spinner animation="border" size="sm" /> Running…</>
              : 'Simulate Tournament'}
          </Button>
          <Button
            variant="light"
            onClick={handleRandomizeAll}
            disabled={isRunning}
            className="me-2"
          >
            🎲 Randomize
          </Button>
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={isRunning}
          >
            Reset
          </Button>
        </div>

        {isRunning && (
          <ProgressBar
            now={progress}
            label={`${progress}%`}
            variant="info"
            className="mb-4"
          />
        )}

        <div className="bracket-row">
          {stageConfig.roundLabels.map((label, colIdx) => {
            const isChampionCol = colIdx === geometry.numMatchCols;
            const colPlayers = colIdx === 0 ? slots : (rounds[colIdx] || []);
            const nextRoundWinners = rounds[colIdx + 1] || [];
            const matchCenters = isChampionCol
              ? null
              : geometry.matchCentersByCol[colIdx];
            const championCenter = geometry.matchCentersByCol[geometry.numMatchCols - 1][0];

            const column = (
              <div className={`bracket-col${isChampionCol ? ' champion' : ''}`} key={`col-${label}`}>
                <h6>{label}</h6>
                <div className="bracket-col-matches" style={{ height: geometry.totalHeight }}>
                  {isChampionCol ? (
                    <div
                      className="bracket-match champion-card"
                      style={{ position: 'absolute', top: championCenter - CHAMPION_BOX_H / 2, left: '50%', transform: 'translateX(-50%)', height: CHAMPION_BOX_H, width: 'max-content', maxWidth: '60vw' }}
                    >
                      {colPlayers[0] ? (
                        <div className="competitor winner">
                          <img className="player-avatar" src={getPlayerImageSrc(colPlayers[0])} alt="" />
                          <span>🏆 {colPlayers[0].name}</span>
                        </div>
                      ) : (
                        <div className="competitor placeholder">TBD</div>
                      )}
                    </div>
                  ) : (
                    pairUp(colPlayers).map((pair, pairIdx) => {
                      const winner = nextRoundWinners[pairIdx];
                      const center = matchCenters[pairIdx];
                      return (
                        <div
                          className="bracket-match"
                          key={pairIdx}
                          style={{ position: 'absolute', top: center - MATCH_BOX_H / 2, left: 0, right: 0, height: MATCH_BOX_H }}
                        >
                          {pair.map((p, slotIdx) => {
                            const globalSlotIdx = pairIdx * 2 + slotIdx;
                            const isWinner = !!(winner && p && winner.id === p.id);
                            const isLoser = !!(winner && p && winner.id !== p.id);
                            return (
                              <React.Fragment key={slotIdx}>
                                {renderCompetitor(p, { colIdx, globalSlotIdx, isWinner, isLoser })}
                                {slotIdx === 0 && <div className="bracket-vs">vs</div>}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );

            if (colIdx >= stageConfig.roundLabels.length - 1) return column;

            // connector gap between this column and the next
            const feeders = geometry.matchCentersByCol[colIdx];
            const isLastGap = colIdx === geometry.numMatchCols - 1;
            const outputs = isLastGap ? [championCenter] : geometry.matchCentersByCol[colIdx + 1];
            const pathD = buildConnectorPath(feeders, outputs, CONNECTOR_W);

            return (
              <React.Fragment key={`group-${label}`}>
                {column}
                <div className="bracket-connector" style={{ width: CONNECTOR_W }}>
                  {/* invisible spacer mirroring .bracket-col's h6, so the svg below lines up
                      with .bracket-col-matches rather than starting above it */}
                  <h6 aria-hidden="true">&nbsp;</h6>
                  <svg width={CONNECTOR_W} height={geometry.totalHeight} viewBox={`0 0 ${CONNECTOR_W} ${geometry.totalHeight}`}>
                    <path d={pathD} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" />
                  </svg>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
