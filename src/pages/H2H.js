// src/pages/H2H.js
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import Papa from 'papaparse';
import Select from 'react-select';
import { Button, Form } from 'react-bootstrap';
import { toast } from '../components/ui/Toast';
import AppModal from '../components/ui/AppModal';
import { simulateBatch, simulateMatchStepwise } from '../simulator';
import MatchHero from '../components/MatchHero';
import AdvancedSimPanel, { STAT_KEYS } from '../components/AdvancedSimPanel';
import { pickEngineProb, eloProb } from '../engines';
import logoUS from '../assets/logo_us.png';
import logoRG from '../assets/logo_rg.png';
import logoWB from '../assets/logo_wb.png';

const playerImgsByTour = {
  atp: require.context('../assets/players', false, /\.png$/),
  wta: require.context('../assets/players-women', false, /\.png$/),
};

// Dark-themed react-select styling - control + the open dropdown menu/options
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

// Everything that used to be a separate page's hardcoded constants (US
// Open/French Open/Wimbledon) - one entry per surface, switched via the
// dropdown instead of three near-identical page files.
const TOURNAMENT_CONFIGS = {
  clay: {
    csvFile: 'smash_fr.csv', label: 'French Open', logo: logoRG, bgClass: 'french-bg',
    surfaceLabel: 'Clay Court', surfaceKey: 'clay',
    accentColor: '#e8694a', accentTextColor: '#fff',
    panelColorA: '#B24936', panelColorB: '#1E2E2B', panelColorAText: '#fff', panelColorBText: '#fff',
    simulateButtonColor: '#1E2E2B', simulateButtonTextColor: '#fff',
  },
  grass: {
    csvFile: 'smash_wb.csv', label: 'Wimbledon', logo: logoWB, bgClass: 'wimbledon-bg',
    surfaceLabel: 'Grass Court', surfaceKey: 'grass',
    accentColor: '#3ddc84', accentTextColor: '#0b3d1f',
    panelColorA: '#4F2683', panelColorB: '#1E7A45', panelColorAText: '#fff', panelColorBText: '#fff',
  },
  hard: {
    csvFile: 'smash_us.csv', label: 'US Open', logo: logoUS, bgClass: 'usopen-bg',
    surfaceLabel: 'Hard Court', surfaceKey: 'hard',
    accentColor: '#5b8cff', accentTextColor: '#0a1330',
    panelColorA: '#fff200', panelColorB: '#0033A0', panelColorAText: '#1a1a1a', panelColorBText: '#fff',
  },
};
const VALID_SURFACES = Object.keys(TOURNAMENT_CONFIGS);

export default function H2H({ tour = 'atp' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const surfaceParam = searchParams.get('surface');
  const surface = VALID_SURFACES.includes(surfaceParam) ? surfaceParam : 'hard';
  const config = TOURNAMENT_CONFIGS[surface];

  const isWta = tour === 'wta';
  const bestOf = isWta ? 3 : 5;
  const dataDir = isWta ? '/data/women' : '/data';
  const playerImgs = playerImgsByTour[tour];

  const handleSurfaceChange = (value) => {
    const next = new URLSearchParams(searchParams);
    next.set('surface', value);
    setSearchParams(next);
  };

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
  const [eloData, setEloData]             = useState(null);
  const [engine, setEngine]               = useState('smash');
  const [engineAcc, setEngineAcc]         = useState(null);
  const [featuredPair, setFeaturedPair]   = useState(null); // {a,b} ids of the auto-picked "matchup of the day"
  const [loadError, setLoadError]         = useState(false); // roster CSV failed to load
  // The "Hot Streak" engine (upset) simulates on heavy-recency 7-day stats
  // instead of the season CSV - selecting it re-seeds the sliders.
  const upsetMode = engine === 'upset';
  // ids with enough recent same-surface matches for real upset stats
  // (upset_ok=1 in the _upset.csv) - the Hot Streak engine is disabled for anyone else.
  const [upsetOkIds, setUpsetOkIds]       = useState(null);
  const watchTimeoutRef = useRef(null);
  const batchRef                          = useRef({ completed: 0, total: 0 });
  const prevDataDirRef                    = useRef(dataDir);
  const poolDirRef                        = useRef(dataDir); // which tour's CSV the current pool came from

  // Reload whenever the surface (tournament) or tour changes. Player picks
  // are kept and remapped to their row in the new pool by id (rather than
  // cleared) - same player, different surface's stats, so you can see how
  // the matchup shifts across Clay/Grass/Hard. Any previous simulation
  // result is surface-specific, so it's cleared here too.
  useEffect(() => {
    // Switching TOUR (not surface) clears both picks immediately - ATP and
    // WTA ids never overlap, so remapping is impossible, and letting stale
    // players linger for even one render fires spurious effects (e.g. the
    // upset-stats seeding looking them up in the other tour's CSV).
    if (prevDataDirRef.current !== dataDir) {
      prevDataDirRef.current = dataDir;
      setPlayerA(null);
      setPlayerB(null);
      setEngine('smash');
    }
    setLoadError(false);
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + config.csvFile, {
      header: true,
      download: true,
      complete: ({ data }) => {
        const newPool = data.filter(r => Number(r.us_rd) === 2);
        poolDirRef.current = dataDir;
        setPlayers(newPool);
        setLoadError(newPool.length === 0);
        setPlayerA(prev => (prev ? (newPool.find(p => p.id === prev.id) || null) : null));
        setPlayerB(prev => (prev ? (newPool.find(p => p.id === prev.id) || null) : null));
      },
      error: () => setLoadError(true),
    });
    fetch(process.env.PUBLIC_URL + dataDir + '/h2h.json')
      .then(r => r.json())
      .then(setH2hData)
      .catch(() => setH2hData({}));
    fetch(process.env.PUBLIC_URL + dataDir + '/elo.json')
      .then(r => r.json())
      .then(setEloData)
      .catch(() => setEloData({}));
    // Which players have real upset stats on this surface (upset_ok=1)
    setUpsetOkIds(null);
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + config.csvFile.replace('.csv', '_upset.csv'), {
      header: true,
      download: true,
      complete: ({ data }) => {
        setUpsetOkIds(new Set(data.filter(r => r.id && Number(r.upset_ok) === 1).map(r => r.id)));
      },
      error: () => setUpsetOkIds(new Set()),
    });
    setBatchResult(null);
    setLiveLog([]);
    setIsWatching(false);
    setIsRunning(false);
    setProgress(0);
  }, [config.csvFile, dataDir]);

  // Re-seeds both sliders whenever a player changes OR the Upset Scenario
  // toggle flips - upset mode pulls from the heavy-recency CSV instead of
  // the normal season-long one, falling back to normal stats (with a
  // one-time notice) if a player has too few recent matches on this surface.
  useEffect(() => {
    if (!playerA && !playerB) return;
    // Mid-tour-switch: current picks belong to the OTHER tour's pool - skip;
    // this effect re-runs (and early-returns) once the picks are cleared.
    if (poolDirRef.current !== dataDir) return;
    const seedNormal = (player) => Object.fromEntries(STAT_KEYS.map(([k]) => [k, (player[k] || 0) * 100]));

    if (!upsetMode) {
      if (playerA) setStatsA(seedNormal(playerA));
      if (playerB) setStatsB(seedNormal(playerB));
      return;
    }

    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + config.csvFile.replace('.csv', '_upset.csv'), {
      header: true,
      download: true,
      complete: ({ data }) => {
        const rowA = playerA && data.find(r => r.id === playerA.id);
        const rowB = playerB && data.find(r => r.id === playerB.id);
        if (playerA) setStatsA(rowA ? Object.fromEntries(STAT_KEYS.map(([k]) => [k, (Number(rowA[k]) || 0) * 100])) : seedNormal(playerA));
        if (playerB) setStatsB(rowB ? Object.fromEntries(STAT_KEYS.map(([k]) => [k, (Number(rowB[k]) || 0) * 100])) : seedNormal(playerB));
        if ((playerA && !rowA) || (playerB && !rowB)) {
          toast({
            type: 'info',
            title: 'Not enough recent data',
            message: 'One or both players have too few recent matches on this surface for an upset scenario, so their normal stats are used instead.',
          });
        }
      }
    });
  }, [playerA, playerB, upsetMode, dataDir, config.csvFile]);

  useEffect(() => {
    return () => { if (watchTimeoutRef.current) clearTimeout(watchTimeoutRef.current); };
  }, []);

  // Which engine is most accurate for this tour+surface (from the backtest) -
  // drives the "Recommended" badge, and becomes the default when the surface
  // changes (the user can still switch).
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/engine_accuracy.json')
      .then(r => r.json()).then(setEngineAcc).catch(() => setEngineAcc(null));
  }, []);
  const recommendedEngine = engineAcc?.[tour]?.[config.surfaceKey]?.best || 'smash';
  useEffect(() => { setEngine(recommendedEngine); }, [recommendedEngine]);

  // Onboarding: on the first load with nothing picked, preselect a
  // deterministic "matchup of the day" so the landing screen shows a live
  // prediction instead of two empty dropdowns. Fires once per page load; if
  // the user has already picked (or once they change a player) it steps aside.
  const featuredDoneRef = useRef(false);
  useEffect(() => {
    if (featuredDoneRef.current) return;
    if (playerA || playerB) { featuredDoneRef.current = true; return; }
    if (!players.length || poolDirRef.current !== dataDir) return;
    featuredDoneRef.current = true;
    const d = new Date();
    let seed = (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const top = players.slice(0, Math.min(16, players.length));
    const iA = Math.floor(rand() * top.length);
    let iB = Math.floor(rand() * top.length);
    if (iB === iA) iB = (iB + 1) % top.length;
    setPlayerA(top[iA]);
    setPlayerB(top[iB]);
    setFeaturedPair({ a: top[iA].id, b: top[iB].id });
  }, [players, dataDir, playerA, playerB]);

  // Badge shows only while the current picks are still the featured pair.
  const isFeatured = !!(featuredPair && playerA?.id === featuredPair.a && playerB?.id === featuredPair.b);

  useEffect(() => {
    if (!batchResult) return;
    setShowResults(false);
    const tid = setTimeout(() => setShowResults(true), 500);
    return () => clearTimeout(tid);
  }, [batchResult]);

  // Switching either player clears any previous result - a stale batch
  // chart or watch-match scoreboard from the old matchup shouldn't linger.
  useEffect(() => {
    if (watchTimeoutRef.current) { clearTimeout(watchTimeoutRef.current); watchTimeoutRef.current = null; }
    setBatchResult(null);
    setLiveLog([]);
    setIsWatching(false);
    setIsRunning(false);
    setProgress(0);
  }, [playerA?.id, playerB?.id]);

  // Add-player modal state (replaces the old SweetAlert HTML form)
  const [addPlayerFor, setAddPlayerFor] = useState(null); // 'A' | 'B' | null
  const [addForm, setAddForm] = useState({ name: '', stats: Object.fromEntries(STAT_KEYS.map(([k]) => [k, 50])), file: null });

  const handleAddPlayer = (who) => {
    setAddForm({ name: '', stats: Object.fromEntries(STAT_KEYS.map(([k]) => [k, 50])), file: null });
    setAddPlayerFor(who);
  };

  const confirmAddPlayer = async () => {
    if (!addForm.name.trim()) return;
    let imageSrc = null;
    if (addForm.file) {
      imageSrc = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.readAsDataURL(addForm.file);
      });
    }
    const newPlayer = {
      id: `custom-${Date.now()}`,
      name: addForm.name.trim(),
      p1: addForm.stats.p1 / 100,
      p2: addForm.stats.p2 / 100,
      p3: addForm.stats.p3 / 100,
      p4: addForm.stats.p4 / 100,
      p5: addForm.stats.p5 / 100,
      p6: addForm.stats.p6 / 100,
      imageSrc,
      us_rd: 2
    };
    setPlayers(prev => [newPlayer, ...prev]);
    if (addPlayerFor === 'A') setPlayerA(newPlayer);
    else setPlayerB(newPlayer);
    setAddPlayerFor(null);
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

  const showPlayerError = () => toast({
    type: 'warning',
    title: 'No players selected',
    message: 'Pick both Player A and Player B first.',
  });

  // Only one result view shows at a time - running a batch sim clears any
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

  // Excludes whichever player is already picked on the OTHER side, so the
  // same player can never be matched up against themselves - both for the
  // dropdown (the id is simply not offered as an option) and for Random.
  const randomPick = who => {
    const excludeId = who === 'A' ? playerB?.id : playerA?.id;
    const pool = excludeId ? players.filter(p => p.id !== excludeId) : players;
    if (pool.length === 0) return;
    const idx = Math.floor(Math.random() * pool.length);
    who === 'A' ? setPlayerA(pool[idx]) : setPlayerB(pool[idx]);
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

  // Auto-run the detailed batch simulation once both players are picked (and
  // their stats have seeded), and whenever the matchup, engine, or surface
  // changes - so results are ready without clicking. Manual slider tweaks
  // don't re-trigger it (the key is unchanged); use the button to re-run.
  const autoRunKeyRef = useRef(null);
  useEffect(() => {
    if (!playerA || !playerB || isWatching || isRunning) return;
    const readyA = STAT_KEYS.some(([k]) => (statsA[k] || 0) > 0);
    const readyB = STAT_KEYS.some(([k]) => (statsB[k] || 0) > 0);
    if (!readyA || !readyB) return;
    const key = `${playerA.id}|${playerB.id}|${engine}|${config.csvFile}`;
    if (autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;
    handleSimulate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerA, playerB, statsA, statsB, engine, config.csvFile, isWatching]);

  // Reason the Hot Streak engine is unavailable (null = available). Only
  // players with enough recent same-surface matches (upset_ok=1) can use it.
  const upsetDisabledReason = (() => {
    if (!playerA || !playerB || !upsetOkIds) return null;
    const lacking = [playerA, playerB].filter(p => !upsetOkIds.has(p.id)).map(p => p.name);
    if (lacking.length === 0) return null;
    return `${lacking.join(' and ')} ${lacking.length > 1 ? "don't" : "doesn't"} have enough recent ${config.surfaceLabel.toLowerCase()} matches for a hot-streak read.`;
  })();
  const engineDisabled = upsetDisabledReason ? { upset: upsetDisabledReason } : {};

  // If a player switch makes the Hot Streak engine unavailable, fall back.
  useEffect(() => {
    if (engine === 'upset' && upsetDisabledReason) setEngine('smash');
  }, [engine, upsetDisabledReason]);

  // The single authoritative win probability for this matchup: the selected
  // engine applied to the shared 1000-sim batch. Both the MatchHero headline
  // and the AdvancedSimPanel pie render THIS number, so the auto-populated
  // result and the post-"Simulate Matches" result always agree.
  const engineProbA = useMemo(() => {
    if (!playerA || !playerB || !batchResult) return null;
    const total = batchResult.matchWins[0] + batchResult.matchWins[1];
    if (!total) return null;
    const simProb = batchResult.matchWins[0] / total;
    const elo = eloData ? eloProb(eloData[playerA.id], eloData[playerB.id], config.surfaceKey) : null;
    return pickEngineProb(
      engine,
      { sim: simProb, upsetSim: simProb, elo, rankA: playerA.us_seed, rankB: playerB.us_seed },
      tour, config.surfaceKey
    );
  }, [playerA, playerB, batchResult, engine, eloData, tour, config.surfaceKey]);

  const buildOptions = (excludeId) => [
    { value:'add', label:'+ Add Player' },
    ...players.filter(p => p.id !== excludeId).map(p => ({ value:p.id, label:p.name, data:p }))
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
    <div className={`page-background ${config.bgClass}`}>
      <div className="overlay text-center">
        <div className="h2h-artifact">
        {loadError && (
          <div className="h2h-load-error" role="alert">
            <strong>Couldn't load the {config.label} roster.</strong>
            <span> Check your connection and try again.</span>
            <button type="button" onClick={() => handleSurfaceChange(surface)}>Retry</button>
          </div>
        )}
        <MatchHero
          title={`${config.label}${isWta ? " Women's" : ''} · ${config.surfaceLabel}`}
          logo={config.logo}
          badge={isFeatured ? 'Matchup of the day' : null}
          surfaceSelector={
            <Form.Select
              className="dark-select h2h-tournament-select"
              value={surface}
              onChange={e => handleSurfaceChange(e.target.value)}
              disabled={isRunning||isWatching}
            >
              <option value="clay">French Open · Clay</option>
              <option value="grass">Wimbledon · Grass</option>
              <option value="hard">US Open · Hard</option>
            </Form.Select>
          }
          playerA={playerA}
          playerB={playerB}
          selectorA={
            <div className="d-flex">
              <Select
                className="react-select"
                options={buildOptions(playerB?.id)}
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
                options={buildOptions(playerA?.id)}
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
          surfaceLabel={config.surfaceLabel}
          surfaceKey={config.surfaceKey}
          bestOf={bestOf}
          accentColor={config.accentColor}
          accentTextColor={config.accentTextColor}
          h2hData={h2hData}
          eloData={eloData}
          tour={tour}
          engine={engine}
          setEngine={setEngine}
          engineDisabled={engineDisabled}
          recommendedEngine={recommendedEngine}
          winProbOverride={engineProbA}
          getPlayerImageSrc={getPlayerImageSrc}
          poolLoading={players.length === 0}
          statsA={statsA}
          statsB={statsB}
        />

        <AdvancedSimPanel
          colorA={config.panelColorA}
          colorB={config.panelColorB}
          colorAText={config.panelColorAText}
          colorBText={config.panelColorBText}
          simulateButtonColor={config.simulateButtonColor}
          simulateButtonTextColor={config.simulateButtonTextColor}
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
          engine={engine}
          engineWinProbA={engineProbA}
          onSimulate={handleSimulate}
          onWatchMatch={handleWatchMatch}
          bestOf={bestOf}
          tournamentLabel={config.label}
          surfaceLabel={config.surfaceLabel}
          surfaceKey={config.surfaceKey}
          h2hData={h2hData}
        />
        </div>

        <AppModal
          show={!!addPlayerFor}
          onHide={() => setAddPlayerFor(null)}
          title="Add custom player"
          confirmText="Add player"
          onConfirm={confirmAddPlayer}
          confirmDisabled={!addForm.name.trim()}
        >
          <Form.Group className="mb-3">
            <Form.Label>Name</Form.Label>
            <Form.Control
              value={addForm.name}
              onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Player name"
              autoFocus
            />
          </Form.Group>
          {STAT_KEYS.map(([key, label]) => (
            <Form.Group className="mb-2" key={key}>
              <Form.Label className="d-flex justify-content-between">
                <span>{label}</span>
                <span>{addForm.stats[key]}%</span>
              </Form.Label>
              <Form.Range
                min={0} max={100}
                value={addForm.stats[key]}
                onChange={e => setAddForm(f => ({ ...f, stats: { ...f.stats, [key]: +e.target.value } }))}
              />
            </Form.Group>
          ))}
          <Form.Group>
            <Form.Label>Photo (optional)</Form.Label>
            <Form.Control
              type="file"
              accept="image/*"
              onChange={e => setAddForm(f => ({ ...f, file: e.target.files[0] || null }))}
            />
          </Form.Group>
        </AppModal>
      </div>
    </div>
  );
}
