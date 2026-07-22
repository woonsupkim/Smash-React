/**
 * After-refresh API usage report. Reads the session ledger that
 * lib/apiBudget.js maintains (every fetcher upserts its call count and the
 * live quota headers) and answers the five questions that matter on a
 * $10/month, 10,000-call plan:
 *
 *   1. calls made this session
 *   2. cumulative calls this month
 *   3. remaining calls this month
 *   4. $ used this session
 *   5. cumulative $ this month
 *
 * Output goes to the console AND to the workflow run's summary page
 * (GITHUB_STEP_SUMMARY renders markdown right on the run), so the numbers
 * are one click away after every refresh. Never fails the workflow.
 *
 * Env (all optional):
 *   PLAN_COST_USD (default 10), PLAN_QUOTA (default 10000),
 *   OVERAGE_PER_CALL (default 0.00277 - derived from the $51.66 / 18,646
 *   overage on the July invoice; adjust if RapidAPI lists a different rate).
 */
const fs = require('fs');
const path = require('path');

const LEDGER = path.join(__dirname, 'raw', 'api-usage.json');
const PLAN_COST = Number(process.env.PLAN_COST_USD || 10);
const PLAN_QUOTA = Number(process.env.PLAN_QUOTA || 10000);
const OVERAGE_RATE = Number(process.env.OVERAGE_PER_CALL || 0.00277);
const PER_CALL = PLAN_COST / PLAN_QUOTA; // plan value of one in-quota call

const usd = (v) => `$${v.toFixed(2)}`;
// Per-call rates are fractions of a cent - show enough digits to be honest.
const rate = (v) => `$${Number(v.toPrecision(3))}`;

function main() {
  let ledger = null;
  try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { /* no calls this run */ }

  const runKey = process.env.GITHUB_RUN_ID || `local-${new Date().toISOString().slice(0, 10)}`;
  const isThisRun = ledger && ledger.runKey === runKey;
  const session = isThisRun ? (ledger.total || 0) : 0;
  const limit = ledger?.lastLimit ?? PLAN_QUOTA;
  const remaining = ledger?.lastRemaining ?? null;

  const lines = [];
  lines.push('## API usage · this refresh');
  lines.push('');

  if (!ledger) {
    lines.push('No API calls recorded (ledger absent - every fetch served from cache or the fetchers did not run).');
  } else {
    // Month state from the live quota headers (authoritative: what RapidAPI
    // bills from). remaining < 0 means the month is already in overage.
    const monthUsed = remaining != null ? limit - remaining : null;
    const overageCalls = remaining != null ? Math.max(0, -remaining) : 0;
    const inQuotaMonth = monthUsed != null ? Math.min(monthUsed, limit) : null;

    // Session cost: calls at plan value, plus overage rate for any calls
    // that landed past the quota this session.
    const sessionOverage = Math.min(session, overageCalls);
    const sessionInQuota = session - sessionOverage;
    const sessionCost = sessionInQuota * PER_CALL + sessionOverage * OVERAGE_RATE;
    const monthCost = monthUsed != null ? PLAN_COST + overageCalls * OVERAGE_RATE : null;

    lines.push('| | |');
    lines.push('|---|---|');
    lines.push(`| Calls this session | **${session.toLocaleString()}**${isThisRun ? '' : ' (ledger is from a previous run)'} |`);
    if (monthUsed != null) {
      lines.push(`| Cumulative this month | **${monthUsed.toLocaleString()}** of ${limit.toLocaleString()} |`);
      lines.push(`| Remaining this month | **${Math.max(0, remaining).toLocaleString()}**${overageCalls ? ` (⚠️ ${overageCalls.toLocaleString()} calls INTO overage)` : ''} |`);
    } else {
      lines.push('| Cumulative / remaining | quota headers not seen this run |');
    }
    lines.push(`| Spend this session | **${usd(sessionCost)}** (${sessionInQuota.toLocaleString()} calls × ${rate(PER_CALL)} plan value${sessionOverage ? ` + ${sessionOverage.toLocaleString()} × ${rate(OVERAGE_RATE)} overage` : ''}) |`);
    if (monthCost != null) {
      lines.push(`| Spend this month | **${usd(monthCost)}** (${usd(PLAN_COST)} plan${overageCalls ? ` + ${usd(overageCalls * OVERAGE_RATE)} overage ⚠️` : ', no overage'}) |`);
    }
    lines.push('');
    if (isThisRun && ledger.calls) {
      const parts = Object.entries(ledger.calls).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`);
      if (parts.length) lines.push(`<sub>By script: ${parts.join(' · ')}</sub>`);
    }
    if (overageCalls) {
      lines.push('');
      lines.push('> ⚠️ **The month is in overage.** The spend guardrail should have stopped this - check the api-budget alert issue and the RapidAPI hard-limit setting.');
    }
  }

  const report = lines.join('\n');
  console.log(report.replace(/\*\*|\| /g, ' ').replace(/\|/g, ''));
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`); } catch { /* summary is best-effort */ }
  }
}

main();
