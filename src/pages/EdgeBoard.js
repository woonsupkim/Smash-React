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
import { pickFavorite, pickFavProb, pickCorrect, pickNoCall, ledgerNoCall } from '../utils/deployedPick';
import useDocMeta from '../utils/useDocMeta';
import './EdgeBoard.css';

// Vig-stripped implied probability for p1 from decimal odds: bookmakers
// overround the raw inverses, so normalize the pair to sum to 1.
function impliedP1(od1, od2) {
  const r1 = 1 / od1, r2 = 1 / od2;
  return r1 / (r1 + r2);
}

const pct = (p) => `${Math.round(p * 100)}%`;

// Two cumulative $1 curves over the graded splits, in date order: what a
// flat dollar on our side of every disagreement did, against the same dollar
// on the market's side. The end points are already stated as two numbers
// above; a reader has no way to tell from those whether the gap opened
// steadily or came from one lucky afternoon, which is exactly the question a
// sceptic should ask. Both lines start at zero on the same matches, so the
// vertical distance between them at any point is purely the price we were
// getting - the only thing that is free to differ.
function DivergenceChart({ curve, height = 190 }) {
  if (!curve || curve.length < 4) return null;
  const w = 720, h = height, padL = 44, padR = 12, padT = 14, padB = 22;
  const vals = curve.flatMap((d) => [d.us, d.mkt]);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = Math.max(hi - lo, 1e-6);
  const x = (i) => padL + (i / (curve.length - 1)) * (w - padL - padR);
  const y = (v) => h - padB - ((v - lo) / span) * (h - padT - padB);
  const path = (key) => curve.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');
  const last = curve[curve.length - 1];
  const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`;
  // Ticks at the extremes and at ZERO, not at the midpoint. The midpoint of
  // a range straddling break-even lands a hair off the dashed zero line and
  // labels it with something that is not zero, which is the one value on
  // this axis a reader needs to locate exactly.
  const ticks = [...new Set([Math.round(hi), 0, Math.round(lo)])];
  return (
    <figure className="edge-diverge">
      <figcaption className="edge-diverge-cap">
        $1 on every split, running total
        <span className="edge-diverge-key">
          <span className="edge-diverge-swatch us" /> our picks
          <span className="edge-diverge-swatch mkt" /> the bookies&apos; favorite
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img"
        aria-label={`Cumulative return on ${curve.length} graded disagreements. Backing our picks ends at ${money(last.us)}; backing the bookmakers' favorite on the same matches ends at ${money(last.mkt)}.`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3, #9aa1ab)">{money(t)}</text>
          </g>
        ))}
        <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.34)" strokeWidth="1" strokeDasharray="4 4" />
        <path d={path('mkt')} fill="none" stroke="#8b93a1" strokeWidth="2" strokeLinejoin="round" />
        <path d={path('us')} fill="none" stroke="var(--accent-brand, #c8f560)" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx={x(curve.length - 1)} cy={y(last.mkt)} r="3.5" fill="#8b93a1" />
        <circle cx={x(curve.length - 1)} cy={y(last.us)} r="4" fill="var(--accent-brand, #c8f560)" />
        <text x={padL} y={h - 6} fontSize="11" fill="var(--text-3, #9aa1ab)">first split</text>
        <text x={w - padR} y={h - 6} textAnchor="end" fontSize="11" fill="var(--text-3, #9aa1ab)">most recent</text>
      </svg>
    </figure>
  );
}

export default function EdgeBoard() {
  useDocMeta(
    'The Edge: Us vs the Betting Market, Graded | Smash',
    'Every match where our model and the bookies disagreed on the winner, graded in public: our pick, the market pick, and who was right.'
  );
  const [data, setData] = useState(null);
  const [preds, setPreds] = useState(null);
  const [tour, setTour] = useState('all');

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setData({ ...d, matches: cleanEvents(d.matches) }))
      .catch(() => setData({ matches: [] }));
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setPreds(cleanEvents(d.predictions)))
      .catch(() => setPreds([]));
  }, []);

  // THE FORWARD EDGE: pending picks that carry lock-time odds - the market's
  // price at the moment we locked, before the match is played. Only splits
  // (different winners) make the board; agreements carry no edge.
  const forward = useMemo(() => {
    return (preds || [])
      .filter((p) => p.status === 'pending' && !ledgerNoCall(p) && p.lockOdd1 && p.lockOdd2)
      .filter((p) => tour === 'all' || p.tour === tour)
      .map((p) => {
        const mktP1 = impliedP1(p.lockOdd1, p.lockOdd2);
        const mktFav = mktP1 >= 0.5 ? p.p1 : p.p2;
        return { ...p, mktP1, mktFav, disagree: p.favorite !== mktFav };
      })
      .filter((p) => p.disagree)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 10);
  }, [preds, tour]);

  // Rows where the ledger has both closing odds and a market favorite.
  const oddsRows = useMemo(() => {
    return (data?.matches || [])
      .filter((m) => m.od1 && m.od2 && m.oddFav && pickFavorite(m) && !pickNoCall(m))
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
    // The $1 test: stake $1 on every split, once on OUR pick and once on
    // the market's own favorite, both paid at the closing odds. Splits mean
    // we're usually holding the underdog ticket - the accuracy edge
    // compounds into a payout edge.
    let usReturn = 0, mktReturn = 0, ourOddSum = 0, mktOddSum = 0;
    // The two cumulative curves, in date order: this is the divergence the
    // end-point numbers only assert. Both start at zero and are settled a
    // dollar at a time on the same matches, so every place they separate is
    // a price difference rather than a difference in who was right.
    const chron = [...dis].sort((a, b) => new Date(a.date) - new Date(b.date));
    const curve = [];
    let cu = 0, cm = 0;
    for (const m of chron) {
      const ourOdds = pickFavorite(m) === m.p1 ? m.od1 : m.od2;
      const mktOdds = m.oddFav === m.p1 ? m.od1 : m.od2;
      ourOddSum += ourOdds; mktOddSum += mktOdds;
      if (pickCorrect(m)) usReturn += ourOdds;
      if (m.oddCorrect) mktReturn += mktOdds;
      cu += pickCorrect(m) ? ourOdds - 1 : -1;
      cm += m.oddCorrect ? mktOdds - 1 : -1;
      curve.push({ date: m.date, us: cu, mkt: cm });
    }
    return {
      n: oddsRows.length,
      disagreements: dis.length,
      usRight,
      mktRight,
      usAcc: dis.length ? Math.round((usRight / dis.length) * 100) : 0,
      mktAcc: dis.length ? Math.round((mktRight / dis.length) * 100) : 0,
      usNet: usReturn - dis.length,
      mktNet: mktReturn - dis.length,
      // The reason the money can diverge while the hit rates cannot: on a
      // split we hold the longer ticket, by this much on average.
      ourAvgOdds: dis.length ? ourOddSum / dis.length : null,
      mktAvgOdds: dis.length ? mktOddSum / dis.length : null,
      curve,
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
      <h1 className="edge-title">What our disagreements are worth</h1>
      <p className="edge-sub">
        The bookmakers are the strongest public forecast in tennis, and we do not out-guess
        them: on the matches where our locked pick and the market's favorite differ, both
        sides win about as often. The difference is the price. A split puts us on the longer
        ticket, so the same hit rate pays differently - and that is the edge this page grades,
        in public, all season.
      </p>
      <p className="edge-disclaimer">
        For research and entertainment only. Probabilities, not betting advice - if this page
        makes you want to bet, that is the one prediction we won't stand behind.
      </p>

      {stats.disagreements > 0 && (
        <div className="edge-money edge-money-lead">
          {/* One side, not two. Backing the market on the same splits
              returns roughly the mirror of this by construction - a split
              has exactly one winner - so printing both invited readers to
              read a doubled gap into what is a single measurement. The bar
              worth clearing is zero: flat-staking anything at bookmakers'
              prices loses money on average, which is how they stay open. */}
          <div className="edge-money-label">THE $1 TEST · ${stats.disagreements} staked on each side of every split</div>
          <div className="edge-money-row">
            <span className={`edge-money-cell us ${stats.usNet >= 0 ? 'pos' : 'neg'}`}>
              $1 on our picks → <strong>{stats.usNet >= 0 ? '+' : '-'}${Math.abs(stats.usNet).toFixed(0)}</strong>
              <span className="edge-money-roi"> ({stats.usNet >= 0 ? '+' : '-'}{Math.abs((100 * stats.usNet) / Math.max(1, stats.disagreements)).toFixed(0)}%)</span>
            </span>
            <span className={`edge-money-cell ${stats.mktNet >= 0 ? 'pos' : 'neg'}`}>
              $1 on the market&apos;s → <strong>{stats.mktNet >= 0 ? '+' : '-'}${Math.abs(stats.mktNet).toFixed(0)}</strong>
              <span className="edge-money-roi"> ({stats.mktNet >= 0 ? '+' : '-'}{Math.abs((100 * stats.mktNet) / Math.max(1, stats.disagreements)).toFixed(0)}%)</span>
            </span>
          </div>
        </div>
      )}
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
            <div className="edge-hero-label">MARKET WON<br /><span className="edge-hero-forced">the remainder, by definition</span></div>
          </div>
        </div>
      ) : (
        <div className="edge-empty">
          No graded disagreements for this filter yet. The moment we and the market split
          on a winner, the receipt lands here.
        </div>
      )}
      {stats.disagreements > 0 && <DivergenceChart curve={stats.curve} />}
      {stats.disagreements > 0 && (
        <div className="edge-money">
          <div className="edge-money-note">
            Hypothetical, settled at the price each side was quoted when we locked the call.
            The two hit rates above are forced to add to 100% - on a split one side has to be
            wrong - so they cannot both be interesting. The money can, because the two sides are
            paid differently: a split puts us on the longer ticket, averaging{' '}
            {stats.ourAvgOdds != null && (
              <strong>{stats.ourAvgOdds.toFixed(2)} against their {stats.mktAvgOdds.toFixed(2)}</strong>
            )}. That price gap is why the same {stats.usAcc}% can be worth more than their {stats.mktAcc}%,
            and why the two lines above separate.
            Our feed carries one price per match, so this is not a closing-line comparison.
          </div>
        </div>
      )}
      <div className="edge-hero-note">
        Across {stats.n.toLocaleString()} graded matches that carried a price. When both sides
        picked the same winner, there is no edge to grade - only the {stats.disagreements} splits count here.
      </div>

      <div className="edge-controls" role="group" aria-label="Tour">
        {[['all', 'ATP + WTA'], ['atp', 'ATP'], ['wta', 'WTA']].map(([v, label]) => (
          <button key={v} type="button" className={`edge-seg-btn${tour === v ? ' active' : ''}`} onClick={() => setTour(v)}>
            {label}
          </button>
        ))}
      </div>

      {forward.length > 0 && (
        <>
          <div className="edge-section-label">The forward edge · locked, not yet played</div>
          <div className="edge-board edge-forward">
            {forward.map((p) => {
              const ourName = p.favName;
              const mktName = p.mktFav === p.p1 ? p.name1 : p.name2;
              const mktProb = p.mktFav === p.p1 ? p.mktP1 : 1 - p.mktP1;
              return (
                <div className="edge-row" key={p.id}>
                  <div className="edge-row-meta">
                    <span className="edge-row-event">{p.tour.toUpperCase()}{p.event ? ` · ${p.event}` : ''}</span>
                    <span className="edge-row-date">{new Date(p.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </div>
                  <div className="edge-row-match">
                    {[[p.p1, p.name1], [p.p2, p.name2]].map(([pid, name], i) => (
                      <Link key={pid} className="edge-player" to={`/player/${p.tour}/${pid}`}>
                        <img className="edge-face" src={playerPhoto(p.tour, pid)} alt="" loading="lazy" />
                        <span>{name}</span>
                        {i === 0 && <span className="edge-vs">vs</span>}
                      </Link>
                    ))}
                  </div>
                  <div className="edge-row-calls">
                    <span className="edge-call us">WE SAY {lastName(ourName)} {pct(p.favProb)}</span>
                    <span className="edge-call">MARKET SAYS {lastName(mktName)} {pct(mktProb)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="edge-hero-note">
            Market prices captured at the moment we locked each pick. These grade
            into the board below as results land - no take-backs on either side.
          </div>
        </>
      )}

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
        Market probabilities are the vig-stripped implied probabilities of the price
        recorded for each match when the call locked. "Our pick" is the deployed call from the{' '}
        <Link to="/track-record">the Ledger</Link> - the same one graded on every page of
        this site. Methodology in <Link to="/model">the Engine Room</Link>.
      </p>
    </div>
  );
}
