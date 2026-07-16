/**
 * Model guardrails - public/data/guardrails.json.
 *
 * Watches each tour x surface cell for the thing the dashboard can hide:
 * the deployed engine quietly going cold. For every cell it compares the
 * deployed picks' accuracy over the most recent WINDOW graded matches
 * against (a) the cell's own season accuracy, (b) the dumb rankings
 * baseline on the SAME recent matches, and (c) a coin flip. Any breach
 * lands in `alerts`, and the refresh workflow opens a GitHub issue (which
 * GitHub emails to watchers) so a cold cell never rots silently.
 *
 * Thresholds, for honesty about noise: over 40 matches one standard
 * deviation of accuracy is about 8 points, so the season-drop trigger
 * (12 points) is roughly a 1.5-sigma event and "watch" (8 points) is
 * one sigma. Cells with under MIN_N recent matches are reported but never
 * alerted - small samples would cry wolf weekly.
 *
 * Also checks the forward test overall: the locked-before-play record is
 * the site's headline claim, so a cold streak there alerts too.
 *
 * Usage: node checkGuardrails.js
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const WINDOW = 40;   // recent matches per cell
const MIN_N = 25;    // below this, report but never alert

// Deployed-call accessor (Smart Blend fallback for pre-annotation rows).
const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);

// Every engine's graded field, so each cell's report can answer "would a
// different engine have done better on the same recent matches?" directly.
const ENGINE_FIELD = { smash: 'smashCorrect', sim: 'correct', elo: 'eloCorrect', rank: 'rankCorrect', upset: 'upsetCorrect' };

const pct = (list, fn) => (list.length ? Math.round((list.filter(fn).length / list.length) * 100) : null);

function run() {
  // A monitoring script must never kill the pipeline it monitors: with no
  // track record to check, write an empty report and exit clean.
  const trackPath = path.join(DATA, 'track_record.json');
  if (!fs.existsSync(trackPath)) {
    fs.writeFileSync(path.join(DATA, 'guardrails.json'), JSON.stringify({ generatedAt: new Date().toISOString(), cells: [], alerts: [] }, null, 2));
    console.log('No track_record.json - wrote an empty guardrails report.');
    return;
  }
  const track = JSON.parse(fs.readFileSync(trackPath, 'utf8'));
  const preds = fs.existsSync(path.join(DATA, 'predictions.json'))
    ? JSON.parse(fs.readFileSync(path.join(DATA, 'predictions.json'), 'utf8'))
    : { predictions: [] };
  const ms = (track.matches || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  const alerts = [];
  const cells = [];
  for (const tour of ['atp', 'wta']) {
    for (const surface of ['hard', 'clay', 'grass']) {
      const cell = ms.filter((m) => m.tour === tour && m.surface === surface);
      const recent = cell.slice(-WINDOW);
      const engine = recent.length ? (recent[recent.length - 1].pickEngine || 'smash') : 'smash';
      const seasonAcc = pct(cell, pickCorrect);
      const recentAcc = pct(recent, pickCorrect);
      const rankRecentAcc = pct(recent, (m) => m.rankCorrect);
      const label = `${tour.toUpperCase()} ${surface}`;

      const reasons = [];
      if (recent.length >= MIN_N) {
        if (recentAcc < 50) {
          reasons.push(`recent accuracy ${recentAcc}% is below a coin flip (last ${recent.length} matches)`);
        }
        if (seasonAcc != null && recentAcc < seasonAcc - 12) {
          reasons.push(`recent accuracy ${recentAcc}% is ${seasonAcc - recentAcc} points below the season's ${seasonAcc}% (last ${recent.length} matches)`);
        }
        if (rankRecentAcc != null && recentAcc < rankRecentAcc - 5) {
          reasons.push(`deployed engine (${engine}) at ${recentAcc}% is losing to the rankings baseline at ${rankRecentAcc}% on the same recent matches`);
        }
      }
      const status = recent.length < MIN_N ? 'insufficient'
        : reasons.length ? 'alert'
        : (seasonAcc != null && recentAcc < seasonAcc - 8) ? 'watch'
        : 'ok';
      // All five engines on the SAME recent window, plus which one led it -
      // the first thing to check when a cell goes cold.
      const recentEngines = {};
      for (const [id, f] of Object.entries(ENGINE_FIELD)) recentEngines[id] = pct(recent, (m) => m[f]);
      const bestRecent = Object.entries(recentEngines)
        .filter(([, v]) => v != null)
        .reduce((b, e) => (b && b[1] >= e[1] ? b : e), null);
      cells.push({
        tour, surface, engine, status, n: cell.length, seasonAcc, recentN: recent.length, recentAcc, rankRecentAcc,
        recentEngines, bestRecent: bestRecent ? { engine: bestRecent[0], acc: bestRecent[1] } : null, reasons,
      });
      for (const r of reasons) alerts.push(`${label} (${engine}): ${r}`);
    }
  }

  // Forward test: the locked-before-play record over its own recent window.
  const decided = (preds.predictions || [])
    .filter((p) => p.status !== 'pending')
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const fRecent = decided.slice(-WINDOW);
  const fAcc = pct(fRecent, (p) => p.correct);
  const forward = { n: decided.length, recentN: fRecent.length, recentAcc: fAcc, status: fRecent.length < MIN_N ? 'insufficient' : 'ok' };
  if (fRecent.length >= MIN_N && fAcc < 50) {
    forward.status = 'alert';
    alerts.push(`Forward test: locked-before-play accuracy ${fAcc}% is below a coin flip over the last ${fRecent.length} verified calls`);
  }

  const out = { generatedAt: new Date().toISOString(), window: WINDOW, minN: MIN_N, cells, forward, alerts };
  const outPath = path.join(DATA, 'guardrails.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  for (const c of cells) {
    console.log(`${c.tour} ${c.surface} [${c.engine}] ${c.status.toUpperCase()}: season ${c.seasonAcc}% | last ${c.recentN}: ${c.recentAcc}% (rank ${c.rankRecentAcc}%)`);
  }
  console.log(`forward [${forward.status.toUpperCase()}]: last ${forward.recentN} verified: ${forward.recentAcc}%`);
  console.log(alerts.length ? `GUARDRAIL ALERTS:\n- ${alerts.join('\n- ')}` : 'All guardrails green.');
  console.log(`Wrote ${outPath}`);
}

run();
