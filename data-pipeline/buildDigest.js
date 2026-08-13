/**
 * The email digest, in two editions.
 *
 *   DAILY  (public/data/digest-daily.html + .txt)
 *     How yesterday's calls landed, then every match on today's card with a
 *     headshot, a win-probability bar, one line of read on where we stand
 *     against the market, and links to the full call / a stat comparison / a
 *     live simulation. Closes with the staking plan and the slam countdown.
 *
 *   WEEKLY (public/data/digest.html + .txt)
 *     The week in prose: hit rate, a day-by-day chart, the bold calls that
 *     landed, the ones that missed, and where we finished against the
 *     bookmakers.
 *
 * Edition comes from DIGEST_MODE (daily|weekly), defaulting to weekly on
 * Mondays (UTC) and daily otherwise. The daily edition only lands on days the
 * refresh workflow runs: daily inside the tournament windows, Mondays only
 * off-season.
 *
 * DESIGN NOTES (this is an email, not a web page):
 *   - Light background. Dark-themed mail looks broken in clients that force
 *     their own light palette, and prints badly.
 *   - Tables and inline styles only. No flexbox, no <style> block, no
 *     webfonts, no background-image: Outlook and Gmail strip or ignore them.
 *   - Charts are coloured table cells, so they survive image blocking.
 *   - Photographs are real player headshots mirrored out of src/assets into
 *     public/data (see mirrorPhoto). The Instagram share cards are
 *     deliberately NOT reused: they are 1080px square, dark, and designed to
 *     be read at arm's length on a phone feed, which is the wrong shape and
 *     the wrong contrast for an inbox.
 *   - Prose carries the email. A wall of numbers is what the site is for.
 *
 * Usage: node data-pipeline/buildDigest.js
 * Env:   DIGEST_MODE (daily|weekly), DIGEST_TO, SITE_URL, and ONE transport:
 *          GMAIL_USER + GMAIL_APP_PASSWORD  (no domain needed), or
 *          RESEND_API_KEY + DIGEST_FROM     (domain verified in Resend)
 *        Subscriber list: SUPABASE_URL + SUPABASE_SERVICE_KEY.
 *
 * Nothing is emailed unless a transport is configured AND there is at least
 * one recipient. Every one of those conditions logs loudly when it fails
 * rather than passing silently, because a digest that builds every week and
 * quietly mails nobody looks exactly like success.
 */
// Load .env like the other pipeline scripts (fetch.js, buildRoster.js, ...).
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const PHOTO_SRC = { atp: path.join(ROOT, 'src', 'assets', 'players'), wta: path.join(ROOT, 'src', 'assets', 'players-women') };
const PHOTO_OUT = path.join(DATA, 'digest', 'players');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');

// Light palette. The brand lime is unreadable as text on white, so it lives
// on dark buttons and chips instead, and links use a deep green that passes
// contrast on a white card.
const PAGE = '#eef1f5';
const CARD = '#ffffff';
const INK = '#14171c';
const BODY = '#39414d';
const MUTED = '#6b7480';
const LINE = '#e2e7ee';
const BTN = '#14171c';
const LIME = '#c6ff1c';
const LINK = '#14652f';
const WIN = '#157f4c';
const LOSS = '#c0392b';
const TRACK = '#e8ecf2';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const pickCorrect = (m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect);
const pickFavorite = (m) => m.pickFavorite || m.smashFavorite;

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (correct, n) => (n ? Math.round((100 * correct) / n) : 0);
const lastName = (full) => String(full || '').trim().split(/\s+/).slice(-1)[0] || String(full || '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// MUST stay byte-identical to src/utils/slug.js, or every link 404s.
const slugify = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const matchUrl = (p) => `${SITE}/match/${slugify(p.name1)}-vs-${slugify(p.name2)}-${p.id}`;
const compareUrl = (p) => `${SITE}/compare/${p.tour || 'atp'}/${slugify(p.name1)}-vs-${slugify(p.name2)}`;
// Opens the H2H studio pre-loaded with this matchup, ready to simulate.
const simUrl = (p) => `${SITE}${p.tour === 'wta' ? '/women' : ''}/h2h?surface=${p.surface}&a=${p.p1}&b=${p.p2}`;

// Player headshots live in src/assets and are bundled by Vite, so they have no
// stable public URL an email can reference. Mirror the ones this email needs
// into public/data (which the workflow commits) - each player is copied once,
// ever, and skipped on every later run.
function mirrorPhoto(tour, id) {
  const t = tour === 'wta' ? 'wta' : 'atp';
  if (!id) return null;
  const src = path.join(PHOTO_SRC[t], `${id}.png`);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(PHOTO_OUT, t);
  const dest = path.join(dir, `${id}.png`);
  try {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return `${SITE}/data/digest/players/${t}/${id}.png`;
  } catch { return null; }
}

// The market's own read on our pick, with the bookmaker's margin divided out.
// Same vig-stripping the Parlay builder uses, so the two never disagree.
function marketProb(p) {
  if (!(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) return null;
  const q1 = 1 / p.lockOdd1, q2 = 1 / p.lockOdd2;
  return (p.favorite === p.p1 ? q1 : q2) / (q1 + q2);
}

// ── Email primitives ────────────────────────────────────────────────────────
function bar(percent, color = INK, height = 10) {
  const w = Math.max(0, Math.min(100, Math.round(percent)));
  const cell = `height:${height}px;font-size:0;line-height:0;mso-line-height-rule:exactly;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
    <tr>
      ${w > 0 ? `<td width="${w}%" style="${cell}background:${color};border-radius:5px 0 0 5px;">&nbsp;</td>` : ''}
      ${w < 100 ? `<td style="${cell}background:${TRACK};border-radius:${w > 0 ? '0 5px 5px 0' : '5px'};">&nbsp;</td>` : ''}
    </tr>
  </table>`;
}

const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${BTN};color:${LIME};font-size:15px;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:8px;">${esc(label)}</a>`;

const textLink = (href, label) =>
  `<a href="${href}" style="color:${LINK};text-decoration:none;font-weight:700;border-bottom:1px solid ${LINE};">${esc(label)}</a>`;

// Section wrapper: a white card on the page tint.
const section = (inner) =>
  `<tr><td style="padding:26px 28px;border-top:1px solid ${LINE};">${inner}</td></tr>`;

const h2 = (text) =>
  `<h2 style="margin:0 0 12px;font-size:19px;line-height:1.3;font-weight:800;color:${INK};">${esc(text)}</h2>`;

const p = (html, extra = '') =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${BODY};${extra}">${html}</p>`;

const kicker = (text) =>
  `<div style="font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};font-weight:700;padding-bottom:8px;">${esc(text)}</div>`;

// ── Content builders ────────────────────────────────────────────────────────

// One upcoming match: two headshots, the call, a probability bar, a line of
// read on the market, and the three ways into the app.
function matchCard(pr, upset) {
  const favIsP1 = pr.favorite === pr.p1;
  const favName = pr.favName || (favIsP1 ? pr.name1 : pr.name2);
  const dogName = favIsP1 ? pr.name2 : pr.name1;
  const favId = favIsP1 ? pr.p1 : pr.p2;
  const dogId = favIsP1 ? pr.p2 : pr.p1;
  const prob = Math.round((pr.favProb || 0) * 100);
  const favPhoto = mirrorPhoto(pr.tour, favId);
  const dogPhoto = mirrorPhoto(pr.tour, dogId);
  const when = new Date(pr.date);
  const timeLabel = Number.isFinite(when.getTime()) && when.getUTCHours() >= 5
    ? `${when.toISOString().slice(11, 16)} UTC`
    : 'time to be confirmed';

  // The read: what the market thinks, versus us. This is the line that makes
  // the email worth opening rather than a fixture list.
  const mkt = marketProb(pr);
  let read;
  if (upset) {
    read = `Upset watch: ${esc(upset.reason)}`;
  } else if (mkt != null) {
    const gap = Math.round((pr.favProb - mkt) * 100);
    if (gap >= 10) {
      read = `We rate ${esc(lastName(favName))} ${gap} points higher than the bookmakers do, and calls in that band have come in about 69% of the time.`;
    } else if (gap <= -8) {
      read = `The market is warmer on ${esc(lastName(favName))} than we are, pricing this nearer ${Math.round(mkt * 100)}%. We still take the same side, with less conviction than they have.`;
    } else if (prob <= 56) {
      read = `Close to a coin toss, and we say so: ${prob}% is the honest number, not a headline.`;
    } else {
      read = `The bookmakers land in much the same place at ${Math.round(mkt * 100)}%, so there is no argument here, just a favourite.`;
    }
  } else {
    read = prob >= 70
      ? `A clear favourite on our numbers. No closing price was quoted when we locked it.`
      : `Tight on our numbers, and unpriced at lock time, so there is no market to argue with.`;
  }

  const face = (url, alt, dim) => (url
    ? `<img src="${url}" width="54" height="54" alt="${esc(alt)}" style="display:block;width:54px;height:54px;border-radius:27px;border:2px solid ${dim ? LINE : INK};" />`
    : `<div style="width:54px;height:54px;border-radius:27px;background:${TRACK};"></div>`);

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};border-radius:12px;margin-bottom:16px;">
    <tr><td style="padding:18px 20px;">
      <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};font-weight:700;padding-bottom:12px;">
        ${esc((pr.tour || '').toUpperCase())} &nbsp;&middot;&nbsp; ${esc(pr.event || '')} &nbsp;&middot;&nbsp; ${esc(pr.surface || '')} &nbsp;&middot;&nbsp; ${esc(timeLabel)}
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="54" style="padding-right:12px;">${face(favPhoto, favName, false)}</td>
          <td style="font-size:17px;font-weight:800;color:${INK};line-height:1.35;">
            ${esc(lastName(favName))}
            <span style="font-weight:400;color:${MUTED};font-size:15px;"> to beat ${esc(lastName(dogName))}</span>
          </td>
          <td width="54" style="padding-left:12px;">${face(dogPhoto, dogName, true)}</td>
        </tr>
      </table>
      <div style="font-size:14px;color:${BODY};padding:14px 0 6px;">Our number: <strong style="color:${INK};font-size:16px;">${prob}%</strong></div>
      ${bar(prob)}
      <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:${BODY};">${read}</p>
      <div style="padding-top:14px;font-size:14px;line-height:2;">
        ${textLink(matchUrl(pr), 'Read the full call')}
        <span style="color:${LINE};padding:0 6px;">&nbsp;</span>
        ${textLink(compareUrl(pr), 'Compare them')}
        <span style="color:${LINE};padding:0 6px;">&nbsp;</span>
        ${textLink(simUrl(pr), 'Run the simulation')}
      </div>
    </td></tr>
  </table>`;
}

// A graded result, with the face of whoever we backed.
function resultRow(m) {
  const hit = !!pickCorrect(m);
  const fav = pickFavorite(m);
  const favIsP1 = fav === m.p1;
  const ourPick = favIsP1 ? m.name1 : m.name2;
  const other = favIsP1 ? m.name2 : m.name1;
  const winner = m.winner === m.p1 ? m.name1 : m.name2;
  const raw = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1;
  const prob = Math.round((favIsP1 ? raw : 1 - raw) * 100);
  const photo = mirrorPhoto(m.tour, fav);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid ${LINE};">
    <tr>
      <td width="40" style="padding:12px 12px 12px 0;">
        ${photo
    ? `<img src="${photo}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:18px;border:2px solid ${hit ? WIN : LOSS};" />`
    : `<div style="width:36px;height:36px;border-radius:18px;background:${TRACK};"></div>`}
      </td>
      <td style="padding:12px 0;font-size:14px;line-height:1.5;color:${BODY};">
        <strong style="color:${INK};">${esc(lastName(ourPick))}</strong> over ${esc(lastName(other))} at ${prob}%
        <div style="color:${hit ? WIN : LOSS};font-weight:700;padding-top:2px;">
          ${hit ? 'Landed' : `Missed, ${esc(lastName(winner))} won`}${m.score ? `<span style="color:${MUTED};font-weight:400;"> &nbsp;${esc(m.score)}</span>` : ''}
        </div>
      </td>
    </tr>
  </table>`;
}

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

async function main() {
  const scorecard = readJson(path.join(DATA, 'daily_scorecard.json'));
  const track = readJson(path.join(DATA, 'track_record.json'));
  const predsDoc = readJson(path.join(DATA, 'predictions.json'));

  if (!scorecard && !track && !predsDoc) {
    console.log('No digest inputs found; nothing to build.');
    return;
  }

  const now = new Date();
  const MODE = (process.env.DIGEST_MODE || (now.getUTCDay() === 1 ? 'weekly' : 'daily')).toLowerCase();
  const isWeekly = MODE === 'weekly';
  const dateLabel = now.toISOString().slice(0, 10);
  const prettyDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  const season = scorecard && scorecard.season ? scorecard.season : null;
  const yday = scorecard && scorecard.yesterday ? scorecard.yesterday : null;
  const upsetById = new Map(((scorecard && scorecard.upsetWatch) || []).map((u) => [u.id, u]));
  const matches = (track && track.matches) || [];
  const graded = matches.filter((m) => m.date && pickCorrect(m) != null);
  const preds = (predsDoc && predsDoc.predictions) || [];

  let slam = null;
  try {
    const { nextSlam } = require('./lib/slamCalendar');
    slam = nextSlam(now);
  } catch { /* no countdown */ }
  const slamDays = slam ? Math.max(0, Math.ceil((Date.parse(slam.startsAt) - now.getTime()) / 86400000)) : null;

  let subject = '';
  let preheader = '';
  const blocks = [];
  const txtLines = [];
  let ctaHref = `${SITE}/today`;
  let ctaText = "See today's calls";

  if (!isWeekly) {
    // ── DAILY ───────────────────────────────────────────────────────────────
    const todayISO = dateLabel;
    const upcoming = preds
      .filter((pr) => pr.status === 'pending' && String(pr.date || '').slice(0, 10) >= todayISO)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const todays = upcoming.filter((pr) => String(pr.date || '').slice(0, 10) === todayISO);
    const card = todays.length ? todays : upcoming.slice(0, 6);
    const shown = card.slice(0, 5);
    const events = [...new Set(card.map((pr) => pr.event).filter(Boolean))];
    const splits = card.filter((pr) => {
      const mk = marketProb(pr);
      return mk != null && pr.favProb - mk >= 0.10;
    });

    subject = yday && yday.n
      ? `${yday.correct} of ${yday.n} yesterday, ${plural(card.length, 'call', 'calls')} locked for today`
      : `${plural(card.length, 'call', 'calls')} locked for today`;
    preheader = card.length
      ? `Every pick below was locked before play. ${events.length ? events.join(' and ') + '. ' : ''}Plus what we would stake, and ${slamDays != null ? `${slamDays} days to the ${slam.label}` : 'the road ahead'}.`
      : 'Yesterday graded, and what comes next.';
    ctaHref = `${SITE}/today`;
    ctaText = "See today's full card";

    txtLines.push(`SMASH DAILY - ${prettyDate}`, '');

    // Lede: set the scene in prose before any numbers.
    const ledeBits = [];
    if (yday && yday.n) {
      ledeBits.push(`Yesterday we called ${yday.correct} of ${yday.n} winners`);
      ledeBits.push(yday.correct === yday.n
        ? ', a clean sweep.'
        : pct(yday.correct, yday.n) >= 70 ? ', a good day.' : ', and we own the ones that got away.');
    }
    if (card.length) {
      ledeBits.push(` Today there ${card.length === 1 ? 'is' : 'are'} ${plural(card.length, 'match', 'matches')} on the card${events.length ? ` at ${events.join(' and ')}` : ''}, every pick locked and public before a ball is struck.`);
    }
    if (ledeBits.length) {
      blocks.push(section(p(ledeBits.join('').trim())));
      txtLines.push(ledeBits.join('').trim(), '');
    }

    // Yesterday, graded.
    if (yday && yday.n) {
      const ypct = pct(yday.correct, yday.n);
      const ydayRows = graded
        .filter((m) => String(m.date).slice(0, 10) === String(yday.date).slice(0, 10))
        .slice(0, 6);
      blocks.push(section(`
        ${kicker('How yesterday landed')}
        ${h2(`${yday.correct} of ${yday.n} winners called`)}
        ${p(`That is ${ypct}% on the day, and every one of those calls was public before the match started. ${yday.worstMiss && yday.worstMiss.call ? `The one that stings: <strong style="color:${INK};">${esc(yday.worstMiss.call)}</strong>${yday.worstMiss.winner ? `, and ${esc(yday.worstMiss.winner)} won it` : ''}. It goes in the record at full weight, like everything else.` : ''}`)}
        ${bar(ypct, ypct >= 50 ? WIN : LOSS)}
        ${ydayRows.length ? `<div style="padding-top:16px;">${ydayRows.map(resultRow).join('')}</div>` : ''}
        <div style="padding-top:16px;">${textLink(`${SITE}/track-record`, 'Every call ever made, graded')}</div>
      `));
      txtLines.push(`HOW YESTERDAY LANDED: ${yday.correct} of ${yday.n} (${ypct}%)`);
      if (yday.worstMiss && yday.worstMiss.call) txtLines.push(`  The one that stings: ${yday.worstMiss.call}${yday.worstMiss.winner ? ` (${yday.worstMiss.winner} won)` : ''}`);
      txtLines.push('');
    }

    // Today's card.
    if (shown.length) {
      const intro = splits.length
        ? `We disagree with the bookmakers on ${plural(splits.length, 'of these', 'of these')} by ten points or more. Those are the ones worth your attention: agreeing with the favourite proves nothing.`
        : 'We land close to the market on today\'s card, so these are about conviction rather than argument.';
      blocks.push(section(`
        ${kicker(todays.length ? 'On court today' : 'Next up')}
        ${h2(`${plural(card.length, 'match', 'matches')}, already locked`)}
        ${p(intro)}
        ${shown.map((pr) => matchCard(pr, upsetById.get(pr.id))).join('')}
        ${card.length > shown.length ? p(textLink(`${SITE}/today`, `See the other ${plural(card.length - shown.length, 'match', 'matches')}`)) : ''}
      `));
      txtLines.push(todays.length ? 'ON COURT TODAY' : 'NEXT UP');
      for (const pr of shown) {
        const favIsP1 = pr.favorite === pr.p1;
        txtLines.push(`  ${lastName(pr.favName || (favIsP1 ? pr.name1 : pr.name2))} over ${lastName(favIsP1 ? pr.name2 : pr.name1)} - ${Math.round(pr.favProb * 100)}% - ${pr.event}`);
        txtLines.push(`    Call: ${matchUrl(pr)}`);
        txtLines.push(`    Compare: ${compareUrl(pr)}`);
        txtLines.push(`    Simulate: ${simUrl(pr)}`);
      }
      txtLines.push('');
    }

    // Staking plan.
    blocks.push(section(`
      ${kicker('What we would stake')}
      ${h2('The slip, sized honestly')}
      ${p('A probability is only half an answer. The parlay builder takes today\'s calls, prices each one against the odds you are actually offered, and splits a budget across only the bets that beat their price. Anything the market has already sharpened past our number gets nothing.')}
      ${p('It will tell you to stake less than you expected, and some days it will tell you to stake nothing at all. That is the point.')}
      <div style="padding-top:4px;">${button(`${SITE}/parlay`, 'Size today\'s slip')}</div>
    `));
    txtLines.push(`WHAT WE WOULD STAKE: ${SITE}/parlay`, '');

    // Countdown.
    if (slam && slamDays != null) {
      blocks.push(section(`
        ${kicker('Countdown')}
        ${h2(slamDays === 0 ? `The ${slam.label} starts today` : `${plural(slamDays, 'day', 'days')} to the ${slam.label}`)}
        ${p(`On ${esc(slam.surface)}. Until the real draw lands we simulate a seeded field from current rankings, two thousand times over, and re-price it with every refresh. It is the closest thing to a look at the tournament before the tournament exists.`)}
        <div style="padding-top:4px;">${button(`${SITE}/draw`, 'See the projected draw')}</div>
      `));
      txtLines.push(`COUNTDOWN: ${slamDays === 0 ? `the ${slam.label} starts today` : `${slamDays} days to the ${slam.label}`} (${slam.surface})`, `  ${SITE}/draw`, '');
    }

    if (season && season.n) {
      blocks.push(section(p(
        `<span style="color:${MUTED};">For the record: ${season.acc}% of winners called across ${season.correct.toLocaleString()} of ${season.n.toLocaleString()} matches this season, today's engines replayed over every one of them.</span>`
      )));
      txtLines.push(`SEASON: ${season.acc}% (${season.correct.toLocaleString()} of ${season.n.toLocaleString()})`, '');
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
      ? `Your week: ${weekCorrect} of ${week.length} winners called`
      : `Smash weekly - ${dateLabel}`;
    preheader = week.length
      ? `${weekPct}% across every graded match, the bold calls that landed, and the ones that did not.`
      : 'The week in review.';
    ctaHref = `${SITE}/track-record`;
    ctaText = 'Open the Ledger';

    txtLines.push(`SMASH WEEKLY - ${prettyDate}`, '');

    if (week.length) {
      blocks.push(section(`
        ${p(`Seven days, ${plural(week.length, 'graded match', 'graded matches')}, and a number we cannot edit after the fact. Here is how the week actually went.`)}
        ${kicker('The week')}
        ${h2(`${weekCorrect} of ${week.length} winners called`)}
        ${p(`${weekPct}% across every match we graded, hits and misses together. No filtering by confidence, no quietly dropping the ones that aged badly.`)}
        ${bar(weekPct, weekPct >= 50 ? WIN : LOSS, 14)}
      `));
      txtLines.push(`THE WEEK: ${weekCorrect} of ${week.length} (${weekPct}%)`, '');

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
        const best = days.reduce((a, b) => (pct(b.correct, b.n) > pct(a.correct, a.n) ? b : a));
        const rows = days.map((d) => {
          const dp = pct(d.correct, d.n);
          return `<tr>
            <td width="46" style="font-size:13px;color:${MUTED};padding:6px 10px 6px 0;white-space:nowrap;font-weight:700;">${esc(d.label)}</td>
            <td style="padding:6px 0;">${bar(dp, dp >= 50 ? WIN : LOSS, 12)}</td>
            <td width="62" style="font-size:13px;color:${BODY};padding:6px 0 6px 10px;text-align:right;white-space:nowrap;">${d.correct}/${d.n}</td>
          </tr>`;
        }).join('');
        blocks.push(section(`
          ${kicker('Day by day')}
          ${p(`Best day was ${esc(best.label)} at ${pct(best.correct, best.n)}%. Volume swings a lot with the draw, so a thin day reads louder than it should.`)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
        `));
        txtLines.push('DAY BY DAY');
        for (const d of days) txtLines.push(`  ${d.label}: ${d.correct}/${d.n} (${pct(d.correct, d.n)}%)`);
        txtLines.push('');
      }

      const splitRows = week.filter((m) => m.oddFav && pickFavorite(m) && pickFavorite(m) !== m.oddFav);
      const boldHits = splitRows.filter((m) => pickCorrect(m)).slice(0, 4);
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
        blocks.push(section(`
          ${kicker('Bold calls that landed')}
          ${h2('We took a different winner, and won')}
          ${p(`These are the only matches that really test a model: we named a different winner than the bookmakers did, so one of us had to be wrong. ${boldHits.length === 1 ? 'Once this week' : `${boldHits.length === 2 ? 'Twice' : `${boldHits.length} times`} this week`} it was them.`)}
          ${boldHits.map(resultRow).join('')}
          <div style="padding-top:16px;">${textLink(`${SITE}/edge`, 'Every split we have graded')}</div>
        `));
        txtLines.push('BOLD CALLS THAT LANDED');
        for (const m of boldHits) txtLines.push(`  + ${lastName(pickFavorite(m) === m.p1 ? m.name1 : m.name2)} (against the market) ${m.score || ''}`.trimEnd());
        txtLines.push('');
      }

      if (misses.length) {
        blocks.push(section(`
          ${kicker('And the ones we got wrong')}
          ${h2('Our most confident misses')}
          ${p('Publishing these is the whole deal. A model that only shows you its winners is a highlight reel, not a record.')}
          ${misses.map(resultRow).join('')}
        `));
        txtLines.push('THE ONES WE GOT WRONG');
        for (const m of misses) {
          const favIsP1 = pickFavorite(m) === m.p1;
          txtLines.push(`  - ${lastName(favIsP1 ? m.name1 : m.name2)} lost to ${lastName(favIsP1 ? m.name2 : m.name1)} ${m.score || ''}`.trimEnd());
        }
        txtLines.push('');
      }

      const priced = week.filter((m) => m.oddCorrect != null);
      if (priced.length >= 5) {
        const us = pct(priced.filter((m) => pickCorrect(m)).length, priced.length);
        const them = pct(priced.filter((m) => m.oddCorrect).length, priced.length);
        const verdict = us > them
          ? `We finished ${us - them} points ahead of the bookmakers this week.`
          : us === them
            ? 'We finished level with the bookmakers this week.'
            : `The bookmakers finished ${them - us} points ahead of us this week. Some weeks go that way, and the number stays up either way.`;
        blocks.push(section(`
          ${kicker('Us vs the bookmakers')}
          ${h2(verdict)}
          ${p(`Measured across the ${priced.length} matches this week that carried a closing price, scoring both sides on the same fixtures.`)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="50%" style="padding:0 10px 0 0;vertical-align:top;">
                <div style="font-size:26px;font-weight:800;color:${INK};line-height:1.1;">${us}%</div>
                <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;padding:2px 0 8px;">us</div>
                ${bar(us, INK)}
              </td>
              <td width="50%" style="padding:0 0 0 10px;vertical-align:top;">
                <div style="font-size:26px;font-weight:800;color:${MUTED};line-height:1.1;">${them}%</div>
                <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;padding:2px 0 8px;">the bookmakers</div>
                ${bar(them, MUTED)}
              </td>
            </tr>
          </table>
        `));
        txtLines.push(`US VS THE BOOKMAKERS: ${us}% vs ${them}% (${priced.length} priced matches)`, '');
      }
    }

    const decided = preds.filter((pr) => pr.status === 'won' || pr.status === 'lost');
    const fwdWon = decided.filter((pr) => pr.status === 'won').length;
    const pending = preds.filter((pr) => pr.status === 'pending').length;
    if (decided.length || (season && season.n)) {
      blocks.push(section(`
        ${kicker('The standing record')}
        ${decided.length ? p(`<strong style="color:${INK};">${fwdWon}-${decided.length - fwdWon}</strong> on calls locked before play and graded after${pending ? `, with ${pending} still pending` : ''}. That is the honest one: no hindsight, no re-runs.`) : ''}
        ${season && season.n ? p(`<span style="color:${MUTED};">Season benchmark ${season.acc}% (${season.correct.toLocaleString()} of ${season.n.toLocaleString()}), today's engines replayed over the season.</span>`) : ''}
      `));
      if (decided.length) txtLines.push(`FORWARD TEST: ${fwdWon}-${decided.length - fwdWon}${pending ? ` (${pending} pending)` : ''}`);
      if (season && season.n) txtLines.push(`SEASON: ${season.acc}%`);
      txtLines.push('');
    }

    if (slam && slamDays != null) {
      blocks.push(section(`
        ${kicker('Next up')}
        ${h2(slamDays === 0 ? `The ${slam.label} starts today` : `${plural(slamDays, 'day', 'days')} to the ${slam.label}`)}
        ${p(`On ${esc(slam.surface)}. The projected field re-prices with every refresh until the real draw drops.`)}
        <div style="padding-top:4px;">${button(`${SITE}/draw`, 'See the projected draw')}</div>
      `));
      txtLines.push(`NEXT UP: ${slamDays === 0 ? `the ${slam.label} starts today` : `${slamDays} days to the ${slam.label}`}`, '');
    }
  }

  if (!blocks.length) {
    console.log(`[${MODE}] Nothing worth mailing today; wrote no files and skipped send.`);
    return;
  }

  const editionLabel = isWeekly ? 'Weekly' : 'Daily';
  const stem = isWeekly ? 'digest' : 'digest-daily';

  const txt = [
    ...txtLines,
    `${ctaText}: ${ctaHref}`,
    '',
    'Not betting advice. The season number is a benchmark; only the forward test rows were locked before play.',
    '%%UNSUB_TXT%%',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};font-family:${FONT};">
    <tr><td align="center" style="padding:28px 12px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${CARD};border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:26px 28px 22px;background:${INK};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1px;">
                  SMASH<span style="color:${LIME};">.</span>
                </td>
                <td align="right" style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${LIME};">${esc(editionLabel)}</td>
              </tr>
            </table>
            <div style="font-size:13px;color:#aab2bf;padding-top:8px;">${esc(prettyDate)} &nbsp;&middot;&nbsp; every call locked before play, graded in public</div>
          </td>
        </tr>
        ${blocks.join('')}
        <tr>
          <td align="center" style="padding:28px;border-top:1px solid ${LINE};">
            ${button(ctaHref, ctaText)}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 26px;background:#f7f9fb;border-top:1px solid ${LINE};font-size:12px;line-height:1.7;color:${MUTED};">
            You are getting this because you asked for the Smash digest.
            Not betting advice: the season number is a benchmark (today's engines replayed
            over the season), and only the forward test rows were locked before play.
            <br /><a href="${SITE}" style="color:${MUTED};">${esc(SITE.replace(/^https?:\/\//, ''))}</a>
            &nbsp;&middot;&nbsp; %%UNSUB_HTML%%
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

  const FALLBACK_TXT = `Unsubscribe by replying "stop". ${SITE}`;
  const FALLBACK_HTML = 'Reply "stop" to unsubscribe.';
  const fillUnsub = (s, unsubUrl) => s
    .replace(/%%UNSUB_TXT%%/g, unsubUrl ? `Unsubscribe: ${unsubUrl}` : FALLBACK_TXT)
    .replace(/%%UNSUB_HTML%%/g, unsubUrl
      ? `<a href="${unsubUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>`
      : FALLBACK_HTML);

  fs.writeFileSync(path.join(DATA, `${stem}.txt`), `${fillUnsub(txt, null)}\n`);
  fs.writeFileSync(path.join(DATA, `${stem}.html`), fillUnsub(html, null));
  console.log(`[${MODE}] Wrote public/data/${stem}.html and ${stem}.txt (${blocks.length} sections).`);

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
