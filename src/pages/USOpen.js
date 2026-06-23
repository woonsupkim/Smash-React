import React, { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import Select from 'react-select';
import Swal from 'sweetalert2';
import { Button } from 'react-bootstrap';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import MatchHero from '../components/MatchHero';
import AdvancedSimPanel, { STAT_KEYS } from '../components/AdvancedSimPanel';
import logoUS from '../assets/logo_us.png';
import './USOpen.css';

const playerImgsByTour = {
  atp: require.context('../assets/players', false, /\.png$/),
  wta: require.context('../assets/players-women', false, /\.png$/),
};

// Dark-themed react-select styling — control + the open dropdown menu/options
// all match the app's dark surfaces instead of react-select's default white.
const SELECT_STYLES = {
  container: b => ({...b, minWidth: 230, flex: 1}),
  control: (b, state) => ({
    ...b,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: state.isFocused ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
    boxShadow: 'none',
  }),
  singleValue: p => ({...p,color:'#fff'}),
  input: p => ({...p,color:'#fff'}),
  placeholder: p => ({...p,color:'#888'}),
  menu: b => ({...b, backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)'}),
  menuList: b => ({...b, backgroundColor: '#1a1a1a'}),
  option: (b, state) => ({
    ...b,
    backgroundColor: state.isSelected ? 'rgba(255,255,255,0.18)' : state.isFocused ? 'rgba(255,255,255,0.08)' : 'transparent',
    color: '#fff',
  }),
};

// Matches the "Hard" surface palette used on the Home page.
const ACCENT_COLOR = '#5b8cff';
const ACCENT_TEXT_COLOR = '#0a1330';
// Neon yellow + deep blue — restores US Open's original broadcast-style
// chart palette for the Advanced Controls pie/bar charts specifically.
const PANEL_COLOR_A = '#fff200';
const PANEL_COLOR_B = '#0033A0';
const PANEL_COLOR_A_TEXT = '#1a1a1a';
const PANEL_COLOR_B_TEXT = '#fff';

export default function USOpen({ tour = 'atp' }) {
  const isWta = tour === 'wta';
  const bestOf = isWta ? 3 : 5;
  const dataDir = isWta ? '/data/women' : '/data';
  const playerImgs = playerImgsByTour[tour];
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
  // heavy-recency-weighted stats (7-day half-life) instead of the default
  // 60-day-calibrated CSV — toggling this re-seeds the sliders, it doesn't
  // run a simulation by itself.
  const [upsetMode, setUpsetMode]         = useState(false);
  const watchTimeoutRef = useRef(null);
  const batchRef                          = useRef({ completed: 0, total: 0 });

  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        setPlayers(data.filter(r => Number(r.us_rd) === 2));
      }
    });
    fetch(process.env.PUBLIC_URL + dataDir + '/h2h.json')
      .then(r => r.json())
      .then(setH2hData)
      .catch(() => setH2hData({}));
  }, [dataDir]);

  // Re-seeds both sliders whenever a player changes OR the Upset Scenario
  // toggle flips — upset mode pulls from the heavy-recency CSV instead of
  // the normal season-long one, falling back to normal stats (with a
  // one-time notice) if a player has too few recent matches on this surface.
  useEffect(() => {
    if (!playerA && !playerB) return;
    const seedNormal = (player) => Object.fromEntries(STAT_KEYS.map(([k]) => [k, (player[k] || 0) * 100]));

    if (!upsetMode) {
      if (playerA) setStatsA(seedNormal(playerA));
      if (playerB) setStatsB(seedNormal(playerB));
      return;
    }

    Papa.parse(process.env.PUBLIC_URL + dataDir + '/smash_us_upset.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const rowA = playerA && data.find(r => r.id === playerA.id);
        const rowB = playerB && data.find(r => r.id === playerB.id);
        if (playerA) setStatsA(rowA ? Object.fromEntries(STAT_KEYS.map(([k]) => [k, (Number(rowA[k]) || 0) * 100])) : seedNormal(playerA));
        if (playerB) setStatsB(rowB ? Object.fromEntries(STAT_KEYS.map(([k]) => [k, (Number(rowB[k]) || 0) * 100])) : seedNormal(playerB));
        if ((playerA && !rowA) || (playerB && !rowB)) {
          Swal.fire({
            icon: 'info',
            title: 'Not enough recent data',
            text: 'One or both players have too few recent matches on this surface for an upset scenario — using their normal stats instead.'
          });
        }
      }
    });
  }, [playerA, playerB, upsetMode, dataDir]);

  useEffect(() => {
    return () => { if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current); };
  }, []);

  useEffect(() => {
    if (!batchResult) return;
    setShowResults(false);
    const tid = setTimeout(() => setShowResults(true), 500);
    return () => clearTimeout(tid);
  }, [batchResult]);

  // Switching either player clears any previous result — a stale batch
  // chart or watch-match scoreboard from the old matchup shouldn't linger.
  useEffect(() => {
    if (watchTimeoutRef.current) { clearTimeout(watchTimeoutRef.current); watchTimeoutRef.current = null; }
    setBatchResult(null);
    setLiveLog([]);
    setIsWatching(false);
    setIsRunning(false);
    setProgress(0);
  }, [playerA?.id, playerB?.id]);

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
      const res  = simulateBatch(pA, pB, run, bestOf);

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

  // Only one result view shows at a time — running a batch sim clears any
  // in-progress/finished Watch Match, and vice versa (see handleWatchMatch).
  const stopWatching = () => {
    if (watchTimeoutRef.current) { clearTimeout(watchTimeoutRef.current); watchTimeoutRef.current = null; }
    setLiveLog([]);
    setIsWatching(false);
  };

  const handleSimulate = () => {
    if (!playerA || !playerB) return showPlayerError();
    stopWatching();
    setBatchResult(null);
    setProgress(0);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    runBatch(pA, pB, simCount);
  };

  const randomPick = who => {
    const idx = Math.floor(Math.random() * players.length);
    who === 'A' ? setPlayerA(players[idx]) : setPlayerB(players[idx]);
  };

  const handleWatchMatch = () => {
    if (!playerA || !playerB) return showPlayerError();
    setBatchResult(null);
    if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current);
    const pA = STAT_KEYS.map(([k]) => (statsA[k]||0)/100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k]||0)/100);
    const gen = simulateMatchStepwise(pA, pB, { A: playerA, B: playerB }, bestOf);

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
    <div className="page-background usopen-bg">
      <div className="overlay text-center">
        <MatchHero
          title={isWta ? "US Open Women's · Hard Court" : 'US Open · Hard Court'}
          logo={logoUS}
          playerA={playerA}
          playerB={playerB}
          selectorA={
            <div className="d-flex">
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
                styles={SELECT_STYLES}
              />
              <Button variant="outline-light" size="sm" className="ms-1 random-btn" onClick={()=>randomPick('A')} disabled={isRunning||isWatching}>Random</Button>
            </div>
          }
          selectorB={
            <div className="d-flex">
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
                styles={SELECT_STYLES}
              />
              <Button variant="outline-light" size="sm" className="ms-1 random-btn" onClick={()=>randomPick('B')} disabled={isRunning||isWatching}>Random</Button>
            </div>
          }
          surfaceLabel="Hard Court"
          surfaceKey="hard"
          bestOf={bestOf}
          accentColor={ACCENT_COLOR}
          accentTextColor={ACCENT_TEXT_COLOR}
          h2hData={h2hData}
          getPlayerImageSrc={getPlayerImageSrc}
        />

        <AdvancedSimPanel
          colorA={PANEL_COLOR_A}
          colorB={PANEL_COLOR_B}
          colorAText={PANEL_COLOR_A_TEXT}
          colorBText={PANEL_COLOR_B_TEXT}
          playerA={playerA}
          playerB={playerB}
          getPlayerImageSrc={getPlayerImageSrc}
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
          upsetMode={upsetMode}
          setUpsetMode={setUpsetMode}
          onSimulate={handleSimulate}
          onWatchMatch={handleWatchMatch}
          bestOf={bestOf}
        />
      </div>
    </div>
  );
}
