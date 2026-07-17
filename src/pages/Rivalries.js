// src/pages/Rivalries.js
//
// The rivalries board: the top matchups on each tour, ranked by career
// meetings and combined ranking. Every entry links to its own rivalry page
// (/rivalry/:tour/:slug) - the crawlable hub behind the programmatic SEO
// pages. Built entirely from data files the pipeline already publishes.
import React, { useEffect, useMemo, useState } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { playerPhoto } from '../utils/playerPhotos';
import { slugify } from '../utils/slug';
import './Rivalry.css';

const TOP_N = 25; // per tour

function useTourRivalries(tour) {
  const dataDir = tour === 'wta' ? '/data/women' : '/data';
  const [roster, setRoster] = useState(null);
  const [h2h, setH2h] = useState(null);
  useEffect(() => {
    Papa.parse(process.env.PUBLIC_URL + `${dataDir}/smash_us.csv`, {
      header: true,
      download: true,
      complete: ({ data }) => setRoster(data.filter((r) => r.id && r.name)),
      error: () => setRoster([]),
    });
    fetch(process.env.PUBLIC_URL + `${dataDir}/h2h.json`).then((r) => r.json()).then(setH2h).catch(() => setH2h({}));
  }, [dataDir]);

  return useMemo(() => {
    if (!roster || !h2h) return null;
    const byId = new Map(roster.map((r) => [r.id, r]));
    const out = [];
    for (const [key, rec] of Object.entries(h2h)) {
      const [ia, ib] = key.split('_');
      const a = byId.get(ia), b = byId.get(ib);
      if (!a || !b) continue;
      const meetings = (rec.winsA || 0) + (rec.winsB || 0);
      if (meetings < 3) continue;
      const rankSum = (Number(a.us_seed) || 200) + (Number(b.us_seed) || 200);
      out.push({
        a, b, meetings,
        winsA: rec.winsA, winsB: rec.winsB,
        // More meetings and better-ranked players float up.
        score: meetings * 10 - rankSum * 0.5,
        slug: `${slugify(a.name)}-vs-${slugify(b.name)}`,
      });
    }
    return out.sort((x, y) => y.score - x.score).slice(0, TOP_N);
  }, [roster, h2h]);
}

function RivalryList({ tour, title }) {
  const list = useTourRivalries(tour);
  return (
    <div className="rivalries-tour">
      <div className="rivalry-section-label">{title}</div>
      {!list && <div className="skeleton rivalries-skel" />}
      {list && list.length === 0 && (
        <p className="rivalry-note">The board is still filling in - rivalries appear as the season's meetings accumulate.</p>
      )}
      {list && list.length > 0 && (
        <div className="rivalries-grid">
          {list.map((r) => (
            <Link className="rivalries-card" to={`/rivalry/${tour}/${r.slug}`} key={r.slug}>
              <span className="rivalries-faces">
                <img src={playerPhoto(tour, r.a.id)} alt="" loading="lazy" />
                <img src={playerPhoto(tour, r.b.id)} alt="" loading="lazy" />
              </span>
              <span className="rivalries-names">
                {lastName(r.a.name)} <em>vs</em> {lastName(r.b.name)}
              </span>
              <span className="rivalries-meta">{r.winsA}–{r.winsB} · {r.meetings} meetings</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Rivalries() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'Tennis Rivalries: H2H Records & Predictions | Smash';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="rivalry-page">
      <div className="eyebrow">THE RIVALRIES</div>
      <h1 className="rivalry-title">Every big matchup, on the record</h1>
      <p className="rivalry-sub">
        Career head-to-heads, live form curves, and a model read for every surface -
        each rivalry graded in public whenever the two actually meet.
      </p>
      <RivalryList tour="atp" title="ATP" />
      <RivalryList tour="wta" title="WTA" />
    </div>
  );
}
