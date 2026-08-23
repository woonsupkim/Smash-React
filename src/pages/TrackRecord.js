// src/pages/TrackRecord.js
//
// Retrospective model performance: every completed 2026 tour-level match
// between two ranked players, across all surfaces. Predictions are
// PRECOMPUTED offline (data-pipeline/buildTrackRecord.js runs the same
// closed-form engine), so this page just reads track_record.json and
// renders - no client-side simulation, instant load.
import React, { useState, useEffect, useMemo } from 'react';
import { lastName } from '../utils/names';
import { Link } from 'react-router-dom';
import { countryFlagUrl } from '../components/countryFlags';
import { playerPhoto } from '../utils/playerPhotos';
import { matchSlug } from '../utils/matchTime';
import { MODEL_VERSION } from '../data/changelog';
import { pickCorrect, pickFavorite, pickFavProb, pickNoCall, ledgerNoCall, thresholdFor } from '../utils/deployedPick';
import { cleanEvents } from '../utils/eventName';
import { slugify } from '../utils/slug';
import useDocMeta from '../utils/useDocMeta';
import './TrackRecord.css';

const SURFACES = {
  hard: { label: 'Hard', accent: '#5b8cff' },
  clay: { label: 'Clay', accent: '#e8694a' },
  grass: { label: 'Grass', accent: '#3ddc84' },
};

const PAGE_SIZE = 10;

// The events a casual tennis fan recognizes on sight: slams, the
// Masters/WTA-1000 stops, and the season finals - each tagged with the
// tier that becomes its optgroup in the dropdown. Patterns match the
// sponsor-heavy names the data actually carries ("BNP Paribas Open",
// "Internazionali BNL d'Italia", "National Bank Open").
const MAJOR_EVENT_TIERS = [
  { tier: 'Grand Slams', re: /australian open|french open|roland garros|wimbledon|us open/i },
  {
    tier: 'Masters & 1000s',
    re: /bnp paribas|indian wells|miami open|monte.carlo|madrid open|internazionali|italian open|national bank|canadian open|\bcanada\b|cincinnati|shanghai|paris masters|rolex paris|qatar totalenergies|qatar open|dubai|china open|wuhan/i,
    // qatar totalenergies = the WTA 1000; NOT the ATP Doha 250 ("Qatar ExxonMobil Open").
    // predictions.json labels the National Bank Open as bare "Canada" (the
    // retrospective log uses "National Bank Open"); match both so the live
    // Masters stop actually populates the forward receipts.
  },
  { tier: 'Tour Finals', re: /atp finals|wta finals|tour finals/i },
];
const eventTier = (name) => MAJOR_EVENT_TIERS.find(({ re }) => re.test(name))?.tier || null;

// The forward record ("The Receipts") only counts calls at the events a fan
// treats as real tests: Grand Slams and the Masters/1000 stops. Lower-tier
// 250/500 calls are noise for a public scoreboard. Two independent signals,
// since neither is complete in the data: the event-name regex catches the
// slams (which carry no tier code), and the native `tier` field catches
// Masters even when the event name is a sponsor string the regex misses.
// The forward record counts EVERY locked call, at whatever event.
//
// It used to be filtered to slams and 1000s here on the reasoning that
// lower-tier calls are noise for a public scoreboard. Two problems. It was a
// no-op - buildPredictions only locks calls at those events anyway, so the
// filter excluded nothing and merely hid the constraint - and it made the
// scope of the headline a display decision rather than a locking one. If we
// ever start locking calls at a 500, they belong in the record the moment we
// make them, not once someone remembers to widen a regex. The scope is now
// whatever we actually locked, stated on the page.
const isForwardEvent = () => true;

// One call per matchup: the ESPN id can reassign between refreshes, so the
// same match can appear twice (often one pending + one graded). Key by the
// player pair and event, and keep the graded copy when there's a choice.
const dedupePreds = (list) => {
  const seen = new Map();
  for (const p of list) {
    const key = `${p.tour}|${[p.p1, p.p2].sort().join('_')}|${(p.event || '').toLowerCase()}`;
    const prev = seen.get(key);
    if (!prev || (prev.status === 'pending' && p.status !== 'pending')) seen.set(key, p);
  }
  return [...seen.values()];
};

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
  useDocMeta(
    'The Ledger: Every Call Graded | Smash',
    'Every prediction the model makes, graded in public: accuracy by tour, surface, and event, with the full match log.'
  );
  const [tour, setTour] = useState('all');
  const [surface, setSurface] = useState('all');
  const [eventF, setEventF] = useState('all');
  const [data, setData] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/track_record.json')
      .then((r) => r.json())
      .then((d) => setData({ ...d, matches: cleanEvents(d.matches) }))
      .catch(() => setData({ matches: [] }));
    fetch(process.env.PUBLIC_URL + '/data/predictions.json')
      .then((r) => r.json())
      .then((d) => setPredictions({ ...d, predictions: cleanEvents(d.predictions) }))
      .catch(() => setPredictions({ predictions: [] }));
  }, []);

  // Distinct event names present in the graded data, most recent first,
  // limited to the tournaments a casual fan recognizes: the four slams, the
  // Masters/1000-level stops, and the tour finals. Purely a dropdown-length
  // decision - every match still counts in every stat, and rows from a
  // 250 in Bastad still show under "All events".
  const events = useMemo(() => {
    const latest = new Map();
    for (const m of data?.matches || []) {
      if (!m.event) continue;
      if (!latest.has(m.event) || m.date > latest.get(m.event)) latest.set(m.event, m.date);
    }
    const majors = [...latest.entries()]
      .map(([name, date]) => ({ name, date, tier: eventTier(name) }))
      .filter((e) => e.tier)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    // Grouped for <optgroup>, in tier order; empty tiers drop out.
    return MAJOR_EVENT_TIERS
      .map(({ tier }) => ({ tier, items: majors.filter((e) => e.tier === tier).map((e) => e.name) }))
      .filter((g) => g.items.length > 0);
  }, [data]);

  const forward = useMemo(() => {
    // Majors only (Slams + Masters/1000), one call per matchup, then the UI filters.
    const majors = dedupePreds((predictions?.predictions || []).filter(isForwardEvent));
    const list = majors.filter((p) =>
      (tour === 'all' || p.tour === tour) && (surface === 'all' || p.surface === surface)
      && (eventF === 'all' || p.event === eventF));
    // Lead with genuinely-upcoming calls (soonest first) - the panel is about
    // "called before it happens". Past-dated calls that finished but weren't
    // graded yet ("Awaiting result") sink below, freshest first, so a handful
    // of ungraded stragglers can't bury tonight's picks out of the top 8.
    const now = Date.now();
    const isUpcoming = (p) => new Date(p.date).getTime() >= now;
    const pending = list.filter((p) => p.status === 'pending').sort((a, b) => {
      const ua = isUpcoming(a), ub = isUpcoming(b);
      if (ua !== ub) return ua ? -1 : 1;
      return ua ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date);
    });
    const decided = list.filter((p) => (p.status === 'won' || p.status === 'lost') && !ledgerNoCall(p)).sort((a, b) => new Date(b.date) - new Date(a.date));
    // Graded calls only guest-star here briefly: after a few days they live
    // in the match log below (every graded call lands there), and this panel
    // stays focused on fresh calls. The record count keeps ALL of them.
    const RECENT_DAYS = 3;
    const recent = decided.filter((p) => (Date.now() - new Date(p.date).getTime()) < RECENT_DAYS * 864e5);
    return { pending, decided, recent, correct: decided.filter((p) => p.correct).length };
  }, [predictions, tour, surface, eventF]);

  // Unfiltered forward record for the hero: the locked-before-play claim is
  // the page's headline once it has enough verified calls behind it.
  const forwardAll = useMemo(() => {
    const all = dedupePreds((predictions?.predictions || []).filter(isForwardEvent));
    // Calls only: a no-call is graded for audit, never counted as a claim.
    const decided = all.filter((p) => (p.status === 'won' || p.status === 'lost') && !ledgerNoCall(p));
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

  // The ledger by stated confidence: every verified call, bucketed by what we
  // CLAIMED before play, with what actually landed next to it. All bands are
  // shown, including the coin flips - a "confident calls" line without the
  // rest sitting under it would be cherry-picking, and the whole point of
  // this page is that we do not do that. Unfiltered on purpose: it grades the
  // same population as the headline record, not whatever the filters show.
  const confTiers = useMemo(() => {
    const decided = dedupePreds((predictions?.predictions || []).filter(isForwardEvent))
      .filter((p) => (p.status === 'won' || p.status === 'lost') && typeof p.favProb === 'number');
    if (decided.length < FORWARD_HERO_MIN) return null;
    // The passes are their OWN row, split off by the per-cell rule rather
    // than by a probability boundary. "Coin flips 50-65%" used to mix the
    // matches we declined to call with the lowest band we do call, under a
    // column headed CALLS, so its count could not be reconciled with the
    // record two panels down. A fixed boundary cannot do the job any more
    // either: the cutoff is 0.54 on ATP clay and 0.64 on WTA clay, so no
    // single number separates the passes from the claims. Ask the rule.
    const bands = [
      { label: 'Passed on', pass: true },
      { label: 'Slim calls', lo: 0.5, hi: 0.65 },
      { label: 'Leans', lo: 0.65, hi: 0.75 },
      { label: 'Confident', lo: 0.75, hi: 1.01 },
    ];
    return bands.map(({ label, lo, hi, pass }) => {
      const g = pass
        ? decided.filter((pr) => ledgerNoCall(pr))
        : decided.filter((pr) => !ledgerNoCall(pr) && pr.favProb >= lo && pr.favProb < hi);
      const won = g.filter((p) => p.correct).length;
      return {
        label,
        pass: !!pass,
        range: pass
          ? 'under its cutoff'
          : `${Math.round(lo * 100)}–${Math.round(Math.min(hi, 1) * 100)}%`,
        n: g.length,
        said: g.length ? g.reduce((s, p) => s + p.favProb, 0) / g.length : null,
        landed: g.length ? won / g.length : null,
        wilson: g.length ? wilson(won, g.length) : null,
      };
    }).filter((b) => b.n > 0);
  }, [predictions]);

  // Reset pagination whenever the filters change
  useEffect(() => { setVisible(PAGE_SIZE); }, [tour, surface, eventF]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.matches
      .filter((m) => (tour === 'all' || m.tour === tour) && (surface === 'all' || m.surface === surface)
        && (eventF === 'all' || m.event === eventF))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [data, tour, surface, eventF]);
  // Published stats grade CALLS only - the same policy the ledger locks
  // under, applied to the whole history (derived on read, no row rewritten).
  // The match log below still lists every graded match, no-calls tagged, and
  // the by-confidence table keeps grading them: restraint stays auditable.
  const filteredCalls = useMemo(() => filtered.filter((m) => !pickNoCall(m)), [filtered]);

  const stats = useMemo(() => {
    // Claims grade CALLS; the calibration buckets below deliberately keep
    // every graded row (coin flips included) - that view exists to audit
    // the no-call policy, not to flatter it.
    const n = filteredCalls.length;
    const pct = (k) => (n ? Math.round((filteredCalls.filter((m) => m[k]).length / n) * 100) : 0);

    // Per-surface accuracy (for the whole tour, ignoring the surface filter).
    // Each card shows the DEPLOYED call's accuracy on that surface - the
    // number the site actually put on screen for those matches. It used to
    // show the best engine's number instead, taking the max over five
    // engines per surface, which is a cherry-pick even with the engine
    // named on the card: the maximum of five estimates beats any one of
    // them on noise alone, and it could print a surface figure higher than
    // the "Our model" bar below it on exactly the same matches.
    const perSurface = ['hard', 'clay', 'grass'].map((s) => {
      const list = (data?.matches || []).filter((m) => (tour === 'all' || m.tour === tour) && m.surface === s
        && (eventF === 'all' || m.event === eventF) && !pickNoCall(m));
      const acc = list.length ? Math.round((list.filter((m) => pickCorrect(m)).length / list.length) * 100) : 0;
      return { key: s, ...SURFACES[s], n: list.length, acc };
    });

    // Confidence calibration buckets on the DEPLOYED call's probability
    // (the number the site actually showed for each match).
    const buckets = [
      { label: '50–60%', lo: 0.5, hi: 0.6, mid: 55 },
      { label: '60–70%', lo: 0.6, hi: 0.7, mid: 65 },
      { label: '70–85%', lo: 0.7, hi: 0.85, mid: 77 },
      { label: '85%+', lo: 0.85, hi: 1.01, mid: 92 },
    ].map((b) => {
      const inB = filtered.filter((m) => pickFavProb(m) >= b.lo && pickFavProb(m) < b.hi);
      const won = inB.filter((m) => pickCorrect(m)).length;
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
    const oddList = filteredCalls.filter((m) => m.oddCorrect != null);
    const oddAcc = oddList.length ? Math.round((oddList.filter((m) => m.oddCorrect).length / oddList.length) * 100) : null;
    // ...and OUR two numbers re-scored on that same subset, because the
    // comparison panel puts all three in one bar chart. It used to plot our
    // model and rankings over every call (2,381) beside the bookmakers over
    // the priced ones (1,140) - three bars, two populations, under a heading
    // that promised "same matches". On this data that understated us: the
    // like-for-like figures are 75% to 74%, not 72% to 74%.
    const pricedAcc = {
      deployed: oddList.length ? Math.round((oddList.filter((m) => pickCorrect(m)).length / oddList.length) * 100) : null,
      rank: oddList.length ? Math.round((oddList.filter((m) => m.rankCorrect).length / oddList.length) * 100) : null,
      n: oddList.length,
    };

    // Head-to-head vs the market on the SAME odds-carrying matches, scored
    // on the DEPLOYED calls, plus how often we were right when we disagreed
    // with the market ("beat the line").
    const smashOnOdds = oddList.length ? Math.round((oddList.filter((m) => pickCorrect(m)).length / oddList.length) * 100) : null;
    const disagree = oddList.filter((m) => pickFavorite(m) !== m.oddFav);
    const market = {
      n: oddList.length,
      marketAcc: oddAcc,
      smashAcc: smashOnOdds,
      disagreeN: disagree.length,
      disagreeWin: disagree.length ? Math.round((disagree.filter((m) => pickCorrect(m)).length / disagree.length) * 100) : null,
    };

    // 95% Wilson interval on the headline (deployed calls) accuracy.
    const smashK = filteredCalls.filter((m) => pickCorrect(m)).length;
    const ci = wilson(smashK, n);
    const ciHalf = Math.round(((ci.hi - ci.lo) / 2) * 100);

    // Exact-scoreline grading: the model predicts a set score ("3–1", from
    // the favorite's perspective); a hit requires both the right winner AND
    // the right number of sets.
    const scoreline = (() => {
      let total = 0, hits = 0;
      for (const m of filteredCalls) {
        if (!m.predScore || !m.score) continue;
        const sets = parseScore(m.score);
        if (!sets.length) continue;
        const wSets = sets.filter((s) => s.w > s.l).length;
        const lSets = sets.filter((s) => s.l > s.w).length;
        const favWon = pickFavorite(m) === m.winner;
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
    // Calls only, same as every other published figure: we no longer stake a
    // match we would not call, so a return panel that bet them would price a
    // policy nobody follows. The baselines bet the identical set.
    const betList = filteredCalls.filter((m) => m.od1 != null && m.od2 != null && m.od1 !== m.od2);
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
    // One model, two baselines. This used to break out all five engines
    // alongside the baselines, which invited the reader to pick the best row
    // and treat it as the product - but no visitor can bet "Point Sim", and
    // which engine is deployed changes per tour x surface and again at every
    // retune. "Our model" IS the deployed call: the strongest engine for each
    // match's tour and surface, re-selected when the tuner runs. The
    // per-engine detail still lives on the Model Card for anyone who wants
    // to see the bake-off.
    const returns = [
      { id: 'deployed', label: 'Our model', ...roiFor((m) => pickFavorite(m)) },
      { id: 'rank', label: 'Rankings', baseline: true, ...roiFor((m) => m.rankPick) },
      { id: 'odd', label: "The bookies' favorite", baseline: true, ...roiFor((m) => m.oddFav) },
    ];
    const bestReturn = returns.reduce((b, r) => (r.profit > b.profit ? r : b), returns[0]);

    // Deployed calls: the pick the site actually showed for each match (best
    // engine for that tour x surface, annotated by the pipeline). These drive
    // the headline; the per-engine numbers below stay pure.
    //
    // Counted over filteredCalls, NOT filtered. These are numerators for a
    // denominator (`n`) that has already dropped the no-calls, and they were
    // being counted over every graded row - hits from matches the policy
    // never claimed, divided by the claims only. That published a 94%
    // season benchmark against a true 72%.
    const deployedCorrect = filteredCalls.filter((m) => pickCorrect(m)).length;

    // The restraint audit: how the LEANS on passed matches turned out. Not a
    // claim and never counted as one - it exists so the no-call threshold is
    // falsifiable rather than a free pass, and so the tuner has a number to
    // move it by.
    const passed = filtered.filter((m) => pickNoCall(m));
    const passedRight = passed.filter((m) => pickCorrect(m)).length;
    // Broken out per tour x surface, because that is the grain the cutoff is
    // set at. One aggregate number cannot tell you which cell is passing on
    // matches it could call - and that per-cell read is exactly what the
    // tuner consumes when it re-derives the cutoffs.
    const cells = [];
    for (const t of ['atp', 'wta']) {
      for (const sf of ['hard', 'clay', 'grass']) {
        const cellRows = filtered.filter((m) => m.tour === t && m.surface === sf);
        const cellPassed = cellRows.filter((m) => pickNoCall(m));
        if (cellPassed.length < 15) continue;
        const right = cellPassed.filter((m) => pickCorrect(m)).length;
        cells.push({
          key: `${t}|${sf}`,
          tour: t,
          surface: sf,
          threshold: thresholdFor(t, sf),
          n: cellPassed.length,
          right,
          wrong: cellPassed.length - right,
          rate: Math.round((right / cellPassed.length) * 100),
          calls: cellRows.length - cellPassed.length,
        });
      }
    }
    const shadow = {
      n: passed.length,
      right: passedRight,
      wrong: passed.length - passedRight,
      rate: passed.length ? Math.round((passedRight / passed.length) * 100) : null,
      cells,
    };

    return {
      n,
      shadow,
      pricedAcc,
      correct: filteredCalls.filter((m) => m.correct).length,
      smashCorrect: filteredCalls.filter((m) => m.smashCorrect).length,
      deployedCorrect,
      deployed: n ? Math.round((deployedCorrect / n) * 100) : 0,
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
  }, [filtered, filteredCalls, data, tour, eventF]);

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
            <div className="eyebrow">THE LEDGER · {new Date().getFullYear()} SEASON</div>
            <h1 className="track-title">Every call, graded</h1>
            <p className="track-sub">
              Every completed {new Date().getFullYear()} tour match between two ranked players, scored
              against what actually happened. The stats grade our calls; matches too close to call
              are in the log below marked NO CALL, still graded, never claimed. No cherry-picking,
              no quiet deletions. The misses count the same as the wins.
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
            {events.length > 0 && (
              <select
                className={`track-event-select${eventF !== 'all' ? ' active' : ''}`}
                aria-label="Event"
                value={eventF}
                onChange={(e) => setEventF(e.target.value)}
              >
                <option value="all">All events</option>
                {events.map(({ tier, items }) => (
                  <optgroup key={tier} label={tier}>
                    {items.map((name) => <option key={name} value={name}>{name}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            {eventF !== 'all' && (
              <Link className="track-event-file" to={`/event/${slugify(eventF)}`}>
                the {eventF} file →
              </Link>
            )}
          </div>

          {/* Forward record - predictions LOCKED before the match was played.
              This is the leak-free, honest scoreboard (the retrospective below
              re-simulates finished matches). */}
          {(forward.pending.length > 0 || forward.decided.length > 0) && (
            <div className="track-panel track-forward">
              <div className="track-forward-head">
                <div className="track-section-label" style={{ margin: 0 }}><span aria-hidden="true">🔒 </span>THE RECEIPTS · called before the match, no take-backs</div>
                {forward.decided.length > 0 && (
                  <div className="track-forward-record">
                    {Math.round((forward.correct / forward.decided.length) * 100)}% · {forward.correct}/{forward.decided.length} verified
                  </div>
                )}
              </div>
              {forward.pending.slice(0, 8).map((p) => {
                // A locked call whose match time has passed but the result
                // hasn't been fetched yet reads "Awaiting result", not
                // "Upcoming" - honest when the data refresh is lagging.
                const awaiting = new Date(p.date).getTime() < Date.now();
                // A no-call shows here too: restraint IS a receipt. The lean
                // is on the record; it just is not a claim.
                if (ledgerNoCall(p)) {
                  return (
                    <Link className="track-forward-row pending nocall" to={`/match/${matchSlug(p)}`} key={p.id}>
                      <span className="track-forward-status">
                        <span aria-hidden="true">✋ </span>No call
                      </span>
                      <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                      <span className="track-forward-call">too close - we lean {lastName(p.favName)} {Math.round(p.favProb * 100)}%</span>
                    </Link>
                  );
                }
                return (
                  <Link className={`track-forward-row pending${awaiting ? ' awaiting' : ''}`} to={`/match/${matchSlug(p)}`} key={p.id}>
                    <span className="track-forward-status">
                      <span aria-hidden="true">{awaiting ? '⌛ ' : '⏳ '}</span>{awaiting ? 'Awaiting result' : 'Upcoming'}
                    </span>
                    <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                    <span className="track-forward-call">{awaiting ? 'Backed' : 'Backing'} {lastName(p.favName)} {Math.round(p.favProb * 100)}%</span>
                  </Link>
                );
              })}
              {forward.pending.length > 8 && (
                <div className="track-note" style={{ marginTop: '0.4rem' }}>
                  Plus {forward.pending.length - 8} more locked calls · <Link to="/today">see all of today's</Link>
                </div>
              )}
              {forward.recent.slice(0, 5).map((p) => (
                <Link className={`track-forward-row ${p.correct ? 'hit' : 'miss'}`} to={`/match/${matchSlug(p)}`} key={p.id}>
                  <span className="track-forward-status">
                    <span aria-hidden="true">{p.correct ? '✓' : '✗'}</span>
                    <span className="sr-only">{p.correct ? 'correct' : 'missed'}</span>
                  </span>
                  <span className="track-forward-match">{p.name1} vs {p.name2}</span>
                  <span className="track-forward-call">Called {lastName(p.favName)} {Math.round(p.favProb * 100)}%</span>
                </Link>
              ))}
              {forward.decided.length > Math.min(forward.recent.length, 5) && (
                <div className="track-note" style={{ marginTop: '0.4rem' }}>
                  Older graded calls have moved down to the match log. The running record above counts every one.
                </div>
              )}
              {forward.pending.length > 0 && forward.decided.length === 0 && (
                <div className="track-note" style={{ marginTop: '0.6rem' }}>
                  These calls are on the record now. When the matches finish we score them
                  automatically. No hindsight, no edits.
                </div>
              )}

              {confTiers && (
                <div className="track-conf">
                  <div className="track-section-label" style={{ marginTop: '1rem' }}>
                    BY STATED CONFIDENCE · what we claimed vs what landed
                  </div>
                  <table className="track-conf-table">
                    <thead>
                      <tr><th scope="col">Band</th><th scope="col">Matches</th><th scope="col">We said</th><th scope="col">Landed</th></tr>
                    </thead>
                    <tbody>
                      {confTiers.map((b) => (
                        <tr key={b.label} className={b.pass ? 'track-conf-pass' : undefined}>
                          <th scope="row">{b.label} <span className="track-conf-range">{b.range}</span></th>
                          <td>{b.n}</td>
                          <td>{Math.round(b.said * 100)}%</td>
                          <td>
                            <strong>{Math.round(b.landed * 100)}%</strong>
                            <span className="track-conf-ci"> ±{Math.round(((b.wilson.hi - b.wilson.lo) / 2) * 100)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="track-note" style={{ marginTop: '0.4rem' }}>
                    Every graded match, bucketed by the probability we published before play.
                    A call we make at 70% is supposed to land about 70%, and a confident call is
                    supposed to earn the label. The top row is the one we <em>passed on</em>: those
                    leans are recorded and graded but never claimed, and they are shown here so the
                    restraint can be checked rather than taken on trust. The ± is a 95% interval;
                    small buckets swing.
                  </p>
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
                        before play and graded automatically when the result lands. We lock calls at the slams
                        and the combined 1000s, so that is the scope of this number — a different, smaller
                        population than the season benchmark below.
                      </div>
                      <div className="track-hero-marks">
                        <span className="track-hero-hit">✓ {forwardAll.correct} hits</span>
                        <span className="track-hero-miss">✗ {(forwardAll.n - forwardAll.correct)} misses</span>
                        <span className="track-hero-marks-note">every receipt public</span>
                      </div>
                    </div>
                  </div>
                  <div className="track-panel track-benchmark">
                    <div className="track-benchmark-chip">SEASON BENCHMARK · SIMULATED</div>
                    <div className="track-benchmark-row">
                      <span className="track-benchmark-val">{stats.deployed}%</span>
                      <span className="track-benchmark-text">
                        of winners across {stats.n.toLocaleString()} matches ({tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()}{surface !== 'all' ? ` · ${SURFACES[surface].label}` : ''}),
                        calling each match with the strongest engine for its tour and surface,
                        re-run over the full season. Every tour-level event, not just the ones we lock
                        calls at, which is why the count dwarfs the record above. A model benchmark,
                        not locked picks.
                        {stats.scoreline.n > 0 ? ` Exact set score called in ${stats.scoreline.pct}%.` : ''}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="track-hero-stat">
                    <div className="track-hero-value">{stats.deployed}%</div>
                    <div className="track-hero-detail">
                      <div className="track-hero-label">of winners called correctly</div>
                      <div className="track-hero-sub">{stats.deployedCorrect} of {stats.n} matches · {tour === 'all' ? 'ATP + WTA' : tour.toUpperCase()}{surface !== 'all' ? ` · ${SURFACES[surface].label}` : ''}</div>
                      <div className="track-benchmark-chip">SEASON BENCHMARK · SIMULATED</div>
                      <div className="track-hero-ci">
                        How our calls score when re-run across every completed match this
                        season, each match called with the strongest engine for its tour and
                        surface, give or take {stats.ciHalf} points. The locked-before-play
                        record below is the one that can only be earned.
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
                      fills up match by match at the next big tournament, then takes over this page's headline.
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
                      <div className="track-market-cap">Our calls</div>
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
                    Total profit and return per $1 staked. Read the GAP, not the sign: all three
                    strategies bet the same filtered set - the matches we were confident enough to
                    call - and on a set selected that way even backing the bookies' favorite can
                    come out ahead. That baseline is not the market's true long-run return, which is
                    negative by the width of their margin; it is what the market's pick returned on
                    our card. Beating it is the claim.
                    {stats.betN < 50 && ' Not many matches in this view yet, so expect it to swing.'}
                  </div>
                </div>
              )}

              {/* Per-surface accuracy. The scope note is not decoration: these
                  cards sit directly beneath two panels scoped to the priced
                  subset, so their larger counts read as inflated unless the
                  page says out loud that they cover every graded match rather
                  than only the ones that carried a price. */}
              <div className="track-section-label" style={{ marginTop: '1rem' }}>
                By surface · every graded call, priced or not
              </div>
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
                    <div className="track-surface-n">{s.n} matches</div>
                  </button>
                ))}
              </div>

              {/* Engine comparison - the best engine for this filter is highlighted */}
              <div className="track-panel">
                <div className="track-section-label">
                  Our model against the two baselines · {surface !== 'all' ? SURFACES[surface].label : 'all surfaces'}
                  {stats.pricedAcc.n ? ` · the same ${stats.pricedAcc.n.toLocaleString()} priced calls` : ', same matches'}
                </div>
                <div className="track-compare">
                  {/* Same rows and order as the betting panel above.
                      Rankings doubles as the baseline: its picks ARE
                      "higher rank wins" (the probability it carries only
                      matters inside the blend). */}
                  {[
                    { id: 'deployed', label: 'Our model', desc: 'The strongest engine for each tour and surface, retuned as the season runs', acc: stats.pricedAcc.deployed ?? stats.deployed },
                    { id: 'rank', label: 'Rankings', desc: 'Just pick the higher-ranked player', acc: stats.pricedAcc.rank ?? stats.rank, baseline: true },
                  ].map((mo) => (
                    <div className={`track-compare-row${mo.baseline ? ' baseline' : ' primary'}`} key={mo.id}>
                      <div className="track-compare-name">
                        {mo.label}
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
                  <em>Our model</em> is not one fixed engine. Each match is called by whichever
                  engine measures strongest for that tour and surface, and that choice is re-made
                  every time the model is retuned. We clear <em>rankings</em>, the easy test.
                  {stats.oddAcc != null && stats.pricedAcc.deployed != null && (
                    stats.pricedAcc.deployed > stats.oddAcc
                      ? (
                        <> Against <em>the bookies&apos; favorite</em> we are {stats.pricedAcc.deployed}% to{' '}
                          {stats.oddAcc}% - a lead of {stats.pricedAcc.deployed - stats.oddAcc} point
                          {stats.pricedAcc.deployed - stats.oddAcc === 1 ? '' : 's'}, thin enough that it should
                          not be leaned on. Out-picking the market is not the claim this site makes; the money
                          panel above is.</>
                      )
                      : (
                        <> We do <strong>not</strong> clear <em>the bookies&apos; favorite</em>, who named the
                          winner {stats.oddAcc}% of the time against our {stats.pricedAcc.deployed}%, and we do
                          not expect that to reverse. Out-picking the market is not the claim this site makes;
                          the money panel above is.</>
                      )
                  )}
                  {' '}Honest caveat: the engines were tuned on this same season, so the purest
                  proof is the called-before-the-match record up top. The engine-by-engine bake-off
                  behind this single number is on the <Link to="/model">model card</Link>.
                </div>
              </div>

              {/* Calibration - redesigned as compact horizontal reliability bars */}
              <div className="track-panel">
                <div className="track-section-label">Do the probabilities mean what they say?</div>
                {/* Tooltip lives on the whole row: the bar track clips
                    overflow, so a bubble on the tick itself would be cut off. */}
                <div className="track-calib">
                  {stats.buckets.map((b) => (
                    <div className="track-calib-row has-tip" key={b.label} tabIndex={0} data-tip={`White tick = ideal: a perfectly calibrated ${b.label} bucket wins ≈ ${b.mid}%`}>
                      <div className="track-calib-said">Said {b.label}</div>
                      <div className="track-calib-track">
                        <div className="track-calib-ideal" style={{ left: `${b.mid}%` }} />
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

              {/* The restraint audit, promoted to its own panel above the log.
                  It was buried between the log's section label and its first
                  row, which is nowhere: the one number that holds the passes
                  accountable was the hardest thing on the page to find. Without
                  it you could abstain on everything and never be shown to be
                  wrong. The per-cell table is the same evidence the tuner reads
                  when it re-derives each cutoff, so what the page shows and what
                  the model is fitted on are the same thing. */}
              {stats.shadow.n >= 20 && (
                <div className="track-panel track-shadow-panel">
                  <div className="track-section-label">The matches we passed on</div>
                  <div className="track-shadow">
                    <span className="track-shadow-val">{stats.shadow.right}–{stats.shadow.wrong}</span>
                    <span className="track-shadow-text">
                      is how the leans went on the {stats.shadow.n.toLocaleString()} matches we declined to
                      call — <strong>{stats.shadow.rate}% right</strong>. We claim none of them either way, in
                      either direction. A cutoff set correctly leaves this near a coin flip; drifting well
                      above it means we are passing on matches we could be calling, and that is the signal to
                      lower it at the next retune.
                    </span>
                  </div>
                  {stats.shadow.cells.length > 1 && (
                    <>
                      <table className="track-shadow-table">
                        <thead>
                          <tr>
                            <th scope="col">Tour &amp; surface</th>
                            <th scope="col">Cutoff</th>
                            <th scope="col">Called</th>
                            <th scope="col">Passed</th>
                            <th scope="col">Leans right</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.shadow.cells.map((c) => (
                            <tr key={c.key}>
                              <th scope="row">{c.tour.toUpperCase()} {SURFACES[c.surface].label}</th>
                              <td>{Math.round(c.threshold * 100)}%</td>
                              <td>{c.calls.toLocaleString()}</td>
                              <td>{c.n.toLocaleString()}</td>
                              <td className={c.rate >= 60 ? 'hot' : undefined}>
                                {c.right}–{c.wrong} <span className="track-shadow-rate">({c.rate}%)</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="track-note">
                        The cutoff is not one number. It is set per tour and surface, because how far our
                        confidence has to run before it beats a coin flip depends on the tennis: it takes
                        {' '}{Math.round(thresholdFor('wta', 'clay') * 100)}% on WTA clay and only
                        {' '}{Math.round(thresholdFor('atp', 'clay') * 100)}% on ATP clay. Each one is the lowest
                        cutoff from which the weakest calls it still permits beat a coin flip at 95% confidence,
                        re-derived from this record every time the model is retuned rather than typed in once.
                        Cells with too little evidence use the {Math.round(thresholdFor('nope', 'nope') * 100)}% default.
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Match log - paginated */}
              <div className="track-panel">
                <div className="track-section-label">Match log · newest first</div>
                {shown.map((m) => {
                  const winnerIsP1 = m.winner === m.p1;
                  const wName = winnerIsP1 ? m.name1 : m.name2;
                  const lName = winnerIsP1 ? m.name2 : m.name1;
                  const wFlag = countryFlagUrl(winnerIsP1 ? m.country1 : m.country2);
                  const lFlag = countryFlagUrl(winnerIsP1 ? m.country2 : m.country1);
                  // The DEPLOYED call for this match: the pick made by the
                  // best engine for its tour x surface.
                  const callCorrect = pickCorrect(m);
                  const callFav = pickFavorite(m);
                  const callProb = pickFavProb(m);
                  const favName = lastName(callFav === m.p1 ? m.name1 : m.name2);
                  // Predicted scoreline (stored, favorite's perspective) vs the
                  // real result, also from the favorite's perspective.
                  const sets = parseScore(m.score);
                  const wSets = sets.filter((s) => s.w > s.l).length;
                  const lSets = sets.filter((s) => s.l > s.w).length;
                  const favWon = callFav === m.winner;
                  const actualFav = sets.length ? (favWon ? `${wSets}–${lSets}` : `${lSets}–${wSets}`) : null;
                  const scoreHit = m.predScore && actualFav && m.predScore === actualFav;
                  const rowNoCall = pickNoCall(m);
                  return (
                    <div className={`track-row${callCorrect ? '' : ' miss'}${rowNoCall ? ' nocall' : ''}`} key={m.id}>
                      <div className="track-row-meta">
                        {rowNoCall && <span className="track-row-nocall">NO CALL</span>}
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
                        {/* A no-call gets no verdict. "Called it" on a match
                            we explicitly declined to call is a contradiction,
                            and "Missed" is worse - it books a loss against a
                            claim that was never made. The lean and how it
                            turned out still show, greyed, because the point
                            of keeping these rows is to audit the restraint;
                            the tally of that audit is the shadow line above
                            the log. */}
                        {rowNoCall ? (
                          <span className="track-verdict nocall">
                            No call · leaned {favName} {Math.round(callProb * 100)}%
                            <span className="track-verdict-shadow">{callCorrect ? ' (lean was right)' : ' (lean was wrong)'}</span>
                          </span>
                        ) : (
                          <span className={`track-verdict ${callCorrect ? 'hit' : 'miss'}`}>
                            {callCorrect ? '✓ Called it' : '✗ Missed'} · {favName} {Math.round(callProb * 100)}%
                          </span>
                        )}
                        {m.predScore && actualFav && (
                          <span className={`track-scorecompare${scoreHit ? ' hit' : ''}`}>
                            Predicted {favName} {m.predScore} · actual {actualFav}{scoreHit ? ' ✓' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="track-empty">
                    The Ledger has no entries for this filter yet. Every match that
                    fits will be graded here the moment it finishes - widen the filter
                    or check back after the next round of play.
                  </div>
                )}
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
