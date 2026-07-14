// src/pages/MatchPage.js
//
// One URL per locked prediction - the landing target for every social card
// and the full pre-match answer: who wins, when it starts, how they match
// up, and (once played) how our call graded. Slug format:
// /match/jannik-sinner-vs-alexander-zverev-177491 (trailing id is the key).
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { timeUntil, localKickoff, idFromSlug } from '../utils/matchTime';
import { castCall, fetchTally, matchCallKey } from '../utils/matchCalls';
import './MatchPage.css';

const SURFACE_ACCENTS = { clay: '#e8694a', grass: '#3ddc84', hard: '#5b8cff' };

function verdictLine(favProb, favLast) {
  if (favProb < 0.55) return 'Coin-flip classic. Flip a coin, seriously.';
  if (favProb < 0.6) return 'Too close to call. Somebody leaves heartbroken.';
  if (favProb >= 0.75) return `Statement incoming. The numbers are not shy about ${favLast}.`;
  return `Clear favorite. The stats picked ${favLast}.`;
}

export default function MatchPage() {
  const { slug } = useParams();
  const matchId = idFromSlug(slug);

  const [pred, setPred] = useState(undefined); // undefined = loading, null = not found
  const [rows, setRows] = useState(null);      // roster rows for ranks/form
  const [h2h, setH2h] = useState(null);
  const [pairRecord, setPairRecord] = useState(null);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setPred((d.predictions || []).find((p) => String(p.id) === String(matchId)) || null))
      .catch(() => setPred(null));
  }, [matchId]);

  // Roster stats (rank + recent form) for the prediction's tour. The alive
  // flag keeps a slow response for the previous match from clobbering the
  // current one after a quick navigation.
  useEffect(() => {
    if (!pred) return undefined;
    let alive = true;
    const guard = (setter) => (v) => { if (alive) setter(v); };
    const setRowsG = guard(setRows), setH2hG = guard(setH2h), setPairG = guard(setPairRecord);
    const dir = pred.tour === 'wta' ? '/data/women' : '/data';
    Papa.parse(process.env.PUBLIC_URL + dir + '/smash_us.csv', {
      header: true,
      download: true,
      complete: ({ data }) => {
        const byId = new Map(data.filter((r) => r.id).map((r) => [r.id, r]));
        setRowsG({ a: byId.get(pred.p1) || null, b: byId.get(pred.p2) || null });
      },
      error: () => setRowsG({ a: null, b: null }),
    });
    fetch(process.env.PUBLIC_URL + '/data/h2h.json')
      .then((r) => r.json())
      .then((d) => {
        const key = [pred.p1, pred.p2].sort().join('_');
        const rec = d[key];
        if (!rec) { setH2hG(null); return; }
        const firstIsP1 = [pred.p1, pred.p2].sort()[0] === pred.p1;
        setH2hG({
          w1: firstIsP1 ? rec.winsA : rec.winsB,
          w2: firstIsP1 ? rec.winsB : rec.winsA,
          form1: firstIsP1 ? rec.recentFormA : rec.recentFormB,
          form2: firstIsP1 ? rec.recentFormB : rec.recentFormA,
        });
      })
      .catch(() => setH2hG(null));
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => {
        const pair = (d.matches || []).filter((m) =>
          (m.p1 === pred.p1 && m.p2 === pred.p2) || (m.p1 === pred.p2 && m.p2 === pred.p1));
        setPairG({ n: pair.length, correct: pair.filter((m) => m.smashCorrect).length });
      })
      .catch(() => setPairG(null));
    return () => { alive = false; };
  }, [pred]);

  const when = useMemo(() => (pred ? timeUntil(pred.date) : null), [pred]);

  // Community tally + your call, shared with the H2H studio via the same
  // matchup key (order-independent pair + surface + tour).
  const callKey = pred ? matchCallKey(pred.p1, pred.p2, pred.surface, pred.tour) : null;
  const [tally, setTally] = useState(null);
  const [myPick, setMyPick] = useState(null);
  useEffect(() => {
    let alive = true;
    setTally(null);
    if (callKey) {
      fetchTally(callKey).then((t) => { if (alive) setTally(t); });
      try { setMyPick(JSON.parse(localStorage.getItem('smashCalls') || '{}')[callKey]?.pick || null); } catch { setMyPick(null); }
    }
    return () => { alive = false; };
  }, [callKey]);

  const backPlayer = (pid) => {
    if (!pred || !callKey) return;
    setMyPick(pid);
    try {
      const s = JSON.parse(localStorage.getItem('smashCalls') || '{}');
      s[callKey] = { pick: pid, modelPick: pred.favorite, p1: pred.p1, p2: pred.p2, name1: pred.name1, name2: pred.name2, surface: pred.surface, tour: pred.tour, date: Date.now() };
      localStorage.setItem('smashCalls', JSON.stringify(s));
    } catch { /* storage unavailable */ }
    castCall(callKey, pid).then(() => fetchTally(callKey).then((t) => t && setTally(t)));
  };

  if (pred === undefined) {
    return <div className="match-page"><div className="skeleton match-skel" /></div>;
  }
  if (pred === null) {
    return (
      <div className="match-page">
        <div className="eyebrow">MATCH</div>
        <h1 className="match-title-line">Match not found</h1>
        <p className="match-sub">This call may have rotated off the board. The record keeps everything:</p>
        <Link className="match-cta" to="/track-record">See the track record →</Link>
      </div>
    );
  }

  const favIsP1 = pred.favorite === pred.p1;
  const favPct = Math.round(pred.favProb * 100);
  const favLast = pred.favName.split(' ').pop();
  const decided = pred.status !== 'pending';
  const accent = SURFACE_ACCENTS[pred.surface] || '#fff';
  const studioHref = `${pred.tour === 'wta' ? '/women' : ''}/h2h?surface=${pred.surface}&a=${pred.p1}&b=${pred.p2}`;

  const playerCard = (id, name, isFav) => {
    const row = rows ? (id === pred.p1 ? rows.a : rows.b) : null;
    return (
      <Link to={`/player/${pred.tour}/${id}`} className={`match-player${isFav ? ' fav' : ''}`}>
        <img src={playerPhoto(pred.tour, id)} alt={name} className="match-player-photo" />
        <span className="match-player-name">{name}</span>
        {isFav && <span className="match-player-tag">OUR PICK</span>}
        {row && (
          <span className="match-player-meta">
            {row.us_seed ? `World No. ${row.us_seed}` : ''}
            {row.recent_w != null && row.recent_w !== '' ? ` · ${row.recent_w}-${row.recent_l} recent` : ''}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="match-page" style={{ '--surf': accent }}>
      <div className="eyebrow">{pred.event.toUpperCase()} · {pred.surface.toUpperCase()} · {pred.tour.toUpperCase()}</div>
      <h1 className="match-title-line">{pred.name1} <span className="match-vs">vs</span> {pred.name2}</h1>

      <div className="match-when">
        {decided ? (
          <span className={`match-result-chip ${pred.correct ? 'hit' : 'miss'}`}>
            {pred.correct ? '✓ Called it' : '✗ Missed'} · {pred.winner === pred.p1 ? pred.name1 : pred.name2} won{pred.score ? ` ${pred.score}` : ''}
          </span>
        ) : (
          <>
            <span className="match-kickoff">{localKickoff(pred.date)}</span>
            {when && <span className={`match-countdown${when.soon ? ' soon' : ''}`}>{when.label}</span>}
          </>
        )}
      </div>

      <div className="match-players">
        {playerCard(pred.p1, pred.name1, favIsP1)}
        <div className="match-center">
          <div className="match-center-pct">{favPct}%</div>
          <div className="match-center-cap">{favLast} to win</div>
        </div>
        {playerCard(pred.p2, pred.name2, !favIsP1)}
      </div>

      <div className="match-verdict">
        <div className="match-bar">
          <div className="match-bar-fill" style={{ width: `${favIsP1 ? favPct : 100 - favPct}%` }} />
        </div>
        <p className="match-verdict-line">{verdictLine(pred.favProb, favLast)} Locked before play{decided ? ', graded after' : ''}.</p>
      </div>

      {/* Your call + the fan tally. Voting closes at kickoff, not at grading:
          a match that started (or finished, but hasn't been graded yet)
          shouldn't accept new calls. */}
      {((!decided && !when?.past) || (tally && tally.total > 0)) && (
        <div className="match-call">
          {!decided && !when?.past && (
            <div className="match-call-btns">
              {[[pred.p1, pred.name1], [pred.p2, pred.name2]].map(([pid, name]) => (
                <button
                  key={pid}
                  type="button"
                  className={`match-call-btn${myPick === pid ? ' picked' : ''}`}
                  onClick={() => backPlayer(pid)}
                >
                  Back {name.split(' ').pop()}
                </button>
              ))}
            </div>
          )}
          {myPick && !decided && (
            <span className="match-call-note">
              You backed {(myPick === pred.p1 ? pred.name1 : pred.name2).split(' ').pop()},
              {myPick === pred.favorite ? ' same as the model.' : ' fading the model.'}
            </span>
          )}
          {tally && (tally.counts[pred.p1] || 0) + (tally.counts[pred.p2] || 0) > 0 && (() => {
            const a = tally.counts[pred.p1] || 0;
            const b = tally.counts[pred.p2] || 0;
            const tot = a + b;
            const pctA = Math.round((a / tot) * 100);
            const leader = pctA >= 50 ? pred.name1 : pred.name2;
            return (
              <span className="match-call-tally">
                Fans back <strong>{leader.split(' ').pop()} {Math.max(pctA, 100 - pctA)}%</strong> · {tot.toLocaleString()} call{tot === 1 ? '' : 's'}
              </span>
            );
          })()}
        </div>
      )}

      <div className="match-facts">
        {h2h && (h2h.w1 + h2h.w2 > 0) && (
          <div className="match-fact">
            <div className="match-fact-label">Career head-to-head</div>
            <div className="match-fact-val">{pred.name1.split(' ').pop()} {h2h.w1} - {h2h.w2} {pred.name2.split(' ').pop()}</div>
            {(h2h.form1 || h2h.form2) && (
              <div className="match-fact-sub">recent form: {h2h.form1 || '-'} vs {h2h.form2 || '-'}</div>
            )}
          </div>
        )}
        {pairRecord && pairRecord.n > 0 && (
          <div className="match-fact">
            <div className="match-fact-label">Our record on this matchup</div>
            <div className="match-fact-val">{pairRecord.correct} of {pairRecord.n} called right</div>
            <div className="match-fact-sub">every meeting this season, graded in public</div>
          </div>
        )}
        <div className="match-fact">
          <div className="match-fact-label">Run it yourself</div>
          <Link className="match-cta" to={studioHref}>Play this match 1,000 times →</Link>
          <div className="match-fact-sub">full breakdown: win odds, exact scores, upset risk</div>
        </div>
      </div>
    </div>
  );
}
