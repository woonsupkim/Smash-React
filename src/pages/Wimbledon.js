// src/pages/Wimbledon.js
import React, { useState, useEffect } from 'react';
import Papa from 'papaparse';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import {
  Table,
  Button,
  Dropdown,
  ProgressBar,
  Form
} from 'react-bootstrap';
import Swal from 'sweetalert2';
import './Wimbledon.css';
import placeholdera from '../assets/players/0a.png';
import placeholderb from '../assets/players/0b.png';

const playerImgs = require.context('../assets/players', false, /\.png$/);

export default function Wimbledon() {
  const [players, setPlayers] = useState([]);
  const [playerA, setPlayerA] = useState(null);
  const [playerB, setPlayerB] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const [pointGen, setPointGen] = useState(null);
  const [pointLog, setPointLog] = useState([]);
  const [simCount, setSimCount] = useState(1000);

  // load players
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
  }, []);

  // stepwise slow sim
  useEffect(() => {
    if (!pointGen) return;
    const timer = setInterval(() => {
      const { value, done } = pointGen.next();
      if (done) clearInterval(timer);
      else setPointLog(prev => [...prev, value]);
    }, 20);
    return () => clearInterval(timer);
  }, [pointGen]);

  const showPlayerError = () => {
    Swal.fire({
      icon: 'error',
      title: 'No Players',
      text: 'Select the players before simulating match results.',
      confirmButtonColor: '#3085d6'
    });
  };

  const handleFast = () => {
    if (!playerA || !playerB) return showPlayerError();
    const pA = [playerA.p1, playerA.p2, playerA.p3, playerA.p4, playerA.p5].map(Number);
    const pB = [playerB.p1, playerB.p2, playerB.p3, playerB.p4, playerB.p5].map(Number);
    const result = simulateBatch(pA, pB, simCount);
    setBatchResult(result);
    setPointLog([]);
    setPointGen(null);
  };

  const handleSlow = () => {
    if (!playerA || !playerB) return showPlayerError();
    const pA = [playerA.p1, playerA.p2, playerA.p3, playerA.p4, playerA.p5].map(Number);
    const pB = [playerB.p1, playerB.p2, playerB.p3, playerB.p4, playerB.p5].map(Number);
    setBatchResult(null);
    setPointLog([]);
    setPointGen(simulateMatchStepwise(pA, pB));
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setPointGen(null);
    setPointLog([]);
  };

  const renderProgressBar = (label, value) => (
    <div className="text-start text-white mb-2">
      <strong>{label}</strong>
      <ProgressBar
        now={value}
        label={`${Math.round(value)}%`}
        variant="success"
        className="bg-dark"
      />
    </div>
  );

  const renderPlayerCard = (player) => (
    <div className="text-center mt-3 border border-success rounded p-3"
         style={{ backgroundColor: '#222', width: '230px' }}>
      <img
        src={playerImgs(`./${player.id}.png`)}
        alt={player.name}
        className="img-fluid rounded shadow"
        style={{ maxHeight: '200px' }}
      />
      <h5 className="text-white mt-3">{player.name}</h5>
      {renderProgressBar('1st Serve In', player.p1 * 100)}
      {renderProgressBar('2nd Serve In', player.p2 * 100)}
      {renderProgressBar('1st Return In', player.p3 * 100)}
      {renderProgressBar('2nd Return In', player.p4 * 100)}
      {renderProgressBar('Volley Win', player.p5 * 100)}
    </div>
  );

  const renderPlaceholder = (img, label) => (
    <div className="text-center mt-3 border rounded p-3"
         style={{ backgroundColor: '#222', width: '230px' }}>
      <img
        src={img}
        alt="placeholder"
        className="img-fluid rounded shadow"
        style={{ maxHeight: '200px', opacity: 0.3 }}
      />
      <h5 className="text-muted mt-3">{label}</h5>
    </div>
  );

  // ===== bulletproof renderSummaryStats() =====
  const renderSummaryStats = () => {
    const lostLabels = ['3–0', '3–1', '3–2'];

    // while slow sim is still streaming, just show a message
    if (
      !batchResult ||
      !Array.isArray(batchResult.matchWins) ||
      !Array.isArray(batchResult.setsWon)
    ) {
      return pointGen ? (
        <h5 className="text-white">Running slow simulation...</h5>
      ) : null;
    }

    const matchWins = batchResult.matchWins;
    const setsWon   = batchResult.setsWon;
    const lostInWins = Array.isArray(batchResult.lostInWins)
      ? batchResult.lostInWins
      : [[], []];

    return (
      <>
        <h5 className="text-white">Simulation Summary ({simCount} Matches)</h5>

        <Table bordered variant="dark" size="sm" className="mt-2">
          <thead>
            <tr>
              <th></th>
              <th>{playerA?.name || 'Player A'}</th>
              <th>{playerB?.name || 'Player B'}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Matches Won</td>
              <td>{matchWins?.[0] ?? '-'}</td>
              <td>{matchWins?.[1] ?? '-'}</td>
            </tr>
            <tr>
              <td>Avg Sets Won</td>
              <td>{setsWon?.[0] ? (setsWon[0] / simCount).toFixed(2) : '-'}</td>
              <td>{setsWon?.[1] ? (setsWon[1] / simCount).toFixed(2) : '-'}</td>
            </tr>
          </tbody>
        </Table>

        <h6 className="text-white mt-3">Wins by Set Scoreline</h6>
        <Table bordered variant="dark" size="sm">
          <thead>
            <tr>
              <th></th>
              {lostLabels.map((lbl, i) => <th key={i}>{lbl}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{playerA?.name || 'Player A'}</td>
              {[0, 1, 2].map(i => (
                <td key={i}>
                  {Array.isArray(lostInWins[0]) && lostInWins[0][i] != null
                    ? lostInWins[0][i]
                    : '-'}
                </td>
              ))}
            </tr>
            <tr>
              <td>{playerB?.name || 'Player B'}</td>
              {[0, 1, 2].map(i => (
                <td key={i}>
                  {Array.isArray(lostInWins[1]) && lostInWins[1][i] != null
                    ? lostInWins[1][i]
                    : '-'}
                </td>
              ))}
            </tr>
          </tbody>
        </Table>
      </>
    );
  };
  // ===== end renderSummaryStats() =====

  return (
    <div className="page-background wimbledon-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles</h3>
        <div className="d-flex justify-content-center align-items-start mb-4">

          {/* Player A picker & card */}
          <div>
            <Dropdown onSelect={id => setPlayerA(players.find(p => p.id === id))}>
              <Dropdown.Toggle variant="light">
                {playerA ? playerA.name : 'Select Player A'}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                {players.map(p => (
                  <Dropdown.Item eventKey={p.id} key={p.id}>{p.name}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
            {playerA
              ? renderPlayerCard(playerA)
              : renderPlaceholder(placeholdera, 'Select Player A')}
          </div>

          {/* Controls + summary */}
          <div className="mx-4">
            <div className="controls mb-3">
              <Form.Group controlId="simCount" className="text-white mb-2">
                <Form.Label>Simulation Count</Form.Label>
                <Form.Select
                  value={simCount}
                  onChange={e => setSimCount(Number(e.target.value))}
                >
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                  <option value={2000}>2000</option>
                </Form.Select>
              </Form.Group>
              <Button variant="warning" onClick={handleSlow}  className="mx-2">Slow</Button>
              <Button variant="warning" onClick={handleFast}  className="mx-2">Fast</Button>
              <Button variant="secondary" onClick={handleReset} className="mx-2">Reset</Button>
            </div>

            {/* Simulation summary */}
            {renderSummaryStats()}

            {/* point-by-point table: only render the `point` events */}
            {pointGen && (
              <div className="point-log mb-3">
                <h5 className="text-white">Point-by-Point Flow</h5>
                <Table striped bordered size="sm" variant="dark">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Set</th>
                      <th>Games A</th>
                      <th>Games B</th>
                      <th>Point A</th>
                      <th>Point B</th>
                      <th>Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pointLog
                      .filter(evt => evt.type === 'point')
                      .map((pt, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{pt.set}</td>
                          <td>{pt.games[0]}</td>
                          <td>{pt.games[1]}</td>
                          <td>{pt.points[0]}</td>
                          <td>{pt.points[1]}</td>
                          <td className={pt.winner === 0 ? 'text-lime' : 'text-magenta'}>
                            {pt.winner === 0 ? playerA.name : playerB.name}
                          </td>
                        </tr>
                      ))
                    }
                  </tbody>
                </Table>
              </div>
            )}
          </div>

          {/* Player B picker & card */}
          <div>
            <Dropdown onSelect={id => setPlayerB(players.find(p => p.id === id))}>
              <Dropdown.Toggle variant="light">
                {playerB ? playerB.name : 'Select Player B'}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                {players.map(p => (
                  <Dropdown.Item eventKey={p.id} key={p.id}>{p.name}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
            {playerB
              ? renderPlayerCard(playerB)
              : renderPlaceholder(placeholderb, 'Select Player B')}
          </div>

        </div>
      </div>
    </div>
  );
}
