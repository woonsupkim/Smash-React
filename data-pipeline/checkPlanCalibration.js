// data-pipeline/checkPlanCalibration.js
//
// Plan-level calibration: do the Risk Lab's plans deliver the chance
// of finishing ahead they claim?
//
// Leg-level calibration is watched elsewhere (the tuner's by-band report);
// this is the level above it, where the August 2026 audit found plans
// claiming an average 69% and delivering 53% - a gap that was, at n=19 days,
// inside the +/-21pt binomial noise floor and therefore NOT actionable. The
// verdict below stays INSUFFICIENT until 50 settleable days exist, then
// turns into WITHIN NOISE or CLAIMED RUNNING HOT with the numbers attached.
//
// If it ever reads CLAIMED RUNNING HOT, the named fix is to apply the
// reliability haircut at PLAN level (a lambda on pProfit fitted the same
// sequential way the leg-level lambda is), not to hand-tune copy.
//
// Method, same as the audit's ad-hoc script: for every ledger day with at
// least two locked, priced, graded calls, rebuild the morning's plan menu
// exactly as the site would have (planFrontier over the locked card,
// reliability measured only on days strictly before), settle every plan at
// the locked odds via lib/planSettle, and compare each plan's claimed
// pProfit with whether it actually finished ahead.
//
// Report-only: exits 0 always. Usage: node data-pipeline/checkPlanCalibration.js
const path = require('path');
const planSettle = require('./lib/planSettle');

const MIN_DAYS = 50;

async function main() {
  const staking = await planSettle.ready();
  const preds = require(path.join(__dirname, '..', 'public', 'data', 'predictions.json')).predictions;
  const led = planSettle.ledgerGraded(preds);
  const days = [...new Set(led.map((m) => String(m.date).slice(0, 10)))].sort();

  const rec = { profit: 0, days: 0, up: 0, claim: 0 };
  const perPlan = new Map();
  for (const d of days) {
    const bets = planSettle.lockedBets(preds, d);
    if (bets.length < 2) continue;
    const hist = led.filter((m) => String(m.date).slice(0, 10) < d);
    const rel = staking.reliability(hist);
    const f = staking.planFrontier(bets.map(({ key, p, o }) => ({ key, p, o })), planSettle.PLAN_BUDGET, { lambda: rel.lambda });
    if (!f.plans.length) continue;
    const settled = planSettle.planReturns(preds, d);
    const byId = new Map(settled.plans.map((p) => [p.id, p]));
    const recPlan = f.plans.find((p) => p.id === f.recommendedId) || f.plans[0];
    const s = byId.get(recPlan.id);
    if (!s) continue;
    rec.days++; rec.profit += s.profit; if (s.profit > 0) rec.up++;
    rec.claim += recPlan.metrics.pProfit || 0;
    for (const pl of f.plans) {
      const ss = byId.get(pl.id);
      if (!ss) continue;
      const t = perPlan.get(pl.id) || { label: pl.label, claim: 0, up: 0, n: 0, profit: 0 };
      t.claim += pl.metrics.pProfit || 0; t.n++; if (ss.profit > 0) t.up++; t.profit += ss.profit;
      perPlan.set(pl.id, t);
    }
  }

  const money = (v) => `${v >= 0 ? '+$' : '-$'}${Math.abs(v).toFixed(0)}`;
  console.log(`plan calibration: ${rec.days} settleable day(s) on the ledger`);
  if (!rec.days) { console.log('verdict: INSUFFICIENT (no settleable days yet)'); return; }

  const claimed = rec.claim / rec.days;
  const realized = rec.up / rec.days;
  const sigma = Math.sqrt(claimed * (1 - claimed) / rec.days);
  const gap = claimed - realized;
  const z = gap / sigma;

  console.log(`recommendation: claimed avg ${(100 * claimed).toFixed(0)}% to finish ahead | actually up ${rec.up}/${rec.days} = ${(100 * realized).toFixed(0)}% | net ${money(rec.profit)} (ROI ${(100 * rec.profit / (100 * rec.days)).toFixed(1)}%)`);
  for (const [id, t] of perPlan) {
    console.log(`  ${id.padEnd(11)} claimed ${(100 * t.claim / t.n).toFixed(0)}% | up ${t.up}/${t.n} = ${(100 * t.up / t.n).toFixed(0)}% | net ${money(t.profit)}`);
  }
  console.log(`gap ${(100 * gap).toFixed(1)}pts | noise floor +/-${(100 * 1.96 * sigma).toFixed(0)}pts (95%) | z=${z.toFixed(2)}`);

  if (rec.days < MIN_DAYS) {
    console.log(`verdict: INSUFFICIENT (n=${rec.days} < ${MIN_DAYS} settleable days - keep accruing)`);
  } else if (z > 1.96) {
    console.log(`verdict: CLAIMED RUNNING HOT (gap ${(100 * gap).toFixed(1)}pts > 1.96 sigma at n=${rec.days}). Fix: fit a plan-level reliability haircut on pProfit, sequentially, the same way the leg-level lambda is fitted - do not hand-tune the copy.`);
  } else {
    console.log(`verdict: WITHIN NOISE at n=${rec.days} - claimed and realized are statistically compatible.`);
  }
}

if (require.main === module) main();
module.exports = { main, MIN_DAYS };
