// data-pipeline/lib/planSettle.js
//
// Settlement of the Risk Lab's recommended plans, shared by every
// pipeline consumer (the digest, the share-asset generator). One home on
// purpose: the digest used to carry its own copy of the staking maths and it
// drifted - mirroring the plan logic per consumer is how the email ended up
// reporting returns from a strategy the site no longer recommended.
//
// The staking module itself is the app's own (src/utils/staking.mjs), loaded
// once via dynamic import; call ready() before anything else.
const path = require('path');
const { pathToFileURL } = require('url');
const { ledgerNoCall } = require('./noCall');
// Venue days, matching every caller. These functions receive a day string
// picked by recapDay/eventDay, so bucketing by the UTC slice here compared
// two different calendars and silently settled the wrong day's slip.
const { eventDay } = require('./eventDay');

const stakingReady = import(pathToFileURL(path.join(__dirname, '..', '..', 'src', 'utils', 'staking.mjs')).href);
let staking = null;

async function ready() {
  staking = await stakingReady;
  return staking;
}

const PLAN_BUDGET = 100;

// The graded LEDGER rows are the plan's whole universe. The builder only
// ever offers plans over locked calls (predictions.json), so both the
// reliability haircut and any settlement of "the plan you were shown" must
// come from there. The track record grades far more tennis than the builder
// ever stakes; a settlement built from it prices a plan that never existed.
//
// No-calls are OUT, and this is the seam that puts them out everywhere.
// The old policy staked them deliberately - the builder bets edges, not
// calls, and sub-threshold stakes had measured +2.2% ROI - but that left
// the product saying two things at once: the record refused to claim a
// coin flip while the plan asked you to put money on it. One rule now. It
// also means the reliability haircut is measured on the population we
// actually stake, not on one padded with matches we decline to back.
function ledgerGraded(preds) {
  return (preds || []).filter((m) => (m.status === 'won' || m.status === 'lost') && !ledgerNoCall(m));
}

// Locked bets for one calendar day, straight off the ledger: the pick, the
// price stamped before play, and what actually happened.
function lockedBets(preds, dayISO) {
  const bets = [];
  for (const m of ledgerGraded(preds)) {
    if (eventDay(m.date) !== dayISO) continue;
    const favIsP1 = m.favorite === m.p1;
    const o = Number(favIsP1 ? m.lockOdd1 : m.lockOdd2);
    if (!(o > 1) || typeof m.favProb !== 'number') continue;
    bets.push({ key: String(m.id), p: m.favProb, o, won: !!m.correct });
  }
  return bets;
}

// Settle one plan against what actually happened. Singles pay at their price
// or lose their stake; the parlay pays only if every leg landed.
function settlePlan(plan, bets) {
  const by = new Map(bets.map((b) => [b.key, b]));
  let staked = 0, profit = 0, hits = 0, backed = 0;
  for (const [key, stake] of Object.entries(plan.singles || {})) {
    if (!(stake > 0.005)) continue;
    const b = by.get(key);
    if (!b) continue;
    backed++; staked += stake;
    if (b.won) { profit += stake * (b.o - 1); hits++; } else { profit -= stake; }
  }
  let parlay = null;
  if (plan.parlayStake > 0.005 && (plan.parlayLegs || []).length >= 2 && plan.parlayLegs.every((k) => by.has(k))) {
    staked += plan.parlayStake;
    const won = plan.parlayLegs.every((k) => by.get(k).won);
    const o = plan.parlayLegs.reduce((m, k) => m * by.get(k).o, 1);
    profit += won ? plan.parlayStake * (o - 1) : -plan.parlayStake;
    parlay = { legs: plan.parlayLegs.length, won, o };
  }
  return { id: plan.id, label: plan.label, n: backed, hits, staked, profit, parlay };
}

// What each of a day's recommended plans would have returned, settled at the
// odds stamped before play. The plans are rebuilt exactly as the site would
// have built them that morning: the same locked card, the same maths, and
// reliability measured only on what was graded BEFORE that day - the site
// could not have known the day's results when it recommended, so neither may
// this settlement.
function planReturns(preds, dayISO) {
  if (!staking) throw new Error('planSettle: call ready() before planReturns()');
  const bets = lockedBets(preds, dayISO);
  if (bets.length < 2) return null;
  const history = ledgerGraded(preds).filter((m) => eventDay(m.date) < dayISO);
  const rel = staking.reliability(history);
  const frontier = staking.planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), PLAN_BUDGET, { lambda: rel.lambda });
  if (!frontier.plans.length) return null;
  return {
    budget: PLAN_BUDGET,
    recommendedId: frontier.recommendedId,
    plans: frontier.plans.map((pl) => settlePlan(pl, bets)),
  };
}

// The settleable ledger days belonging to one event, oldest first.
//
// Matched through the event registry, not by string equality: the same
// tournament is "Cincinnati Open" in track_record.json and "Cincinnati" in
// predictions.json, so an exact compare silently returned zero days and the
// tournament total never rendered. The registry is the one place that knows
// those are the same event.
// A day belongs to the event that MOST of its graded calls belong to, and to
// only that one. Tournaments overlap by a few days at the changeover - the
// Canada and Cincinnati draws share three - and a day is staked as one card,
// so attributing it to every event it touches would count the same profit
// under two tournaments and make the totals sum to more than the season.
// Majority ownership partitions the days cleanly at the cost of a little
// imprecision on the changeover days, which is the honest trade: the
// alternative is a number that double-counts.
function eventDayOwner(preds) {
  const { matchEvent } = require('./events');
  const tally = new Map();
  for (const m of ledgerGraded(preds)) {
    const reg = matchEvent(m.event);
    if (!reg) continue;
    const day = eventDay(m.date);
    if (!tally.has(day)) tally.set(day, new Map());
    const t = tally.get(day);
    t.set(reg.label, (t.get(reg.label) || 0) + 1);
  }
  const owner = new Map();
  for (const [day, t] of tally) {
    owner.set(day, [...t.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
  }
  return owner;
}

function eventDays(preds, event) {
  const { matchEvent } = require('./events');
  const want = matchEvent(event);
  if (!want) return [];
  const owner = eventDayOwner(preds);
  return [...owner.entries()]
    .filter(([, label]) => label === want.label)
    .map(([day]) => day)
    .sort();
}

// Follow the recommendation across a run of days and keep the running total.
// One day is noise in both directions; a tournament is the smallest window
// where "does following this work" has an answer, which is the question a
// daily reader is actually asking. Each day is rebuilt exactly as the site
// would have built it that morning - planReturns measures reliability only
// on rows graded strictly before the day - so the cumulative line carries no
// hindsight anywhere in it.
function planRun(preds, dayISOs) {
  let staked = 0, profit = 0, up = 0, days = 0;
  const series = [];
  for (const day of dayISOs) {
    const r = planReturns(preds, day);
    if (!r) continue;
    const rec = r.plans.find((pl) => pl.id === r.recommendedId) || r.plans[0];
    if (!rec) continue;
    days += 1;
    staked += rec.staked;
    profit += rec.profit;
    if (rec.profit > 0) up += 1;
    series.push({ day, profit: rec.profit, staked: rec.staked, cum: profit });
  }
  if (!days) return null;
  return { days, staked, profit, up, series, roi: staked > 0 ? profit / staked : 0 };
}

module.exports = {
  ready, ledgerGraded, lockedBets, settlePlan, planReturns, planRun,
  eventDays, eventDayOwner, PLAN_BUDGET,
};
