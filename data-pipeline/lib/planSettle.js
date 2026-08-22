// data-pipeline/lib/planSettle.js
//
// Settlement of the parlay builder's recommended plans, shared by every
// pipeline consumer (the digest, the share-asset generator). One home on
// purpose: the digest used to carry its own copy of the staking maths and it
// drifted - mirroring the plan logic per consumer is how the email ended up
// reporting returns from a strategy the site no longer recommended.
//
// The staking module itself is the app's own (src/utils/staking.mjs), loaded
// once via dynamic import; call ready() before anything else.
const path = require('path');
const { pathToFileURL } = require('url');

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
function ledgerGraded(preds) {
  return (preds || []).filter((m) => m.status === 'won' || m.status === 'lost');
}

// Locked bets for one calendar day, straight off the ledger: the pick, the
// price stamped before play, and what actually happened.
function lockedBets(preds, dayISO) {
  const bets = [];
  for (const m of ledgerGraded(preds)) {
    if (String(m.date).slice(0, 10) !== dayISO) continue;
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
  const history = ledgerGraded(preds).filter((m) => String(m.date).slice(0, 10) < dayISO);
  const rel = staking.reliability(history);
  const frontier = staking.planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), PLAN_BUDGET, { lambda: rel.lambda });
  if (!frontier.plans.length) return null;
  return {
    budget: PLAN_BUDGET,
    recommendedId: frontier.recommendedId,
    plans: frontier.plans.map((pl) => settlePlan(pl, bets)),
  };
}

module.exports = { ready, ledgerGraded, lockedBets, settlePlan, planReturns, PLAN_BUDGET };
