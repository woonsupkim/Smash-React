// data-pipeline/expPlanPolicies.js
//
// The plan-policy tournament: which daily staking plan should the parlay
// builder RECOMMEND, if the bar is "a user follows it verbatim every day and
// comes out ahead"?
//
// The live ledger only has ~19 settleable days (all August, all Masters-1000
// population - the model's worst class). That sample already showed the
// current recommendation losing 3.5%, inside noise. This harness widens the
// evidence: it reconstructs every deploy-tier tournament day since April
// from the graded record - the same matches the builder would have priced,
// at the same prices (this feed carries one odds snapshot per match, so the
// recorded price IS the lockable price) - and runs every candidate plan
// through every day, walk-forward:
//
//   - the card = that day's graded deploy-tier rows (slams + combined
//     1000s, per lib/events vocabulary), deployed pick + its price
//   - reliability lambda measured only on rows graded BEFORE the day
//   - each candidate builds its plan from {p, o} and a $100 budget,
//     settles at the recorded odds
//
// Candidates cover the live plan family (spread / spread+parlay / weighted)
// and the selective policies the money audit favoured (+EV flat, +EV
// fractional Kelly, edge thresholds, with and without a plan-scored parlay).
// Selective plans may stake less than the full budget - "bet less today" is
// a legitimate recommendation and the harness scores it as such.
//
// Scoreboard per candidate: total P&L, ROI on money actually staked, share
// of up days, worst day, max drawdown of the cumulative curve, and the
// slam/1000 split (the US Open is days away; the recommendation should be
// chosen knowing which population it is about to live in).
//
// Usage: node data-pipeline/expPlanPolicies.js
const path = require('path');

const BUDGET = 100;

async function main() {
  const staking = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'staking.mjs')).href);
  const track = require(path.join(__dirname, '..', 'public', 'data', 'track_record.json')).matches
    .filter((m) => m.winner && m.od1 > 1 && m.od2 > 1);

  const SLAM = /australian open|french open|roland|wimbledon|us open/i;
  const M1000 = /national bank|miami open|internazionali bnl|mutua madrid|bnp paribas|cincinnati|monte-carlo|rolex shanghai|paris masters/i;
  const cls = (e) => (SLAM.test(e || '') ? 'slam' : M1000.test(e || '') ? 'm1000' : 'tail');

  const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
  const pickFav = (m) => m.pickFavorite || m.smashFavorite;
  const pickProbP1 = (m) => (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1);
  const pickFavProb = (m) => { const p = pickProbP1(m); return Math.max(p, 1 - p); };
  const pickOdds = (m) => (pickFav(m) === m.p1 ? m.od1 : m.od2);

  // Deploy-tier days only, CALLS only: the population the builder actually
  // prices. The no-call filter is the policy change of 2026-08-23 - we no
  // longer stake a match we decline to call - so a tournament run without it
  // would rank policies over a card the product will not build.
  const { rowNoCall } = require('./lib/noCall');
  const rows = track.filter((m) => cls(m.event) !== 'tail' && pickProbP1(m) != null && !rowNoCall(m))
    .map((m) => ({
      day: String(m.date).slice(0, 10), t: new Date(m.date).getTime(),
      p: pickFavProb(m), o: pickOdds(m), won: !!pickCorrect(m), cls: cls(m.event),
      key: String(m.id),
    }))
    .sort((a, b) => a.t - b.t);

  const days = [...new Set(rows.map((r) => r.day))].sort();
  const byDay = new Map(days.map((d) => [d, rows.filter((r) => r.day === d)]));

  // Walk-forward reliability: stated vs landed on rows before the day,
  // shrunk exactly the way the site's reliability() shrinks.
  const lambdaFor = (day) => {
    const hist = rows.filter((r) => r.day < day);
    const n = hist.length;
    if (n < 30) return 1;
    const acc = hist.filter((r) => r.won).length / n;
    const stated = hist.reduce((s, r) => s + r.p, 0) / n;
    const raw = stated > 0.5 + 1e-6 ? (acc - 0.5) / (stated - 0.5) : 1;
    const w = n / (n + 60);
    return Math.min(1.5, Math.max(0.5, 1 + w * (raw - 1)));
  };
  const adj = (p, L) => Math.min(0.999, Math.max(0.001, 0.5 + L * (p - 0.5)));
  const kelly = (p, o) => { const f = (p * o - 1) / (o - 1); return f > 0 ? f : 0; };

  // Plan-scored 2-leg parlay from the two best-edge legs, only if +EV.
  const bestParlay = (bets) => {
    const pos = bets.filter((b) => b.p * b.o > 1).sort((a, b) => (b.p * b.o) - (a.p * a.o)).slice(0, 4);
    let best = null;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
      const p = pos[i].p * pos[j].p, o = pos[i].o * pos[j].o;
      const f = kelly(p, o);
      if (f > 0 && (!best || f > best.f)) best = { legs: [pos[i], pos[j]], p, o, f };
    }
    return best;
  };

  // ── Candidates: (bets, L) -> { stakes: Map(key->$), parlay?: {legs, stake, o} } ──
  const CANDIDATES = {
    'spread (fund all, flat)': (bets) => {
      const per = BUDGET / bets.length;
      return { stakes: new Map(bets.map((b) => [b.key, per])) };
    },
    'weighted (half even, half Kelly)': (bets) => {
      const fs = bets.map((b) => kelly(b.p, b.o));
      const tot = fs.reduce((s, f) => s + f, 0);
      const stakes = new Map(bets.map((b, i) => [b.key, BUDGET / 2 / bets.length + (tot > 0 ? (BUDGET / 2) * fs[i] / tot : 0)]));
      return { stakes };
    },
    'spread + plan parlay': (bets) => {
      const par = bestParlay(bets);
      const parStake = par ? Math.min(10, BUDGET * par.f / (par.f + 1)) : 0;
      const per = (BUDGET - parStake) / bets.length;
      return { stakes: new Map(bets.map((b) => [b.key, per])), parlay: par ? { legs: par.legs, stake: parStake, o: par.o } : null };
    },
    '+EV only, flat': (bets) => {
      const pos = bets.filter((b) => b.p * b.o > 1);
      if (!pos.length) return { stakes: new Map() };
      const per = BUDGET / Math.max(pos.length, 4); // cap concentration on thin days
      return { stakes: new Map(pos.map((b) => [b.key, per])) };
    },
    '+EV only, quarter Kelly': (bets) => {
      const pos = bets.filter((b) => b.p * b.o > 1);
      const stakes = new Map(pos.map((b) => [b.key, Math.min(25, BUDGET * 0.25 * kelly(b.p, b.o))]));
      return { stakes };
    },
    '+EV only, half Kelly': (bets) => {
      const pos = bets.filter((b) => b.p * b.o > 1);
      const stakes = new Map(pos.map((b) => [b.key, Math.min(35, BUDGET * 0.5 * kelly(b.p, b.o))]));
      return { stakes };
    },
    'edge>10%, flat': (bets) => {
      const pos = bets.filter((b) => b.p * b.o - 1 > 0.10);
      if (!pos.length) return { stakes: new Map() };
      const per = BUDGET / Math.max(pos.length, 4);
      return { stakes: new Map(pos.map((b) => [b.key, per])) };
    },
    '+EV qKelly + plan parlay': (bets) => {
      const pos = bets.filter((b) => b.p * b.o > 1);
      const stakes = new Map(pos.map((b) => [b.key, Math.min(25, BUDGET * 0.25 * kelly(b.p, b.o))]));
      const par = bestParlay(bets);
      const spent = [...stakes.values()].reduce((s, v) => s + v, 0);
      const parStake = par ? Math.min(10, Math.max(0, BUDGET * 0.25 - 0) * par.f, BUDGET - spent) : 0;
      return { stakes, parlay: par && parStake > 0.5 ? { legs: par.legs, stake: parStake, o: par.o } : null };
    },
  };

  const board = new Map();
  for (const [name] of Object.entries(CANDIDATES)) {
    board.set(name, { pl: 0, staked: 0, days: 0, up: 0, worst: 0, path: [], slam: 0, m1000: 0, skipped: 0 });
  }

  for (const day of days) {
    const card = byDay.get(day);
    if (card.length < 2) continue;
    const L = lambdaFor(day);
    const bets = card.map((r) => ({ ...r, p: adj(r.p, L) }));
    const byKey = new Map(card.map((r) => [r.key, r]));
    for (const [name, gen] of Object.entries(CANDIDATES)) {
      const b = board.get(name);
      const plan = gen(bets);
      let staked = 0, pl = 0;
      for (const [key, s] of plan.stakes) {
        if (!(s > 0.005)) continue;
        const r = byKey.get(key);
        staked += s;
        pl += r.won ? s * (r.o - 1) : -s;
      }
      if (plan.parlay && plan.parlay.stake > 0.005) {
        staked += plan.parlay.stake;
        const allWon = plan.parlay.legs.every((l) => byKey.get(l.key).won);
        pl += allWon ? plan.parlay.stake * (plan.parlay.o - 1) : -plan.parlay.stake;
      }
      if (staked < 0.01) { b.skipped++; continue; }
      b.days++; b.pl += pl; b.staked += staked; if (pl > 0) b.up++;
      b.worst = Math.min(b.worst, pl);
      b.path.push(pl);
      const slamShare = card.filter((r) => r.cls === 'slam').length / card.length;
      if (slamShare >= 0.5) b.slam += pl; else b.m1000 += pl;
    }
  }

  console.log(`Plan-policy tournament: ${days.length} deploy-tier days, ${rows.length} priced calls, walk-forward lambda.\n`);
  console.log('candidate                          days  staked     P&L      ROI    up%   worst   maxDD   slamP&L  1000P&L  skip');
  for (const [name, b] of board) {
    let peak = 0, run = 0, dd = 0;
    for (const p of b.path) { run += p; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); }
    console.log(
      name.padEnd(34),
      String(b.days).padStart(4),
      ('$' + b.staked.toFixed(0)).padStart(7),
      ((b.pl >= 0 ? '+$' : '-$') + Math.abs(b.pl).toFixed(0)).padStart(8),
      ((100 * b.pl / Math.max(1, b.staked)).toFixed(1) + '%').padStart(8),
      ((100 * b.up / Math.max(1, b.days)).toFixed(0) + '%').padStart(5),
      ('-$' + Math.abs(b.worst).toFixed(0)).padStart(7),
      ('$' + dd.toFixed(0)).padStart(7),
      ((b.slam >= 0 ? '+$' : '-$') + Math.abs(b.slam).toFixed(0)).padStart(8),
      ((b.m1000 >= 0 ? '+$' : '-$') + Math.abs(b.m1000).toFixed(0)).padStart(8),
      String(b.skipped).padStart(5),
    );
  }

  // Publish the two rows the product actually quotes, so the copy on the
  // builder and in the digest is READ from this run rather than typed out of
  // it. The old figures ("+19.7% over 94 days") were transcribed by hand and
  // went stale the moment the staking universe changed; a number that
  // describes an experiment should be written by the experiment.
  const summarise = (name) => {
    const b = board.get(name);
    if (!b || !b.days) return null;
    let peak = 0, run = 0, dd = 0;
    for (const x of b.path) { run += x; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); }
    return {
      days: b.days,
      staked: Math.round(b.staked),
      pl: Math.round(b.pl),
      roi: Number((100 * b.pl / Math.max(1, b.staked)).toFixed(1)),
      upPct: Math.round(100 * b.up / Math.max(1, b.days)),
      worst: Math.round(Math.abs(b.worst)),
      maxDD: Math.round(dd),
    };
  };
  const out = {
    _comment: 'GENERATED by data-pipeline/expPlanPolicies.js. Do not edit; re-run the tournament.',
    measuredAt: new Date().toISOString().slice(0, 10),
    windowDays: days.length,
    pricedCalls: rows.length,
    edge: summarise('+EV qKelly + plan parlay'),
    spread: summarise('spread (fund all, flat)'),
  };
  if (out.edge && out.spread) {
    const fs = require('fs');
    // Provenance travels with the number. This replay reads the resimulated
    // record, so its probabilities carry a little knowledge of how matches
    // turned out - small in aggregate (about 1.5 points of accuracy on
    // identical matches) but concentrated exactly at the margin, where a
    // staking rule decides what to fund. The forward ledger currently returns
    // roughly a third of what this reports on the same policy.
    out.source = 'track_record.json (resimulated, end-of-season stats)';
    out.caveat = 'upper bound: marginal calls are hindsight-ordered; the forward ledger is the clean measure';
    const dest = path.join(__dirname, '..', 'src', 'data', 'planBacktest.json');
    fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`\nwrote src/data/planBacktest.json (edge ${out.edge.roi}% over ${out.edge.days} staked days)`);
  }
}

main();
