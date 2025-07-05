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

export default function DreamBrackets() {
  const [playersPool, setPlayersPool]     = useState([]);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [isRunning, setIsRunning]         = useState(false);
  const [progress, setProgress]           = useState(0);

  // bracket stages
  const [qfWinners, setQfWinners]   = useState([]);
  const [sfWinners, setSfWinners]   = useState([]);
  const [finalists, setFinalists]   = useState([]);
  const [champion, setChampion]     = useState(null);

  // --- Load initial players ---
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayersPool(data.filter(r => Number(r.us_rd) === 2));
      }
    });
  }, []);

  // --- Simulate bracket ---
  const runDreamBracket = () => {
    if (selectedPlayers.length !== 8) {
      Swal.fire({
        icon: 'error',
        title: 'Select Exactly 8 Players',
        text: 'Your bracket must contain exactly eight players.'
      });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setQfWinners([]);
    setSfWinners([]);
    setFinalists([]);
    setChampion(null);

    // helper to pick half winners
    const pickWinners = (arr) => {
      const winners = [];
      for (let i = 0; i < arr.length; i += 2) {
        const a = arr[i], b = arr[i+1];
        winners.push(Math.random() < 0.5 ? a : b);
      }
      return winners;
    };

    // simulate with small delays to update progress
    let stage = 0;
    const totalStages = 4; // QF → SF → Final → Champion
    let tempQF = [], tempSF = [], tempFinal = [], tempChamp = null;

    const step = () => {
      stage += 1;
      // Quarter → Semi
      if (stage === 1) {
        tempQF = pickWinners(selectedPlayers);
        setQfWinners(tempQF);
      }
      // Semi → Final
      else if (stage === 2) {
        tempSF = pickWinners(tempQF);
        setSfWinners(tempSF);
      }
      // Final → Champion
      else if (stage === 3) {
        tempFinal = pickWinners(tempSF);
        setFinalists(tempFinal);
      }
      // Champion
      else if (stage === 4) {
        tempChamp = pickWinners(tempFinal)[0];
        setChampion(tempChamp);
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
    setSelectedPlayers([]);
    setQfWinners([]);
    setSfWinners([]);
    setFinalists([]);
    setChampion(null);
    setProgress(0);
    setIsRunning(false);
  };

  // keep dropdown text fully opaque
  const selectStyles = {
    option: (base, state) => ({
      ...base,
      color: '#000',
      opacity: 1,
      backgroundColor: state.isFocused ? '#eee' : '#fff'
    }),
    control: (base) => ({ ...base, opacity: 1 }),
    singleValue: (base) => ({ ...base, color: '#000' }),
    multiValue: (base) => ({ ...base, backgroundColor: '#555' }),
    multiValueLabel: (base) => ({ ...base, color: '#fff' })
  };

  return (
    <div className="dream-brackets-page">
      <h3>Dream Bracket Simulator</h3>

      <Form.Group controlId="dreamPlayers" className="text-start bracket-controls">
        <Form.Label>Select Exactly 8 Players</Form.Label>
        <Select
          isMulti
          options={playersPool.map(p => ({
            value: p.id,
            label: p.name,
            data: p
          }))}
          value={selectedPlayers.map(p => ({
            value: p.id, label: p.name, data: p
          }))}
          onChange={opts => setSelectedPlayers(opts.map(o => o.data))}
          isDisabled={isRunning}
          styles={selectStyles}
          placeholder="Pick 8 players…"
        />
      </Form.Group>

      <div className="mb-3">
        <Button
          variant="success"
          onClick={runDreamBracket}
          disabled={isRunning}
        >
          {isRunning
            ? <><Spinner animation="border" size="sm"/> Running…</>
            : 'Simulate Tournament'}
        </Button>
        <Button
          variant="secondary"
          className="ms-2"
          onClick={handleReset}
          disabled={isRunning}
        >Reset</Button>
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
        <div className="bracket-col">
          <h6>QUARTER-FINALS</h6>
          {selectedPlayers.map((p,i) => (
            <div className="bracket-card" key={i}>{p.name}</div>
          ))}
        </div>

        <div className="bracket-col">
          <h6>SEMI-FINALS</h6>
          {qfWinners.map((p,i) => (
            <div className="bracket-card" key={i}>{p.name}</div>
          ))}
        </div>

        <div className="bracket-col">
          <h6>FINAL</h6>
          {sfWinners.map((p,i) => (
            <div className="bracket-card" key={i}>{p.name}</div>
          ))}
        </div>

        <div className="bracket-col champion">
          <h6>CHAMPION</h6>
          {champion && (
            <div className="bracket-card">{champion.name}</div>
          )}
        </div>
      </div>
    </div>
  );
}
