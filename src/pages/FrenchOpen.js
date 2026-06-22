import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import Swal from 'sweetalert2';
import { Button, Form } from 'react-bootstrap';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import MatchHero from '../components/MatchHero';
import AdvancedSimPanel, { STAT_KEYS } from '../components/AdvancedSimPanel';
import './French.css';

const playerImgs = require.context(
  '../assets/players',
  false,
  /\.png$/
);

const ACCENT_COLOR = '#B24936';
const ACCENT_TEXT_COLOR = '#fff';
const PANEL_COLOR_A = '#B24936';
const PANEL_COLOR_B = '#1E2E2B';

export default function FrenchOpen() {
  const [players, setPlayers]             = useState([]);
  const [playerA, setPlayerA]             = useState(null);
  const [playerB, setPlayerB]             = useState(null);
  const [statsA, setStatsA]               = useState({});
  const [statsB, setStatsB]               = useState({});
  const [simCount, setSimCount]           = useState(1000);
  const [isRunning, setIsRunning]         = useState(false);
  const [progress, setProgress]           = useState(0);
  const [batchResult, setBatchResult]     = useState(null);
  const [showResults, setShowResults]     = useState(false);
  const [liveLog, setLiveLog]             = useState([]);
  const [isWatching, setIsWatching]       = useState(false);
  const [h2hData, setH2hData]             = useState(null);
  const watchTimeoutRef = useRef(null);
  const commentaryRef = useRef(null);
  const batchRef                          = useRef({ completed: 0, total: 0 });

  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_fr.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
    fetch(process.env.PUBLIC_URL + '/data/h2h.json')
      .then(r => r.json())
      .then(setH2hData)
      .catch(() => setH2hData({}));
  }, []);

  useEffect(() => {
    if (!playerA) return;
    const obj = {};
    STAT_KEYS.forEach(([k]) => obj[k] = (playerA[k] || 0) * 100);
    setStatsA(obj);
  }, [playerA]);

  useEffect(() => {
    if (!playerB) return;
    const obj = {};
    STAT_KEYS.forEach(([k]) => obj[k] = (playerB[k] || 0) * 100);
    setStatsB(obj);
  }, [playerB]);

  useEffect(() => {
    return () => { if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current); };
  }, []);

  useEffect(() => {
    if (commentaryRef.current) commentaryRef.current.scrollTop = commentaryRef.current.scrollHeight;
  }, [liveLog]);

  useEffect(() => {
    if (!batchResult) return;
    setShowResults(false);
    const tid = setTimeout(() => setShowResults(true), 500);
    return () => clearTimeout(tid);
  }, [batchResult]);

  const handleAddPlayer = async who => {
    const htmlFields = `
      <input id="swal-name" class="swal2-input" placeholder="Name">
      ${STAT_KEYS.map(
        ([key,label]) => `
          <label style="color:#444;margin:4px 0">${label}: <span id="swal-${key}-val">50%</span></label>
          <input id="swal-${key}" type="range" min="0" max="100" value="50"
            class="swal2-range"
            oninput="document.getElementById('swal-${key}-val').innerText = this.value + '%';">
        `
      ).join('')}
      <input type="file" id="swal-file" class="swal2-file" accept="image/*">
    `;
    const { value: form } = await Swal.fire({
      title: 'Add New Player',
      html: htmlFields,
      focusConfirm: false,
      showCancelButton: true,
      preConfirm: () => {
        const name = document.getElementById('swal-name').value;
        if (!name) {
          Swal.showValidationMessage('Name is required');
          return;
        }
        const stats = {};
        STAT_KEYS.forEach(([key]) => {
          stats[key] = +document.getElementById(`swal-${key}`).value;
        });
        const file = document.getElementById('swal-file').files[0] || null;
        return { name, stats, file };
      }
    });
    if (!form) return;

    let imageSrc = null;
    if (form.file) {
      imageSrc = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(form.file);
      });
    }

    const newId = `custom-${Date.now()}`;
    const newPlayer = {
      id: newId,
      name: form.name,
      p1: form.stats.p1 / 100,
      p2: form.stats.p2 / 100,
      p3: form.stats.p3 / 100,
      p4: form.stats.p4 / 100,
      p5: form.stats.p5 / 100,
      p6: form.stats.p6 / 100,
      imageSrc,
      us_rd: 2
    };
    setPlayers(prev => [newPlayer, ...prev]);
    if (who === 'A') setPlayerA(newPlayer);
    else setPlayerB(newPlayer);
  };

  const runBatch = (pA, pB, n) => {
    batchRef.current = { completed: 0, total: n };
    setIsRunning(true);
    setProgress(0);

    const acc = { matchWins: [0,0], lostInWins: [[0,0,0],[0,0,0]] };
    const chunk = 50;

    const step = () => {
      const left = batchRef.current.total - batchRef.current.completed;
      const run  = Math.min(chunk, left);
      const res  = simulateBatch(pA, pB, run);

      acc.matchWins[0] += res.matchWins[0];
      acc.matchWins[1] += res.matchWins[1];
      for (let i=0; i<3; i++) {
        acc.lostInWins[0][i] += res.lostInWins[0][i] || 0;
        acc.lostInWins[1][i] += res.lostInWins[1][i] || 0;
      }

      batchRef.current.completed += run;
      setProgress(Math.round(100 * batchRef.current.completed / batchRef.current.total));

      if (batchRef.current.completed < batchRef.current.total) {
        setTimeout(step, 10);
      } else {
        setBatchResult(acc);
        setIsRunning(false);
      }
    };
    step();
  };

  const showPlayerError = () => Swal.fire({
    icon: 'error',
    title: 'No Players Selected',
    text: 'Please pick both Player A and Player B!',
    confirmButtonColor: '#3085d6'
  });

  const handleSimulate = () => {
    if (!playerA || !playerB) return showPlayerError();
    setBatchResult(null);
    setProgress(0);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    runBatch(pA, pB, simCount);
  };

  const handleUpsetScenario = () => {
    if (!playerA || !playerB) return showPlayerError();
    setBatchResult(null);
    setProgress(0);
    Papa.parse(process.env.PUBLIC_URL + '/data/smash_fr_upset.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const rowA = data.find(r => r.id === playerA.id);
        const rowB = data.find(r => r.id === playerB.id);
        if (!rowA || !rowB) {
          Swal.fire({
            icon: 'info',
            title: 'Not enough recent data',
            text: 'One or both players have too few recent matches on this surface for an upset scenario — try different players.'
          });
          return;
        }
        const pA = STAT_KEYS.map(([k]) => Number(rowA[k]) || 0);
        const pB = STAT_KEYS.map(([k]) => Number(rowB[k]) || 0);
        runBatch(pA, pB, simCount);
      }
    });
  };

  const handleReset = () => {
    setPlayerA(null);
    setPlayerB(null);
    setBatchResult(null);
    setStatsA({});
    setStatsB({});
    setProgress(0);
    setIsRunning(false);
    setLiveLog([]);
    setIsWatching(false);
  };

  const randomPick = who => {
    const idx = Math.floor(Math.random() * players.length);
    who === 'A' ? setPlayerA(players[idx]) : setPlayerB(players[idx]);
  };

  const handleWatchMatch = () => {
    if (!playerA || !playerB) return showPlayerError();
    if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    const gen = simulateMatchStepwise(pA, pB, { A: playerA, B: playerB });

    setLiveLog([]);
    setIsWatching(true);
    const advance = () => {
      const { value, done } = gen.next();
      if (done) { watchTimeoutRef.current = null; return setIsWatching(false); }
      setLiveLog(prev => [...prev, value]);
      watchTimeoutRef.current = setTimeout(advance, 400);
    };
    advance();
  };

  const tennisPointLabel = (a,b) => {
    const labels = ['Love','15','30','40'];
    if (a>=3 && b>=3) {
      if (a===b)                  return 'Deuce';
      else if (a===b+1)          return `Advantage ${playerA.name}`;
      else if (b===a+1)          return `Advantage ${playerB.name}`;
    }
    return `${labels[a]||'40'}-${labels[b]||'40'}`;
  };

  const renderEvent = ev => {
    switch(ev.type) {
      case 'point': {
        const [pa,pb] = ev.points;
        return `🎾 ${tennisPointLabel(pa,pb)}  (Game: ${ev.games[0]}-${ev.games[1]})`;
      }
      case 'game':
        return `🟩 Game to ${ev.gameWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'tiebreak_start':
        return `⏱ Tie-break begins`;
      case 'tiebreak_end':
        return `✅ Tie-break won by ${ev.tiebreakWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'set':
        return `📦 Set ${ev.set} to ${ev.setWinner===0?ev.playerA.name:ev.playerB.name}`;
      case 'match':
        return `🏆 Match won by ${ev.winner==='A'?ev.playerA.name:ev.playerB.name}`;
      default:
        return `🔸 ${ev.type}`;
    }
  };

  const buildOptions = () => [
    { value:'add', label:'+ Add Player' },
    ...players.map(p => ({ value:p.id, label:p.name, data:p }))
  ];

  const getPlayerImageSrc = (player) => {
    if (!player) return null;
    if (player.imageSrc) return player.imageSrc;
    const key = `./${player.id}.png`;
    const keys = playerImgs.keys ? playerImgs.keys() : [];
    if (keys.includes(key)) return playerImgs(key);
    return `${process.env.PUBLIC_URL}/assets/players/default.png`;
  };

  return (
    <div className="page-background french-bg">
      <div className="overlay text-center">
        <h3 className="text-white mb-4">Men's Singles Simulator — French Open</h3>

        <div className="d-flex flex-wrap justify-content-center mb-3">
          <div className="mx-3 text-start">
            <Form.Label className="text-white">Player A</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select"
                options={buildOptions()}
                value={playerA?{value:playerA.id,label:playerA.name}:null}
                onChange={opt => {
                  if (opt.value==='add') handleAddPlayer('A');
                  else setPlayerA(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning||isWatching}
                styles={{
                  container: b => ({...b, minWidth: 260}),
                  option: p => ({...p,color:'#000'}),
                  singleValue: p => ({...p,color:'#000'})
                }}
              />
              <Button variant="light" className="ms-1" onClick={()=>randomPick('A')} disabled={isRunning||isWatching}>🎲</Button>
            </div>
          </div>
          <div className="mx-3 text-start">
            <Form.Label className="text-white">Player B</Form.Label>
            <div className="d-flex mb-2">
              <Select
                className="react-select"
                options={buildOptions()}
                value={playerB?{value:playerB.id,label:playerB.name}:null}
                onChange={opt => {
                  if (opt.value==='add') handleAddPlayer('B');
                  else setPlayerB(opt.data);
                }}
                placeholder="Type to search…"
                isDisabled={isRunning||isWatching}
                styles={{
                  container: b => ({...b, minWidth: 260}),
                  option: p => ({...p,color:'#000'}),
                  singleValue: p => ({...p,color:'#000'})
                }}
              />
              <Button variant="light" className="ms-1" onClick={()=>randomPick('B')} disabled={isRunning||isWatching}>🎲</Button>
            </div>
          </div>
        </div>

        {playerA && playerB ? (
          <MatchHero
            playerA={playerA}
            playerB={playerB}
            surfaceLabel="Clay Court"
            surfaceKey="clay"
            accentColor={ACCENT_COLOR}
            accentTextColor={ACCENT_TEXT_COLOR}
            h2hData={h2hData}
            getPlayerImageSrc={getPlayerImageSrc}
          />
        ) : (
          <div className="text-light mb-4">Select both players to see the matchup.</div>
        )}

        <AdvancedSimPanel
          colorA={PANEL_COLOR_A}
          colorB={PANEL_COLOR_B}
          playerA={playerA}
          playerB={playerB}
          statsA={statsA}
          setStatsA={setStatsA}
          statsB={statsB}
          setStatsB={setStatsB}
          simCount={simCount}
          setSimCount={setSimCount}
          isRunning={isRunning}
          progress={progress}
          batchResult={batchResult}
          showResults={showResults}
          liveLog={liveLog}
          isWatching={isWatching}
          commentaryRef={commentaryRef}
          onSimulate={handleSimulate}
          onUpsetScenario={handleUpsetScenario}
          onWatchMatch={handleWatchMatch}
          onReset={handleReset}
          renderEvent={renderEvent}
        />
      </div>
    </div>
  );
}
