// src/pages/DreamBrackets.js
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Papa from 'papaparse';
import Select from 'react-select';
import { ClipboardList, Share2, Download, X } from 'lucide-react';
import { toast } from '../components/ui/Toast';
import AppModal from '../components/ui/AppModal';
import {
  Button,
  Form,
  Spinner,
  ProgressBar
} from 'react-bootstrap';
import './DreamBrackets.css';
import { simulateBatch } from '../simulator';
import { pickEngineProb, eloProb as eloProbFn } from '../engines';
import EngineSelector from '../components/ui/EngineSelector';
import { credibleInterval } from '../credibleInterval';
import { generateBracketShareCard } from '../utils/generateBracketShareCard';
import { countryFlagUrl } from '../components/countryFlags';
import logoRG from '../assets/logo_rg.png';
import logoWB from '../assets/logo_wb.png';
import logoUS from '../assets/logo_us.png';
// Distinct from the tournament pages' own background photos — all three are
// inside-the-stadium shots, sourced from Wikimedia Commons:
//  - clay:  Interieur Court Philippe-Chatrier, Roland Garros (2024) — CC BY-SA 4.0
//  - grass: 2023 Wimbledon Men's singles final, Centre Court — Daniel Cooper, CC BY-SA 2.0
//  - hard:  Arthur Ashe Stadium interior, 2005 US Open — Davidwboswell, CC BY-SA 3.0
import bgClay from '../assets/bracket-clay.jpg';
import bgGrass from '../assets/bracket-grass.jpg';
import bgHard from '../assets/bracket-hard.jpg';

const playerImgsByTour = {
  atp: require.context('../assets/players', false, /\.png$/),
  wta: require.context('../assets/players-women', false, /\.png$/),
};

// Plain gray-circle SVG, used when a player has no headshot and the
// public/assets/players/default.png fallback isn't present in this env.
const BLANK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="%23555"/><circle cx="16" cy="12" r="6" fill="%23999"/><path d="M4 30c0-7 5-11 12-11s12 4 12 11" fill="%23999"/></svg>'
);

const TOURNAMENTS = [
  { value: 'smash_fr.csv', label: 'French Open', logo: logoRG, bgImage: bgClay, accentVar: '--accent-fr-a', surfaceKey: 'clay' },
  { value: 'smash_wb.csv', label: 'Wimbledon', logo: logoWB, bgImage: bgGrass, accentVar: '--accent-wb-a', surfaceKey: 'grass' },
  { value: 'smash_us.csv', label: 'US Open', logo: logoUS, bgImage: bgHard, accentVar: '--accent-us-a', surfaceKey: 'hard' },
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
const CONNECTOR_W = 56; // wide enough that the champion card's intrinsic-width name (+ CI caption) can't spill into the Final column's box

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

const DEFAULT_TOURNAMENT = 'smash_us.csv';

// Map ESPN URL tournament slug → our CSV value
const ESPN_SLUG_TO_CSV = {
  'wimbledon': 'smash_wb.csv',
  'french-open': 'smash_fr.csv',
  'us-open': 'smash_us.csv',
};

function parseEspnUrl(url) {
  const trimmed = url.trim();
  const m = trimmed.match(/espn\.com\/tennis\/([^/?#]+)\/bracket/);
  if (!m) return null;
  const season = trimmed.match(/\/season\/(\d+)/)?.[1] || String(new Date().getFullYear());
  // ESPN puts /competitionType/2/ in the URL for the women's singles draw;
  // no competitionType (or 1) is the men's draw.
  const compType = trimmed.match(/\/competitionType\/(\d+)/)?.[1] || '1';
  return { slug: m[1], season, urlTour: compType === '2' ? 'wta' : 'atp' };
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-–]/g, ' ') // "Auger-Aliassime" (ESPN) matches "Auger Aliassime" (roster)
    .replace(/[^a-z\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns a player from pool whose name best matches the ESPN display name,
// or null if no reasonable match is found.
function matchPlayerByName(espnName, pool) {
  if (!espnName) return null;
  const norm = normalizeName(espnName);
  const parts = norm.split(/\s+/);
  const last = parts[parts.length - 1];

  // 1. Full normalized name match
  let hit = pool.find(p => normalizeName(p.name) === norm);
  if (hit) return hit;

  // 2. Last name match (most reliable for tennis since last names are unique)
  const lastMatches = pool.filter(p => {
    const pParts = normalizeName(p.name).split(/\s+/);
    return pParts[pParts.length - 1] === last;
  });
  if (lastMatches.length === 1) return lastMatches[0];

  // 3. If multiple share a last name, try first-initial match
  if (lastMatches.length > 1 && parts.length > 1) {
    const firstInit = parts[0][0];
    const initMatch = lastMatches.find(p => normalizeName(p.name)[0] === firstInit);
    if (initMatch) return initMatch;
  }

  return null;
}

// Walk ESPN's bracket JSON (which varies by season/tournament) and extract
// an ordered list of player display names for the target round size.
function parseEspnBracket(data, targetSlots) {
  // ESPN bracket APIs use several different shapes over the years.
  // Try the most common patterns.
  const bracket = data?.bracket || data;
  const rounds = bracket?.rounds || bracket?.matchups || [];

  const names = [];

  for (const round of rounds) {
    const matchups = round.matchups || round.matches || round.competitions || [];
    const roundNames = [];
    for (const mu of matchups) {
      const comps = mu.competitors || mu.players || [];
      for (const c of comps) {
        const name = c?.athlete?.displayName
          || c?.player?.displayName
          || c?.displayName
          || c?.name
          || '';
        if (name && !name.toLowerCase().includes('tbd') && !name.toLowerCase().includes('bye')) {
          roundNames.push(name);
        }
      }
    }
    // Pick the round whose size matches the target (or the closest ≥ target)
    if (roundNames.length >= targetSlots) {
      names.push(...roundNames);
      break;
    }
  }

  // Fallback: try a flat players/athletes list at the top level
  if (names.length === 0) {
    const flat = data?.players || data?.athletes || data?.bracket?.players || [];
    for (const p of flat) {
      const name = p?.displayName || p?.name || '';
      if (name) names.push(name);
    }
  }

  return names.slice(0, targetSlots);
}

export default function DreamBrackets({ tour = 'atp' }) {
  const navigate = useNavigate();
  const isWta = tour === 'wta';
  const bestOf = isWta ? 3 : 5;
  const dataDir = isWta ? '/data/women' : '/data';
  const playerImgs = playerImgsByTour[tour];

  const getPlayerImageSrc = (player) => {
    if (!player) return BLANK_AVATAR;
    const key = `./${player.id}.png`;
    const keys = playerImgs.keys ? playerImgs.keys() : [];
    if (keys.includes(key)) return playerImgs(key);
    return `${process.env.PUBLIC_URL}/assets/players/default.png`;
  };

  const [tournament, setTournament] = useState(DEFAULT_TOURNAMENT);
  const [stage, setStage] = useState(STAGES[1].value); // default to Quarter-Finals, as before
  const stageConfig = STAGES.find(s => s.value === stage);
  const tournamentConfig = TOURNAMENTS.find(t => t.value === tournament);
  const geometry = buildBracketGeometry(stageConfig.slots);

  const [slots, setSlots] = useState(Array(stageConfig.slots).fill(null));
  const [playersPool, setPlayersPool] = useState([]);
  const [simsPerMatch, setSimsPerMatch] = useState(DEFAULT_SIMS_PER_MATCHUP);
  const [isImporting, setIsImporting] = useState(false);
  // Prediction engine drives every matchup (see src/engines.js). The Hot
  // Streak engine loads the heavy-recency 7-day CSV; the others use the
  // season CSV and blend in Elo/ranking.
  const [engine, setEngine] = useState('smash');
  const [eloData, setEloData] = useState(null);
  const upsetMode = engine === 'upset';
  const surfaceKey = tournamentConfig.surfaceKey;
  // ids with real upset stats on this tournament's surface (upset_ok=1) —
  // the Hot Streak engine is disabled when any picked player lacks recent data.
  const [upsetOkIds, setUpsetOkIds] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // rounds[0] is always the user's slot picks; each subsequent entry is that
  // round's winners, ending with a single champion in the last round.
  const [rounds, setRounds] = useState([]);

  const [shareUrl, setShareUrl] = useState(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState(false);

  // Completed bracket: the last rounds entry is a single champion.
  const champion = rounds.length > 1 && rounds[rounds.length - 1]?.length === 1
    ? rounds[rounds.length - 1][0]
    : null;
  const runnerUp = champion && rounds[rounds.length - 2]?.length === 2
    ? rounds[rounds.length - 2].find(p => p && p.id !== champion.id) || null
    : null;

  const handleShareBracket = async () => {
    if (!champion) return;
    setIsGeneratingShare(true);
    try {
      const canvas = await generateBracketShareCard({
        champion,
        runnerUp,
        imageSrc: getPlayerImageSrc(champion),
        runnerUpImageSrc: runnerUp ? getPlayerImageSrc(runnerUp) : null,
        flagSrc: countryFlagUrl(champion.country),
        runnerUpFlagSrc: runnerUp ? countryFlagUrl(runnerUp.country) : null,
        surfaceKey: tournamentConfig.surfaceKey,
        tournamentLabel: tournamentConfig.label,
        stageLabel: stageConfig.label,
        slotCount: stageConfig.slots,
        simsPerMatch,
        upsetMode,
      });
      setShareUrl(canvas.toDataURL('image/png'));
    } finally {
      setIsGeneratingShare(false);
    }
  };

  const handleShareDownload = () => {
    if (!shareUrl) return;
    const a = document.createElement('a');
    a.href = shareUrl;
    a.download = `smash-bracket-${(champion?.name || 'champion').replace(/\s+/g, '-')}.png`;
    a.click();
  };

  const shareCaption = champion
    ? `My simulated ${tournamentConfig.label} bracket crowns ${champion.name} champion! Built on SMASH! ⚡ ${window.location.origin}`
    : '';

  const handleShareNative = async () => {
    if (!shareUrl || !navigator.share) return;
    try {
      const blob = await (await fetch(shareUrl)).blob();
      const file = new File([blob], 'smash-bracket.png', { type: 'image/png' });
      await navigator.share({ files: [file], text: shareCaption });
    } catch (_) { /* user cancelled */ }
  };

  const resetBracketState = (slotCount) => {
    setSlots(Array(slotCount).fill(null));
    setRounds([]);
    setShareUrl(null);
    setProgress(0);
    setIsRunning(false);
  };

  // Load & normalize CSV into playersPool whenever the tournament or upset
  // mode changes. The player roster (ids) is the same across all three
  // tournament CSVs and both upset variants — only the per-surface/recency
  // stats differ — so switching either one keeps whichever players were
  // already picked, remapped to their row in the new pool, instead of
  // clearing the bracket. Only the slot COUNT changing (handleStageChange)
  // forces an actual reset, since old picks can't map onto a different
  // number of slots.
  useEffect(() => {
    const csvFile = upsetMode ? tournament.replace('.csv', '_upset.csv') : tournament;
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + csvFile, {
      header: true,
      download: true,
      complete: ({ data }) => {
        const newPool = data
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
          }));
        setPlayersPool(newPool);
        setSlots(prevSlots => prevSlots.map(s => (s ? (newPool.find(p => p.id === s.id) || null) : null)));
        setRounds([]); // old results were computed from the old stats, no longer valid
        setProgress(0);
      }
    });
  }, [tournament, upsetMode, dataDir]);

  // Track which players have real upset stats for the selected tournament.
  useEffect(() => {
    setUpsetOkIds(null);
    Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + tournament.replace('.csv', '_upset.csv'), {
      header: true,
      download: true,
      complete: ({ data }) => {
        setUpsetOkIds(new Set(data.filter(r => r.id && Number(r.upset_ok) === 1).map(r => r.id)));
      },
      error: () => setUpsetOkIds(new Set()),
    });
  }, [tournament, dataDir]);

  // Surface form ratings for the Elo / blend engines.
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + dataDir + '/elo.json')
      .then(r => r.json()).then(setEloData).catch(() => setEloData({}));
  }, [dataDir]);

  // Reason the Upset Scenario toggle is disabled (null = available).
  const upsetDisabledReason = (() => {
    if (!upsetOkIds) return null;
    if (upsetOkIds.size === 0) {
      return 'No players have enough recent matches on this surface for an upset scenario.';
    }
    const lacking = slots.filter(Boolean).filter(p => !upsetOkIds.has(p.id)).map(p => p.name);
    if (lacking.length === 0) return null;
    const shown = lacking.slice(0, 3).join(', ');
    const extra = lacking.length > 3 ? ` and ${lacking.length - 3} more` : '';
    return `${shown}${extra} ${lacking.length > 1 ? "don't" : "doesn't"} have enough recent matches on this surface for an upset scenario.`;
  })();

  const engineDisabled = upsetDisabledReason ? { upset: upsetDisabledReason } : {};

  // If picks change and make the Hot Streak engine unavailable, fall back.
  useEffect(() => {
    if (engine === 'upset' && upsetDisabledReason) setEngine('smash');
  }, [engine, upsetDisabledReason]);

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
      toast({ type: 'warning', title: 'Not enough players', message: `Need at least ${slots.length} players in the pool to randomize this bracket.` });
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
      toast({ type: 'warning', title: `Fill all ${slots.length} spots`, message: `Pick a player for each ${stageConfig.label} slot.` });
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setRounds([slots]);

    // batch-sim winner picker for pairs
    const bernoulliWins = (p, n) => { let w = 0; for (let k = 0; k < n; k++) if (Math.random() < p) w++; return w; };

    const pickWinners = (arr) => {
      const winners = [];
      for (let i = 0; i < arr.length; i += 2) {
        const A = arr[i], B = arr[i+1];
        // The point simulation always runs (it's the sim/hot-streak engine
        // directly, and the sim component of the blends). probabilities are
        // already the hot-form stats when the Hot Streak engine is selected.
        const { matchWins } = simulateBatch(A.probabilities, B.probabilities, simsPerMatch, bestOf);
        let aWins, bWins;
        if (engine === 'sim' || engine === 'upset') {
          aWins = matchWins[0]; bWins = matchWins[1];
        } else {
          const simProb = matchWins[0] / (matchWins[0] + matchWins[1]);
          const elo = eloData ? eloProbFn(eloData[A.id], eloData[B.id], surfaceKey) : null;
          const probA = pickEngineProb(engine, { sim: simProb, elo, rankA: A.us_seed, rankB: B.us_seed }, tour, surfaceKey);
          aWins = bernoulliWins(probA, simsPerMatch);
          bWins = simsPerMatch - aWins;
        }
        const aWon = aWins >= bWins;
        const winner = aWon ? A : B;
        const winCount = aWon ? aWins : bWins;
        const loseCount = aWon ? bWins : aWins;
        const { lower, upper } = credibleInterval(winCount, loseCount);
        winners.push({ ...winner, _winProb: winCount / (winCount + loseCount), _ciLower: lower, _ciUpper: upper });
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

  // Resume an ESPN import that started on the other tour's brackets page —
  // runEspnImport stashes the link and navigates here when the URL's draw
  // (men's/women's) doesn't match the page it was pasted on. Keyed on `tour`
  // (not mount): React reuses this component instance across the ATP/WTA
  // routes, so switching tours changes the prop without remounting.
  useEffect(() => {
    const pending = sessionStorage.getItem('smash-espn-import');
    if (!pending) return;
    if (parseEspnUrl(pending)?.urlTour !== tour) return; // not our tour yet
    sessionStorage.removeItem('smash-espn-import');
    runEspnImport(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  const [espnModalOpen, setEspnModalOpen] = useState(false);
  const [espnUrl, setEspnUrl] = useState('');

  const handleEspnImport = () => {
    setEspnUrl('');
    setEspnModalOpen(true);
  };

  const confirmEspnImport = () => {
    if (!espnUrl.trim()) return;
    setEspnModalOpen(false);
    runEspnImport(espnUrl.trim());
  };

  const runEspnImport = async (url) => {
    const parsed = parseEspnUrl(url);
    if (!parsed) {
      toast({ type: 'error', title: 'Invalid URL', message: 'Paste a link like: https://www.espn.com/tennis/wimbledon/bracket/_/season/2026' });
      return;
    }

    const csvFile = ESPN_SLUG_TO_CSV[parsed.slug];
    if (!csvFile) {
      toast({ type: 'error', title: 'Unsupported tournament', message: `"${parsed.slug}" is not supported. Try wimbledon, french-open, or us-open.` });
      return;
    }

    // The link encodes which draw it is (competitionType/2 = women's).
    // If it doesn't match the current tour, hop to the mirrored brackets
    // page and let its mount effect resume this same import there.
    if (parsed.urlTour !== tour) {
      sessionStorage.setItem('smash-espn-import', url);
      navigate(parsed.urlTour === 'wta' ? '/women/dream-brackets' : '/dream-brackets');
      return;
    }

    setIsImporting(true);
    try {
      // Route through our own serverless proxy (/api/espn-bracket) so the
      // fetch goes server-side — ESPN blocks direct browser requests (CORS).
      const apiUrl = `/api/espn-bracket?slug=${encodeURIComponent(parsed.slug)}&season=${parsed.season}&slots=${stageConfig.slots}&tour=${tour}`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      // Proxy returns { players: string[] } — use directly if present,
      // otherwise fall back to the generic bracket parser for older shapes.
      const espnNames = json.players
        ? json.players.slice(0, stageConfig.slots)
        : parseEspnBracket(json, stageConfig.slots);
      if (!espnNames || espnNames.length === 0) {
        throw new Error('Bracket data not available yet — check back closer to the tournament.');
      }

      // Always parse the roster fresh from this tour's dataDir instead of
      // using playersPool state — when this import resumes right after a
      // tour switch, playersPool may still hold the OTHER tour's players
      // (the reload effect races this one), which would match zero names.
      const targetPool = await new Promise((resolve) => {
        Papa.parse(process.env.PUBLIC_URL + dataDir + '/' + csvFile, {
          header: true, download: true,
          complete: ({ data: rows }) => {
            resolve(rows.filter(r => Number(r.us_rd) === 2).map(r => ({
              ...r,
              probabilities: [Number(r.p1), Number(r.p2), Number(r.p3), Number(r.p4), Number(r.p5), Number(r.p6) || 0],
            })));
          }
        });
      });

      const matched = espnNames.map(name => matchPlayerByName(name, targetPool));
      const matchedCount = matched.filter(Boolean).length;

      if (matchedCount === 0) {
        throw new Error('Could not match any players to our roster. The bracket may not have seeded players yet.');
      }

      if (csvFile !== tournament) setTournament(csvFile);
      setSlots(matched);
      setRounds([]);
      setProgress(0);

      if (matchedCount < espnNames.length) {
        const missing = espnNames.filter((n, i) => !matched[i]);
        toast({
          type: 'warning',
          title: `Imported ${matchedCount}/${espnNames.length} players`,
          message: `Could not match: ${missing.join(', ')}. Fill in the remaining slots manually.`,
          duration: 8000,
        });
      } else {
        toast({ type: 'success', title: `Imported ${matchedCount} players`, message: 'Bracket filled from the ESPN draw.' });
      }
    } catch (err) {
      toast({ type: 'error', title: 'Import failed', message: err.message, duration: 7000 });
    } finally {
      setIsImporting(false);
    }
  };

  const selectStyles = {
    option: (base, state) => ({
      ...base,
      color: '#fff',
      backgroundColor: state.isSelected ? 'rgba(255,255,255,0.18)' : state.isFocused ? 'rgba(255,255,255,0.08)' : 'transparent',
    }),
    menu: base => ({ ...base, backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.15)' }),
    menuList: base => ({ ...base, backgroundColor: '#1a1a1a' }),
    control: (base, state) => ({
      ...base,
      opacity: 1,
      backgroundColor: 'rgba(255,255,255,0.08)',
      borderColor: state.isFocused ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)',
      boxShadow: 'none',
    }),
    singleValue: base => ({ ...base, color: '#fff' }),
    input: base => ({ ...base, color: '#fff' }),
    placeholder: base => ({ ...base, color: '#888' }),
  };

  const renderCompetitor = (p, { colIdx, globalSlotIdx, isWinner, isLoser, winner }) => {
    const competitorClass = `competitor${isWinner ? ' winner' : ''}${isLoser ? ' loser' : ''}`;
    const ciCaption = isWinner && winner && winner._ciLower != null
      ? <div className="bracket-ci-tag">{Math.round(winner._winProb*100)}% [{Math.round(winner._ciLower*100)}–{Math.round(winner._ciUpper*100)}%]</div>
      : null;
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
        <div className="competitor-name-col">
          <span className="competitor-name">{p ? p.name : '—'}</span>
          {ciCaption}
        </div>
        {isWinner && <span className="bracket-result-tag">✓</span>}
      </div>
    );
  };

  return (
    <div
      className="page-background"
      style={{ backgroundImage: `url(${tournamentConfig.bgImage})`, '--bracket-accent': `var(${tournamentConfig.accentVar})` }}
    >
      <div className="dream-brackets-page bracket-overlay">
        <div className="bracket-card" style={{ '--accent': 'var(--bracket-accent)' }}>
        <h3 className="broadcast-title" style={{ '--accent': 'var(--bracket-accent)' }}>
          <img src={tournamentConfig.logo} alt="" className="bracket-title-logo" />
          {tournamentConfig.label}{isWta ? " Women's" : ''} · Bracket Simulator
        </h3>

        <div className="bracket-controls-panel mb-3" style={{ '--accent': 'var(--bracket-accent)' }}>
          <div className="bracket-select-row">
            <Form.Select
              className="dark-select"
              value={tournament}
              onChange={e => setTournament(e.target.value)}
              disabled={isRunning}
            >
              {TOURNAMENTS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Form.Select>

            <Form.Select
              className="dark-select"
              value={stage}
              onChange={e => handleStageChange(e.target.value)}
              disabled={isRunning}
            >
              {STAGES.map(s => (
                <option key={s.value} value={s.value}>Start at {s.label}</option>
              ))}
            </Form.Select>

            <Form.Select
              className="dark-select"
              value={simsPerMatch}
              onChange={e => setSimsPerMatch(Number(e.target.value))}
              disabled={isRunning}
            >
              {SIMS_PER_MATCHUP_OPTIONS.map(n => (
                <option key={n} value={n}>{n} sim{n === 1 ? '' : 's'}/match</option>
              ))}
            </Form.Select>
          </div>

          <div className="bracket-button-row">
            <Button
              style={{ background: 'var(--bracket-accent)', borderColor: 'var(--bracket-accent)' }}
              onClick={runDreamBracket}
              disabled={isRunning}
            >
              {isRunning
                ? <><Spinner animation="border" size="sm" /> Running…</>
                : 'Simulate Tournament'}
            </Button>
            <Button
              variant="outline-light"
              style={{ borderColor: 'var(--bracket-accent)' }}
              onClick={handleRandomizeAll}
              disabled={isRunning}
            >
              Random
            </Button>
            {!isRunning && (
              <EngineSelector engine={engine} setEngine={setEngine} disabled={engineDisabled} align="left" />
            )}
            <Button
              variant="outline-light"
              style={{ borderColor: 'rgba(255,255,255,0.3)', fontSize: '0.82rem' }}
              onClick={handleEspnImport}
              disabled={isRunning || isImporting}
              title="Paste an ESPN bracket link to auto-fill players"
            >
              {isImporting ? <><Spinner animation="border" size="sm" /> Importing…</> : <><ClipboardList size={15} style={{ marginRight: 5, verticalAlign: -2 }} />ESPN</>}
            </Button>
            <Button
              variant="secondary"
              onClick={handleReset}
              disabled={isRunning}
            >
              Reset
            </Button>
            {champion && (
              <Button
                className="adv-share-btn"
                onClick={handleShareBracket}
                disabled={isGeneratingShare}
              >
                {isGeneratingShare ? 'Generating…' : <><Share2 size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Share Bracket</>}
              </Button>
            )}
          </div>
        </div>

        <AppModal
          show={espnModalOpen}
          onHide={() => setEspnModalOpen(false)}
          title="Import ESPN bracket"
          confirmText="Import"
          onConfirm={confirmEspnImport}
          confirmDisabled={!espnUrl.trim()}
        >
          <Form.Group>
            <Form.Label>Paste the ESPN bracket link</Form.Label>
            <Form.Control
              value={espnUrl}
              onChange={e => setEspnUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEspnImport(); }}
              placeholder="https://www.espn.com/tennis/wimbledon/bracket/_/season/2026"
              autoFocus
              autoComplete="off"
            />
          </Form.Group>
        </AppModal>

        {/* Bracket share card modal */}
        {shareUrl && (
          <div className="adv-share-overlay" onClick={() => setShareUrl(null)}>
            <div className="adv-share-modal" onClick={e => e.stopPropagation()}>
              <button className="adv-share-close" aria-label="Close" onClick={() => setShareUrl(null)}><X size={18} /></button>
              <img src={shareUrl} alt="Bracket share card preview" className="adv-share-preview" />
              <div className="adv-share-actions">
                <Button size="sm" className="adv-share-action-btn" onClick={handleShareDownload}>
                  <Download size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Save Image
                </Button>
                {navigator.share && (
                  <Button size="sm" className="adv-share-action-btn" onClick={handleShareNative}>
                    <Share2 size={15} style={{ marginRight: 6, verticalAlign: -2 }} />Share…
                  </Button>
                )}
              </div>
              <p className="adv-share-hint">
                Save the image and share it anywhere.
                {' '}Made with{' '}
                <a
                  className="adv-share-link"
                  href={window.location.origin}
                  target="_blank" rel="noopener noreferrer"
                >
                  {window.location.host}
                </a>
              </p>
            </div>
          </div>
        )}

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
                      style={{ position: 'absolute', top: championCenter - CHAMPION_BOX_H / 2, left: 0, right: 0, height: CHAMPION_BOX_H }}
                    >
                      {colPlayers[0] ? (
                        <div className="competitor winner">
                          <img className="player-avatar" src={getPlayerImageSrc(colPlayers[0])} alt="" />
                          <span>{colPlayers[0].name}</span>
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
                                {renderCompetitor(p, { colIdx, globalSlotIdx, isWinner, isLoser, winner })}
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
    </div>
  );
}
