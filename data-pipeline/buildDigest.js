/**
 * The email digest, in two editions.
 *
 *   DAILY  (public/data/digest-daily.html + .txt)
 *     Yesterday's grade, then TODAY: every locked call with a win-probability
 *     bar, the upset watch, links straight into each match and a head-to-head
 *     comparison, a staking-plan CTA, and the countdown to the next slam.
 *
 *   WEEKLY (public/data/digest.html + .txt)
 *     How the week ended: the hit rate, a day-by-day bar chart, the bold calls
 *     that landed, the ones that missed (named, not buried), and where we
 *     stood against the bookmakers.
 *
 * Edition comes from DIGEST_MODE (daily|weekly), defaulting to weekly on
 * Mondays (UTC) and daily otherwise, so callers need no date logic. Note the
 * daily edition only lands on days the refresh workflow actually runs: daily
 * inside the tournament windows, Mondays only off-season.
 *
 * Everything is built from committed pipeline artifacts, so it regenerates in
 * CI with no extra fetches. Email constraints drive the rendering: table
 * layout, inline styles only, no external CSS or webfonts, and charts drawn as
 * coloured table cells rather than images so they survive image blocking.
 * Photographs come from public/data/share (already generated each run and
 * served at a public URL); player headshots are bundled by Vite and have no
 * stable URL, so they are deliberately not used here.
 *
 * Usage: node data-pipeline/buildDigest.js
 * Env:   DIGEST_MODE (daily|weekly), DIGEST_TO, SITE_URL, and ONE transport:
 *          GMAIL_USER + GMAIL_APP_PASSWORD  (no domain needed), or
 *          RESEND_API_KEY + DIGEST_FROM     (domain verified in Resend)
 *        Subscriber list: SUPABASE_URL + SUPABASE_SERVICE_KEY.
 *
 * Nothing is emailed unless a transport is configured AND there is at least
 * one recipient (DIGEST_TO, or a row in Supabase digest_subscribers). Every
 * one of those conditions logs loudly when it fails rather than passing
 * silently, because a digest that builds every week and quietly mails nobody
 * looks exactly like success - which is precisely how this went unnoticed.
 */
// Load .env like the other pipeline scripts (fetch.js, buildRoster.js, ...).
// Without this, putting RESEND_API_KEY in .env for a local test did nothing
// and the send skipped as if no key existed. In CI the secrets arrive as real
// environment variables and this is a no-op; wrapped so a slim install that
// omits dotenv cannot take the whole digest step down.
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
const LIME = '#c6ff1c';
const INK = '#0c0f14';
const CARD = '#11151d';
const LINE = '#232a38';
const TEXT = '#e8ebf2';
const MUTED = '#8b93a7';
const DIM = '#c7cdd9';
const WIN = '#4caf7d';
const LOSS = '#e05656';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Deployed-call grade with Smart Blend fallback (same convention as
// buildShareAssets.js) - rows that predate the pickCorrect annotation still
// count.
const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
const pickFavorite = (m) => m.pickFavorite || m.smashFavorite;

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (correct, n) => (n ? Math.round((100 * correct) / n) : 0);
const lastName = (full) => String(full || '').trim().split(/\s+/).slice(-1)[0] || String(full || '');

// MUST stay byte-identical to src/utils/slug.js and the pipeline's other
// copies, or the links in this email will 404.
const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// ── Mail transports ─────────────────────────────────────────────────────────
// Two ways out, same interface. Gmail SMTP needs no domain (Google already
// signs mail from its own accounts), which is why it wins when configured;
// Resend needs a verified domain but scales past a personal mailbox.
function pickTransport() {
  const user = process.env.GMAIL_USER;
  // Google shows App Passwords in four-character groups. People paste them
  // exactly as shown, spaces and all, and SMTP auth then fails with a bare
  // "Username and Password not accepted" - so strip whitespace here.
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (user && pass) {
    const nodemailer = require('nodemailer');
    const tx = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass },
    });
    // Gmail will not let you forge the From: it rewrites (or rejects) anything
    // that is not the authenticated account or a verified alias. So the
    // account address IS the sender, and a stale DIGEST_FROM is called out
    // rather than silently ignored.
    const want = process.env.DIGEST_FROM;
    if (want && !want.includes(user)) {
      console.warn(`  ! DIGEST_FROM (${want}) is ignored on Gmail: mail must come from ${user}.`);
    }
    return {
      label: `Gmail SMTP as ${user}`,
      from: `Smash <${user}>`,
      // Gmail's own per-day recipient ceiling is far lower than an API's.
      cap: 400,
      async send({ from, to, subject, html, text, headers }) {
        await tx.sendMail({ from, to, subject, html, text, headers });
      },
    };
  }

  const key = process.env.RESEND_API_KEY;
  if (key) {
    return {
      label: 'Resend API',
      from: process.env.DIGEST_FROM || 'smash@updates.local',
      cap: 90, // free tier is 100/day; leave headroom for alert mail
      async send({ from, to, subject, html, text, headers }) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, html, text, ...(headers ? { headers } : {}) }),
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
      },
    };
  }
  return null;
}

const matchUrl = (p) => `${SITE}/match/${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
const compareUrl = (p) => `${SITE}/compare/${p.tour || 'atp'}/${slugify(p.name1)}-vs-${slugify(p.name2)}`;
// Only link a share card that actually rendered this run.
const shareImg = (file) => (fs.existsSync(path.join(DATA, 'share', file)) ? `${SITE}/data/share/${file}` : null);

// ── Email primitives ────────────────────────────────────────────────────────
// A horizontal bar drawn as two table cells. Images-off safe, and it renders
// in Outlook, where divs with percentage widths do not.
function bar(percent, color = LIME, height = 8) {
  const w = Math.max(0, Math.min(100, Math.round(percent)));
  const cell = `height:${height}px;font-size:0;line-height:0;mso-line-height-rule:exactly;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
    <tr>
      ${w > 0 ? `<td width="${w}%" style="${cell}background:${color};border-radius:4px 0 0 4px;">&nbsp;</td>` : ''}
      ${w < 100 ? `<td style="${cell}background:${LINE};border-radius:${w > 0 ? '0 4px 4px 0' : '4px'};">&nbsp;</td>` : ''}
    </tr>
  </table>`;
}

function button(href, label, { primary = true } = {}) {
  const bg = primary ? LIME : 'transparent';
  const fg = primary ? INK : LIME;
  const border = primary ? LIME : LINE;
  return `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};border:1px solid ${border};font-size:14px;font-weight:700;text-decoration:none;padding:11px 20px;border-radius:8px;">${esc(label)}</a>`;
}

const sectionRow = (inner, extra = '') =>
  `<tr><td style="padding:16px 20px;border-bottom:1px solid ${LINE};${extra}">${inner}</td></tr>`;

const kicker = (text) =>
  `<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};padding-bottom:8px;">${esc(text)}</div>`;

// ── Content builders ────────────────────────────────────────────────────────

// One upcoming match: the call, a probability bar, and the two ways in.
function upcomingCard(p) {
  const favIsP1 = p.favorite === p.p1;
  const favName = p.favName || (favIsP1 ? p.name1 : p.name2);
  const dogName = favIsP1 ? p.name2 : p.name1;
  const prob = Math.round((p.favProb || 0) * 100);
  const when = new Date(p.date);
  const timeLabel = Number.isFinite(when.getTime()) && when.getUTCHours() >= 5
    ? `${when.toISOString().slice(11, 16)} UTC`
    : 'time TBC';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${INK};border:1px solid ${LINE};border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};">
          ${esc((p.tour || '').toUpperCase())} · ${esc(p.event || '')} · ${esc(p.surface || '')} · ${esc(timeLabel)}
        </div>
        <div style="font-size:17px;font-weight:700;color:${TEXT};padding:6px 0 2px;">
          <span style="color:${LIME};">${esc(lastName(favName))}</span>
          <span style="color:${MUTED};font-weight:400;font-size:14px;"> over ${esc(lastName(dogName))}</span>
        </div>
        <div style="font-size:13px;color:${DIM};padding-bottom:8px;">We make it <strong style="color:${TEXT};">${prob}%</strong></div>
        ${bar(prob)}
        <div style="padding-top:12px;font-size:13px;">
          <a href="${matchUrl(p)}" style="color:${LIME};text-decoration:none;font-weight:700;">The full call &rarr;</a>
          <span style="color:${LINE};padding:0 8px;">|</span>
          <a href="${compareUrl(p)}" style="color:${DIM};text-decoration:none;">Compare them stat by stat</a>
        </div>
      </td></tr>
    </table>`;
}

// A graded result line: who we took, what happened, coloured by outcome.
function resultLine(m) {
  const hit = !!pickCorrect(m);
  const fav = pickFavorite(m);
  const favIsP1 = fav === m.p1;
  const ourPick = favIsP1 ? m.name1 : m.name2;
  const other = favIsP1 ? m.name2 : m.name1;
  const winner = m.winner === m.p1 ? m.name1 : m.name2;
  const prob = Math.round((favIsP1 ? (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1) : 1 - (m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1)) * 100);
  return `
    <div style="padding:9px 0;border-bottom:1px solid ${LINE};">
      <span style="display:inline-block;width:18px;color:${hit ? WIN : LOSS};font-weight:700;">${hit ? '&#10003;' : '&#10007;'}</span>
      <a href="${matchUrl(m)}" style="color:${TEXT};text-decoration:none;font-weight:600;">${esc(lastName(ourPick))}</a>
      <span style="color:${MUTED};"> over ${esc(lastName(other))} at ${prob}%</span>
      <span style="color:${hit ? WIN : LOSS};"> &middot; ${hit ? 'landed' : `${esc(lastName(winner))} won`}</span>
      ${m.score ? `<span style="color:${MUTED};"> ${esc(m.score)}</span>` : ''}
    </div>`;
}

async function main() {
  const scorecard = readJson(path.join(DATA, 'daily_scorecard.json'));
  const track = readJson(path.join(DATA, 'track_record.json'));
  const predsDoc = readJson(path.join(DATA, 'predictions.json'));

  if (!scorecard && !track && !predsDoc) {
    console.log('No digest inputs found (daily_scorecard.json, track_record.json, predictions.json); nothing to build.');
    return;
  }

  const now = new Date();
  const MODE = (process.env.DIGEST_MODE || (now.getUTCDay() === 1 ? 'weekly' : 'daily')).toLowerCase();
  const isWeekly = MODE === 'weekly';
  const dateLabel = now.toISOString().slice(0, 10);

  const season = scorecard && scorecard.season ? scorecard.season : null;
  const yday = scorecard && scorecard.yesterday ? scorecard.yesterday : null;
  const upsets = (scorecard && scorecard.upsetWatch) || [];
  const upsetById = new Map(upsets.map((u) => [u.id, u]));
  const matches = (track && track.matches) || [];
  const graded = matches.filter((m) => m.date && pickCorrect(m) != null);
  const preds = (predsDoc && predsDoc.predictions) || [];

  // Next slam, for the countdown.
  let slam = null;
  try {
    const { nextSlam } = require('./lib/slamCalendar');
    slam = nextSlam(now);
  } catch { /* no tease */ }
  const slamDays = slam ? Math.max(0, Math.ceil((Date.parse(slam.startsAt) - now.getTime()) / 86400000)) : null;

  let subject = '';
  let heroImage = null;
  let heroAlt = '';
  const blocks = [];   // rendered HTML rows
  const txtLines = []; // plain-text twin
  let ctaHref = `${SITE}/today`;
  let ctaText = "See today's calls";

  if (!isWeekly) {
    // ── DAILY ───────────────────────────────────────────────────────────────
    const todayISO = dateLabel;
    const upcoming = preds
      .filter((p) => p.status === 'pending' && String(p.date || '').slice(0, 10) >= todayISO)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const todays = upcoming.filter((p) => String(p.date || '').slice(0, 10) === todayISO);
    const card = todays.length ? todays : upcoming.slice(0, 6);
    const shown = card.slice(0, 5);

    subject = yday && yday.n
      ? `${yday.correct} of ${yday.n} yesterday, and ${card.length} call${card.length === 1 ? '' : 's'} locked for today`
      : card.length
        ? `${card.length} call${card.length === 1 ? '' : 's'} locked and priced for today`
        : `Smash daily · ${dateLabel}`;
    heroImage = shareImg('cover.png');
    heroAlt = "Today's locked calls";
    ctaHref = `${SITE}/parlay`;
    ctaText = 'Size today\'s slip';

    txtLines.push(`SMASH DAILY · ${dateLabel}`, '');

    // Yesterday, in one strip with a bar.
    if (yday && yday.n) {
      const p = pct(yday.correct, yday.n);
      blocks.push(sectionRow(`
        ${kicker('Yesterday')}
        <div style="font-size:30px;font-weight:800;color:${LIME};line-height:1;">${yday.correct} of ${yday.n}</div>
        <div style="font-size:13px;color:${DIM};padding:6px 0 10px;">${p}% of winners called, every one locked before play.</div>
        ${bar(p)}
        ${yday.worstMiss && yday.worstMiss.call ? `<div style="font-size:13px;color:${DIM};padding-top:10px;"><span style="color:${LOSS};font-weight:700;">The one we own:</span> ${esc(yday.worstMiss.call)}${yday.worstMiss.winner ? ` &middot; ${esc(yday.worstMiss.winner)} won it.` : '.'}</div>` : ''}
      `));
      txtLines.push(`YESTERDAY: ${yday.correct} of ${yday.n} (${p}%)`);
      if (yday.worstMiss && yday.worstMiss.call) txtLines.push(`  The one we own: ${yday.worstMiss.call}${yday.worstMiss.winner ? ` (${yday.worstMiss.winner} won)` : ''}`);
      txtLines.push('');
    }

    // Today's card: the reason to open this email.
    if (shown.length) {
      const cards = shown.map((p) => {
        const u = upsetById.get(p.id);
        return `${upcomingCard(p)}${u ? `<div style="font-size:12px;color:#e8a33d;padding:6px 2px 0;">&#9888; Upset watch: ${esc(u.reason)}</div>` : ''}`;
      }).join('<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>');
      blocks.push(sectionRow(`
        ${kicker(todays.length ? `On court today · ${card.length} locked` : `Next up · ${card.length} locked`)}
        ${cards}
        ${card.length > shown.length ? `<div style="padding-top:12px;font-size:13px;"><a href="${SITE}/today" style="color:${LIME};text-decoration:none;font-weight:700;">And ${card.length - shown.length} more &rarr;</a></div>` : ''}
      `));
      txtLines.push(todays.length ? `ON COURT TODAY (${card.length} locked)` : `NEXT UP (${card.length} locked)`);
      for (const p of shown) {
        const favIsP1 = p.favorite === p.p1;
        txtLines.push(`  ${lastName(p.favName || (favIsP1 ? p.name1 : p.name2))} over ${lastName(favIsP1 ? p.name2 : p.name1)} · ${Math.round(p.favProb * 100)}% · ${p.event}`);
        txtLines.push(`    ${matchUrl(p)}`);
      }
      txtLines.push('');
    }

    // The staking plan: the app's sharpest tool, one tap away.
    blocks.push(sectionRow(`
      ${kicker('What to do about it')}
      <div style="font-size:15px;color:${TEXT};line-height:1.55;padding-bottom:12px;">
        The builder prices every call against the odds you are actually offered, then splits a
        budget across only the bets that beat their price, so the slip is break-even or better
        before you stake a penny.
      </div>
      ${button(`${SITE}/parlay`, 'Size today\'s slip')}
    `));
    txtLines.push(`SIZE TODAY'S SLIP: ${SITE}/parlay`, '');

    // Countdown.
    if (slam && slamDays != null) {
      blocks.push(sectionRow(`
        ${kicker('Countdown')}
        <div style="font-size:15px;color:${TEXT};">
          <strong style="color:${LIME};font-size:22px;">${slamDays === 0 ? 'Today' : `${slamDays} day${slamDays === 1 ? '' : 's'}`}</strong>
          ${slamDays === 0 ? `the ${esc(slam.label)} begins` : `to the ${esc(slam.label)}`}, on ${esc(slam.surface)}.
        </div>
        <div style="font-size:13px;color:${MUTED};padding-top:6px;">The projected draw re-prices with every refresh until the real one drops.</div>
        <div style="padding-top:12px;">${button(`${SITE}/draw`, 'See the projected draw', { primary: false })}</div>
      `));
      txtLines.push(`COUNTDOWN: ${slamDays === 0 ? `the ${slam.label} begins today` : `${slamDays} days to the ${slam.label}`} (${slam.surface})`, `  ${SITE}/draw`, '');
    }

    if (season && season.n) {
      blocks.push(sectionRow(`
        ${kicker('Season benchmark')}
        <div style="font-size:13px;color:${DIM};">
          <strong style="color:${TEXT};">${season.acc}%</strong> of winners called across
          ${season.correct.toLocaleString()} of ${season.n.toLocaleString()} matches, today's engines replayed over the season.
        </div>
      `));
      txtLines.push(`SEASON BENCHMARK: ${season.acc}% (${season.correct.toLocaleString()} of ${season.n.toLocaleString()})`, '');
    }
  } else {
    // ── WEEKLY ──────────────────────────────────────────────────────────────
    const weekAgo = now.getTime() - 7 * 86400000;
    const week = graded.filter((m) => {
      const t = Date.parse(m.date);
      return Number.isFinite(t) && t >= weekAgo && t <= now.getTime();
    });
    const weekCorrect = week.filter((m) => pickCorrect(m)).length;
    const weekPct = pct(weekCorrect, week.length);

    subject = week.length
      ? `Your week: ${weekCorrect} of ${week.length} winners called (${weekPct}%)`
      : season
        ? `Smash weekly: season benchmark ${season.acc}% over ${season.n.toLocaleString()} matches`
        : `Smash weekly digest · ${dateLabel}`;
    // The banner is the thesis card ("every call public, every miss too"),
    // which is the same promise this edition keeps by naming its misses. The
    // match-specific cards are deliberately NOT used here: they headline one
    // fixture ("THE MISS"), which reads as the whole week's story when it is
    // sitting above a seven-day summary.
    heroImage = shareImg('banner.png') || shareImg('edge-dollar.png');
    heroAlt = 'Every call public, every miss too';
    ctaHref = `${SITE}/track-record`;
    ctaText = 'Open the Ledger';

    txtLines.push(`SMASH WEEKLY · ${dateLabel}`, '');

    if (week.length) {
      blocks.push(sectionRow(`
        ${kicker('The week')}
        <div style="font-size:34px;font-weight:800;color:${LIME};line-height:1;">${weekCorrect} of ${week.length}</div>
        <div style="font-size:13px;color:${DIM};padding:6px 0 10px;">${weekPct}% of winners called across every graded match this week.</div>
        ${bar(weekPct)}
      `));
      txtLines.push(`THE WEEK: ${weekCorrect} of ${week.length} (${weekPct}%)`, '');

      // Day by day, oldest first: seven labelled bars.
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        const rows = week.filter((m) => String(m.date).slice(0, 10) === key);
        if (rows.length) {
          days.push({
            label: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
            n: rows.length,
            correct: rows.filter((m) => pickCorrect(m)).length,
          });
        }
      }
      if (days.length > 1) {
        const rows = days.map((d) => {
          const p = pct(d.correct, d.n);
          return `<tr>
            <td width="42" style="font-size:12px;color:${MUTED};padding:5px 8px 5px 0;white-space:nowrap;">${esc(d.label)}</td>
            <td style="padding:5px 0;">${bar(p, p >= 50 ? WIN : LOSS, 10)}</td>
            <td width="58" style="font-size:12px;color:${DIM};padding:5px 0 5px 8px;text-align:right;white-space:nowrap;">${d.correct}/${d.n}</td>
          </tr>`;
        }).join('');
        blocks.push(sectionRow(`
          ${kicker('Day by day')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
        `));
        txtLines.push('DAY BY DAY');
        for (const d of days) txtLines.push(`  ${d.label}: ${d.correct}/${d.n} (${pct(d.correct, d.n)}%)`);
        txtLines.push('');
      }

      // Bold calls that landed: we took a different player than the market and
      // were right. The hardest thing to do, so it leads the highlights.
      const splits = week.filter((m) => m.oddFav && pickFavorite(m) && pickFavorite(m) !== m.oddFav);
      const boldHits = splits.filter((m) => pickCorrect(m)).slice(0, 4);
      const misses = week
        .filter((m) => !pickCorrect(m))
        .sort((a, b) => {
          const conf = (x) => {
            const pp = x.pickProbP1 != null ? x.pickProbP1 : x.smashProbP1;
            return Math.max(pp, 1 - pp);
          };
          return conf(b) - conf(a);
        })
        .slice(0, 3);

      if (boldHits.length) {
        blocks.push(sectionRow(`
          ${kicker('Bold calls that landed')}
          <div style="font-size:13px;color:${MUTED};padding-bottom:6px;">We named a different winner than the bookmakers, and the match agreed with us.</div>
          ${boldHits.map(resultLine).join('')}
        `));
        txtLines.push('BOLD CALLS THAT LANDED');
        for (const m of boldHits) txtLines.push(`  + ${lastName(pickFavorite(m) === m.p1 ? m.name1 : m.name2)} (against the market) ${m.score || ''}`.trimEnd());
        txtLines.push('');
      }

      if (misses.length) {
        blocks.push(sectionRow(`
          ${kicker('And the ones we got wrong')}
          <div style="font-size:13px;color:${MUTED};padding-bottom:6px;">Our most confident misses of the week. They count the same as the hits.</div>
          ${misses.map(resultLine).join('')}
        `));
        txtLines.push('THE ONES WE GOT WRONG');
        for (const m of misses) {
          const favIsP1 = pickFavorite(m) === m.p1;
          txtLines.push(`  - ${lastName(favIsP1 ? m.name1 : m.name2)} lost to ${lastName(favIsP1 ? m.name2 : m.name1)} ${m.score || ''}`.trimEnd());
        }
        txtLines.push('');
      }

      // Versus the market, over the same week.
      const priced = week.filter((m) => m.oddCorrect != null);
      if (priced.length >= 5) {
        const us = pct(priced.filter((m) => pickCorrect(m)).length, priced.length);
        const them = pct(priced.filter((m) => m.oddCorrect).length, priced.length);
        blocks.push(sectionRow(`
          ${kicker('Us vs the bookmakers')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="50%" style="padding-right:8px;">
                <div style="font-size:24px;font-weight:800;color:${LIME};line-height:1.1;">${us}%</div>
                <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;">us</div>
                ${bar(us)}
              </td>
              <td width="50%" style="padding-left:8px;">
                <div style="font-size:24px;font-weight:800;color:${DIM};line-height:1.1;">${them}%</div>
                <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};padding-bottom:6px;">the bookmakers</div>
                ${bar(them, MUTED)}
              </td>
            </tr>
          </table>
          <div style="font-size:12px;color:${MUTED};padding-top:10px;">Across the ${priced.length} matches this week that carried a closing price.</div>
        `));
        txtLines.push(`US VS THE BOOKMAKERS: ${us}% vs ${them}% (${priced.length} priced matches)`, '');
      }
    }

    // Forward test + season, the standing numbers.
    const decided = preds.filter((p) => p.status === 'won' || p.status === 'lost');
    const fwdWon = decided.filter((p) => p.status === 'won').length;
    const pending = preds.filter((p) => p.status === 'pending').length;
    if (decided.length || (season && season.n)) {
      blocks.push(sectionRow(`
        ${kicker('The standing record')}
        ${decided.length ? `<div style="font-size:14px;color:${TEXT};padding-bottom:4px;"><strong style="color:${LIME};">${fwdWon}-${decided.length - fwdWon}</strong> locked before play and graded after${pending ? `, ${pending} more pending` : ''}.</div>` : ''}
        ${season && season.n ? `<div style="font-size:13px;color:${DIM};">Season benchmark <strong style="color:${TEXT};">${season.acc}%</strong> (${season.correct.toLocaleString()} of ${season.n.toLocaleString()}), today's engines replayed over the season.</div>` : ''}
      `));
      if (decided.length) txtLines.push(`FORWARD TEST: ${fwdWon}-${decided.length - fwdWon}${pending ? ` (${pending} pending)` : ''}`);
      if (season && season.n) txtLines.push(`SEASON BENCHMARK: ${season.acc}% (${season.correct.toLocaleString()} of ${season.n.toLocaleString()})`);
      txtLines.push('');
    }

    if (slam && slamDays != null) {
      blocks.push(sectionRow(`
        ${kicker('Next up')}
        <div style="font-size:15px;color:${TEXT};">
          <strong style="color:${LIME};font-size:22px;">${slamDays === 0 ? 'Today' : `${slamDays} day${slamDays === 1 ? '' : 's'}`}</strong>
          ${slamDays === 0 ? `the ${esc(slam.label)} begins` : `to the ${esc(slam.label)}`}, on ${esc(slam.surface)}.
        </div>
        <div style="padding-top:12px;">${button(`${SITE}/draw`, 'See the projected draw', { primary: false })}</div>
      `));
      txtLines.push(`NEXT UP: ${slamDays === 0 ? `the ${slam.label} begins today` : `${slamDays} days to the ${slam.label}`}`, '');
    }
  }

  if (!blocks.length) {
    console.log(`[${MODE}] Nothing worth mailing today (no graded results, no locked calls); wrote no files and skipped send.`);
    return;
  }

  const editionLabel = isWeekly ? 'weekly' : 'daily';
  const stem = isWeekly ? 'digest' : 'digest-daily';

  // ── digest.txt
  const txt = [
    ...txtLines,
    `${ctaText}: ${ctaHref}`,
    '',
    'Not betting advice. The season number is a benchmark; only the forward test rows were locked before play.',
    // Swapped per recipient at send time; the on-disk copy gets the fallback.
    '%%UNSUB_TXT%%',
  ].join('\n');
  // The unsubscribe link is per recipient, so the committed artifact carries
  // the no-token fallback rather than a placeholder or a stranger's token.
  const FALLBACK_TXT = `Unsubscribe by replying "stop". ${SITE}`;
  const FALLBACK_HTML = 'Reply "stop" to unsubscribe.';
  const fillUnsub = (s, unsubUrl) => s
    .replace(/%%UNSUB_TXT%%/g, unsubUrl ? `Unsubscribe: ${unsubUrl}` : FALLBACK_TXT)
    .replace(/%%UNSUB_HTML%%/g, unsubUrl
      ? `<a href="${unsubUrl}" style="color:#687082;text-decoration:underline;">Unsubscribe</a>`
      : FALLBACK_HTML);

  fs.writeFileSync(path.join(DATA, `${stem}.txt`), `${fillUnsub(txt, null)}\n`);

  // ── digest.html
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${INK};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(subject)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${INK};font-family:${FONT};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD};border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:20px 20px 16px;border-bottom:2px solid ${LIME};">
            <div style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">SMASH &middot; ${esc(editionLabel)}</div>
            <div style="font-size:12px;color:${MUTED};padding-top:4px;">${esc(dateLabel)} &middot; every call locked before play, graded in public</div>
          </td>
        </tr>
        ${heroImage ? `<tr><td style="padding:0;"><a href="${ctaHref}"><img src="${heroImage}" alt="${esc(heroAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></a></td></tr>` : ''}
        ${blocks.join('')}
        <tr>
          <td style="padding:20px;" align="center">
            ${button(ctaHref, ctaText)}
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 18px;font-size:11px;line-height:1.6;color:#687082;">
            Not betting advice. The season number is a benchmark (today's engines replayed over the
            season); only the forward test rows were locked before play.
            <a href="${SITE}" style="color:#687082;">${esc(SITE.replace(/^https?:\/\//, ''))}</a>
            <br />%%UNSUB_HTML%%
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;
  fs.writeFileSync(path.join(DATA, `${stem}.html`), fillUnsub(html, null));
  console.log(`[${MODE}] Wrote public/data/${stem}.html and ${stem}.txt (${blocks.length} sections${heroImage ? ', hero image' : ', no hero image'}). Subject: ${subject}`);

  // ── Optional send via Resend. Never fatal.
  // Recipients = DIGEST_TO (owner) + the public subscriber list from
  // Supabase (digest_subscribers, readable only with the service key).
  // Each subscriber gets their own send - addresses are never shared in a
  // joint "to" line. Capped per run to stay inside Resend's free tier.
  // Transport: Gmail SMTP wins when configured, else Resend. Both send one
  // message per recipient with that person's own unsubscribe link, so
  // switching between them changes nothing a reader can see.
  const transport = pickTransport();
  if (!transport) {
    console.warn(
      '  ! No mail transport configured, so NO EMAIL WAS SENT - only files were written.\n'
      + '    Either GMAIL_USER + GMAIL_APP_PASSWORD (a Google App Password, needs\n'
      + '    2-Step Verification on that account), or RESEND_API_KEY with DIGEST_FROM\n'
      + '    on a domain verified in Resend. Plus DIGEST_TO for yourself.'
    );
    return;
  }
  console.log(`Transport: ${transport.label}`);
  // email -> unsubscribe token (null for DIGEST_TO addresses, which are not
  // rows in the table and so have nothing to unsubscribe from). A subscriber
  // who is ALSO in DIGEST_TO overwrites the null, so they get a live link.
  const owners = new Set((process.env.DIGEST_TO || '').split(',').map((s) => s.trim()).filter(Boolean));
  const recipients = new Map([...owners].map((e) => [e, null]));
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/digest_subscribers?select=email,unsubscribe_token`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
      if (res.ok) {
        const rows = await res.json();
        for (const r of rows) recipients.set(r.email, r.unsubscribe_token || null);
        const tokenless = rows.filter((r) => !r.unsubscribe_token).length;
        console.log(`Subscribers: ${rows.length} from digest_subscribers, ${owners.size} from DIGEST_TO, ${recipients.size} unique.`);
        if (tokenless) {
          console.warn(
            `  ! ${tokenless} subscriber(s) have no unsubscribe_token, so they get the\n`
            + '    reply-to-unsubscribe fallback. Run supabase/digest_unsubscribe.sql.'
          );
        }
      } else {
        console.warn(
          `  ! Could not read digest_subscribers (HTTP ${res.status}), so ONLY DIGEST_TO is being mailed.\n`
          + '    SUPABASE_SERVICE_KEY must be the service-role key: the table allows anon\n'
          + '    INSERT but no anon SELECT, so the anon key reads back an empty list.'
        );
      }
    } catch (err) {
      console.warn(`  ! Subscriber fetch failed, mailing DIGEST_TO only (non-fatal): ${err.message}`);
    }
  } else {
    // Silent-skipping this is how you mail yourself, see "sent to 1 recipient",
    // and never learn that real subscribers were dropped on the floor.
    console.warn(
      '  ! SUPABASE_URL / SUPABASE_SERVICE_KEY are not set, so the subscriber list was\n'
      + '    NEVER READ - anyone who signed up on the site is being skipped and only\n'
      + '    DIGEST_TO will receive this. These are the server-side pair, distinct from\n'
      + '    the REACT_APP_SUPABASE_* values the browser build uses.'
    );
  }
  if (!recipients.size) {
    console.warn(
      '  ! RESEND_API_KEY is set but there are NO RECIPIENTS, so nothing was sent.\n'
      + '    Set DIGEST_TO, and check the footer signup can reach Supabase\n'
      + '    (digest_subscribers must exist - see supabase/digest.sql - and the\n'
      + '    deployed site needs REACT_APP_SUPABASE_URL / _ANON_KEY at build time).'
    );
    return;
  }
  const CAP = transport.cap;
  const list = [...recipients].slice(0, CAP);
  if (recipients.size > CAP) console.warn(`  ! recipient list capped at ${CAP} of ${recipients.size} for ${transport.label} - move to a bulk sender.`);
  let sent = 0, failed = 0, oneClick = 0;
  for (const [rcpt, token] of list) {
    const unsubUrl = token ? `${SITE}/api/unsubscribe?t=${token}` : null;
    // RFC 8058: with both headers present, Gmail and Outlook show their own
    // unsubscribe control next to the sender and POST to this URL. That is
    // what keeps bulk mail out of spam, so it matters more than the footer
    // link. Only advertised when there is a token to honour it with.
    const headers = unsubUrl
      ? { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined;
    if (headers) oneClick++;
    try {
      await transport.send({
        from: transport.from,
        to: rcpt,
        subject,
        html: fillUnsub(html, unsubUrl),
        text: fillUnsub(txt, unsubUrl),
        headers,
      });
      sent++;
    } catch (err) {
      failed++;
      if (failed === 1) console.log(`  first send failure: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 600)); // stay under provider rate limits
  }
  console.log(`Digest sent to ${sent} recipient(s)${failed ? `, ${failed} failed` : ''}. ${oneClick} carried a one-click unsubscribe.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
