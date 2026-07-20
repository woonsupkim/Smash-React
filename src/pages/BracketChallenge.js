// src/pages/BracketChallenge.js
//
// THE SLAM BRACKET CHALLENGE: when a slam's round of 16 is set, lock a
// full bracket (8 R16 calls -> champion), then watch it grade round by
// round against the public ledger. The model locks its own bracket from
// the survival matrix and sits on the leaderboard like any other entrant.
// Storage is one insert-only Supabase row per user per slam; grading is
// entirely client-side, and without Supabase the page still shows the
// model's bracket and the rules.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, cloudEnabled } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
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

const displayNameFor = (user) => (user?.email || 'player').split('@')[0].slice(0, 24);
const emptyPicks = () => ROUND_META.map((r) => Array(r.size).fill(null));

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
    'Lock a full bracket when the round of 16 is set, then get graded round by round in public - against everyone, including the model.'
  );
  const { user, openSignIn } = useAuth();
  const [odds, setOdds] = useState(null);
  const [track, setTrack] = useState(null);
  const [tour, setTour] = useState('atp');
  const [sel, setSel] = useState(emptyPicks());
  const [entries, setEntries] = useState(null);
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

  useEffect(() => { setSel(emptyPicks()); setEntries(null); }, [tour, eventKey]);

  useEffect(() => {
    if (!supabase || !eventKey) return;
    supabase.from('bracket_entries').select('user_id, display_name, picks, created_at').eq('event_key', eventKey)
      .then(({ data }) => setEntries(data || []));
  }, [eventKey]);

  // Real roster ids only: slotN ids can never appear in the ledger.
  const fieldIds = useMemo(() => new Set((field || []).map((p) => p.id).filter((id) => !String(id).startsWith('slot'))), [field]);
  const wins = useMemo(
    () => (gradeable && eventName ? actualProgress(track, eventName, fieldIds) : new Map()),
    [gradeable, track, eventName, fieldIds]
  );
  const model = useMemo(() => (field && survival ? modelBracket(field, survival) : null), [field, survival]);
  const byId = useMemo(() => new Map((field || []).map((p) => [p.id, p])), [field]);
  const mine = user && entries ? entries.find((e) => e.user_id === user.id) : null;

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

  const lockBracket = async () => {
    if (!user) { openSignIn(); return; }
    if (!complete || saving) return;
    setSaving(true);
    try {
      const picks = Object.fromEntries(ROUND_META.map((r, i) => [r.key, sel[i]]));
      const { error } = await supabase.from('bracket_entries').insert({
        user_id: user.id,
        display_name: displayNameFor(user),
        event_key: eventKey,
        picks,
      });
      if (error && error.code !== '23505') throw error;
      toast(error
        ? { type: 'error', title: 'Already locked', message: 'You have a bracket for this slam - one entry, no take-backs.' }
        : { type: 'success', title: 'Bracket locked', message: 'Graded round by round from here. No take-backs.' });
      const { data } = await supabase.from('bracket_entries').select('user_id, display_name, picks, created_at').eq('event_key', eventKey);
      setEntries(data || []);
    } catch (err) {
      toast({ type: 'error', title: 'Bracket not saved', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const leaderboard = useMemo(() => {
    if (!field) return [];
    const rows = (entries || []).map((e) => ({ name: e.display_name, ...scoreEntry(e.picks, wins), isModel: false }));
    if (model) rows.push({ name: 'The Model', ...scoreEntry(Object.fromEntries(ROUND_META.map((r, i) => [r.key, model[i]])), wins), isModel: true });
    return rows.sort((a, b) => b.score - a.score);
  }, [entries, model, wins, field]);

  if (!odds || !track) return <div className="challenge-page"><div className="skeleton challenge-skel" /></div>;

  return (
    <div className="challenge-page">
      <div className="eyebrow">THE BRACKET CHALLENGE</div>
      <h1 className="challenge-title">Beat the model's bracket</h1>
      <p className="challenge-sub">
        When a slam's round of 16 is set, everyone locks a full bracket - you, the field,
        and the model. One point per round-of-16 call, doubling every round to 8 for the
        champion ({MAX_SCORE} is a perfect bracket). Graded in public as results land.
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

          {/* With cloud on, wait for entries to load before offering the
              picker - otherwise a fast finger could double-submit while
              `mine` is still unknown. */}
          {open && !mine && (!cloudEnabled || entries !== null) && (
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
              {cloudEnabled ? (
                <button type="button" className="challenge-lock" disabled={!complete || saving} onClick={lockBracket}>
                  {complete ? (user ? 'Lock my bracket' : 'Sign in to lock it') : 'Finish every round to lock'}
                </button>
              ) : (
                <div className="challenge-nocloud">
                  Accounts aren't switched on in this deployment yet, so brackets can't be
                  saved - but the model's bracket below is live, and the picker works.
                </div>
              )}
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
