/**
 * Upset-alert web push sender. Runs at the end of the data refresh (after
 * the commit), reads what just changed, and pings subscribers about at most
 * ONE thing per run - the boldest headline available:
 *
 *   1. a graded upset we CALLED yesterday (scorecard "beat the bookies"),
 *   2. a locked pick where we back the market's underdog (lock-time odds),
 *   3. a bracket-challenge round completing mid-slam.
 * Signed-in subscribers with freshly graded pick'em picks get a PERSONAL
 * recap ("you went 3-1, the model went 2-2") instead of the headline.
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
const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
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
    // Bold call = a pending pick where WE back the market's underdog,
    // judged by the lock-time odds stamped on the row. (favProb is always
    // the favorite's number and never dips below 0.5, so "low favProb"
    // can't define boldness - market disagreement does.)
    const preds = readJson(path.join(DATA, 'predictions.json'))?.predictions || [];
    const stillOpen = (p) => p.status === 'pending' && new Date(p.date) > new Date();
    const impliedOurs = (p) => {
      if (!(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) return null;
      const q1 = 1 / p.lockOdd1, q2 = 1 / p.lockOdd2;
      const mktP1 = q1 / (q1 + q2);
      return p.favorite === p.p1 ? mktP1 : 1 - mktP1;
    };
    const bold = preds
      .filter(stillOpen)
      .map((p) => ({ p, mkt: impliedOurs(p) }))
      .filter((x) => x.mkt != null && x.mkt < 0.5)
      .sort((a, b) => a.mkt - b.mkt)[0];
    if (bold) {
      note = {
        title: 'We just took the underdog',
        body: `We're backing ${bold.p.favName} at ${Math.round(bold.p.favProb * 100)}% - the market has them at ${Math.round(bold.mkt * 100)}%. Think we're wrong? Make your pick.`,
        url: `${SITE}/edge`,
      };
    }
  }

  // ── Bracket-challenge round recap: fires mid-slam when the surviving
  // field just shrank (a round completed since the last snapshot).
  if (!note) {
    const odds = readJson(path.join(DATA, 'title_odds.json'));
    for (const tour of ['atp', 'wta']) {
      const e = odds?.events?.[tour];
      const h = e?.history || [];
      if (e?.status === 'live' && e.fieldSize < 16 && h.length >= 2 && h[h.length - 1].fieldSize !== h[h.length - 2].fieldSize) {
        note = {
          title: `${e.event}: the field just cut to ${e.fieldSize}`,
          body: 'A round is in the books - your bracket moved. See where you stand against the field and the model.',
          url: `${SITE}/challenge`,
        };
        break;
      }
    }
  }

  // ── Fetch subscribers via the service-role key (anon cannot read them).
  const res = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?select=endpoint,keys,user_id`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) { console.log(`Could not read subscriptions (HTTP ${res.status}); skipping.`); return; }
  const subs = await res.json();
  if (!subs.length) { console.log('No subscribers yet.'); return; }

  // ── Personal recaps for signed-in subscribers: their pick'em record on
  // predictions graded in the last ~36h, vs the model on the same matches.
  // Personal beats editorial - a subscriber with a fresh recap gets that
  // instead of the generic headline.
  const personal = new Map(); // user_id -> note
  const linked = subs.filter((s) => s.user_id);
  if (linked.length) {
    const preds = readJson(path.join(DATA, 'predictions.json'))?.predictions || [];
    const cutoff = Date.now() - 36 * 3600 * 1000;
    const fresh = preds.filter((p) => (p.status === 'won' || p.status === 'lost') && new Date(p.date).getTime() > cutoff);
    if (fresh.length) {
      const byMatch = new Map(fresh.map((p) => [String(p.id), p]));
      const ids = [...byMatch.keys()].map((x) => `"${x}"`).join(',');
      const users = [...new Set(linked.map((s) => s.user_id))].join(',');
      try {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/pickem_picks?select=user_id,match_id,pick&match_id=in.(${ids})&user_id=in.(${users})`, {
          headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
        });
        if (pr.ok) {
          const picks = await pr.json();
          const byUser = new Map();
          for (const p of picks) {
            if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
            byUser.get(p.user_id).push(p);
          }
          for (const [uid, list] of byUser) {
            let w = 0, mw = 0;
            for (const p of list) {
              const pred = byMatch.get(String(p.match_id));
              if (!pred) continue;
              if (p.pick === pred.winner) w++;
              if (pred.correct) mw++;
            }
            const n = list.length;
            if (!n) continue;
            const vs = w > mw ? 'you beat the model' : w < mw ? 'the model edged you' : 'dead heat with the model';
            personal.set(uid, {
              title: `Your picks: ${w}-${n - w} yesterday`,
              body: `The model went ${mw}-${n - mw} on the same matches - ${vs}. Today's board is open.`,
              url: `${SITE}/pickem`,
            });
          }
        }
      } catch (err) {
        console.log(`Personal recap fetch failed (non-fatal): ${err.message}`);
      }
    }
  }

  if (!note && personal.size === 0) {
    console.log('No headline and no personal recaps today; no push sent.');
    return;
  }

  console.log(`Sending: ${personal.size} personal recap(s), generic "${note ? note.title : 'none'}" to the rest...`);
  let sent = 0, gone = 0;
  for (const s of subs) {
    const payload = (s.user_id && personal.get(s.user_id)) || note;
    if (!payload) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload));
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
