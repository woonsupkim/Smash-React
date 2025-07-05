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
import './DreamBrackets.css'; // create this or remove if not needed

export default function DreamBrackets() {
  const [playersPool, setPlayersPool]       = useState([]);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [qfWinners, setQfWinners]           = useState([]);
  const [sfWinners, setSfWinners]           = useState([]);
  const [finalists, setFinalists]           = useState([]);
  const [champion, setChampion]             = useState(null);

  const [isRunning, setIsRunning]         = useState(false);
  const [progress, setProgress]           = useState(0);

  // load players once
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const pool = data.filter(r => Number(r.us_rd) === 2);
        setPlayersPool(pool);
      }
    });
  }, []);

  // random pick helper
  const pickWinner = (p1, p2) => {
    return Math.random() < 0.5 ? p1 : p2;
  };

  const runDreamBracket = () => {
    if (selectedPlayers.length !== 8) {
      Swal.fire({
        icon: 'error',
        title: 'Wrong number of players',
        text: 'Please select exactly 8 players.'
      });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setQfWinners([]);
    setSfWinners([]);
    setFinalists([]);
    setChampion(null);

    // Quarter finals
    const qf = [];
    selectedPlayers.forEach((p, idx) => {
      if (idx % 2 === 1) {
        const winner = pickWinner(selectedPlayers[idx-1], p);
        qf.push(winner);
      }
    });
    setTimeout(() => {
      setQfWinners(qf);
      setProgress(25);

      // Semi finals
      const sf = [];
      qf.forEach((p, idx) => {
        if (idx % 2 === 1) {
          const winner = pickWinner(qf[idx-1], p);
          sf.push(winner);
        }
      });
      setTimeout(() => {
        setSfWinners(sf);
        setProgress(50);

        // Final
        const final = [];
        sf.forEach((p, idx) => {
          if (idx % 2 === 1) {
            const winner = pickWinner(sf[idx-1], p);
            final.push(winner);
          }
        });
        setTimeout(() => {
          setFinalists(final);
          setProgress(75);

          // Champion
          const champ = pickWinner(final[0], final[1]);
          setTimeout(() => {
            setChampion(champ);
            setProgress(100);
            setIsRunning(false);
          }, 300);
        }, 300);
      }, 300);
    }, 300);
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

  const selectStyles = {
    option: (base, state) => ({
      ...base,
      color: '#000',
      backgroundColor: state.isFocused ? '#eee' : '#fff'
    }),
    multiValue: base => ({ ...base, backgroundColor: '#ddd' }),
    singleValue: base => ({ ...base, color: '#000' }),
    control: base => ({ ...base, opacity: 1 })
  };

  return (
    <div className="dream-brackets-page p-4">
      <h3 className="text-white mb-4">Dream Bracket Simulator</h3>

      <Form.Group controlId="dreamPlayers" className="mb-3 text-start">
        <Form.Label className="text-white">Select Exactly 8 Players</Form.Label>
        <Select
          isMulti
          options={playersPool.map(p => ({
            value: p.id,
            label: p.name,
            data: p
          }))}
          value={selectedPlayers.map(p => ({
            value: p.id,
            label: p.name,
            data: p
          }))}
          onChange={opts => setSelectedPlayers(opts.map(o => o.data))}
          isDisabled={isRunning}
          styles={selectStyles}
        />
      </Form.Group>

      <div className="mb-3">
        <Button
          variant="success"
          onClick={runDreamBracket}
          disabled={isRunning}
        >
          {isRunning
            ? <><Spinner animation="border" size="sm" /> Running…</>
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

      {/* Bracket Layout */}
      <div className="d-flex flex-wrap text-white">
        {/* QF */}
        <div className="me-5">
          <h5 className="text-center">QUARTER-FINALS</h5>
          {selectedPlayers.map((p, i) => (
            <div key={i} className="mb-2">
              <Form.Control
                readOnly
                value={p.name}
                className="bg-light"
              />
            </div>
          ))}
        </div>

        {/* SF */}
        <div className="me-5">
          <h5 className="text-center">SEMI-FINALS</h5>
          {qfWinners.map((p, i) => (
            <div key={i} className="mb-2">
              <Form.Control
                readOnly
                value={p.name}
                className="bg-light"
              />
            </div>
          ))}
        </div>

        {/* Final */}
        <div className="me-5">
          <h5 className="text-center">FINAL</h5>
          {sfWinners.map((p, i) => (
            <div key={i} className="mb-2">
              <Form.Control
                readOnly
                value={p.name}
                className="bg-light"
              />
            </div>
          ))}
        </div>

        {/* Champion */}
        <div>
          <h5 className="text-center">CHAMPION</h5>
          {champion && (
            <Form.Control
              readOnly
              value={champion.name}
              className="bg-light"
            />
          )}
        </div>
      </div>
    </div>
  );
}
