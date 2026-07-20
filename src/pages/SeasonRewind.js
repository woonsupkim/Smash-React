// src/pages/SeasonRewind.js
//
// THE REWIND: one page per season. The current year renders live from
// season_rewind.json (rebuilt every refresh); past years render from the
// frozen archive in /data/seasons/<year>.json and never change again -
// that's the evergreen "how good were the predictions in <year>" answer.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { lastName } from '../utils/names';
import { cleanEventName } from '../utils/eventName';
import useDocMeta from '../utils/useDocMeta';
import './SeasonRewind.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (k, n) => (n ? Math.round((k / n) * 100) : 0);

export default function SeasonRewind() {
  const { year } = useParams();
  const [data, setData] = useState(undefined); // undefined loading, null missing

  useEffect(() => {
    // Try the live file first; if the URL names an archived year, fall
    // through to the frozen copy.
    let alive = true;
    (async () => {
      try {
        const live = await fetch(process.env.PUBLIC_URL + '/data/season_rewind.json').then((r) => (r.ok ? r.json() : null));
        if (!year || (live && String(live.year) === String(year))) {
          if (alive) setData(live);
          return;
        }
        const frozen = await fetch(process.env.PUBLIC_URL + `/data/seasons/${year}.json`).then((r) => (r.ok ? r.json() : null));
        if (alive) setData(frozen);
      } catch {
        if (alive) setData(null);
      }
    })();
    return () => { alive = false; };
  }, [year]);

  // A frozen archive is forever - treat a malformed one (missing headline
  // or monthly) as absent rather than letting it crash the page for good.
  const valid = !!(data && data.headline && Array.isArray(data.monthly));

  useDocMeta(
    valid ? `${data.year} Tennis Predictions, Graded: The Season Rewind | Smash` : null,
    valid ? `Every ${data.year} prediction graded in public: ${pct(data.headline.correct, data.headline.n)}% of winners called across ${data.headline.n.toLocaleString()} matches, the boldest calls, and the miss we own.` : null
  );

  const monthlyMax = useMemo(() => Math.max(1, ...(data?.monthly || []).map((m) => m.n)), [data]);

  if (data === undefined) return <div className="rewind-page"><div className="skeleton rewind-skel" /></div>;
  if (!valid) {
    return (
      <div className="rewind-page">
        <div className="eyebrow">THE REWIND</div>
        <h1 className="rewind-title">No rewind for {year || 'that season'} yet</h1>
        <p className="rewind-sub">Seasons freeze here as they end. The one being written right now lives on <Link to="/track-record">the Ledger</Link>.</p>
      </div>
    );
  }

  const H = data.headline;
  const isLive = !year || String(new Date().getUTCFullYear()) === String(data.year);

  return (
    <div className="rewind-page">
      <div className="eyebrow">THE REWIND · {data.year}{isLive ? ' · IN PROGRESS' : ' · FINAL'}</div>
      <h1 className="rewind-title">The {data.year} season, graded</h1>
      <p className="rewind-sub">
        Every call locked before play, graded after, nothing deleted. This is what that
        honesty added up to in {data.year}.
      </p>

      <div className="rewind-hero">
        <div className="rewind-hero-cell">
          <div className="rewind-hero-val">{pct(H.correct, H.n)}%</div>
          <div className="rewind-hero-label">WINNERS CALLED</div>
          <div className="rewind-hero-sub">{H.correct.toLocaleString()} of {H.n.toLocaleString()} matches</div>
        </div>
        {H.odds?.n > 0 && (
          <div className="rewind-hero-cell">
            <div className="rewind-hero-val">{pct(H.odds.us, H.odds.n)}% <span className="rewind-vs">vs</span> {pct(H.odds.market, H.odds.n)}%</div>
            <div className="rewind-hero-label">US VS THE BOOKIES</div>
            <div className="rewind-hero-sub">
              on {H.odds.n.toLocaleString()} matches with closing odds
              {H.odds.disagreements ? ` · splits went ${H.odds.usOnSplits}-${H.odds.disagreements - H.odds.usOnSplits} our way` : ''}
            </div>
          </div>
        )}
      </div>

      {data.monthly.length > 1 && (
        <section>
          <div className="rewind-section-label">Month by month</div>
          <div className="rewind-months">
            {data.monthly.map((m) => (
              <div className="rewind-month" key={m.month}>
                <div className="rewind-month-acc">{pct(m.correct, m.n)}%</div>
                <div className="rewind-month-bar-track">
                  <div className="rewind-month-bar" style={{ height: `${Math.round((m.n / monthlyMax) * 100)}%` }} />
                </div>
                <div className="rewind-month-name">{MONTHS[m.month - 1]}</div>
                <div className="rewind-month-n">{m.n}</div>
              </div>
            ))}
          </div>
          <div className="rewind-table-note">bar height = matches graded that month · number = winners called</div>
        </section>
      )}

      {data.best?.length > 0 && (
        <section>
          <div className="rewind-section-label">The boldest calls that landed</div>
          {data.best.map((m) => (
            <div className="rewind-call" key={m.id}>
              <img className="rewind-face" src={playerPhoto(m.tour, m.pick)} alt="" loading="lazy" />
              <div className="rewind-call-body">
                <span className="rewind-call-line">
                  Backed <strong>
                    {m.pickRank ? `#${m.pickRank} ` : ''}{lastName(m.pick === m.p1 ? m.name1 : m.name2)}
                  </strong>{' '}
                  over {m.oppRank ? `#${m.oppRank} ` : ''}{lastName(m.pick === m.p1 ? m.name2 : m.name1)} at{' '}
                  <strong>{Math.round(m.prob * 100)}%</strong>
                </span>
                <span className="rewind-call-meta">
                  {m.tour.toUpperCase()}{m.event ? ` · ${cleanEventName(m.event)}` : ''} ·{' '}
                  {new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {m.score ? ` · won ${m.score}` : ''}
                </span>
              </div>
              <span className="rewind-hit">✓</span>
            </div>
          ))}
        </section>
      )}

      {data.worst && (
        <section>
          <div className="rewind-section-label">The miss we own</div>
          <div className="rewind-worst">
            We had <strong>{lastName(data.worst.pick === data.worst.p1 ? data.worst.name1 : data.worst.name2)}</strong> at{' '}
            <strong>{Math.round(data.worst.prob * 100)}%</strong>
            {data.worst.event ? ` at the ${cleanEventName(data.worst.event)}` : ''} and{' '}
            {lastName(data.worst.winner === data.worst.p1 ? data.worst.name1 : data.worst.name2)} won
            {data.worst.score ? ` ${data.worst.score}` : ''}. It stays on the record like everything else.
          </div>
        </section>
      )}

      {data.engines?.length > 0 && (
        <section>
          <div className="rewind-section-label">How every engine scored</div>
          <div className="rewind-engines">
            {data.engines.map((e) => (
              <div className="rewind-engine" key={e.label}>
                <span className="rewind-engine-name">{e.label}</span>
                <span className="rewind-engine-acc">{pct(e.correct, e.n)}%</span>
                <span className="rewind-engine-n">{e.n.toLocaleString()} graded</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.keys(data.journeys || {}).length > 0 && (
        <section>
          <div className="rewind-section-label">Title runs we priced</div>
          {Object.entries(data.journeys).map(([tour, j]) => (
            <p className="rewind-journey" key={tour}>
              <strong>{tour.toUpperCase()} · {j.event}:</strong>{' '}
              {j.champion
                ? <>champion <strong>{j.champion}</strong>{j.openOdds != null ? `, priced at ${Math.round(j.openOdds * 100)}% on day one` : ''}, tracked across {j.days} daily snapshots.</>
                : <>tracked across {j.days} daily snapshots{j.status === 'projection' ? ' (projection)' : ''}.</>}
            </p>
          ))}
        </section>
      )}

      <p className="rewind-foot">
        The full receipts behind every number: <Link to="/track-record">the Ledger</Link> ·
        how the engines work: <Link to="/model">the Engine Room</Link>
      </p>
    </div>
  );
}
