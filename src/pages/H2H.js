// src/pages/H2H.js
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import Papa from 'papaparse';
import Select from 'react-select';
import { Form } from 'react-bootstrap';
import { ArrowLeftRight, Trophy, Check, X } from 'lucide-react';
import { toast } from '../components/ui/Toast';
import AppModal from '../components/ui/AppModal';
import Chip from '../components/ui/Chip';
import { simulateBatch, simulateMatchStepwise, seedFromString } from '../simulator';
import { matchProb } from '../analyticProb';
import AdvancedSimPanel, { STAT_KEYS } from '../components/AdvancedSimPanel';
import { countryFlagUrl } from '../components/countryFlags';
import UiButton from '../components/ui/Button';
import { eloProb, engineProbs, pickEngineProb, ENGINE_LABELS } from '../engines';
import { currentSlamSurface } from '../utils/currentSlam';
import { castCall, fetchTally } from '../utils/matchCalls';
import defaultAvatar from '../assets/player-default.png';
import CONFIG from '../engineConfig.json';
import logoUS from '../assets/logo_us.png';
import logoRG from '../assets/logo_rg.png';
import logoWB from '../assets/logo_wb.png';
import './H2HStudio.css';

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

// A roster row is usable only if it carries real serve/return/rally rates.
// Blank rows (ranked players without enough recent match data) sim to nonsense.
const hasStats = (r) => ['p1', 'p2', 'p3', 'p4', 'p5'].every((k) => Number(r[k]) > 0);

// Fallback headshot when a player has no image (or it fails to load).
// Bundled (not in gitignored /public/assets) so the fallback actually ships
// to production for the many rostered players without a headshot yet.
const DEFAULT_IMG = defaultAvatar;
const imgFallback = (e) => { e.currentTarget.onerror = null; e.currentTarget.src = DEFAULT_IMG; };

// Per-engine field names in track_record.json, so the credibility line and
// receipts can be scored with the same engine that drives the verdict.
const ENGINE_FIELDS = {
  smash: { prob: 'smashProbP1', correct: 'smashCorrect' },
  sim:   { prob: 'probP1',      correct: 'correct' },
  elo:   { prob: 'eloProbP1',   correct: 'eloCorrect' },
  rank:  { prob: 'rankProbP1',  correct: 'rankCorrect' },
  upset: { prob: 'upsetProbP1', correct: 'upsetCorrect' },
};

export default function H2H({ tour = 'atp' }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const surfaceParam = searchParams.get('surface');
  // No explicit surface in the URL: default to the slam that's live or up
  // next (grass during Wimbledon, clay in the French Open run-up, etc.).
  const surface = VALID_SURFACES.includes(surfaceParam) ? surfaceParam : currentSlamSurface();
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

  // Tour lives on this page (and Brackets), not in the global header: switching
  // navigates between the ATP and /women mirror of the current path, keeping
  // the surface query so you stay on the same tournament.
  const navigate = useNavigate();
  const location = useLocation();
  const switchTour = (nextIsWta) => {
    const base = location.pathname.replace(/^\/women/, '') || '/';
    navigate((nextIsWta ? '/women' + base : base) + location.search);
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
  // The studio auto-selects the most accurate engine for this tour+surface
  // (same selector the deployed calls use); the Detailed simulation drawer
  // has a manual picker to run any engine, and switching tour or surface
  // snaps back to the recommended one.
  const [engine, setEngine]               = useState('smash');
  const [engineAcc, setEngineAcc]         = useState(null);
  const [featuredPair, setFeaturedPair]   = useState(null); // {a,b} ids of the auto-picked "matchup of the day"
  const [loadError, setLoadError]         = useState(false); // roster CSV failed to load
  // The "Hot Streak" engine (upset) simulates on heavy-recency 7-day stats
  // instead of the season CSV - selecting it re-seeds the sliders.
  const upsetMode = engine === 'upset'; // picking Hot Streak re-seeds the sliders with 7-day stats
  const watchTimeoutRef = useRef(null);
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
    }
    setLoadError(false);
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + config.csvFile, {
      header: true,
      download: true,
      complete: ({ data }) => {
        // Only players with real computed stats are selectable. The expanded
        // top-120 roster includes ranked players who lack enough recent match
        // data (blank p1-p5); those would sim to nonsense, so drop them.
        const newPool = data.filter(r => Number(r.us_rd) === 2 && hasStats(r));
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

  // Most accurate engine per tour+surface, from the backtest summary.
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/engine_accuracy.json')
      .then((r) => r.json()).then(setEngineAcc).catch(() => setEngineAcc(null));
  }, []);
  const bestEngine = engineAcc?.[tour]?.[config.surfaceKey]?.best || 'smash';
  const bestEngineAccPct = engineAcc?.[tour]?.[config.surfaceKey]?.[bestEngine] ?? null;
  useEffect(() => { setEngine(bestEngine); }, [bestEngine]);

  // Manual engine picker options for the Detailed simulation drawer: the
  // five engines with their season accuracy in THIS tour x surface cell,
  // the recommended (deployed) one starred.
  const engineOptions = useMemo(() => {
    const cell = engineAcc?.[tour]?.[config.surfaceKey] || {};
    return [
      { id: 'smash', label: 'Smart Blend' },
      { id: 'sim', label: 'Point Sim' },
      { id: 'elo', label: 'Form' },
      { id: 'upset', label: 'Hot Streak' },
      { id: 'rank', label: 'Rankings' },
    ].map((e) => ({ ...e, acc: cell[e.id] ?? null, recommended: e.id === bestEngine }));
  }, [engineAcc, tour, config.surfaceKey, bestEngine]);

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

    // Deep link: /h2h?surface=grass&a=zvere&b=sinne preselects that exact
    // matchup (used by Home's "Live now" cards). Overrides the featured pick.
    const aId = searchParams.get('a');
    const bId = searchParams.get('b');
    if (aId || bId) {
      const a = players.find((p) => p.id === aId);
      const b = players.find((p) => p.id === bId);
      if (a) setPlayerA(a);
      if (b) setPlayerB(b);
      if (a || b) return;
    }

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
    // Reads searchParams once on first pool load; intentionally not reactive to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setIsRunning(true);
    setProgress(0);
    // Seed the whole batch from the matchup so the probability is identical on
    // every reload (no Monte Carlo jitter). 1000 sims run in a single pass, so
    // there is no need to chunk for progress. The seed folds in the stats so
    // slider what-ifs still change the result deterministically.
    const key = [playerA?.id, playerB?.id].sort().join('_') + '|' + config.surfaceKey + '|' + tour
      + '|' + pA.map((v) => Math.round(v * 1000)).join(',') + '|' + pB.map((v) => Math.round(v * 1000)).join(',');
    const res = simulateBatch(pA, pB, n, bestOf, seedFromString(key));
    setProgress(100);
    setBatchResult({ matchWins: res.matchWins, lostInWins: res.lostInWins });
    setIsRunning(false);
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

  // Auto-run the detailed batch simulation once both players are picked and
  // their stats have seeded, re-running whenever the matchup, engine, surface,
  // or the stats themselves change. The stats are in the key so that when the
  // Hot Streak engine swaps in its hot-form stats (loaded async), the Verdict
  // re-simulates on them instead of being stuck on the season values - and so
  // slider what-ifs update the Verdict live.
  const autoRunKeyRef = useRef(null);
  useEffect(() => {
    if (!playerA || !playerB || isWatching || isRunning) return;
    const readyA = STAT_KEYS.some(([k]) => (statsA[k] || 0) > 0);
    const readyB = STAT_KEYS.some(([k]) => (statsB[k] || 0) > 0);
    if (!readyA || !readyB) return;
    const statsSig = STAT_KEYS.map(([k]) => `${Math.round(statsA[k] || 0)}-${Math.round(statsB[k] || 0)}`).join(',');
    const key = `${playerA.id}|${playerB.id}|${engine}|${config.csvFile}|${statsSig}`;
    if (autoRunKeyRef.current === key) return;
    autoRunKeyRef.current = key;
    handleSimulate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerA, playerB, statsA, statsB, engine, config.csvFile, isWatching]);

  // All engine probabilities for this matchup, driven by the shared batch.
  // The Verdict headline uses probs.smash (the flagship Smart Blend), and the
  // Why panel decomposes that same number, so the headline and its explanation
  // can never disagree. `engineProbA` (smash P(A wins)) also feeds the Explore
  // drawer so its pie matches the Verdict exactly.
  const probs = useMemo(() => {
    if (!playerA || !playerB || !batchResult) return null;
    const total = batchResult.matchWins[0] + batchResult.matchWins[1];
    if (!total) return null;
    // Engine probability comes from the CLOSED-FORM match model on the
    // current (slider-adjusted) stats - the exact expectation the batch
    // converges to, and digit-identical to the pipeline's locked number.
    // The Monte Carlo batch still powers the charts and scorelines.
    const pA = STAT_KEYS.map(([k]) => (statsA[k] || 0) / 100);
    const pB = STAT_KEYS.map(([k]) => (statsB[k] || 0) / 100);
    const sim = matchProb(pA, pB, bestOf);
    const elo = eloData ? eloProb(eloData[playerA.id], eloData[playerB.id], config.surfaceKey) : null;
    return engineProbs({ sim, elo, rankA: playerA.us_seed, rankB: playerB.us_seed }, tour, config.surfaceKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerA, playerB, batchResult, statsA, statsB, bestOf, eloData, tour, config.surfaceKey]);
  // Headline P(A wins) from the best engine for this surface. The batch already
  // reflects hot-form stats when that engine is 'upset' (the seeding effect
  // swaps them in), so pickEngineProb reads the right point-sim number.
  const engineProbA = useMemo(() => {
    if (!probs || !playerA || !playerB) return null;
    return pickEngineProb(
      engine,
      { sim: probs.sim, upsetSim: probs.sim, elo: probs.elo, rankA: playerA.us_seed, rankB: playerB.us_seed },
      tour, config.surfaceKey
    );
  }, [probs, engine, playerA, playerB, tour, config.surfaceKey]);

  // One retellable sentence: which signals back the pick and which dissent.
  const whySentence = useMemo(() => {
    if (!probs || engineProbA == null || !playerA || !playerB) return null;
    const favIsA = engineProbA >= 0.5;
    const agreesWithFav = (p) => (p == null ? null : (p >= 0.5) === favIsA);
    const comps = [
      { name: 'the point-by-point sim', agrees: agreesWithFav(probs.sim) },
      { name: `recent ${config.surfaceLabel.toLowerCase()} form`, agrees: agreesWithFav(probs.elo) },
      { name: 'the world rankings', agrees: agreesWithFav(probs.rank) },
    ].filter((c) => c.agrees != null);
    if (!comps.length) return null;
    const fav = (favIsA ? playerA : playerB).name.split(' ').pop();
    const list = (arr) => (arr.length === 1 ? arr[0] : `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`);
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const agree = comps.filter((c) => c.agrees).map((c) => c.name);
    const dissent = comps.filter((c) => !c.agrees).map((c) => c.name);
    if (!dissent.length) return `Everything points the same way: ${list(agree)} all back ${fav}.`;
    if (!agree.length) return `A genuine split decision - no single signal carries ${fav} alone.`;
    return `${cap(list(agree))} back${agree.length === 1 ? 's' : ''} ${fav}; ${list(dissent)} lean${dissent.length === 1 ? 's' : ''} the other way.`;
  }, [probs, engineProbA, playerA, playerB, config.surfaceLabel]);

  // ── Verdict values (Smart Blend is "the model") ─────────────────────────
  const bothPicked = !!(playerA && playerB);
  const probA = engineProbA; // smash P(A wins), or null until the batch lands
  const favoredIsA = probA != null ? probA >= 0.5 : true;
  const favPlayer = favoredIsA ? playerA : playerB;
  const dogPlayer = favoredIsA ? playerB : playerA;
  const favPct = probA != null ? Math.round(Math.max(probA, 1 - probA) * 100) : null;

  const scoreline = useMemo(() => {
    if (!batchResult || probA == null) return null;
    const favIdx = favoredIsA ? 0 : 1;
    const target = Math.ceil(bestOf / 2);
    const dist = batchResult.lostInWins[favIdx].slice(0, target);
    let maxI = 0;
    for (let i = 1; i < dist.length; i++) if ((dist[i] || 0) > (dist[maxI] || 0)) maxI = i;
    return `${target}–${maxI}`;
  }, [batchResult, probA, favoredIsA, bestOf]);

  // How the Smart Blend adds up: each component's signed push toward the
  // favored player, in probability points (they sum to favPct - 50).
  const attribution = useMemo(() => {
    if (!probs) return null;
    const w = (CONFIG.weights[tour] && CONFIG.weights[tour][config.surfaceKey]) || { ws: 0.5, we: 0.5, wr: 0 };
    const sim = probs.sim;
    const elo = probs.elo == null ? probs.sim : probs.elo;
    const rank = probs.rank;
    const sign = favoredIsA ? 1 : -1;
    const toPts = (wt, p) => Math.round(wt * (p - 0.5) * 100 * sign * 10) / 10;
    return [
      { id: 'sim', label: 'Point simulation', pts: toPts(w.ws, sim) },
      { id: 'elo', label: 'Surface form (Elo)', pts: toPts(w.we, elo), estimated: probs.elo == null },
      { id: 'rank', label: 'World ranking', pts: toPts(w.wr, rank) },
    ];
  }, [probs, favoredIsA, tour, config.surfaceKey]);

  // Track-record data powers the credibility line + the receipts (how the
  // model has actually done on matchups this lopsided, on this surface).
  const [trackData, setTrackData] = useState(null);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json()).then(setTrackData).catch(() => setTrackData({ matches: [] }));
  }, []);

  const receipts = useMemo(() => {
    if (!trackData || probA == null) return null;
    // Score the band and accuracy with the SAME engine that drives the verdict,
    // so the credibility line and the headline never cite different models.
    const F = ENGINE_FIELDS[engine] || ENGINE_FIELDS.smash;
    const favProb = Math.max(probA, 1 - probA);
    const band = (trackData.matches || []).filter((m) => {
      if (m.tour !== tour || m.surface !== config.surfaceKey) return false;
      const p = m[F.prob];
      if (typeof p !== 'number') return false;
      const fp = p >= 0.5 ? p : 1 - p;
      return Math.abs(fp - favProb) <= 0.07;
    });
    const acc = band.length ? Math.round((band.filter((m) => m[F.correct]).length / band.length) * 100) : null;
    const examples = band.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5).map((m) => {
      const wIsP1 = m.winner === m.p1;
      return { wName: wIsP1 ? m.name1 : m.name2, lName: wIsP1 ? m.name2 : m.name1, score: m.score, right: m[F.correct] };
    });
    return { acc, n: band.length, examples, lo: Math.round((favProb - 0.07) * 100), hi: Math.round(Math.min(1, favProb + 0.07) * 100) };
  }, [trackData, probA, engine, tour, config.surfaceKey]);

  // Live matches: current locked (not-yet-played) Slam predictions for this
  // tour, so you can drop straight into a real matchup instead of searching.
  const [livePicks, setLivePicks] = useState([]);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setLivePicks((d.predictions || []).filter((p) => p.tour === tour && p.status === 'pending').slice(0, 6)))
      .catch(() => setLivePicks([]));
  }, [tour]);
  const pickLiveMatch = (p) => {
    const a = players.find((x) => x.id === p.p1);
    const b = players.find((x) => x.id === p.p2);
    if (a) setPlayerA(a);
    if (b) setPlayerB(b);
    if (p.surface && p.surface !== surface) handleSurfaceChange(p.surface);
  };

  const swapPlayers = () => { const a = playerA; setPlayerA(playerB); setPlayerB(a); };

  // ── Make Your Call: your pick, stored locally, graded against real results ─
  const callKey = bothPicked ? `${[playerA.id, playerB.id].sort().join('_')}|${config.surfaceKey}|${tour}` : null;
  const [userPick, setUserPick] = useState(null);
  useEffect(() => {
    if (!callKey) { setUserPick(null); return; }
    try { const s = JSON.parse(localStorage.getItem('smashCalls') || '{}'); setUserPick(s[callKey]?.pick || null); } catch { setUserPick(null); }
  }, [callKey]);
  const makeCall = (pid) => {
    if (!callKey || !playerA || !playerB) return;
    setUserPick(pid);
    try {
      const s = JSON.parse(localStorage.getItem('smashCalls') || '{}');
      s[callKey] = { pick: pid, modelPick: favoredIsA ? playerA.id : playerB.id, p1: playerA.id, p2: playerB.id, name1: playerA.name, name2: playerB.name, surface: config.surfaceKey, tour, date: Date.now() };
      localStorage.setItem('smashCalls', JSON.stringify(s));
    } catch { /* storage unavailable */ }
    // Community tally (cloud only): cast, then re-read so the bar reflects
    // your vote. A repeat vote on the same matchup is ignored server-side.
    castCall(callKey, pid).then(() => fetchTally(callKey).then((t) => t && setFanTally(t)));
  };

  // Who the fans back on this matchup (null when cloud is off or empty).
  const [fanTally, setFanTally] = useState(null);
  useEffect(() => {
    let alive = true;
    setFanTally(null);
    if (callKey) fetchTally(callKey).then((t) => { if (alive) setFanTally(t); });
    return () => { alive = false; };
  }, [callKey]);

  // Your record vs the model: grade every stored call whose matchup has since
  // been decided in the track record.
  const youVsModel = useMemo(() => {
    if (!trackData) return null;
    let store; try { store = JSON.parse(localStorage.getItem('smashCalls') || '{}'); } catch { return null; }
    const byPair = new Map();
    for (const m of (trackData.matches || [])) {
      const key = [m.p1, m.p2].sort().join('_');
      const prev = byPair.get(key);
      if (!prev || new Date(m.date) > new Date(prev.date)) byPair.set(key, m);
    }
    let youRight = 0, modelRight = 0, graded = 0;
    for (const k of Object.keys(store)) {
      const c = store[k];
      const m = byPair.get([c.p1, c.p2].sort().join('_'));
      if (!m) continue;
      if (new Date(m.date).getTime() < c.date - 2 * 864e5) continue; // only grade matches at/after the call
      graded++;
      if (c.pick === m.winner) youRight++;
      if (c.modelPick === m.winner) modelRight++;
    }
    return graded ? { graded, youRight, modelRight } : null;
    // userPick is intentional: it re-grades the moment you lock a new call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackData, userPick]);

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
    return DEFAULT_IMG;
  };

  const selectStyles = SELECT_STYLES;
  const renderSelect = (who) => (
    <div className="studio-pick-row">
      <Select
        className="react-select"
        options={buildOptions((who === 'A' ? playerB : playerA)?.id)}
        value={(who === 'A' ? playerA : playerB) ? { value: (who === 'A' ? playerA : playerB).id, label: (who === 'A' ? playerA : playerB).name } : null}
        onChange={(opt) => {
          if (opt.value === 'add') handleAddPlayer(who);
          else (who === 'A' ? setPlayerA : setPlayerB)(opt.data);
        }}
        placeholder="Search a player…"
        isDisabled={isRunning || isWatching}
        styles={selectStyles}
        aria-label={`Player ${who}`}
      />
      <UiButton variant="ghost" size="sm" aria-label={`Pick a random player for slot ${who}`} onClick={() => randomPick(who)} className="studio-random">Random</UiButton>
    </div>
  );

  return (
    <div className={`page-background ${config.bgClass}`}>
      <div className="overlay">
        <div className="studio">

          {/* Header: tournament + surface segmented control */}
          <div className="studio-head">
            <h1 className="studio-title">
              <img src={config.logo} alt="" className="studio-logo" />
              <span className="studio-title-text">{config.label}{isWta ? " Women's" : ''}</span>
              <span className="studio-title-sub">{config.surfaceLabel} · Best of {bestOf}</span>
            </h1>
            <div className="studio-controls">
              <div className="studio-surface-seg" role="group" aria-label="Tour">
                <button type="button" className={`studio-seg-btn${!isWta ? ' active' : ''}`} onClick={() => switchTour(false)}>ATP</button>
                <button type="button" className={`studio-seg-btn${isWta ? ' active' : ''}`} onClick={() => switchTour(true)}>WTA</button>
              </div>
              <div className="studio-surface-seg" role="group" aria-label="Surface">
                {[['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']].map(([v, l]) => (
                  <button key={v} type="button" className={`studio-seg-btn${surface === v ? ' active' : ''}`} onClick={() => handleSurfaceChange(v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>

          {loadError && (
            <div className="h2h-load-error" role="alert">
              <strong>Couldn't load the {config.label} roster.</strong>
              <span> Check your connection and try again.</span>
              <UiButton variant="danger" size="sm" onClick={() => handleSurfaceChange(surface)}>Retry</UiButton>
            </div>
          )}

          {/* Setup: two searchable picks + swap */}
          <div className="studio-setup">
            <div className="studio-pick">
              <span className="studio-pick-label">Player A</span>
              {renderSelect('A')}
            </div>
            <button type="button" className="studio-swap" onClick={swapPlayers} disabled={!bothPicked} aria-label="Swap the two players">
              <ArrowLeftRight size={16} />
            </button>
            <div className="studio-pick">
              <span className="studio-pick-label">Player B</span>
              {renderSelect('B')}
            </div>
          </div>

          {/* Live matches: drop straight into a real matchup */}
          {livePicks.length > 0 && (
            <div className="studio-live">
              <span className="studio-live-label"><span className="studio-live-dot" /> Live now</span>
              <div className="studio-live-row">
                {livePicks.map((p) => (
                  <button key={p.id} type="button" className="studio-live-chip" onClick={() => pickLiveMatch(p)}>
                    {p.name1.split(' ').pop()} vs {p.name2.split(' ').pop()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!bothPicked ? (
            <div className="studio-empty">
              {players.length === 0 ? 'Loading the roster…' : 'Pick two players to see the verdict.'}
            </div>
          ) : (
            <>
              {/* ── The Verdict ─────────────────────────────────────────── */}
              <section className="studio-verdict" style={{ '--accent': config.accentColor }}>
                {isFeatured && <Chip tone="accent" className="studio-featured-chip">Matchup of the day</Chip>}
                <div className="verdict-eyebrow">The verdict</div>
                {favPct != null ? (
                  <div className="verdict-headline">
                    <strong>{favPlayer.name.split(' ').pop()}</strong> is the pick
                    <span className="verdict-pct" style={{ color: config.accentColor }}>{favPct}%</span>
                  </div>
                ) : (
                  <div className="verdict-headline verdict-loading">Running the simulation…</div>
                )}

                <div className="verdict-faces">
                  <PlayerFace player={playerA} favored={probA != null && favoredIsA} accent={config.accentColor} getImg={getPlayerImageSrc} />
                  <div className="verdict-vs">vs</div>
                  <PlayerFace player={playerB} favored={probA != null && !favoredIsA} accent={config.accentColor} getImg={getPlayerImageSrc} align="right" />
                </div>

                {favPct != null && (
                  <>
                    <div className="verdict-bar">
                      <div className="verdict-bar-fill" style={{ width: `${Math.round(probA * 100)}%`, background: favoredIsA ? config.accentColor : 'var(--surface-3)' }} />
                      <div className="verdict-bar-fill" style={{ width: `${100 - Math.round(probA * 100)}%`, background: !favoredIsA ? config.accentColor : 'var(--surface-3)' }} />
                    </div>
                    <div className="verdict-bar-labels">
                      <span style={{ fontWeight: favoredIsA ? 700 : 400 }}>{playerA.name.split(' ').pop()} {Math.round(probA * 100)}%</span>
                      <span style={{ fontWeight: !favoredIsA ? 700 : 400 }}>{playerB.name.split(' ').pop()} {100 - Math.round(probA * 100)}%</span>
                    </div>
                    {scoreline && (
                      <div className="verdict-scoreline">Most likely: <strong>{favPlayer.name.split(' ').pop()}</strong> wins {scoreline} in sets</div>
                    )}
                    <div className="verdict-powered">
                      Powered by <strong>{ENGINE_LABELS[engine] || 'Smart Blend'}</strong>
                      {bestEngineAccPct != null ? `, our strongest engine on ${config.surfaceLabel.toLowerCase()} (${bestEngineAccPct}% of winners on our record)` : ''}.
                    </div>
                    {receipts && receipts.acc != null && receipts.n >= 8 && (
                      <div className="verdict-credibility">
                        <Trophy size={14} /> <strong>Track record:</strong> when {ENGINE_LABELS[engine] || 'Smart Blend'} has
                        been this confident on {config.surfaceLabel.toLowerCase()} ({receipts.lo}{'–'}{receipts.hi}% favorite),
                        its pick has been right <strong>{receipts.acc}%</strong> of the time ({receipts.n} past matches).{' '}
                        <Link to="/methodology" className="verdict-method-link">How it works</Link>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* ── Why ─────────────────────────────────────────────────── */}
              {attribution && favPct != null && (
                <section className="studio-card">
                  <div className="studio-card-title">Why {favPlayer.name.split(' ').pop()}</div>
                  {whySentence && <p className="why-sentence">{whySentence}</p>}
                  <p className="studio-card-sub">
                    {engine === 'smash'
                      ? 'What pushes the Smart Blend toward each player, in probability points.'
                      : `How each model signal leans. The headline uses ${ENGINE_LABELS[engine]}, our strongest engine on ${config.surfaceLabel.toLowerCase()}.`}
                  </p>
                  <div className="why-attr">
                    {attribution.map((c) => {
                      const pos = c.pts >= 0;
                      const maxAbs = Math.max(1, ...attribution.map((x) => Math.abs(x.pts)));
                      const w = (Math.abs(c.pts) / maxAbs) * 46;
                      return (
                        <div className="why-attr-row" key={c.id}>
                          <div className="why-attr-name">{c.label}{c.estimated && <span className="why-attr-est"> (est.)</span>}</div>
                          <div className="why-attr-track">
                            <div className="why-attr-zero" />
                            <div className={`why-attr-fill ${pos ? 'pos' : 'neg'}`} style={{ width: `${w}%`, left: pos ? '50%' : `${50 - w}%`, background: pos ? config.accentColor : 'var(--accent-negative)' }} />
                          </div>
                          <div className={`why-attr-val ${pos ? 'pos' : 'neg'}`}>{pos ? '+' : '−'}{Math.abs(c.pts).toFixed(1)}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="why-attr-legend">
                    {engine === 'smash'
                      ? `Bars toward ${favPlayer.name.split(' ').pop()} (right) and ${dogPlayer.name.split(' ').pop()} (left) sum to the ${favPct}% call.`
                      : `The signals feeding our models: right leans to ${favPlayer.name.split(' ').pop()}, left to ${dogPlayer.name.split(' ').pop()}.`}
                  </div>

                  {/* Stat comparison: the raw evidence */}
                  <div className="why-stats">
                    {STAT_KEYS.map(([key, label]) => {
                      const a = Math.round(statsA[key] || 0);
                      const b = Math.round(statsB[key] || 0);
                      const total = a + b || 1;
                      return (
                        <div className="why-stat-row" key={key}>
                          <div className={`why-stat-val a${a >= b ? ' lead' : ''}`}>{a}</div>
                          <div className="why-stat-mid">
                            <div className="why-stat-label">{label}</div>
                            <div className="why-stat-bar">
                              <div className="why-stat-bar-a" style={{ width: `${(a / total) * 100}%`, background: config.accentColor }} />
                              <div className="why-stat-bar-b" style={{ width: `${(b / total) * 100}%` }} />
                            </div>
                          </div>
                          <div className={`why-stat-val b${b > a ? ' lead' : ''}`}>{b}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="why-stats-legend">
                    <span>{playerA.name.split(' ').pop()}</span>
                    <span className="why-stats-legend-hint">Edit these under Explore to run what-ifs</span>
                    <span>{playerB.name.split(' ').pop()}</span>
                  </div>
                </section>
              )}

              {/* ── Make your call ──────────────────────────────────────── */}
              {favPct != null && (
                <section className="studio-card studio-call">
                  <div className="studio-card-title">Make your call</div>
                  <p className="studio-card-sub">Lock your pick before the match. Real matchups grade automatically when the result lands.</p>
                  <div className="call-buttons">
                    {[playerA, playerB].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`call-btn${userPick === p.id ? ' picked' : ''}`}
                        onClick={() => makeCall(p.id)}
                        style={userPick === p.id ? { borderColor: config.accentColor } : undefined}
                      >
                        <img src={getPlayerImageSrc(p)} alt="" className="call-btn-img" onError={imgFallback} />
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                  {userPick && (
                    <div className="call-result">
                      You backed <strong>{(userPick === playerA.id ? playerA : playerB).name.split(' ').pop()}</strong>.
                      {' '}The model backs <strong>{favPlayer.name.split(' ').pop()}</strong>.
                      {userPick === (favoredIsA ? playerA.id : playerB.id)
                        ? ' You agree.'
                        : ' Bold call: you are fading the model.'}
                    </div>
                  )}
                  {youVsModel && (
                    <div className="call-record">
                      Your record vs the model: <strong>you {youVsModel.youRight}/{youVsModel.graded}</strong>, model {youVsModel.modelRight}/{youVsModel.graded}.
                    </div>
                  )}
                  {fanTally && (fanTally.counts[playerA.id] || 0) + (fanTally.counts[playerB.id] || 0) > 0 && (() => {
                    const a = fanTally.counts[playerA.id] || 0;
                    const b = fanTally.counts[playerB.id] || 0;
                    const tot = a + b;
                    const pctA = Math.round((a / tot) * 100);
                    return (
                      <div className="call-tally">
                        <div className="call-tally-bar">
                          <div className="call-tally-fill" style={{ width: `${pctA}%`, background: config.accentColor }} />
                        </div>
                        <div className="call-tally-line">
                          Fans back <strong>{pctA >= 50 ? playerA.name.split(' ').pop() : playerB.name.split(' ').pop()} {Math.max(pctA, 100 - pctA)}%</strong>
                          <span className="call-tally-n"> · {tot.toLocaleString()} call{tot === 1 ? '' : 's'} so far</span>
                        </div>
                      </div>
                    );
                  })()}
                </section>
              )}

              {/* ── Receipts: comparable past matchups ──────────────────── */}
              {receipts && receipts.examples.length > 0 && (
                <section className="studio-card">
                  <div className="studio-card-title">Comparable calls</div>
                  <p className="studio-card-sub">Recent {config.surfaceLabel.toLowerCase()} matchups the model rated about this lopsided ({receipts.lo}-{receipts.hi}% favorites), and how they went.</p>
                  <div className="receipts-list">
                    {receipts.examples.map((ex, i) => (
                      <div className="receipt-row" key={i}>
                        <span className={`receipt-mark ${ex.right ? 'hit' : 'miss'}`}>{ex.right ? <Check size={14} /> : <X size={14} />}</span>
                        <span className="receipt-text"><strong>{ex.wName.split(' ').pop()}</strong> beat {ex.lName.split(' ').pop()} {ex.score}</span>
                        <span className="receipt-verdict">{ex.right ? 'model right' : 'model wrong'}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Explore the full simulation (power-user drawer) ─────── */}
              <details className="studio-drawer">
                <summary>Explore the full simulation</summary>
                <AdvancedSimPanel
                  colorA={config.accentColor}
                  colorB="#6b7280"
                  colorAText={config.accentTextColor}
                  colorBText="#ffffff"
                  simulateButtonColor={config.accentColor}
                  simulateButtonTextColor={config.accentTextColor}
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
                  engineOptions={engineOptions}
                  onEngineChange={setEngine}
                  engineWinProbA={engineProbA}
                  onSimulate={handleSimulate}
                  onWatchMatch={handleWatchMatch}
                  bestOf={bestOf}
                  tournamentLabel={config.label}
                  surfaceLabel={config.surfaceLabel}
                  surfaceKey={config.surfaceKey}
                  h2hData={h2hData}
                />
              </details>
            </>
          )}
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

// A single player in the Verdict: photo (accent ring + "Favored" badge when
// the model favors them), name with flag, rank and age.
function PlayerFace({ player, favored, accent, getImg, align = 'left' }) {
  const flag = countryFlagUrl(player.country);
  return (
    <div className={`verdict-face ${align}${favored ? ' favored' : ''}`}>
      <div className="verdict-face-photo-wrap">
        <img
          src={getImg(player)}
          alt={player.name}
          className="verdict-face-photo"
          onError={imgFallback}
          style={favored ? { borderColor: accent, boxShadow: `0 0 0 4px rgba(255,255,255,0.06), 0 0 22px -2px ${accent}` } : undefined}
        />
        {favored && <span className="verdict-face-badge" style={{ background: accent }}>Favored</span>}
      </div>
      <div className="verdict-face-name">
        {flag && <img src={flag} alt="" className="verdict-face-flag" />}
        <span>{player.name}</span>
      </div>
      <div className="verdict-face-meta">
        {player.us_seed != null && player.us_seed !== '' && <span>Rank {player.us_seed}</span>}
        {player.age ? <span> · Age {player.age}</span> : null}
      </div>
    </div>
  );
}
