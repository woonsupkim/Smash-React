// src/pages/EdgeBoard.js
//
// THE EDGE: the matches where our deployed pick and the betting market's
// favorite disagree, graded in public like everything else. The ledger
// already carries closing odds (od1/od2) on about half its rows; this page
// productizes the divergence: who did we back, who did the market back,
// who was right. Zero API calls - everything renders from track_record.json.
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { playerPhoto } from '../utils/playerPhotos';
import { countryFlagUrl } from '../components/countryFlags';
import { lastName } from '../utils/names';
import { cleanEvents } from '../utils/eventName';
import { pickFavorite, pickFavProb, pickCorrect } from '../utils/deployedPick';
import useDocMeta from '../utils/useDocMeta';
import './EdgeBoard.css';

// Vig-stripped implied probability for p1 from decimal odds: bookmakers
// overround the raw inverses, so normalize the pair to sum to 1.
function impliedP1(od1, od2) {
  const r1 = 1 / od1, r2 = 1 / od2;
  return r1 / (r1 + r2);
}

const pct = (p) => `${Math.round(p * 100)}%`;

export default function EdgeBoard() {
  useDocMeta(
    'The Edge: Us vs the Betting Market, Graded | Smash',
    'Every match where our model and the bookies disagreed on the winner, graded in public: our pick, the market pick, and who was right.'
  );
  const [data, setData] = useState(null);
  const [tour, setTour] = useState('all');

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setData({ ...d, matches: cleanEvents(d.matches) }))
      .catch(() => setData({ matches: [] }));
  }, []);

  // Rows where the ledger has both closing odds and a market favorite.
  const oddsRows = useMemo(() => {
    return (data?.matches || [])
      .filter((m) => m.od1 && m.od2 && m.oddFav && pickFavorite(m))
      .filter((m) => tour === 'all' || m.tour === tour)
      .map((m) => {
        const ourProbP1 = m.pickProbP1 ?? m.smashProbP1 ?? m.probP1;
        const mktProbP1 = impliedP1(m.od1, m.od2);
        return {
          ...m,
          ourProbP1,
          mktProbP1,
          gap: Math.abs(ourProbP1 - mktProbP1),
          disagree: pickFavorite(m) !== m.oddFav,
        };
      });
  }, [data, tour]);

  const stats = useMemo(() => {
    const dis = oddsRows.filter((m) => m.disagree);
    const usRight = dis.filter((m) => pickCorrect(m)).length;
    const mktRight = dis.filter((m) => m.oddCorrect).length;
    return {
      n: oddsRows.length,
      disagreements: dis.length,
      usRight,
      mktRight,
      usAcc: dis.length ? Math.round((usRight / dis.length) * 100) : 0,
      mktAcc: dis.length ? Math.round((mktRight / dis.length) * 100) : 0,
    };
  }, [oddsRows]);

  // The board: disagreements first (the whole point), sorted by how far
  // apart the two probabilities were; capped so the page stays a board,
  // not an archive.
  const board = useMemo(
    () => oddsRows.filter((m) => m.disagree).sort((a, b) => b.gap - a.gap).slice(0, 25),
    [oddsRows]
  );

  if (!data) {
    return <div className="edge-page"><div className="skeleton edge-skel" /></div>;
  }

  return (
    <div className="edge-page">
      <div className="eyebrow">THE EDGE</div>
      <h1 className="edge-title">Where we disagree with the market</h1>
      <p className="edge-sub">
        The bookmakers are the strongest public forecast in tennis. On the matches where
        our locked pick and the market's favorite differ, somebody has to be wrong - so we
        grade both sides, in public, all season.
      </p>
      <p className="edge-disclaimer">
        For research and entertainment only. Probabilities, not betting advice - if this page
        makes you want to bet, that is the one prediction we won't stand behind.
      </p>

      {stats.disagreements > 0 ? (
        <div className="edge-hero">
          <div className="edge-hero-cell us">
            <div className="edge-hero-val">{stats.usAcc}%</div>
            <div className="edge-hero-label">OUR PICK WON</div>
          </div>
          <div className="edge-hero-vs">
            <div className="edge-hero-n">{stats.disagreements}</div>
            <div className="edge-hero-nlabel">DISAGREEMENTS<br />THIS SEASON</div>
          </div>
          <div className="edge-hero-cell">
            <div className="edge-hero-val">{stats.mktAcc}%</div>
            <div className="edge-hero-label">MARKET WON</div>
          </div>
        </div>
      ) : (
        <div className="edge-empty">
          No graded disagreements for this filter yet. The moment we and the market split
          on a winner, the receipt lands here.
        </div>
      )}
      <div className="edge-hero-note">
        Across {stats.n.toLocaleString()} graded matches with closing odds. When both sides
        picked the same winner, there is no edge to grade - only the {stats.disagreements} splits count here.
      </div>

      <div className="edge-controls" role="group" aria-label="Tour">
        {[['all', 'ATP + WTA'], ['atp', 'ATP'], ['wta', 'WTA']].map(([v, label]) => (
          <button key={v} type="button" className={`edge-seg-btn${tour === v ? ' active' : ''}`} onClick={() => setTour(v)}>
            {label}
          </button>
        ))}
      </div>

      <div className="edge-section-label">Biggest splits, graded</div>
      <div className="edge-board">
        {board.map((m) => {
          const ourFavIsP1 = pickFavorite(m) === m.p1;
          const ourName = ourFavIsP1 ? m.name1 : m.name2;
          const mktName = m.oddFav === m.p1 ? m.name1 : m.name2;
          const ourProb = pickFavProb(m);
          const mktProb = m.oddFav === m.p1 ? m.mktProbP1 : 1 - m.mktProbP1;
          const usWon = pickCorrect(m);
          return (
            <div className="edge-row" key={m.id}>
              <div className="edge-row-meta">
                <span className="edge-row-event">{m.tour.toUpperCase()}{m.event ? ` · ${m.event}` : ''}</span>
                <span className="edge-row-date">{new Date(m.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="edge-row-match">
                {[[m.p1, m.name1, m.country1], [m.p2, m.name2, m.country2]].map(([pid, name, ctry], i) => (
                  <Link key={pid} className={`edge-player${m.winner === pid ? ' won' : ''}`} to={`/player/${m.tour}/${pid}`}>
                    <img className="edge-face" src={playerPhoto(m.tour, pid)} alt="" loading="lazy" />
                    {countryFlagUrl(ctry) && <img className="edge-flag" src={countryFlagUrl(ctry)} alt="" />}
                    <span>{name}</span>
                    {i === 0 && <span className="edge-vs">vs</span>}
                  </Link>
                ))}
              </div>
              <div className="edge-row-calls">
                <span className={`edge-call us${usWon ? ' hit' : ' miss'}`}>
                  WE SAID {lastName(ourName)} {pct(ourProb)} {usWon ? '✓' : '✗'}
                </span>
                <span className={`edge-call${m.oddCorrect ? ' hit' : ' miss'}`}>
                  MARKET SAID {lastName(mktName)} {pct(mktProb)} {m.oddCorrect ? '✓' : '✗'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="edge-note">
        Market probabilities are the vig-stripped implied probabilities of the closing odds
        recorded for each match. "Our pick" is the deployed call from the{' '}
        <Link to="/track-record">public ledger</Link> - the same one graded on every page of
        this site. Methodology in <Link to="/model">the Engine Room</Link>.
      </p>
    </div>
  );
}
