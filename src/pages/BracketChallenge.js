// src/pages/BracketChallenge.js
//
// THE SLAM BRACKET CHALLENGE: lock a full bracket for the draw as it stands
// - a whole 128 if that is what has been published, the closing rounds if
// the tournament is already underway - then watch it grade round by round
// against the public ledger. The model locks its own bracket from
// the survival matrix and sits opposite yours on the board.
//
// Your bracket is kept in this browser (one entry per slam, no take-backs)
// and grading is entirely client-side. It used to be a Supabase row behind a
// sign-in, which made a one-player game need an account; the challenge is
// you versus the model either way.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '../components/ui/Toast';
import { playerPhoto } from '../utils/playerPhotos';
import { lastName } from '../utils/names';
import { slugify } from '../utils/slug';
import { cleanEventName } from '../utils/eventName';
import useDocMeta from '../utils/useDocMeta';
import './BracketChallenge.css';

// The rounds of a draw, derived from its size rather than hardcoded to the
// last four. This was a fixed round-of-16 table, which is why the challenge
// could only ever be the closing stages of a tournament; the projection now
// publishes a full 128 field, so a fixed table also meant the page fell
// through to its empty state the moment the draw got bigger than 16.
//
// Points double each round, which is not decoration: it makes every round
// worth the same total (a 128 draw is 64 points a round, 448 in all), so
// calling the champion is worth as much as calling the entire opening round.
// The keys match the old ones for the last four rounds - r16, qf, sf, f - so
// a bracket already locked in someone's browser still reads and still grades.
const roundLabel = (size) => {
  if (size === 1) return 'Champion';
  if (size === 2) return 'Semi-finals';
  if (size === 4) return 'Quarter-finals';
  return `Round of ${size * 2}`;
};
const roundKey = (size) => {
  if (size === 1) return 'f';
  if (size === 2) return 'sf';
  if (size === 4) return 'qf';
  return `r${size * 2}`;
};

function roundsFor(fieldSize) {
  const out = [];
  let points = 1;
  for (let size = Math.floor(fieldSize / 2); size >= 1; size = Math.floor(size / 2)) {
    out.push({ key: roundKey(size), label: roundLabel(size), size, points });
    points *= 2;
  }
  return out;
}

const maxScoreOf = (rounds) => rounds.reduce((s, r) => s + r.size * r.points, 0);
const emptyPicksFor = (rounds) => rounds.map((r) => Array(r.size).fill(null));

// A draw has to be a power of two of at least 2 for any of this to mean
// anything, and a single sanity ceiling keeps a malformed feed from asking
// the page to render thousands of rows.
const isDrawSize = (n) => Number.isInteger(n) && n >= 2 && n <= 128 && (n & (n - 1)) === 0;

// One locked bracket per slam, in this browser. localStorage throws in some
// private modes, so both helpers fail soft and the page carries on.
const entryKey = (eventKey) => `smash_challenge_${eventKey}`;
function readEntry(eventKey) {
  try {
    const raw = localStorage.getItem(entryKey(eventKey));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeEntry(eventKey, entry) {
  try {
    localStorage.setItem(entryKey(eventKey), JSON.stringify(entry));
    return true;
  } catch { return false; }
}

// The model's bracket from the survival matrix: in every matchup, advance
// whichever player the sim gives the better chance of reaching the NEXT round.
function modelBracket(field, survival, rounds) {
  const byId = new Map(field.map((p, i) => [p.id ?? `slot${i}`, survival[i]]));
  const idAt = (i) => field[i].id ?? `slot${i}`;
  const picks = emptyPicksFor(rounds);
  // Seeded from the WHOLE field, not a fixed 16. With the length hardcoded,
  // a 128-player draw had its model bracket built from the first sixteen
  // slots - a quarter of one quarter of the draw.
  let prev = field.map((_, i) => idAt(i));
  for (let r = 0; r < rounds.length; r++) {
    const next = [];
    for (let i = 0; i < rounds[r].size; i++) {
      const a = prev[2 * i], b = prev[2 * i + 1];
      const sa = byId.get(a)?.[r] ?? 0, sb = byId.get(b)?.[r] ?? 0;
      next.push(sa >= sb ? a : b);
    }
    picks[r] = next;
    prev = next;
  }
  return picks;
}

// Bracket wins per player inside the event. Single elimination means two
// R16 survivors can only meet from the R16 on, so every field-vs-field
// ledger row is a bracket result. Some field players have no roster id
// (unresolved qualifiers), so their matches never reach the ledger - a
// naive win count would then UNDERCOUNT their opponents. Date-ordered
// round propagation recovers those invisible wins: when A beats B, the
// round they met at is max(progress so far) of either player, so A's
// progress becomes that round + 1 even if A's earlier win is missing.
function actualProgress(track, eventName, fieldIds) {
  const rows = (track?.matches || [])
    .filter((m) => cleanEventName(m.event) === eventName && fieldIds.has(m.p1) && fieldIds.has(m.p2))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const prog = new Map(); // id -> bracket wins (0..4)
  for (const m of rows) {
    const loser = m.winner === m.p1 ? m.p2 : m.p1;
    const round = Math.max(prog.get(m.winner) || 0, prog.get(loser) || 0);
    prog.set(loser, Math.max(prog.get(loser) || 0, round));
    prog.set(m.winner, Math.max(prog.get(m.winner) || 0, round + 1));
  }
  return prog;
}

function scoreEntry(picks, wins, rounds) {
  let score = 0;
  const detail = [];
  for (let r = 0; r < rounds.length; r++) {
    const need = r + 1; // wins required to have survived this round
    const arr = picks[rounds[r].key] ?? picks[r] ?? [];
    const hits = arr.filter((id) => (wins.get(id) || 0) >= need).length;
    score += hits * rounds[r].points;
    detail.push(hits);
  }
  return { score, detail };
}

export default function BracketChallenge() {
  useDocMeta(
    'Slam Bracket Challenge: Beat the Model\'s Bracket | Smash',
    'Lock a bracket for the whole draw, then get graded round by round against the real results and the model.'
  );
  const [odds, setOdds] = useState(null);
  const [track, setTrack] = useState(null);
  const [tour, setTour] = useState('atp');
  // Raw picks state. Read through `sel` below, which is this reshaped to the
  // current draw - state lags `rounds` by one render whenever the field size
  // changes, and every read site indexing sel[r][i] threw on that frame.
  const [selRaw, setSelRaw] = useState([]);
  // Your locked bracket lives in this browser. The challenge was always "beat
  // the model", so the board is you against it - no account, no shared
  // leaderboard, and nothing to sign in for.
  const [mine, setMine] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/title_odds.json').then((r) => r.json()).then(setOdds).catch(() => setOdds({ events: {} }));
    fetch(process.env.PUBLIC_URL + '/data/track_record.json').then((r) => r.json()).then(setTrack).catch(() => setTrack({ matches: [] }));
  }, []);

  const entry = odds?.events?.[tour];
  const eventName = entry ? cleanEventName(entry.event) : null;
  // Slot fallbacks for unresolved qualifiers (null roster ids): every
  // consumer below - picker, model bracket, byId, saved picks - speaks the
  // same 'slotN' language, so a null id can never collapse the lookup map
  // or render a blank name.
  const field = useMemo(() => {
    const raw = isDrawSize(entry?.draw?.field?.length) ? entry.draw.field : null;
    return raw ? raw.map((p, i) => ({ ...p, id: p.id ?? `slot${i}` })) : null;
  }, [entry]);
  // Rounds follow the draw. Any power of two from a two-player final up to a
  // full 128 works; the page used to insist on exactly 16 and showed its
  // empty state for anything else.
  const rounds = useMemo(() => (field ? roundsFor(field.length) : []), [field]);
  const maxScore = useMemo(() => maxScoreOf(rounds), [rounds]);
  const survival = entry?.draw?.survival;
  const eventKey = entry ? `${tour}-${slugify(eventName)}-${new Date(entry.startsAt || entry.history?.[0]?.date || Date.now()).getUTCFullYear()}` : null;
  const open = !!(field && (entry.status === 'live' || entry.status === 'projection'));
  // Underway: the live field has shrunk below what we locked at, or it is
  // over. Compared against the locked bracket's own size rather than a
  // literal 16, so it still works whatever round the draw starts from.
  const lockedSize = mine?.fieldSize || (field ? field.length : 0);
  const gradeable = !!(field && ((entry.fieldSize || 0) < lockedSize || entry.status === 'final'));

  useEffect(() => { setSelRaw([]); }, [tour, eventKey, field?.length]);

  // Always the right shape for the draw on screen, whatever state holds.
  const sel = useMemo(
    () => rounds.map((r, i) => {
      const row = selRaw[i] || [];
      return Array.from({ length: r.size }, (_, j) => row[j] ?? null);
    }),
    [rounds, selRaw]
  );

  // Re-read the saved bracket whenever the event changes.
  useEffect(() => {
    if (!eventKey) { setMine(null); return; }
    setMine(readEntry(eventKey));
  }, [eventKey]);

  // Real roster ids only: slotN ids can never appear in the ledger.
  const fieldIds = useMemo(() => new Set((field || []).map((p) => p.id).filter((id) => !String(id).startsWith('slot'))), [field]);
  const wins = useMemo(
    () => (gradeable && eventName ? actualProgress(track, eventName, fieldIds) : new Map()),
    [gradeable, track, eventName, fieldIds]
  );
  const model = useMemo(
    () => (field && survival && rounds.length ? modelBracket(field, survival, rounds) : null),
    [field, survival, rounds]
  );
  const byId = useMemo(() => new Map((field || []).map((p) => [p.id, p])), [field]);

  // Picker interaction: choosing a winner clears any downstream pick that
  // depended on the player being replaced.
  const sources = (r, i) => (r === 0
    ? [field[2 * i]?.id, field[2 * i + 1]?.id]
    : [sel[r - 1]?.[2 * i], sel[r - 1]?.[2 * i + 1]]);
  const choose = (r, i, id) => {
    setSelRaw(() => {
      const next = sel.map((a) => [...a]);
      next[r][i] = id;
      for (let r2 = r + 1; r2 < rounds.length; r2++) {
        for (let j = 0; j < rounds[r2].size; j++) {
          const src = r2 === 0 ? [] : [next[r2 - 1][2 * j], next[r2 - 1][2 * j + 1]];
          if (next[r2][j] && !src.includes(next[r2][j])) next[r2][j] = null;
        }
      }
      return next;
    });
  };
  const complete = sel.length === rounds.length && sel.every((round) => round.every(Boolean));

  const lockBracket = () => {
    if (!complete || saving || mine) return;
    setSaving(true);
    const picks = Object.fromEntries(rounds.map((r, i) => [r.key, sel[i]]));
    // fieldSize is stored so grading knows what round this bracket started
    // from, instead of assuming every bracket is a round-of-16 one.
    const entry = { picks, fieldSize: field.length, lockedAt: new Date().toISOString() };
    if (writeEntry(eventKey, entry)) {
      setMine(entry);
      toast({ type: 'success', title: 'Bracket locked', message: 'Graded round by round from here. No take-backs.' });
    } else {
      toast({ type: 'error', title: 'Bracket not saved', message: 'This browser is blocking local storage, so it could not be kept.' });
    }
    setSaving(false);
  };

  const leaderboard = useMemo(() => {
    if (!field) return [];
    const rows = [];
    if (mine) rows.push({ name: 'You', ...scoreEntry(mine.picks, wins, rounds), isModel: false });
    if (model) rows.push({ name: 'The Model', ...scoreEntry(Object.fromEntries(rounds.map((r, i) => [r.key, model[i]])), wins, rounds), isModel: true });
    return rows.sort((a, b) => b.score - a.score);
  }, [mine, model, wins, field, rounds]);

  if (!odds || !track) return <div className="challenge-page"><div className="skeleton challenge-skel" /></div>;

  return (
    <div className="challenge-page">
      <div className="eyebrow">THE BRACKET CHALLENGE</div>
      <h1 className="challenge-title">Beat the model's bracket</h1>
      <p className="challenge-sub">
        You and the model both lock a bracket for the whole draw. One point per
        opening-round call, doubling every round after it, so calling the champion
        is worth as much as calling the entire first round ({maxScore} is a perfect
        bracket). Graded against the real results as they land.
        The model's picks come from the same simulation that prices the draw, so it has
        nowhere to hide either.
      </p>

      <div className="challenge-seg" role="group" aria-label="Tour">
        {[['atp', 'ATP'], ['wta', 'WTA']].map(([v, l]) => (
          <button key={v} type="button" className={`challenge-seg-btn${tour === v ? ' active' : ''}`} onClick={() => setTour(v)}>{l}</button>
        ))}
      </div>

      {!field && (
        <div className="challenge-empty">
          No bracket on the board right now. Entries open the moment the next slam's
          draw is published - the <Link to="/draw">draw page</Link> shows how close
          we are, and the model will be waiting with its own bracket.
        </div>
      )}

      {field && (
        <>
          <div className="challenge-status">
            {eventName?.toUpperCase()} ·{' '}
            {open ? 'ENTRIES OPEN - LOCK YOURS BEFORE RESULTS START' : entry.status === 'final' ? 'FINAL - GRADED' : 'IN FLIGHT - ENTRIES CLOSED, GRADING LIVE'}
          </div>

          {open && !mine && (
            <>
              <div className="challenge-bracket">
                {rounds.map((round, r) => (
                  <div className="challenge-round" key={round.key}>
                    <div className="challenge-round-label">{round.label} <span>×{round.points}pt</span></div>
                    {Array.from({ length: round.size }, (_, i) => {
                      const [a, b] = sources(r, i);
                      return (
                        <div className="challenge-match" key={i}>
                          {[a, b].map((id, side) => {
                            const p = id ? byId.get(id) : null;
                            return (
                              <button
                                key={side}
                                type="button"
                                disabled={!id}
                                className={`challenge-pick${sel[r]?.[i] === id && id ? ' chosen' : ''}`}
                                onClick={() => id && choose(r, i, id)}
                              >
                                {p ? (
                                  <>
                                    <img src={playerPhoto(tour, p.id)} alt="" loading="lazy" />
                                    <span>{lastName(p.name)}</span>
                                    {p.rank ? <em>#{p.rank}</em> : null}
                                  </>
                                ) : <span className="challenge-tbd">winner of previous pick</span>}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <button type="button" className="challenge-lock" disabled={!complete || saving} onClick={lockBracket}>
                {complete ? 'Lock my bracket' : 'Finish every round to lock'}
              </button>
              <div className="challenge-nocloud">
                Kept in this browser, so clearing your site data clears the bracket.
              </div>
            </>
          )}

          {mine && (
            <div className="challenge-mine">
              <div className="challenge-section-label">Your locked bracket</div>
              {rounds.map((round) => (
                <div className="challenge-mine-round" key={round.key}>
                  <span className="challenge-mine-label">{round.label}:</span>{' '}
                  {(mine.picks[round.key] || []).map((id) => lastName(byId.get(id)?.name || id)).join(' · ')}
                </div>
              ))}
            </div>
          )}

          {model && (
            <div className="challenge-model">
              <div className="challenge-section-label">The model's bracket</div>
              <div className="challenge-mine-round">
                <span className="challenge-mine-label">Champion:</span>{' '}
                <strong>{lastName(byId.get(model[3][0])?.name || '')}</strong>
                {' '}· the final: {model[2].map((id) => lastName(byId.get(id)?.name || id)).join(' vs ')}
              </div>
            </div>
          )}

          {(gradeable || leaderboard.length > 1) && (
            <div className="challenge-board">
              <div className="challenge-section-label">Leaderboard{gradeable ? '' : ' (grading starts with the first result)'}</div>
              {leaderboard.map((row, i) => (
                <div className={`challenge-board-row${row.isModel ? ' model' : ''}`} key={`${row.name}-${i}`}>
                  <span className="challenge-board-rank">{i + 1}</span>
                  <span className="challenge-board-name">{row.name}{row.isModel ? ' 🤖' : ''}</span>
                  <span className="challenge-board-score">{row.score}<em>/{maxScore}</em></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="challenge-foot">
        Results come straight from <Link to="/track-record">the Ledger</Link>; the model's
        bracket is derived from the same simulation that prices <Link to="/draw">the draw</Link>.
      </p>
    </div>
  );
}
