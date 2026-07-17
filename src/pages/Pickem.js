// src/pages/Pickem.js
//
// Beat the model: pick winners on the same locked matches the model calls,
// under the same rules - picks lock at kickoff, no take-backs, graded in
// public. Grading happens client-side against predictions.json (the same
// public file that grades the model), so the database stores only the
// picks themselves. Without Supabase configured the page explains the game
// and degrades honestly.
import React, { useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { supabase, cloudEnabled } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../components/ui/Toast';
import { matchSlug } from '../utils/matchTime';
import useDocMeta from '../utils/useDocMeta';
import './Pickem.css';

const displayNameFor = (user) => {
  const base = (user?.email || 'player').split('@')[0];
  return base.slice(0, 24);
};

export default function Pickem() {
  useDocMeta(
    "Pick'em: Beat the Model | Smash",
    'Pick winners before play, no edits after, and see if you read tennis better than the model.'
  );
  const { user, openSignIn } = useAuth();
  const [preds, setPreds] = useState(null);
  const [allPicks, setAllPicks] = useState(null);
  const [casting, setCasting] = useState(null); // match_id in flight

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setPreds(d.predictions || []))
      .catch(() => setPreds([]));
  }, []);

  const loadPicks = () => {
    if (!supabase) return;
    supabase.from('pickem_picks').select('user_id, display_name, match_id, pick')
      .then(({ data, error }) => setAllPicks(error ? [] : (data || [])));
  };
  useEffect(loadPicks, []);

  const pending = useMemo(
    () => (preds || [])
      .filter((p) => p.status === 'pending' && new Date(p.date) > new Date())
      .sort((a, b) => new Date(a.date) - new Date(b.date)),
    [preds]
  );
  const decidedById = useMemo(() => {
    const m = new Map();
    for (const p of preds || []) if (p.status !== 'pending' && p.winner) m.set(String(p.id), p);
    return m;
  }, [preds]);

  const myPicks = useMemo(() => {
    if (!user || !allPicks) return new Map();
    return new Map(allPicks.filter((p) => p.user_id === user.id).map((p) => [String(p.match_id), p.pick]));
  }, [user, allPicks]);

  // Grade every player against the same decided matches the model is graded on.
  const leaderboard = useMemo(() => {
    if (!allPicks) return null;
    const byUser = new Map();
    for (const p of allPicks) {
      const dec = decidedById.get(String(p.match_id));
      if (!dec) continue;
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, { name: p.display_name, n: 0, w: 0, modelW: 0 });
      const u = byUser.get(p.user_id);
      u.n += 1;
      if (p.pick === dec.winner) u.w += 1;
      if (dec.correct) u.modelW += 1;
    }
    return [...byUser.values()]
      .filter((u) => u.n >= 1)
      .sort((a, b) => b.w - a.w || (b.w / b.n) - (a.w / a.n))
      .slice(0, 20);
  }, [allPicks, decidedById]);

  const myRecord = user && leaderboard ? leaderboard.find((u) => u.name === displayNameFor(user)) : null;

  const modelForward = useMemo(() => {
    const dec = (preds || []).filter((p) => p.status !== 'pending');
    return { n: dec.length, w: dec.filter((p) => p.correct).length };
  }, [preds]);

  const cast = async (pred, pickId) => {
    if (!user) { openSignIn(); return; }
    if (casting || myPicks.has(String(pred.id))) return;
    setCasting(pred.id);
    try {
      const { error } = await supabase.from('pickem_picks').insert({
        user_id: user.id,
        display_name: displayNameFor(user),
        match_id: String(pred.id),
        pick: pickId,
        match_date: pred.date,
      });
      if (error) throw error;
      toast({ type: 'success', title: 'Pick locked', message: 'No take-backs - same rule the model plays by.' });
      loadPicks();
    } catch (err) {
      toast({ type: 'error', title: 'Pick not saved', message: err.message });
    } finally {
      setCasting(null);
    }
  };

  return (
    <div className="pickem-page">
      <div className="eyebrow">BEAT THE MODEL</div>
      <h1 className="pickem-title">Pick'em</h1>
      <p className="pickem-sub">
        Same matches, same rules: pick winners before play, no edits after.
        The model's locked record so far: <strong>{modelForward.w} of {modelForward.n}</strong>.
        Think you read tennis better? Prove it on the record.
      </p>

      {!cloudEnabled && (
        <div className="pickem-empty">
          Accounts aren't switched on in this deployment yet, so the leaderboard is
          napping. The model still takes all comers on the <Link to="/today">Today board</Link>.
        </div>
      )}

      {cloudEnabled && (
        <>
          {!user && (
            <button type="button" className="pickem-signin" onClick={openSignIn}>
              Sign in with a magic link to start picking →
            </button>
          )}
          {user && myRecord && (
            <div className="pickem-mine">
              Your record: <strong>{myRecord.w}/{myRecord.n}</strong> · the model on your matches:{' '}
              <strong>{myRecord.modelW}/{myRecord.n}</strong>
              {myRecord.w > myRecord.modelW ? ' · you are ahead. Respect.' : myRecord.w === myRecord.modelW ? ' · dead even.' : ' · the model leads, for now.'}
            </div>
          )}

          <div className="pickem-section-label">Open matches · picks lock at kickoff</div>
          {pending.length === 0 && (
            <div className="pickem-empty">
              No open matches right now. New calls lock for the grand slams and the
              big combined events - check back when play resumes.
            </div>
          )}
          <div className="pickem-list">
            {pending.slice(0, 12).map((p) => {
              const mine = myPicks.get(String(p.id));
              return (
                <div className="pickem-row" key={p.id}>
                  <div className="pickem-row-meta">
                    <span className="pickem-event">{p.tour.toUpperCase()} · {p.event}</span>
                    <Link className="pickem-match" to={`/match/${matchSlug(p)}`}>
                      {p.name1} vs {p.name2}
                    </Link>
                    <span className="pickem-model">model: {lastName(p.favName)} {Math.round(p.favProb * 100)}%</span>
                  </div>
                  <div className="pickem-btns">
                    {[[p.p1, p.name1], [p.p2, p.name2]].map(([id, name]) => (
                      <button
                        key={id}
                        type="button"
                        className={`pickem-btn${mine === id ? ' picked' : ''}`}
                        disabled={!!mine || casting === p.id}
                        aria-pressed={mine === id}
                        onClick={() => cast(p, id)}
                      >
                        {lastName(name)}
                      </button>
                    ))}
                  </div>
                  {mine && <span className="pickem-locked">locked ✓</span>}
                </div>
              );
            })}
          </div>

          <div className="pickem-section-label">Leaderboard · graded on the public record</div>
          {(!leaderboard || leaderboard.length === 0) && (
            <div className="pickem-empty">
              Nobody's on the board yet - the first graded pick starts it.
            </div>
          )}
          {leaderboard && leaderboard.length > 0 && (
            <table className="pickem-table">
              <thead>
                <tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Record</th><th scope="col">vs the model</th></tr>
              </thead>
              <tbody>
                {leaderboard.map((u, i) => (
                  <tr key={u.name + i}>
                    <td>{i + 1}</td>
                    <td>{u.name}</td>
                    <td>{u.w}/{u.n} ({Math.round((u.w / u.n) * 100)}%)</td>
                    <td className={u.w > u.modelW ? 'ahead' : u.w < u.modelW ? 'behind' : ''}>
                      {u.w > u.modelW ? 'ahead' : u.w < u.modelW ? 'behind' : 'even'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="pickem-note">
            Graded against the same public predictions file that grades the model.
            Picks are public by design - that's the whole game.
          </p>
        </>
      )}
    </div>
  );
}
