// src/components/LiveWinProb.js
//
// The broadcast graphic: a LIVE win probability for a locked match, the
// analytic point model conditioned on the actual score. Polls ESPN's public
// scoreboard while the match is in progress (45s cadence), parses sets and
// games from the linescores, and re-prices with matchProbLive. Renders
// nothing until the match is genuinely live, and fails silent on any fetch
// or parse hiccup - a live widget must never take the page down with it.
import React, { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { matchProbLive } from '../analyticProb';

const POLL_MS = 45000;
const SURFACE_CSV = { hard: 'smash_us.csv', clay: 'smash_fr.csv', grass: 'smash_wb.csv' };

const rowToProbs = (r) => [r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v) => Number(v) || 0);
const lastName = (n) => String(n || '').trim().toLowerCase().split(' ').pop();

// A set's linescore pair is complete when someone has actually won it.
const setDone = (a, b) => {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi >= 6 && hi - lo >= 2) || hi === 7;
};

// Parse an ESPN competition into { state: 'pre'|'in'|'post', score state }.
function parseCompetition(comp, name1) {
  const st = comp.status?.type?.state || 'pre';
  const comps = comp.competitors || [];
  if (comps.length !== 2) return { state: st };
  // Orient to our p1 by last name; fall back to given order.
  const ln1 = lastName(name1);
  const cName = (c) => lastName(c.athlete?.displayName || c.athlete?.shortName);
  const oriented = cName(comps[0]) !== ln1 && cName(comps[1]) === ln1 ? [comps[1], comps[0]] : comps;
  const ls = (c) => (c.linescores || []).map((l) => Number(l.value) || 0);
  const a = ls(oriented[0]), b = ls(oriented[1]);
  let setsA = 0, setsB = 0, gamesA = 0, gamesB = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ga = a[i] || 0, gb = b[i] || 0;
    if (setDone(ga, gb)) {
      if (ga > gb) setsA++; else setsB++;
    } else {
      gamesA = ga; gamesB = gb;
    }
  }
  const scoreTxt = a.map((v, i) => `${v}-${b[i] || 0}`).join(' ');
  return { state: st, setsA, setsB, gamesA, gamesB, scoreTxt };
}

export default function LiveWinProb({ pred }) {
  const [live, setLive] = useState(null);      // parsed score state
  const [prob, setProb] = useState(null);      // live P(favorite)
  const [history, setHistory] = useState([]);  // session samples for the spark
  const statsRef = useRef(null);               // [probsP1, probsP2]
  const doneRef = useRef(false);

  const tour = pred?.tour || 'atp';
  const isFavP1 = pred?.favorite === pred?.p1;

  // Load the two players' point-model stats once (surface CSV, same source
  // the H2H studio simulates from).
  useEffect(() => {
    if (!pred) return;
    const dir = tour === 'wta' ? '/data/women' : '/data';
    const csv = SURFACE_CSV[pred.surface] || SURFACE_CSV.hard;
    Papa.parse(process.env.PUBLIC_URL + `${dir}/${csv}`, {
      header: true,
      download: true,
      complete: ({ data }) => {
        const r1 = data.find((r) => r.id === pred.p1);
        const r2 = data.find((r) => r.id === pred.p2);
        if (r1 && r2) statsRef.current = [rowToProbs(r1), rowToProbs(r2)];
      },
      error: () => {},
    });
  }, [pred, tour]);

  // Poll the scoreboard while the match could be live (from 1h before
  // kickoff until it finishes).
  useEffect(() => {
    if (!pred) return undefined;
    let timer = null;
    let alive = true;

    const tick = async () => {
      if (doneRef.current) return;
      const start = new Date(pred.date).getTime();
      const now = Date.now();
      if (now < start - 3600e3 || now > start + 12 * 3600e3) return; // not plausibly live
      try {
        const d = new Date(pred.date);
        const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard?dates=${ymd}`);
        if (!res.ok) return;
        const data = await res.json();
        let comp = null;
        for (const ev of data.events || []) {
          for (const g of ev.groupings || []) {
            for (const c of g.competitions || []) {
              if (String(c.id) === String(pred.id)) comp = c;
            }
          }
          for (const c of ev.competitions || []) {
            if (String(c.id) === String(pred.id)) comp = c;
          }
        }
        if (!comp || !alive) return;
        const parsed = parseCompetition(comp, pred.name1);
        if (parsed.state === 'post') { doneRef.current = true; }
        if (parsed.state !== 'in' && parsed.state !== 'post') return;
        setLive(parsed);
        if (statsRef.current) {
          const [pa, pb] = statsRef.current;
          const bo = pred.bestOf || (tour === 'wta' ? 3 : 5);
          const pP1 = matchProbLive(pa, pb, bo, {
            setsA: parsed.setsA, setsB: parsed.setsB,
            gamesA: parsed.gamesA, gamesB: parsed.gamesB,
            serverNext: null,
          });
          const pFav = isFavP1 ? pP1 : 1 - pP1;
          setProb(pFav);
          setHistory((h) => [...h.slice(-40), pFav]);
        }
      } catch { /* silent: live widget must never break the page */ }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [pred, tour, isFavP1]);

  if (!pred || !live || prob == null) return null;

  const pct = Math.round(prob * 100);
  const lockedPct = Math.round(pred.favProb * 100);
  const delta = pct - lockedPct;
  const favLast = (pred.favName || '').split(' ').pop();
  const finished = live.state === 'post';

  const spark = history.length >= 2 ? (() => {
    const w = 120, h = 28, pad = 2;
    const pts = history.map((v, i) => {
      const x = pad + (i / (history.length - 1)) * (w - pad * 2);
      const y = h - pad - v * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <line x1={pad} y1={h / 2} x2={w - pad} y2={h / 2} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
        <polyline points={pts.join(' ')} fill="none" stroke="var(--accent-brand)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  })() : null;

  return (
    <div className="live-prob" role="status" aria-live="polite">
      <div className="live-prob-head">
        <span className={`live-prob-badge${finished ? ' done' : ''}`}>
          <span className="live-prob-dot" aria-hidden="true" />
          {finished ? 'FINAL' : 'LIVE'}
        </span>
        <span className="live-prob-score">{live.scoreTxt}</span>
      </div>
      <div className="live-prob-main">
        <span className="live-prob-pct">{pct}%</span>
        <span className="live-prob-who">
          {favLast} to win, right now
          <span className="live-prob-delta">
            {' '}· locked at {lockedPct}%{delta !== 0 ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}
          </span>
        </span>
        {spark}
      </div>
      <div className="live-prob-note">
        the point model re-priced on the live score · updates every 45 seconds
      </div>
    </div>
  );
}
