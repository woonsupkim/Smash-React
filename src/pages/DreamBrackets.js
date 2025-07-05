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

export default function DreamBrackets() {
  // 8 bracket slots for QF
  const [slots, setSlots] = useState(Array(8).fill(null));
  const [playersPool, setPlayersPool] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // winners by round
  const [qfWinners, setQfWinners] = useState([]);
  const [sfWinners, setSfWinners] = useState([]);
  const [finalists, setFinalists] = useState([]);
  const [champion, setChampion] = useState(null);

  // load & normalize CSV into playersPool
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
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
              ],
            }))
        );
      }
    });
  }, []);

  // update a single QF slot
  const handleSlotChange = (idx, player) => {
    const next = [...slots];
    next[idx] = player;
    setSlots(next);
  };

  // core bracket simulation
  const runDreamBracket = () => {
    // require all 8 slots filled
    if (slots.some(s => s === null)) {
      Swal.fire({
        icon: 'error',
        title: 'Fill all 8 spots',
        text: 'Please pick a player for each quarter-final slot.'
      });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setQfWinners([]);
    setSfWinners([]);
    setFinalists([]);
    setChampion(null);

    // batch-sim winner picker for pairs
    const pickWinners = (arr) => {
      const winners = [];
      for (let i = 0; i < arr.length; i += 2) {
        const A = arr[i], B = arr[i+1];
        const sims = 50;
        const { matchWins } = simulateBatch(
          A.probabilities,
          B.probabilities,
          sims
        );
        winners.push(matchWins[0] > matchWins[1] ? A : B);
      }
      return winners;
    };

    let stage = 0;
    const totalStages = 4;
    let temp = [];

    const step = () => {
      stage += 1;

      if (stage === 1) {
        // QF → SF
        temp = pickWinners(slots);
        setQfWinners(temp);
      } else if (stage === 2) {
        // SF → Final
        temp = pickWinners(temp);
        setSfWinners(temp);
      } else if (stage === 3) {
        // Final → Champion slot
        temp = pickWinners(temp);
        setFinalists(temp);
      } else if (stage === 4) {
        // That's our single champion
        setChampion(temp[0]);
      }

      setProgress(Math.round((stage / totalStages) * 100));

      if (stage < totalStages) {
        setTimeout(step, 300);
      } else {
        setIsRunning(false);
      }
    };

    step();
  };

  const handleReset = () => {
    setSlots(Array(8).fill(null));
    setQfWinners([]);
    setSfWinners([]);
    setFinalists([]);
    setChampion(null);
    setProgress(0);
    setIsRunning(false);
  };

  const selectStyles = {
    option: (base, state) => ({
      ...base,
      color: '#000',
      backgroundColor: state.isFocused ? '#eee' : '#fff',
    }),
    control: base => ({ ...base, opacity: 1 }),
    singleValue: base => ({ ...base, color: '#000' }),
  };

  return (
    <div className="dream-brackets-page">
      <h3>Dream Bracket Simulator</h3>

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
        {/* Quarter-Finals: 8 independent selects */}
        <div className="bracket-col">
          <h6>QUARTER-FINALS</h6>
          {slots.map((p, i) => (
            <div className="bracket-card" key={i}>
              <Select
                options={playersPool.map(pl => ({
                  value: pl.id, label: pl.name, data: pl
                }))}
                value={p ? { value: p.id, label: p.name } : null}
                onChange={opt => handleSlotChange(i, opt.data)}
                isDisabled={isRunning}
                styles={selectStyles}
                placeholder={`Slot ${i+1}`}
              />
            </div>
          ))}
        </div>

        {/* Semi-Finals */}
        <div className="bracket-col">
          <h6>SEMI-FINALS</h6>
          {qfWinners.map((p, i) => (
            <div className="bracket-card" key={i}>
              {p.name}
            </div>
          ))}
        </div>

        {/* Final */}
        <div className="bracket-col">
          <h6>FINAL</h6>
          {sfWinners.map((p, i) => (
            <div className="bracket-card" key={i}>
              {p.name}
            </div>
          ))}
        </div>

        {/* Champion */}
        <div className="bracket-col champion">
          <h6>CHAMPION</h6>
          {champion && (
            <div className="bracket-card">
              {champion.name}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
