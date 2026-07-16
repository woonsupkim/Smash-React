// src/pages/TrackRecord.js
//
// Retrospective model performance: every completed 2026 tour-level match
// between two ranked players, across all surfaces. Predictions are
// PRECOMPUTED offline (data-pipeline/buildTrackRecord.js runs the same Monte
// Carlo sim), so this page just reads track_record.json and renders - no
// client-side simulation, instant load.
import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { countryFlagUrl } from '../components/countryFlags';
import { playerPhoto } from '../utils/playerPhotos';
import { matchSlug } from '../utils/matchTime';
import { MODEL_VERSION } from '../data/changelog';
import './TrackRecord.css';

const SURFACES = {
  hard: { label: 'Hard', accent: '#5b8cff' },
  clay: { label: 'Clay', accent: '#e8694a' },
  grass: { label: 'Grass', accent: '#3ddc84' },
};

const PAGE_SIZE = 10;

// Wilson 95% score interval for a binomial proportion - defends the headline
// accuracy against "that's just luck" by showing the sampling uncertainty.
function wilson(k, n) {
  if (!n) return { lo: 0, hi: 0, mid: 0 };
  const z = 1.96, p = k / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { lo: center - half, hi: center + half, mid: p };
}

// Parse an ATP/WTA score string ("7-6(4) 3-6 6-3") into per-set games, from
// the match winner's perspective. tb = tiebreak loser's points (superscript).
function parseScore(score) {
  if (!score) return [];
  return score.trim().split(/\s+/).map((set) => {
    const m = set.match(/^(\d+)-(\d+)(?:\((\d+)\))?/);
    return m ? { w: +m[1], l: +m[2], tb: m[3] != null ? +m[3] : null } : null;
  }).filter(Boolean);
}

// Compact broadcast-style scoreboard for a completed match. Names link to
// their player pages when tour/id are provided.
function MiniScore({ wName, lName, wFlag, lFlag, wPhoto, lPhoto, wId, lId, tour, sets }) {
  const cell = (games, otherGames, tb) => (
    <>{games}{tb != null && games < otherGames && <sup className="ts-tb">{tb}</sup>}</>
  );
  const nameCell = (photo, flag, name, id) => {
    const inner = (
      <>
        {photo && <img className="ts-face" src={photo} alt="" loading="lazy" />}
        {flag && <img src={flag} alt="" />}{name}
      </>
    );
    return id && tour
      ? <Link className="ts-player-link" to={`/player/${tour}/${id}`}>{inner}</Link>
      : inner;
  };
  return (
    <table className="track-scoreboard">
      <tbody>
        <tr className="ts-winner">
          <td className="ts-name">{nameCell(wPhoto, wFlag, wName, wId)}</td>
          {sets.map((s, i) => <td key={i} className="ts-won">{cell(s.w, s.l, s.tb)}</td>)}
        </tr>
        <tr>
          <td className="ts-name">{nameCell(lPhoto, lFlag, lName, lId)}</td>
          {sets.map((s, i) => <td key={i} className={s.l > s.w ? 'ts-won' : 'ts-lost'}>{cell(s.l, s.w, s.tb)}</td>)}
        </tr>
      </tbody>
    </table>
  );
}

export default function TrackRecord() {
  const [tour, setTour] = useState('all');
  const [surface, setSurface] = useState('all');
  const [data, setData] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ matches: [] }));
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then(setPredictions)
      .catch(() => setPredictions({ predictions: [] }));
  }, []);

  const forward = useMemo(() => {
    const list = (predictions?.predictions || []).filter((p) => (tour === 'all' || p.tour === tour) && (surface === 'all' || p.surface === surface));
    const pending = list.filter((p) => p.status === 'pending').sort((a, b) => new Date(a.date) - new Date(b.date));
    const decided = list.filter((p) => p.status !== 'pending').sort((a, b) => new Date(b.date) - new Date(a.date));
    return { pending, decided, correct: decided.filter((p) => p.correct).length };
  }, [predictions, tour, surface]);

  // Unfiltered forward record for the hero: the locked-before-play claim is
  // the page's headline once it has enough verified calls behind it.
  const forwardAll = useMemo(() => {
    const all = predictions?.predictions || [];
    const decided = all.filter((p) => p.status !== 'pending');
    const correct = decided.filter((p) => p.correct).length;
    const dates = all.map((p) => new Date(p.date)).filter((d) => !isNaN(d));
    return {
      n: decided.length,
      correct,
      acc: decided.length ? Math.round((correct / decided.length) * 100) : 0,
      since: dates.length ? new Date(Math.min(...dates)) : null,
    };
  }, [predictions]);
  // Below this many verified calls the season benchmark keeps the hero (an
  // n-of-3 headline helps nobody); past it, the forward test takes over.
  const FORWARD_HERO_MIN = 25;
  const forwardHero = forwardAll.n >= FORWARD_HERO_MIN;

  // Reset pagination whenever the filters change
  useEffect(() => { setVisible(PAGE_SIZE); }, [tour, surface]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.matches
      .filter((m) => (tour === 'all' || m.tour === tour) && (surface === 'all' || m.surface === surface))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data, tour, surface]);

  const stats = useMemo(() => {
    const n = filtered.length;
    const pct = (k) => (n ? Math.round((filtered.filter((m) => m[k]).length / n) * 100) : 0);

    // Per-surface accuracy (for the whole tour, ignoring the surface filter).
    // Each card shows its BEST engine's number - matching the "Most accurate"
    // highlight in the engine panel below - and names that engine on the card
    // so the figure is never quietly cherry-picked. Smart Blend wins ties.
    const perSurface = ['hard', 'clay', 'grass'].map((s) => {
      const list = (data?.matches || []).filter((m) => (tour === 'all' || m.tour === tour) && m.surface === s);
      const accOf = (key) => (list.length ? Math.round((list.filter((m) => m[key]).length / list.length) * 100) : 0);
      const best = [
        { label: 'Smart Blend', acc: accOf('smashCorrect') },
        { label: 'Point Sim', acc: accOf('correct') },
        { label: 'Form', acc: accOf('eloCorrect') },
        { label: 'Rankings', acc: accOf('rankCorrect') },
        { label: 'Hot Streak', acc: accOf('upsetCorrect') },
      ].reduce((b, e) => (e.acc > b.acc ? e : b));
      return { key: s, ...SURFACES[s], n: list.length, acc: best.acc, engine: best.label };
    });

    // Confidence calibration buckets on the favorite's modeled probability
    const buckets = [
      { label: '50–60%', lo: 0.5, hi: 0.6, mid: 55 },
      { label: '60–70%', lo: 0.6, hi: 0.7, mid: 65 },
      { label: '70–85%', lo: 0.7, hi: 0.85, mid: 77 },
      { label: '85%+', lo: 0.85, hi: 1.01, mid: 92 },
    ].map((b) => {
      // Calibrate on the blended probability the app actually shows
      const blendFav = (m) => (m.smashProbP1 >= 0.5 ? m.smashProbP1 : 1 - m.smashProbP1);
      const inB = filtered.filter((m) => blendFav(m) >= b.lo && blendFav(m) < b.hi);
      const won = inB.filter((m) => m.smashCorrect).length;
      return { ...b, n: inB.length, rate: inB.length ? Math.round((won / inB.length) * 100) : null };
    });

    const engines = {
      smash: pct('smashCorrect'),
      sim: pct('correct'),
      elo: pct('eloCorrect'),
      rank: pct('rankCorrect'),
      upset: pct('upsetCorrect'),
    };
    // Best selectable engine for this filter (Smart Blend wins ties).
    const bestEngine = ['smash', 'sim', 'elo', 'rank', 'upset']
      .reduce((b, id) => (engines[id] > engines[b] ? id : b), 'smash');

    // Bookmaker-favorite baseline: only over matches that actually carry odds.
    const oddList = filtered.filter((m) => m.oddCorrect != null);
    const oddAcc = oddList.length ? Math.round((oddList.filter((m) => m.oddCorrect).length / oddList.length) * 100) : null;

    // Head-to-head vs the market on the SAME odds-carrying matches, plus how
    // often we were right when we disagreed with the market ("beat the line").
    const smashOnOdds = oddList.length ? Math.round((oddList.filter((m) => m.smashCorrect).length / oddList.length) * 100) : null;
    const disagree = oddList.filter((m) => m.smashFavorite !== m.oddFav);
    const market = {
      n: oddList.length,
      marketAcc: oddAcc,
      smashAcc: smashOnOdds,
      disagreeN: disagree.length,
      disagreeWin: disagree.length ? Math.round((disagree.filter((m) => m.smashCorrect).length / disagree.length) * 100) : null,
    };

    // 95% Wilson interval on the headline (Smart Blend) accuracy.
    const smashK = filtered.filter((m) => m.smashCorrect).length;
    const ci = wilson(smashK, n);
    const ciHalf = Math.round(((ci.hi - ci.lo) / 2) * 100);

    // Exact-scoreline grading: the model predicts a set score ("3–1", from
    // the favorite's perspective); a hit requires both the right winner AND
    // the right number of sets.
    const scoreline = (() => {
      let total = 0, hits = 0;
      for (const m of filtered) {
        if (!m.predScore || !m.score) continue;
        const sets = parseScore(m.score);
        if (!sets.length) continue;
        const wSets = sets.filter((s) => s.w > s.l).length;
        const lSets = sets.filter((s) => s.l > s.w).length;
        const favWon = m.smashFavorite === m.winner;
        const actualFav = favWon ? `${wSets}–${lSets}` : `${lSets}–${wSets}`;
        total += 1;
        if (m.predScore === actualFav) hits += 1;
      }
      return { n: total, hits, pct: total ? Math.round((hits / total) * 100) : 0 };
    })();

    // Betting return: stake $1 on each strategy's pick at the match's decimal
    // odds. Win pays (odds - 1) profit; loss costs the $1 stake. Restricted to
    // matches with two distinct prices so every strategy (including "back the
    // bookmaker favorite") bets the exact same set. Beating the market here
    // means clearing the vig.
    const betList = filtered.filter((m) => m.od1 != null && m.od2 != null && m.od1 !== m.od2);
    const roiFor = (pickOf) => {
      let profit = 0, k = 0;
      for (const m of betList) {
        const pick = pickOf(m);
        if (!pick) continue;
        const odds = pick === m.p1 ? m.od1 : m.od2;
        if (!(odds > 0)) continue;
        k++;
        profit += pick === m.winner ? odds - 1 : -1;
      }
      return { profit, k, roi: k ? (profit / k) * 100 : 0 };
    };
    const eloFav = (m) => (m.eloProbP1 >= 0.5 ? m.p1 : m.p2);
    // Same names and order as the "Five ways to pick a winner" panel below,
    // so the two sections read as one comparison. "Rankings" IS the
    // higher-rank-wins baseline (identical picks), hence the tag.
    const returns = [
      { id: 'smash', label: 'Smart Blend', ...roiFor((m) => m.smashFavorite) },
      { id: 'sim', label: 'Point Sim', ...roiFor((m) => m.favorite) },
      { id: 'elo', label: 'Form', ...roiFor(eloFav) },
      { id: 'upset', label: 'Hot Streak', ...roiFor((m) => m.upsetFavorite) },
      { id: 'rank', label: 'Rankings', baseline: true, ...roiFor((m) => m.rankPick) },
      { id: 'odd', label: "The bookies' favorite", baseline: true, ...roiFor((m) => m.oddFav) },
    ];
    const bestReturn = returns.reduce((b, r) => (r.profit > b.profit ? r : b), returns[0]);

    return {
      n,
      correct: filtered.filter((m) => m.correct).length,
      smashCorrect: filtered.filter((m) => m.smashCorrect).length,
      smash: engines.smash,
      season: engines.sim,
      elo: engines.elo,
      upset: engines.upset,
      rank: engines.rank,
      engines,
      bestEngine,
      oddAcc,
      market,
      ciHalf,
      scoreline,
      returns,
      betN: betList.length,
      bestReturnId: bestReturn.profit > 0 ? bestReturn.id : null,
      perSurface,
      buckets,
    };
  }, [filtered, data, tour]);

  const isLoading = !data;
  const shown = filtered.slice(0, visible);

  // Freshness indicator - invisible when healthy, loud when the data is stale
  // (enterprise = nobody ever sees February rankings in July).
  const refreshedAt = data?.generatedAt ? new Date(data.generatedAt) : null;
  const staleDays = refreshedAt ? (Date.now() - refreshedAt.getTime()) / 864e5 : null;
  const isStale = staleDays != null && staleDays > 3;
  const refreshedLabel = (() => {
    if (!refreshedAt) return null;
    const h = (Date.now() - refreshedAt.getTime()) / 36e5;
    if (h < 1) return 'just now';
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  })();

  return (
    <div className="page-background track-bg">
      <div className="overlay track-overlay">
        <div className="track-page">
          <div className="track-header">
            <div className="eyebrow">MODEL PERFORMANCE · 2026 SEASON</div>
            <h1 className="track-title">Track Record</h1>
            <p className="track-sub">
              Every completed 2026 tour match between two ranked players, scored
              against what actually happened. No cherry-picking. Every match counts.
            </p>
            <div className="track-header-meta">
              <Link className="track-method-link" to="/methodology">How it works →</Link>
              <Link className="track-model-version" to="/changelog">Model v{MODEL_VERSION} · changelog</Link>
              {refreshedLabel && (
                <span className={`track-refreshed${isStale ? ' stale' : ''}`}>
                  <span className="track-refreshed-dot" />
                  {isStale ? 'Data may be stale · last refreshed ' : 'Data refreshed '}{refreshedLabel}
                </span>
              )}
            </div>
          </div>

          <div className="track-controls">
            <div className="track-seg" role="group" aria-label="Tour">
              {[['all', 'Both'], ['atp', 'ATP'], ['wta', 'WTA']].map(([t, label]) => (
                <button key={t} type="button" className={`track-seg-btn${tour === t ? ' active' : ''}`} onClick={() => setTour(t)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="track-seg" role="group" aria-label="Surface">
              {[['all', 'All surfaces'], ['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']].map(([v, label]) => (
                <button key={v} type="button" className={`track-seg-btn${surface === v ? ' active' : ''}`} onClick={() => setSurface(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Forward record - predictions LOCKED before the match was played.
              This is the leak-free, honest scoreboard (the retrospective below
              re-simulates finished matches). */}
          {(forward.pending.length > 0 || forward.decided.length > 0) && (
            <div className="track-panel track-forward">
              <div className="track-forward-head">
                <div className="track-section-label" style={{ margin: 0 }}>🔒 Called before the match · no take-backs</div>
                {forward.decided.length > 0 && (
                  <div className="track-forward-record">
                    {Math.round((forward.correct / forward.decided.length) * 100)}% · {forward.correct}/{forward.decided.length} verified
                  </div>
                )}
              </div>
              {forward.pending.map((p) => (
                <Link className="track-forward-row pending" to={`/match/${matchSlug(p)}`} key={p.id}>
                  <span className="track-forward-status">⏳ Upcoming</span>
                  <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                  <span className="track-forward-call">Backing {p.favName.split(' ').pop()} {Math.round(p.favProb * 100)}%</span>
                </Link>
              ))}
              {forward.decided.slice(0, 5).map((p) => (
                <Link className={`track-forward-row ${p.correct ? 'hit' : 'miss'}`} to={`/match/${matchSlug(p)}`} key={p.id}>
                  <span className="track-forward-status">{p.correct ? '✓' : '✗'}</span>
                  <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                  <span className="track-forward-call">Called {p.favName.split(' ').pop()} {Math.round(p.favProb * 100)}%</span>
                </Link>
              ))}
              {forward.pending.length > 0 && forward.decided.length === 0 && (
                <div className="track-note" style={{ marginTop: '0.6rem' }}>
                  These calls are on the record now. When the matches finish we score them
                  automatically. No hindsight, no edits.
                </div>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="track-skeletons">
              <div className="skeleton track-skel-hero" />
              <div className="skeleton track-skel-card" />
              {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton track-skel-row" />)}
            </div>
          ) : (
            <>
              {/* Headline. Once the forward test has enough verified calls,
                  the locked-before-play record IS the hero - the one number
                  that can only be earned, never edited. Until then the season
                  benchmark keeps the spot, labeled for what it is. */}
              {forwardHero ? (
                <>
                  <div className="track-hero-eyebrow">🔒 LOCKED BEFORE PLAY · NO TAKE-BACKS</div>
                  <div className="track-hero-stat">
                    <div className="track-hero-value">{forwardAll.acc}%</div>
                    <div className="track-hero-detail">
                      <div className="track-hero-label">of winners called before the match</div>
                      <div className="track-hero-sub">
                        {forwardAll.correct} of {forwardAll.n.toLocaleString()} verified calls · every one timestamped
                        before play and graded automatically when the result lands
                      </div>
                      <div className="track-hero-marks">
                        <span className="track-hero-hit">✓ {forwardAll.correct} hits</span>
                        <span className="track-hero-miss">✗ {(forwardAll.n - forwardAll.correct)} misses</span>
                        <span className="track-hero-marks-note">every receipt public</span>
                      </div>
                    </div>
                  </div>
                  <div className="track-panel track-benchmark">
                    <div className="track-benchmark-chip">SEASON BENCHMARK · RESIMULATED</div>
                    <div className="track-benchmark-row">
                      <span className="track-benchmark-val">{stats.smash}%</span>
                      <span className="track-benchmark-text">
                        of winners across {stats.n.toLocaleString()} matches ({tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()}{surface !== 'all' ? ` · ${SURFACES[surface].label}` : ''}),
                        today's model re-run over the full season. A model benchmark, not locked picks.
                        {stats.scoreline.n > 0 ? ` Exact set score called in ${stats.scoreline.pct}%.` : ''}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="track-hero-stat">
                    <div className="track-hero-value">{stats.smash}%</div>
                    <div className="track-hero-detail">
                      <div className="track-hero-label">of winners called correctly</div>
                      <div className="track-hero-sub">{stats.smashCorrect} of {stats.n} matches · {tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()}{surface !== 'all' ? ` · ${SURFACES[surface].label}` : ''}</div>
                      <div className="track-benchmark-chip">SEASON BENCHMARK · RESIMULATED</div>
                      <div className="track-hero-ci">
                        How today's model scores when re-run across every completed match this
                        season, give or take {stats.ciHalf} points. The locked-before-play record below is
                        the one that can only be earned.
                      </div>
                      {stats.scoreline.n > 0 && (
                        <div className="track-hero-scoreline">
                          Tougher test: we called the exact set score in {stats.scoreline.pct}% of matches
                          ({stats.scoreline.hits.toLocaleString()} of {stats.scoreline.n.toLocaleString()}).
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="track-arming">
                    <span className="track-arming-lock" aria-hidden="true">🔒</span>
                    <span>
                      <strong>The forward test is arming.</strong> Every call locked before
                      play{forwardAll.since ? ` since ${forwardAll.since.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : ''}
                      {forwardAll.n > 0 ? <> · <strong className="track-arming-count">{forwardAll.correct} of {forwardAll.n} verified</strong></> : null} · it
                      fills up match by match at the next grand slam, then takes over this page's headline.
                    </span>
                  </div>
                </>
              )}

              {/* Versus the betting market - the most credible claim in sports
                  prediction. This is a SUBSET (only matches that carried odds),
                  so both figures are scored on those matches, NOT on the full
                  set behind the headline above - that's why they differ. */}
              {stats.market.n > 0 && (
                <div className="track-panel track-market">
                  <div className="track-section-label">Us versus the bookies</div>
                  <div className="track-market-scope">
                    Scored only on the {stats.market.n} of {stats.n} matches that had betting odds, a
                    smaller set than the headline above, so the numbers differ a little.
                  </div>
                  <div className="track-market-row">
                    <div className="track-market-cell">
                      <div className="track-market-val">{stats.market.smashAcc}%</div>
                      <div className="track-market-cap">Smart Blend</div>
                    </div>
                    <div className="track-market-vs">vs</div>
                    <div className="track-market-cell">
                      <div className="track-market-val">{stats.market.marketAcc}%</div>
                      <div className="track-market-cap">The bookies' pick</div>
                    </div>
                    {stats.market.disagreeWin != null && (
                      <div className="track-market-disagree">
                        When we disagreed with the bookies, we were right{' '}
                        <strong>{stats.market.disagreeWin}%</strong> of the time
                        <span className="track-market-disagree-n"> ({stats.market.disagreeN} picks)</span>
                      </div>
                    )}
                  </div>
                  <div className="track-note">
                    Both numbers come from the same matches. Beating the bookies is the hardest
                    test in sports prediction: their odds already bake in everything the public knows.
                    {stats.market.n < 50 && ' Not many matches in this view yet, so take it with a grain of salt.'}
                  </div>
                </div>
              )}

              {/* Betting return: $1 staked on each strategy's pick */}
              {stats.betN > 0 && (
                <div className="track-panel track-roi">
                  <div className="track-section-label">If you bet $1 on every pick</div>
                  <div className="track-roi-scope">
                    Imagine putting $1 on every pick, at the bookies' own odds, across all {stats.betN} matches
                    that had them. Win and you collect; lose and the dollar's gone.
                  </div>
                  {(() => {
                    const maxAbs = Math.max(1, ...stats.returns.map((r) => Math.abs(r.profit)));
                    return stats.returns.map((r) => {
                      const pos = r.profit >= 0;
                      const w = (Math.abs(r.profit) / maxAbs) * 50;
                      return (
                        <div className={`track-roi-row${r.baseline ? ' baseline' : ''}${r.id === stats.bestReturnId ? ' best' : ''}`} key={r.id}>
                          <div className="track-roi-name">
                            {r.label}
                            {r.baseline && <span className="track-compare-baseline-tag">Baseline</span>}
                            {r.id === stats.bestReturnId && <span className="track-roi-best-tag">Best return</span>}
                          </div>
                          <div className="track-roi-track">
                            <div className="track-roi-zero" />
                            <div className={`track-roi-fill ${pos ? 'pos' : 'neg'}`} style={{ width: `${w}%`, left: pos ? '50%' : `${50 - w}%` }} />
                          </div>
                          <div className={`track-roi-val ${pos ? 'pos' : 'neg'}`}>{pos ? '+' : '−'}${Math.abs(r.profit).toFixed(2)}</div>
                          <div className="track-roi-pct">{r.roi >= 0 ? '+' : '−'}{Math.abs(r.roi).toFixed(1)}%</div>
                        </div>
                      );
                    });
                  })()}
                  <div className="track-note">
                    Total profit and return per $1. Just backing the bookies' favorite slowly loses
                    money (that's their cut). Anything that stays in the green is genuinely beating them.
                    {stats.betN < 50 && ' Not many matches in this view yet, so expect it to swing.'}
                  </div>
                </div>
              )}

              {/* Per-surface accuracy */}
              <div className="track-surface-row">
                {stats.perSurface.map((s) => (
                  <button
                    key={s.key}
                    className={`track-surface-card${surface === s.key ? ' active' : ''}`}
                    style={{ '--surf': s.accent }}
                    onClick={() => setSurface(surface === s.key ? 'all' : s.key)}
                  >
                    <div className="track-surface-acc" style={{ color: s.accent }}>{s.acc}%</div>
                    <div className="track-surface-label">{s.label}</div>
                    <div className="track-surface-n">{s.engine} · {s.n} matches</div>
                  </button>
                ))}
              </div>

              {/* Engine comparison - the best engine for this filter is highlighted */}
              <div className="track-panel">
                <div className="track-section-label">Five ways to pick a winner · {surface !== 'all' ? SURFACES[surface].label : 'all surfaces'}, same matches</div>
                <div className="track-compare">
                  {/* Same names and order as the betting panel above.
                      Rankings doubles as the baseline: its picks ARE
                      "higher rank wins" (the probability it carries only
                      matters inside the blend). */}
                  {[
                    { id: 'smash', label: 'Smart Blend', desc: 'Our best: a mix of everything below', acc: stats.smash },
                    { id: 'sim', label: 'Point Sim', desc: 'The match, played 1,000 times', acc: stats.season },
                    { id: 'elo', label: 'Form', desc: "Who's been winning on this surface", acc: stats.elo },
                    { id: 'upset', label: 'Hot Streak', desc: "Who's hot in the last few weeks", acc: stats.upset },
                    { id: 'rank', label: 'Rankings', desc: 'Just pick the higher-ranked player', acc: stats.rank, baseline: true },
                  ].map((mo) => (
                    <div className={`track-compare-row${mo.id === stats.bestEngine ? ' primary' : ''}${mo.baseline ? ' baseline' : ''}`} key={mo.id}>
                      <div className="track-compare-name">
                        {mo.label}
                        {mo.id === stats.bestEngine && <span className="track-compare-best">Most accurate</span>}
                        {mo.baseline && <span className="track-compare-baseline-tag">Baseline</span>}
                        <span className="track-compare-desc">{mo.desc}</span>
                      </div>
                      <div className="track-compare-bar-wrap">
                        <div className="track-compare-bar" style={{ width: `${mo.acc}%` }} />
                      </div>
                      <div className="track-compare-acc">{mo.acc}%</div>
                    </div>
                  ))}

                  {/* Second baseline: always back the bookmaker's favorite
                      (shortest odds). Only over matches that carry odds. */}
                  {stats.oddAcc != null && (
                    <div className="track-compare-row baseline">
                      <div className="track-compare-name">
                        The bookies' favorite
                        <span className="track-compare-baseline-tag">Baseline</span>
                        <span className="track-compare-desc">Always take whoever the bookies like</span>
                      </div>
                      <div className="track-compare-bar-wrap">
                        <div className="track-compare-bar" style={{ width: `${stats.oddAcc}%` }} />
                      </div>
                      <div className="track-compare-acc">{stats.oddAcc}%</div>
                    </div>
                  )}
                </div>
                <div className="track-note">
                  <em>Smart Blend</em> mixes the simulation, recent form, and world ranking, tuned
                  for each tour and surface, which is why it beats just following the rankings. The
                  tougher opponent is <em>the bookies' favorite</em>, shown only for matches that
                  had odds. One honest caveat: the blend was tuned on this same season, so the
                  purest proof is the called-before-the-match record up top.
                </div>
              </div>

              {/* Calibration - redesigned as compact horizontal reliability bars */}
              <div className="track-panel">
                <div className="track-section-label">Do the probabilities mean what they say?</div>
                <div className="track-calib">
                  {stats.buckets.map((b) => (
                    <div className="track-calib-row" key={b.label}>
                      <div className="track-calib-said">Said {b.label}</div>
                      <div className="track-calib-track">
                        <div className="track-calib-ideal" style={{ left: `${b.mid}%` }} title={`Ideal ≈ ${b.mid}%`} />
                        <div className="track-calib-fill" style={{ width: `${b.rate ?? 0}%` }} />
                      </div>
                      <div className="track-calib-actual">{b.rate == null ? '–' : `won ${b.rate}%`}</div>
                      <div className="track-calib-n">{b.n}</div>
                    </div>
                  ))}
                </div>
                <div className="track-note">
                  Each row is a promise check: when we said "about 70%", did favorites actually win
                  about 70% of the time? Bars landing near their tick mark mean yes, the
                  percentages mean what they say.
                </div>
              </div>

              {/* Match log - paginated */}
              <div className="track-panel">
                <div className="track-section-label">Match log · newest first</div>
                {shown.map((m) => {
                  const winnerIsP1 = m.winner === m.p1;
                  const wName = winnerIsP1 ? m.name1 : m.name2;
                  const lName = winnerIsP1 ? m.name2 : m.name1;
                  const wFlag = countryFlagUrl(winnerIsP1 ? m.country1 : m.country2);
                  const lFlag = countryFlagUrl(winnerIsP1 ? m.country2 : m.country1);
                  const blendFavProb = m.smashProbP1 >= 0.5 ? m.smashProbP1 : 1 - m.smashProbP1;
                  const favName = (m.smashFavorite === m.p1 ? m.name1 : m.name2).split(' ').pop();
                  // Predicted scoreline (stored, favorite's perspective) vs the
                  // real result, also from the favorite's perspective.
                  const sets = parseScore(m.score);
                  const wSets = sets.filter((s) => s.w > s.l).length;
                  const lSets = sets.filter((s) => s.l > s.w).length;
                  const favWon = m.smashFavorite === m.winner;
                  const actualFav = sets.length ? (favWon ? `${wSets}–${lSets}` : `${lSets}–${wSets}`) : null;
                  const scoreHit = m.predScore && actualFav && m.predScore === actualFav;
                  return (
                    <div className={`track-row${m.smashCorrect ? '' : ' miss'}`} key={m.id}>
                      <div className="track-row-meta">
                        <span className="track-row-surface" style={{ color: (SURFACES[m.surface] || {}).accent }}>
                          {(SURFACES[m.surface] || { label: m.surface }).label}
                        </span>
                        <span className="track-row-date">{new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        <span className="track-row-event">
                          {m.tour === 'wta' ? 'WTA' : 'ATP'}
                          {m.event ? ` · ${m.event}` : m.bestOf ? ` · Bo${m.bestOf}` : ''}
                        </span>
                      </div>
                      <div className="track-row-matchup">
                        <MiniScore
                          wName={wName} lName={lName} wFlag={wFlag} lFlag={lFlag}
                          wPhoto={playerPhoto(m.tour, winnerIsP1 ? m.p1 : m.p2)}
                          lPhoto={playerPhoto(m.tour, winnerIsP1 ? m.p2 : m.p1)}
                          wId={winnerIsP1 ? m.p1 : m.p2}
                          lId={winnerIsP1 ? m.p2 : m.p1}
                          tour={m.tour}
                          sets={parseScore(m.score)}
                        />
                      </div>
                      <div className="track-row-model">
                        <span className={`track-verdict ${m.smashCorrect ? 'hit' : 'miss'}`}>
                          {m.smashCorrect ? '✓ Called it' : '✗ Missed'} · {favName} {Math.round(blendFavProb * 100)}%
                        </span>
                        {m.predScore && actualFav && (
                          <span className={`track-scorecompare${scoreHit ? ' hit' : ''}`}>
                            Predicted {favName} {m.predScore} · actual {actualFav}{scoreHit ? ' ✓' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && <div className="track-empty">No matches recorded yet for this filter.</div>}
                {visible < filtered.length && (
                  <button className="track-more" onClick={() => setVisible((v) => v + 20)}>
                    See more history ({filtered.length - visible} more)
                  </button>
                )}
              </div>

              <p className="track-footnote">
                One honest footnote: these past matches are re-run with today's stats, which
                already know how the season went. The purest test is the called-before-the-match
                record above, and it grows with every tournament.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
