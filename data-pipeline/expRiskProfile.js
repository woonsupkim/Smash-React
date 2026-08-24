// data-pipeline/expRiskProfile.js
//
// What each way of betting a day's card actually does to a bankroll, measured
// walk-forward on the clean held-out set and written to src/data/riskBacktest.json.
//
// WHY THIS AND NOT A RETURN TABLE. On clean data the recommended plan cannot
// be shown to out-return naive betting: every strategy's return interval
// overlaps every other one, and a season of tennis is nowhere near enough to
// separate them. Claiming otherwise is what the contaminated backtests did.
//
// Risk is different. A parlay needing four things to happen will wipe out more
// often than the same money spread across singles, in any sample, because that
// is arithmetic rather than an edge. It is the one comparison here that is
// structural, so it is the one the product can honestly lead with.
//
// The measured gap is not marginal: a four-leg parlay habit loses the entire
// day's stake on two days in three, where the recommended plan never lost more
// than 40% of it and never once lost the lot.
//
// Reads data-pipeline/output/clean_backtest_{atp,wta}.json - build those first.
// Usage: node data-pipeline/expRiskProfile.js [--write]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'data', 'riskBacktest.json');
const BUDGET = 100;
// A day needs this many priced matches before "how would you bet this card"
// is a meaningful question.
const MIN_CARD = 3;
// History needed before the reliability haircut means anything, matching the
// gate the live page uses.
const MIN_HISTORY = 200;

function load(tour) {
  const f = path.join(__dirname, 'output', `clean_backtest_${tour}.json`);
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).rows;
}

function summarise(daily) {
  const n = daily.length;
  if (!n) return null;
  const mean = daily.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(daily.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));
  let cum = 0, peak = 0, dd = 0;
  for (const v of daily) { cum += v; peak = Math.max(peak, cum); dd = Math.min(dd, cum - peak); }
  // "Lost the lot" means the day ended down essentially the whole stake, which
  // is what a parlay does whenever any leg misses.
  const wipe = daily.filter((v) => v <= -BUDGET * 0.999).length;
  return {
    days: n,
    roiPct: Number(((100 * (cum / (n * BUDGET)))).toFixed(2)),
    worstDay: Number(Math.min(...daily).toFixed(2)),
    bestDay: Number(Math.max(...daily).toFixed(2)),
    wipeoutDays: wipe,
    wipeoutPct: Number(((100 * wipe) / n).toFixed(1)),
    maxDrawdown: Number(dd.toFixed(2)),
    dailySd: Number(sd.toFixed(2)),
  };
}

async function main() {
  const staking = await import(pathToFileURL(path.join(ROOT, 'src', 'utils', 'staking.mjs')).href);
  const raw = [...load('atp'), ...load('wta')];
  if (!raw.length) {
    console.error('No clean backtest. Run: node data-pipeline/buildCleanBacktest.js atp && ... wta');
    process.exit(1);
  }
  // One row per fixture, oriented to the side WE would back, and carrying the
  // market's favourite so the naive strategies can be priced on the same card.
  const rows = raw
    .filter((r) => r.od1 > 1 && r.od2 > 1)
    .map((r) => {
      const ours = r.probP1 >= 0.5;
      const mkt = r.od1 <= r.od2;
      return {
        day: r.day,
        key: `${r.day}|${r.p1}|${r.p2}`,
        p: ours ? r.probP1 : 1 - r.probP1,
        o: ours ? r.od1 : r.od2,
        won: ours ? r.p1Won : !r.p1Won,
        mo: mkt ? r.od1 : r.od2,
        mWon: mkt ? r.p1Won : !r.p1Won,
      };
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  const days = [...new Set(rows.map((r) => r.day))].sort();
  const series = { plan: [], flat: [], single: [], par3: [], par4: [] };

  for (const day of days) {
    const card = rows.filter((r) => r.day === day);
    if (card.length < MIN_CARD) continue;
    const history = rows.filter((r) => r.day < day);
    if (history.length < MIN_HISTORY) continue;

    // The recommended plan, rebuilt exactly as the page would that morning.
    const rel = staking.reliability(history.map((r) => ({ favProb: r.p, correct: r.won, status: r.won ? 'won' : 'lost' })));
    const frontier = staking.planFrontier(card.map(({ key, p, o }) => ({ key, p, o })), BUDGET, { lambda: rel.lambda });
    const plan = frontier.plans.find((pl) => pl.id === frontier.recommendedId) || frontier.plans[0];
    if (plan) {
      const by = new Map(card.map((b) => [b.key, b]));
      let staked = 0, pnl = 0;
      for (const [key, stake] of Object.entries(plan.singles || {})) {
        if (!(stake > 0.005)) continue;
        const b = by.get(key);
        if (!b) continue;
        staked += stake;
        pnl += b.won ? stake * (b.o - 1) : -stake;
      }
      if (plan.parlayStake > 0.005 && (plan.parlayLegs || []).length >= 2 && plan.parlayLegs.every((k) => by.has(k))) {
        const legs = plan.parlayLegs.map((k) => by.get(k));
        staked += plan.parlayStake;
        const won = legs.every((l) => l.won);
        const odds = legs.reduce((m, l) => m * l.o, 1);
        pnl += won ? plan.parlayStake * (odds - 1) : -plan.parlayStake;
      }
      if (staked > 0.01) series.plan.push(pnl);
    }

    // The alternatives, all staking the full budget, all on the market's own
    // favourites - the version of each strategy most flattering to it.
    const favs = [...card].sort((a, b) => a.mo - b.mo);
    const parlay = (n) => {
      const legs = favs.slice(0, Math.min(n, favs.length));
      return legs.every((l) => l.mWon) ? BUDGET * (legs.reduce((m, l) => m * l.mo, 1) - 1) : -BUDGET;
    };
    series.par3.push(parlay(3));
    series.par4.push(parlay(4));
    series.single.push(favs[0].mWon ? BUDGET * (favs[0].mo - 1) : -BUDGET);
    series.flat.push((() => {
      const per = BUDGET / card.length;
      return card.reduce((s, l) => s + (l.mWon ? per * (l.mo - 1) : -per), 0);
    })());
  }

  const out = {
    _comment: 'GENERATED by data-pipeline/expRiskProfile.js. Do not edit; re-run it.',
    measuredAt: new Date().toISOString().slice(0, 10),
    source: 'clean_backtest_{atp,wta}.json - walk-forward, nothing sees its own result',
    budget: BUDGET,
    caveat: 'Return differences between these are NOT significant; the risk differences are structural.',
    strategies: {
      plan: { label: 'The recommended plan', ...summarise(series.plan) },
      flat: { label: 'Flat on every favourite', ...summarise(series.flat) },
      single: { label: 'All on one favourite', ...summarise(series.single) },
      par3: { label: 'Three-leg parlay of favourites', ...summarise(series.par3) },
      par4: { label: 'Four-leg parlay of favourites', ...summarise(series.par4) },
    },
  };

  console.log(`Risk profile over ${out.strategies.plan.days} settleable days, $${BUDGET}/day\n`);
  console.log('  strategy                        ROI    worst    wipeouts    maxDD    daily sd');
  for (const s of Object.values(out.strategies)) {
    console.log(
      '  ' + s.label.padEnd(31),
      ((s.roiPct >= 0 ? '+' : '') + s.roiPct + '%').padStart(7),
      ('$' + s.worstDay.toFixed(0)).padStart(8),
      (s.wipeoutPct + '%').padStart(9),
      ('$' + s.maxDrawdown.toFixed(0)).padStart(9),
      ('$' + s.dailySd.toFixed(0)).padStart(9)
    );
  }

  if (!process.argv.includes('--write')) {
    console.log('\n(dry run: pass --write to update src/data/riskBacktest.json)');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nrisk profile -> ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main();
