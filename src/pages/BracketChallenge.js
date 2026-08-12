// src/pages/BracketChallenge.js
//
// THE SLAM BRACKET CHALLENGE: when a slam's round of 16 is set, lock a
// full bracket (8 R16 calls -> champion), then watch it grade round by
// round against the public ledger. The model locks its own bracket from
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

const ROUND_META = [
  { key: 'r16', label: 'Round of 16', size: 8, points: 1 },
  { key: 'qf', label: 'Quarter-finals', size: 4, points: 2 },
  { key: 'sf', label: 'Semi-finals', size: 2, points: 4 },
  { key: 'f', label: 'Champion', size: 1, points: 8 },
];
const MAX_SCORE = ROUND_META.reduce((s, r) => s + r.size * r.points, 0); // 32

const emptyPicks = () => ROUND_META.map((r) => Array(r.size).fill(null));

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
function modelBracket(field, survival) {
  const byId = new Map(field.map((p, i) => [p.id ?? `slot${i}`, survival[i]]));
  const idAt = (i) => field[i].id ?? `slot${i}`;
  const picks = emptyPicks();
  let prev = Array.from({ length: 16 }, (_, i) => idAt(i));
  for (let r = 0; r < ROUND_META.length; r++) {
    const next = [];
    for (let i = 0; i < ROUND_META[r].size; i++) {
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

function scoreEntry(picks, wins) {
  let score = 0;
  const detail = [];
  for (let r = 0; r < ROUND_META.length; r++) {
    const need = r + 1; // wins required to have survived this round
    const arr = picks[ROUND_META[r].key] ?? picks[r] ?? [];
    const hits = arr.filter((id) => (wins.get(id) || 0) >= need).length;
    score += hits * ROUND_META[r].points;
    detail.push(hits);
  }
  return { score, detail };
}

export default function BracketChallenge() {
  useDocMeta(
    'Slam Bracket Challenge: Beat the Model\'s Bracket | Smash',
    'Lock a full bracket when the round of 16 is set, then get graded round by round against the real results and the model.'
  );
  const [odds, setOdds] = useState(null);
  const [track, setTrack] = useState(null);
  const [tour, setTour] = useState('atp');
  const [sel, setSel] = useState(emptyPicks());
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
    const raw = entry?.draw?.field?.length === 16 ? entry.draw.field : null;
    return raw ? raw.map((p, i) => ({ ...p, id: p.id ?? `slot${i}` })) : null;
  }, [entry]);
  const survival = entry?.draw?.survival;
  const eventKey = entry ? `${tour}-${slugify(eventName)}-${new Date(entry.startsAt || entry.history?.[0]?.date || Date.now()).getUTCFullYear()}` : null;
  const open = !!(field && entry.status === 'live' && entry.fieldSize === 16);
  const gradeable = !!(field && (entry.fieldSize < 16 || entry.status === 'final'));

  useEffect(() => { setSel(emptyPicks()); }, [tour, eventKey]);

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
  const model = useMemo(() => (field && survival ? modelBracket(field, survival) : null), [field, survival]);
  const byId = useMemo(() => new Map((field || []).map((p) => [p.id, p])), [field]);

  // Picker interaction: choosing a winner clears any downstream pick that
  // depended on the player being replaced.
  const sources = (r, i) => (r === 0
    ? [field[2 * i]?.id, field[2 * i + 1]?.id]
    : [sel[r - 1][2 * i], sel[r - 1][2 * i + 1]]);
  const choose = (r, i, id) => {
    setSel((prev) => {
      const next = prev.map((a) => [...a]);
      next[r][i] = id;
      for (let r2 = r + 1; r2 < ROUND_META.length; r2++) {
        for (let j = 0; j < ROUND_META[r2].size; j++) {
          const src = r2 === 0 ? [] : [next[r2 - 1][2 * j], next[r2 - 1][2 * j + 1]];
          if (next[r2][j] && !src.includes(next[r2][j])) next[r2][j] = null;
        }
      }
      return next;
    });
  };
  const complete = sel.every((round) => round.every(Boolean));

  const lockBracket = () => {
    if (!complete || saving || mine) return;
    setSaving(true);
    const picks = Object.fromEntries(ROUND_META.map((r, i) => [r.key, sel[i]]));
    const entry = { picks, lockedAt: new Date().toISOString() };
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
    if (mine) rows.push({ name: 'You', ...scoreEntry(mine.picks, wins), isModel: false });
    if (model) rows.push({ name: 'The Model', ...scoreEntry(Object.fromEntries(ROUND_META.map((r, i) => [r.key, model[i]])), wins), isModel: true });
    return rows.sort((a, b) => b.score - a.score);
  }, [mine, model, wins, field]);

  if (!odds || !track) return <div className="challenge-page"><div className="skeleton challenge-skel" /></div>;

  return (
    <div className="challenge-page">
      <div className="eyebrow">THE BRACKET CHALLENGE</div>
      <h1 className="challenge-title">Beat the model's bracket</h1>
      <p className="challenge-sub">
        When a slam's round of 16 is set, you and the model both lock a full bracket.
        One point per round-of-16 call, doubling every round to 8 for the champion
        ({MAX_SCORE} is a perfect bracket), graded against the real results as they land.
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
          No 16-player bracket on the board right now. Entries open the moment the next
          slam's round of 16 is set - the <Link to="/draw">draw page</Link> shows how close
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
                {ROUND_META.map((round, r) => (
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
                                className={`challenge-pick${sel[r][i] === id && id ? ' chosen' : ''}`}
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
              {ROUND_META.map((round) => (
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
                  <span className="challenge-board-score">{row.score}<em>/{MAX_SCORE}</em></span>
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
