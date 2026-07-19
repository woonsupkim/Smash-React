/**
 * Upset-alert web push sender. Runs at the end of the data refresh (after
 * the commit), reads what just changed, and pings subscribers about at most
 * ONE thing per run - the boldest headline available:
 *
 *   1. a graded upset we CALLED yesterday (scorecard "beat the bookies"), or
 *   2. a fresh bold underdog call now locked on the board (favProb <= 0.45).
 *
 * One notification per day maximum by design: alerts that fire daily get
 * muted within a week, and this channel exists for the moments that earn it.
 *
 * Degrades to a no-op (exit 0) without config. Env:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  - web-push keypair
 *   VAPID_SUBJECT                         - mailto: or site URL (optional)
 *   SUPABASE_URL / SUPABASE_SERVICE_KEY   - to read push_subscriptions
 *   SITE_URL                              - link target base (optional)
 *
 * web-push is installed --no-save in the workflow step (same pattern as
 * sharp for the share kit).
 */
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'public', 'data');
const SITE = (process.env.SITE_URL || 'https://smash-tennis.vercel.app').replace(/\/$/, '');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

async function main() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.log('Push not configured (need VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY); skipping.');
    return;
  }
  let webpush;
  try { webpush = require('web-push'); } catch {
    console.log('web-push not installed; skipping.');
    return;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || SITE, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  // ── Choose today's single headline.
  let note = null;

  const scorecard = readJson(path.join(DATA, 'daily_scorecard.json'));
  const beat = scorecard?.yesterday?.beatBookies?.[0];
  if (beat) {
    note = {
      title: 'We called the upset ✓',
      body: `${beat.call || 'An underdog we backed'} came through - graded on the public ledger like every call.`,
      url: `${SITE}/track-record`,
    };
  }

  if (!note) {
    const preds = readJson(path.join(DATA, 'predictions.json'))?.predictions || [];
    const dayAgo = Date.now() - 36 * 3600 * 1000;
    const bold = preds
      .filter((p) => p.status === 'pending' && p.favProb <= 0.45 && new Date(p.date) > new Date(dayAgo))
      .sort((a, b) => a.favProb - b.favProb)[0];
    if (bold) {
      note = {
        title: 'Bold call just locked',
        body: `We're backing ${bold.favName} at ${Math.round(bold.favProb * 100)}% - the market disagrees. Think we're wrong? Make your pick.`,
        url: `${SITE}/pickem`,
      };
    }
  }

  if (!note) {
    console.log('No upset headline today; no push sent.');
    return;
  }

  // ── Fetch subscribers via the service-role key (anon cannot read them).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,keys`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) { console.log(`Could not read subscriptions (HTTP ${res.status}); skipping.`); return; }
  const subs = await res.json();
  if (!subs.length) { console.log('No subscribers yet.'); return; }

  console.log(`Sending "${note.title}" to ${subs.length} subscriber(s)...`);
  let sent = 0, gone = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(note));
      sent++;
    } catch (err) {
      // 404/410 = the browser dropped the subscription; clean it up.
      if (err.statusCode === 404 || err.statusCode === 410) {
        gone++;
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        }).catch(() => {});
      }
    }
  }
  console.log(`Done: ${sent} sent, ${gone} expired subscriptions pruned.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
