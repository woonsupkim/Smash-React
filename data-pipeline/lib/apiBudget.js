/**
 * RapidAPI spend guardrail. The plan bills OVERAGE past the monthly quota
 * (a real $51.66 lesson), so the pipeline must be incapable of running the
 * meter into the red on its own.
 *
 * Two independent stops, both fail-safe:
 *   1. LIVE QUOTA FLOOR - every RapidAPI response carries
 *      X-RateLimit-Requests-Remaining. The moment it drops to the reserve
 *      floor (default 300), ALL further API calls this process refuse to
 *      fire. The reserve keeps headroom for manual probes and races; the
 *      meter never reaches zero, so overage never starts.
 *   2. PER-PROCESS CAP - a hard ceiling on calls per script run (default
 *      600), so a logic bug or cold cache can't stampede even if the
 *      quota headers ever disappear.
 *
 * When either stop trips, an alert marker is written next to the raw cache;
 * the refresh workflow turns it into a GitHub issue so a throttled run
 * never passes silently.
 *
 * Usage (in every fetcher's apiGet):
 *   const budget = require('./lib/apiBudget');
 *   budget.guard();            // throws BEFORE spending when stopped
 *   const res = await fetch(...);
 *   budget.note(res);          // count the call + read the quota header
 *
 * Env overrides: API_RESERVE, API_MAX_PER_RUN.
 */
const fs = require('fs');
const path = require('path');

const RESERVE = Number(process.env.API_RESERVE || 300);
const MAX_PER_RUN = Number(process.env.API_MAX_PER_RUN || 600);
const ALERT_FILE = path.join(__dirname, '..', 'raw', 'api-budget-alert.json');

let used = 0;
let remaining = null; // last seen X-RateLimit-Requests-Remaining
let hardStopped = false;

function trip(reason) {
  if (hardStopped) return;
  hardStopped = true;
  console.warn(`[api-budget] HARD STOP: ${reason}. No further API calls from this process; cached data serves this run.`);
  try {
    fs.mkdirSync(path.dirname(ALERT_FILE), { recursive: true });
    fs.writeFileSync(ALERT_FILE, JSON.stringify({
      at: new Date().toISOString(),
      reason,
      used,
      remaining,
      script: process.argv[1] ? path.basename(process.argv[1]) : 'unknown',
    }, null, 2));
  } catch { /* the stop itself matters more than the marker */ }
}

// Call AFTER every RapidAPI response, successful or not - each attempt
// bills the same either way.
function note(res) {
  used++;
  // Absent header must NOT read as zero (Number(null) === 0): if RapidAPI
  // ever drops the header, the per-run cap still bounds spend while the
  // pipeline keeps working.
  const raw = res?.headers?.get?.('x-ratelimit-requests-remaining');
  const rem = raw == null || raw === '' ? NaN : Number(raw);
  if (Number.isFinite(rem)) remaining = rem;
  if (remaining != null && remaining <= RESERVE) {
    trip(`monthly quota remaining (${remaining}) at or below the ${RESERVE}-request reserve floor`);
  } else if (used >= MAX_PER_RUN) {
    trip(`per-run cap reached (${used}/${MAX_PER_RUN} calls this process)`);
  }
}

// Call BEFORE every RapidAPI request: throws instead of spending.
function guard() {
  if (hardStopped) {
    const e = new Error('API budget hard stop - call refused');
    e.budget = true;
    throw e;
  }
}

const stopped = () => hardStopped;
const status = () => ({ used, remaining, hardStopped, reserve: RESERVE, maxPerRun: MAX_PER_RUN });

module.exports = { guard, note, stopped, status, ALERT_FILE };
