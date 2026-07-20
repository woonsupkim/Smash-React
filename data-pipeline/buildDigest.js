/**
 * Weekly email digest - public/data/digest.html + public/data/digest.txt.
 *
 * A self-contained recap built entirely from committed pipeline artifacts,
 * so it can regenerate (and optionally send) from CI with no extra fetches:
 *
 *   - Season benchmark record (daily_scorecard.json - replayed with today's
 *     engines over the season, labeled honestly as a benchmark).
 *   - The last 7 days of graded matches (track_record.json), graded with the
 *     deployed-call fallback: m.pickCorrect when annotated, else
 *     m.smashCorrect.
 *   - Current win streak, if one worth mentioning exists.
 *   - The forward test record (predictions.json) - the only rows that earn
 *     "locked before play" language, because they literally were.
 *   - A tease for the next slam (lib/slamCalendar.js), when between events.
 *
 * digest.html is inline-styled dark email HTML (max-width 600px, lime
 * accents, system fonts - no external assets, so it renders anywhere).
 * digest.txt is the same content in plain text for text-part fallbacks.
 *
 * Optional send: when RESEND_API_KEY and DIGEST_TO are both set, POSTs the
 * HTML to https://api.resend.com/emails (from: DIGEST_FROM or
 * 'smash@updates.local'). Send failures are logged and never fail the
 * script - the files on disk are the deliverable.
 *
 * Usage: node data-pipeline/buildDigest.js
 * Env:   RESEND_API_KEY, DIGEST_TO, DIGEST_FROM, SITE_URL (all optional)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
const LIME = '#c6ff1c';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Deployed-call grade with Smart Blend fallback (same convention as
// buildShareAssets.js) - rows that predate the pickCorrect annotation still
// count.
const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (correct, n) => (n ? Math.round((100 * correct) / n) : 0);

async function main() {
  const scorecard = readJson(path.join(DATA, 'daily_scorecard.json'));
  const track = readJson(path.join(DATA, 'track_record.json'));
  const predsDoc = readJson(path.join(DATA, 'predictions.json'));

  if (!scorecard && !track && !predsDoc) {
    console.log('No digest inputs found (daily_scorecard.json, track_record.json, predictions.json); nothing to build.');
    return;
  }

  const now = new Date();

  // ── Season benchmark (today's engines replayed over the season).
  const season = scorecard && scorecard.season ? scorecard.season : null;

  // ── Last 7 days: graded track-record rows dated within the window.
  const weekAgo = now.getTime() - 7 * 24 * 3600 * 1000;
  const matches = (track && track.matches) || [];
  const graded = matches.filter((m) => m.date && pickCorrect(m) != null);
  const week = graded.filter((m) => {
    const t = Date.parse(m.date);
    return Number.isFinite(t) && t >= weekAgo && t <= now.getTime();
  });
  const weekCorrect = week.filter((m) => pickCorrect(m)).length;

  // ── Current streak: consecutive correct calls counting back from the most
  // recently graded match. Only worth a line at 3 or more.
  const byDate = [...graded].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  let streak = 0;
  for (const m of byDate) {
    if (pickCorrect(m)) streak++;
    else break;
  }

  // ── Forward test: locked-before-play predictions that have been graded.
  const preds = (predsDoc && predsDoc.predictions) || [];
  const decided = preds.filter((p) => p.status === 'won' || p.status === 'lost');
  const fwdWon = decided.filter((p) => p.status === 'won').length;
  const pending = preds.filter((p) => p.status === 'pending').length;

  // ── Next event tease (optional dependency; skip quietly if unavailable).
  let slam = null;
  try {
    const { nextSlam } = require('./lib/slamCalendar');
    slam = nextSlam(now);
  } catch {
    /* no tease */
  }
  const slamDays = slam ? Math.max(0, Math.ceil((Date.parse(slam.startsAt) - now.getTime()) / 86400000)) : null;

  // ── Assemble the copy once; render it twice.
  const dateLabel = now.toISOString().slice(0, 10);
  const subject = week.length
    ? `Smash weekly: ${weekCorrect} of ${week.length} winners called this week`
    : season
      ? `Smash weekly: season benchmark ${season.acc}% over ${season.n.toLocaleString()} matches`
      : `Smash weekly digest · ${dateLabel}`;

  const lines = [];
  if (week.length) {
    lines.push({
      label: 'Last 7 days',
      value: `${weekCorrect} of ${week.length}`,
      note: `${pct(weekCorrect, week.length)}% of winners called across every graded match this week.`,
    });
  }
  if (season && season.n) {
    lines.push({
      label: 'Season benchmark',
      value: `${season.correct.toLocaleString()} of ${season.n.toLocaleString()}`,
      note: `${season.acc}% - today's engines replayed over the season. A benchmark, not a live betting record.`,
    });
  }
  if (streak >= 3) {
    lines.push({
      label: 'Current streak',
      value: `${streak} straight`,
      note: 'Consecutive winners called, counting back from the most recent graded match.',
    });
  }
  if (decided.length) {
    lines.push({
      label: 'Forward test',
      value: `${fwdWon}-${decided.length - fwdWon}`,
      note: `Predictions locked before play, then graded in public.${pending ? ` ${pending} more pending.` : ''}`,
    });
  }
  const tease = slam ? `Next up: ${slam.label} on ${slam.surface}, ${slamDays === 0 ? 'starting today' : `${slamDays} day${slamDays === 1 ? '' : 's'} out`}.` : null;

  // ── digest.txt
  const txt = [
    `SMASH WEEKLY DIGEST · ${dateLabel}`,
    '',
    ...lines.map((l) => `${l.label}: ${l.value}\n  ${l.note}`),
    ...(tease ? ['', tease] : []),
    '',
    `Every call, graded in public: ${SITE}/track-record`,
    '',
    'Not betting advice. The season number is a benchmark; only the forward test rows were locked before play.',
  ].join('\n');
  fs.writeFileSync(path.join(DATA, 'digest.txt'), `${txt}\n`);

  // ── digest.html (inline-styled dark email)
  const rows = lines
    .map(
      (l) => `
        <tr>
          <td style="padding:14px 20px;border-bottom:1px solid #232a38;">
            <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8b93a7;">${esc(l.label)}</div>
            <div style="font-size:26px;font-weight:700;color:${LIME};padding:2px 0;">${esc(l.value)}</div>
            <div style="font-size:13px;line-height:1.5;color:#c7cdd9;">${esc(l.note)}</div>
          </td>
        </tr>`
    )
    .join('');
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#0c0f14;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0c0f14;font-family:${FONT};">
    <tr><td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#11151d;border:1px solid #232a38;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:22px 20px 16px;border-bottom:2px solid ${LIME};">
            <div style="font-size:20px;font-weight:800;color:#ffffff;">SMASH · weekly digest</div>
            <div style="font-size:12px;color:#8b93a7;padding-top:4px;">${esc(dateLabel)} · every call graded in public</div>
          </td>
        </tr>
        ${rows}
        ${tease ? `<tr><td style="padding:14px 20px;border-bottom:1px solid #232a38;font-size:14px;color:#e8ebf2;">${esc(tease)}</td></tr>` : ''}
        <tr>
          <td style="padding:18px 20px;" align="center">
            <a href="${SITE}/track-record" style="display:inline-block;background:${LIME};color:#0c0f14;font-size:14px;font-weight:700;text-decoration:none;padding:10px 22px;border-radius:8px;">See the full track record</a>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 18px;font-size:11px;line-height:1.5;color:#687082;">
            Not betting advice. The season number is a benchmark (today's engines replayed over the season); only the forward test rows were locked before play. ${esc(SITE.replace(/^https?:\/\//, ''))}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
  fs.writeFileSync(path.join(DATA, 'digest.html'), html);
  console.log(`Wrote public/data/digest.html and digest.txt (${lines.length} stat rows). Subject: ${subject}`);

  // ── Optional send via Resend. Never fatal.
  // Recipients = DIGEST_TO (owner) + the public subscriber list from
  // Supabase (digest_subscribers, readable only with the service key).
  // Each subscriber gets their own send - addresses are never shared in a
  // joint "to" line. Capped per run to stay inside Resend's free tier.
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('RESEND_API_KEY not set; skipping send.');
    return;
  }
  const recipients = new Set((process.env.DIGEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/digest_subscribers?select=email`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
      if (res.ok) for (const r of await res.json()) recipients.add(r.email);
      else console.log(`Could not read digest subscribers (HTTP ${res.status}); sending to DIGEST_TO only.`);
    } catch (err) {
      console.log(`Subscriber fetch failed (non-fatal): ${err.message}`);
    }
  }
  if (!recipients.size) {
    console.log('No digest recipients (no DIGEST_TO, no subscribers); skipping send.');
    return;
  }
  const CAP = 90; // Resend free tier is 100/day; leave headroom for alerts
  const list = [...recipients].slice(0, CAP);
  if (recipients.size > CAP) console.warn(`  ! digest recipient list capped at ${CAP} of ${recipients.size} - upgrade the email plan.`);
  const from = process.env.DIGEST_FROM || 'smash@updates.local';
  let sent = 0, failed = 0;
  for (const rcpt of list) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [rcpt], subject, html, text: txt }),
      });
      if (res.ok) sent++; else { failed++; if (failed === 1) console.log(`  first send failure: ${res.status} ${await res.text().catch(() => '')}`); }
      await new Promise((r) => setTimeout(r, 600)); // stay under Resend's rate limit
    } catch { failed++; }
  }
  console.log(`Digest sent to ${sent} recipient(s)${failed ? `, ${failed} failed` : ''}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
