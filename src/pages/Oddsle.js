// src/pages/Oddsle.js
//
// ODDSLE: the daily guessing game. Five real graded matches from the public
// ledger, same five for everyone (seeded by the UTC date), and for each one
// you call the winner and guess how confident the model was in your player.
// Entirely client-side: no accounts, no backend, no API - localStorage keeps
// your streak, and the share grid is the growth loop.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { countryFlagUrl } from '../components/countryFlags';
import { cleanEvents } from '../utils/eventName';
import useDocMeta from '../utils/useDocMeta';
import './Oddsle.css';

const ROUNDS = 5;
const EPOCH = Date.UTC(2026, 6, 18); // Oddsle #1 = July 18, 2026
const STORE_KEY = 'smashOddsle';

// Deterministic PRNG so every visitor gets the same five matches per day.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 0x9e3779b9);

const utcDayKey = () => new Date().toISOString().slice(0, 10);
const dayNumber = () => Math.floor((Date.parse(`${utcDayKey()}T00:00:00Z`) - EPOCH) / 864e5) + 1;

const loadStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
};
const saveStore = (s) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode */ } };

// Current streak = consecutive UTC days played, ending today or yesterday.
function computeStreak(store) {
  let streak = 0;
  const d = new Date(`${utcDayKey()}T00:00:00Z`);
  if (!store[utcDayKey()]) d.setUTCDate(d.getUTCDate() - 1); // today not played yet still counts yesterday's run
  for (;;) {
    const key = d.toISOString().slice(0, 10);
    if (!store[key]) break;
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}

// Odds-guess grading: how close you were to the model's actual number.
const odemoji = (diff) => (diff <= 5 ? '🎯' : diff <= 12 ? '🟨' : '⬜');
const odPoints = (diff) => (diff <= 5 ? 1 : 0);

export default function Oddsle() {
  useDocMeta(
    'Oddsle: The Daily Tennis Prediction Game | Smash',
    'Five real graded matches a day. Call the winners, guess the model, keep the streak. Same five for everyone.'
  );
  const [matches, setMatches] = useState(null);
  const [store, setStore] = useState(loadStore);
  const [round, setRound] = useState(0);
  const [pick, setPick] = useState(null);       // player id picked this round
  const [guess, setGuess] = useState(65);       // model-% guess for the pick
  const [phase, setPhase] = useState('pick');   // pick -> guess -> reveal
  const [results, setResults] = useState([]);   // per-round outcomes
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setMatches(cleanEvents(d.matches)))
      .catch(() => setMatches([]));
  }, []);

  const todayKey = utcDayKey();

  // Today's five: deterministic sample over the eligible ledger, sorted by
  // id first so everyone draws from the identical deck. Keyed on todayKey
  // so a tab left open across UTC midnight reshuffles instead of replaying
  // yesterday's five under today's number.
  const daily = useMemo(() => {
    if (!matches) return null;
    const deck = matches
      .filter((m) => m.winner && m.score && m.event && m.name1 && m.name2 && (m.pickProbP1 ?? m.probP1) != null)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (deck.length < ROUNDS) return [];
    const rand = mulberry32(hashStr(`oddsle-${todayKey}`));
    const chosen = new Set();
    while (chosen.size < ROUNDS) chosen.add(Math.floor(rand() * deck.length));
    return [...chosen].map((i) => deck[i]);
  }, [matches, todayKey]);

  const played = store[todayKey];
  const streak = useMemo(() => computeStreak(store), [store]);

  const modelProbFor = (m, pid) => {
    const p1Prob = m.pickProbP1 ?? m.probP1;
    return Math.round((pid === m.p1 ? p1Prob : 1 - p1Prob) * 100);
  };

  const lockGuess = () => {
    const m = daily[round];
    const actual = modelProbFor(m, pick);
    const winnerHit = pick === m.winner;
    const diff = Math.abs(guess - actual);
    setResults([...results, { winnerHit, guess, actual, diff, pick, match: m }]);
    setPhase('reveal');
  };

  // Saved only when the player leaves the last reveal - saving inside
  // lockGuess would flip `played` and skip the fifth reveal entirely.
  const finishDay = () => {
    const score = results.reduce((s, x) => s + (x.winnerHit ? 1 : 0) + odPoints(x.diff), 0);
    const grid = results.map((x) => `${x.winnerHit ? '✅' : '❌'}${odemoji(x.diff)}`).join('\n');
    const s = { ...loadStore(), [todayKey]: { score, grid, n: dayNumber() } };
    saveStore(s);
    setStore(s);
  };

  const nextRound = () => {
    setRound((r) => r + 1);
    setPick(null);
    setGuess(65);
    setPhase('pick');
  };

  const share = async (rec) => {
    const text = `Oddsle #${rec.n} - ${rec.score}/10\n${rec.grid}\n\nFive real matches, one model to outguess:\n${window.location.origin}/oddsle`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch { /* fall through to clipboard */ }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  if (!daily) return <div className="oddsle-page"><div className="skeleton oddsle-skel" /></div>;
  if (daily.length === 0) {
    return (
      <div className="oddsle-page">
        <div className="eyebrow">THE DAILY GAME</div>
        <h1 className="oddsle-title">Oddsle</h1>
        <p className="oddsle-sub">The deck is still shuffling - the ledger hasn't loaded enough graded matches yet. Try again in a moment.</p>
      </div>
    );
  }

  // ── Finished state (today already played) ────────────────────────────────
  if (played) {
    return (
      <div className="oddsle-page">
        <div className="eyebrow">THE DAILY GAME</div>
        <h1 className="oddsle-title">Oddsle #{played.n}</h1>
        <div className="oddsle-done">
          <div className="oddsle-score">{played.score}<span>/10</span></div>
          <pre className="oddsle-grid" aria-label="Today's result grid">{played.grid}</pre>
          <div className="oddsle-streak">🔥 {streak} day streak</div>
          <button type="button" className="oddsle-share" onClick={() => share(played)}>
            {copied ? 'Copied!' : 'Share your grid'}
          </button>
          <p className="oddsle-back">
            New matches at midnight UTC. Until then: the whole deck lives in{' '}
            <Link to="/track-record">the Ledger</Link>, and tomorrow's calls lock on{' '}
            <Link to="/today">Today</Link>.
          </p>
        </div>
      </div>
    );
  }

  const m = daily[round];
  const last = results[results.length - 1];

  return (
    <div className="oddsle-page">
      <div className="eyebrow">THE DAILY GAME</div>
      <h1 className="oddsle-title">Oddsle #{dayNumber()}</h1>
      <p className="oddsle-sub">
        Five real matches from our graded ledger - same five for everyone today.
        Call the winner, then guess how confident the model was in your player.
      </p>

      <div className="oddsle-progress" role="img" aria-label={`Round ${round + 1} of ${ROUNDS}`}>
        {Array.from({ length: ROUNDS }, (_, i) => (
          <span key={i} className={`oddsle-dot${i < results.length ? (results[i].winnerHit ? ' hit' : ' miss') : ''}${i === round ? ' now' : ''}`} />
        ))}
      </div>

      <div className="oddsle-card">
        <div className="oddsle-meta">{m.tour.toUpperCase()} · {m.event} · {m.surface.toUpperCase()} · {new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>

        {phase === 'pick' && (
          <>
            <div className="oddsle-q">Who won this match?</div>
            <div className="oddsle-players">
              {[[m.p1, m.name1, m.country1], [m.p2, m.name2, m.country2]].map(([pid, name, ctry]) => (
                <button key={pid} type="button" className="oddsle-player" onClick={() => { setPick(pid); setPhase('guess'); }}>
                  <img className="oddsle-face" src={playerPhoto(m.tour, pid)} alt="" />
                  <span className="oddsle-name">
                    {countryFlagUrl(ctry) && <img className="oddsle-flag" src={countryFlagUrl(ctry)} alt="" />}
                    {name}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {phase === 'guess' && (
          <>
            <div className="oddsle-q">
              How confident was the model in {pick === m.p1 ? m.name1 : m.name2}?
            </div>
            <div className="oddsle-guess-val">{guess}%</div>
            <input
              type="range"
              className="oddsle-slider"
              min="5"
              max="95"
              value={guess}
              onChange={(e) => setGuess(Number(e.target.value))}
              aria-label="Model confidence guess"
            />
            <div className="oddsle-slider-ends"><span>5% · no chance</span><span>95% · lock</span></div>
            <button type="button" className="oddsle-lock" onClick={lockGuess}>Lock it in</button>
          </>
        )}

        {phase === 'reveal' && last && (
          <div className="oddsle-reveal">
            <div className={`oddsle-verdict ${last.winnerHit ? 'hit' : 'miss'}`}>
              {last.winnerHit ? '✓ Winner called' : '✗ Wrong winner'} ·{' '}
              {last.match.winner === last.match.p1 ? last.match.name1 : last.match.name2} won {last.match.score}
            </div>
            <div className="oddsle-odds-line">
              You guessed <strong>{last.guess}%</strong> · the model had{' '}
              <strong>{last.actual}%</strong> on your player {odemoji(last.diff)}
              {last.diff <= 5 ? ' bullseye' : last.diff <= 12 ? ' close' : ' way off'}
            </div>
            {results.length < ROUNDS ? (
              <button type="button" className="oddsle-lock" onClick={nextRound}>
                Next match ({results.length + 1}/{ROUNDS})
              </button>
            ) : (
              <button type="button" className="oddsle-lock" onClick={finishDay}>
                See my score
              </button>
            )}
          </div>
        )}
      </div>

      <p className="oddsle-foot">
        Every match here is a real call from <Link to="/track-record">the public ledger</Link> - locked
        before play, graded after. 1 point per winner, 1 more if your model guess lands within 5.
      </p>
    </div>
  );
}
