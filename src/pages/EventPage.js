// src/pages/EventPage.js
//
// One page per tournament: /event/wimbledon, /event/miami-open - our graded
// record at that event, both tours together, straight from the ledger. The
// programmatic-SEO sibling of the rivalry pages, aimed at "<event>
// predictions" search intent; the sitemap enumerates every event with a
// meaningful sample.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { lastName } from '../utils/names';
import { cleanEvents } from '../utils/eventName';
import { slugify } from '../utils/slug';
import { pickCorrect, pickFavorite, pickFavProb } from '../utils/deployedPick';
import useDocMeta from '../utils/useDocMeta';
import './EventPage.css';

const ENGINES = [
  ['Smart Blend', 'smashCorrect'],
  ['Point Engine', 'correct'],
  ['Form (Elo)', 'eloCorrect'],
  ['Rankings', 'rankCorrect'],
];
const pct = (k, n) => (n ? Math.round((k / n) * 100) : 0);

export default function EventPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setData(cleanEvents(d.matches)))
      .catch(() => setData([]));
  }, []);

  // Resolve the slug against the distinct event names in the ledger.
  const eventName = useMemo(() => {
    if (!data) return undefined;
    const names = new Set();
    for (const m of data) if (m.event) names.add(m.event);
    return [...names].find((n) => slugify(n) === slug) || null;
  }, [data, slug]);

  const rows = useMemo(
    () => (eventName ? data.filter((m) => m.event === eventName).sort((a, b) => new Date(b.date) - new Date(a.date)) : []),
    [data, eventName]
  );

  const stats = useMemo(() => {
    const n = rows.length;
    const correct = rows.filter((m) => pickCorrect(m)).length;
    const byTour = ['atp', 'wta'].map((t) => {
      const ms = rows.filter((m) => m.tour === t);
      return { tour: t, n: ms.length, correct: ms.filter((m) => pickCorrect(m)).length };
    }).filter((t) => t.n > 0);
    const engines = ENGINES.map(([label, field]) => {
      const graded = rows.filter((m) => typeof m[field] === 'boolean');
      return { label, n: graded.length, correct: graded.filter((m) => m[field]).length };
    }).filter((e) => e.n > 0);
    // Boldest hit: the biggest ranking underdog we backed and got right.
    const bold = rows
      .filter((m) => pickCorrect(m) && m.rankA && m.rankB)
      .map((m) => {
        const pickIsP1 = pickFavorite(m) === m.p1;
        return { m, gap: (pickIsP1 ? m.rankA - m.rankB : m.rankB - m.rankA) };
      })
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap - a.gap)[0] || null;
    return { n, correct, byTour, engines, bold };
  }, [rows]);

  useDocMeta(
    eventName ? `${eventName} Predictions, Graded | Smash` : null,
    eventName ? `Our full graded record at the ${eventName}: ${pct(stats.correct, stats.n)}% of winners called across ${stats.n} matches, engine by engine, on the public ledger.` : null
  );

  if (data === null) return <div className="event-page"><div className="skeleton event-skel" /></div>;
  if (!eventName) {
    return (
      <div className="event-page">
        <div className="eyebrow">THE EVENT FILE</div>
        <h1 className="event-title">No graded matches for that event</h1>
        <p className="event-sub">Events appear here once the ledger has graded calls at them. The full log lives in <Link to="/track-record">the Ledger</Link>.</p>
      </div>
    );
  }

  const year = new Date(rows[0]?.date || Date.now()).getUTCFullYear();

  return (
    <div className="event-page">
      <div className="eyebrow">THE EVENT FILE · {year}</div>
      <h1 className="event-title">{eventName}, graded</h1>
      <p className="event-sub">
        Every {eventName} match between ranked players this season, called by the
        deployed model and scored in public. No take-backs.
      </p>

      <div className="event-hero">
        <div className="event-hero-main">
          <div className="event-hero-val">{pct(stats.correct, stats.n)}%</div>
          <div className="event-hero-label">WINNERS CALLED</div>
          <div className="event-hero-sub">{stats.correct} of {stats.n} matches</div>
        </div>
        {stats.byTour.map((t) => (
          <div className="event-hero-cell" key={t.tour}>
            <div className="event-hero-val sm">{pct(t.correct, t.n)}%</div>
            <div className="event-hero-label">{t.tour.toUpperCase()}</div>
            <div className="event-hero-sub">{t.correct} of {t.n}</div>
          </div>
        ))}
      </div>

      {stats.bold && (
        <div className="event-bold">
          <img className="event-face" src={playerPhoto(stats.bold.m.tour, pickFavorite(stats.bold.m))} alt="" loading="lazy" />
          <span>
            Boldest hit: backed{' '}
            <strong>
              #{pickFavorite(stats.bold.m) === stats.bold.m.p1 ? stats.bold.m.rankA : stats.bold.m.rankB}{' '}
              {lastName(pickFavorite(stats.bold.m) === stats.bold.m.p1 ? stats.bold.m.name1 : stats.bold.m.name2)}
            </strong>{' '}
            over #{pickFavorite(stats.bold.m) === stats.bold.m.p1 ? stats.bold.m.rankB : stats.bold.m.rankA}{' '}
            {lastName(pickFavorite(stats.bold.m) === stats.bold.m.p1 ? stats.bold.m.name2 : stats.bold.m.name1)}{' '}
            at {Math.round(pickFavProb(stats.bold.m) * 100)}% ✓
          </span>
        </div>
      )}

      {stats.engines.length > 0 && (
        <section>
          <div className="event-section-label">Engine by engine here</div>
          <div className="event-engines">
            {stats.engines.map((e) => (
              <div className="event-engine" key={e.label}>
                <span className="event-engine-name">{e.label}</span>
                <span className="event-engine-acc">{pct(e.correct, e.n)}%</span>
                <span className="event-engine-n">{e.n} graded</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="event-section-label">Latest results here</div>
        {rows.slice(0, 10).map((m) => (
          <div className="event-row" key={m.id}>
            <span className="event-row-date">{new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span className="event-row-match">
              <Link to={`/player/${m.tour}/${m.winner}`}>{lastName(m.winner === m.p1 ? m.name1 : m.name2)}</Link>
              {' def. '}
              <Link to={`/player/${m.tour}/${m.winner === m.p1 ? m.p2 : m.p1}`}>{lastName(m.winner === m.p1 ? m.name2 : m.name1)}</Link>
              {m.score ? ` ${m.score}` : ''}
            </span>
            <span className={`event-row-grade ${pickCorrect(m) ? 'hit' : 'miss'}`}>{pickCorrect(m) ? '✓' : '✗'}</span>
          </div>
        ))}
      </section>

      <p className="event-foot">
        The complete log with filters: <Link to="/track-record">the Ledger</Link> · how these
        engines work: <Link to="/model">the Engine Room</Link>
      </p>
    </div>
  );
}
