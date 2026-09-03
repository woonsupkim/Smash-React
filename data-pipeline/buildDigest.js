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
const Papa = require('papaparse');
const { rowNoCall, ledgerNoCall } = require('./lib/noCall');
// Every day boundary in this file is the VENUE's, not UTC's. A night
// session finishing at 11pm is stamped past midnight UTC, so UTC buckets
// filed it under the next day: the scorecard headline (venue days, via
// recapDay) and the match list below it (UTC days) then described two
// different sets, and the Sep 2 email listed Aug 31's matches under a
// Sep 1 heading.
const { eventDay, todayEvent, fmtEventDate } = require('./lib/eventDay');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'data');
const PHOTO_SRC = { atp: path.join(ROOT, 'src', 'assets', 'players'), wta: path.join(ROOT, 'src', 'assets', 'players-women') };
const PHOTO_OUT = path.join(DATA, 'digest', 'players');

const SITE = (process.env.SITE_URL || 'https://smash-react.vercel.app').replace(/\/$/, '');
// The Instagram handle, in the footer rather than in the body: these go to
// people who already subscribed, so the email owes them the day's calls
// first and a second ask last. Mirrors src/components/FollowCta.js.
const INSTAGRAM_URL = 'https://www.instagram.com/smash.tennis.simulator/';

// The email wears the product's own skin. It used to be a light grey page
// with a white 14px-rounded card, system UI type and pastel callouts, which
// is the house style of every SaaS transactional template - and looked
// nothing like the site it reports on.
//
// The fix was mostly NOT the background colour: it was the 14px radii, the
// system font, the pastel fills, the pill buttons and the circular avatars.
// Those are all palette-independent, so the editorial treatment holds in
// either theme and DIGEST_THEME picks the surface.
//
// Default is LIGHT. Dark reads beautifully in a browser, but mail is the one
// place you cannot control the surface: clients force light mode, quote the
// message on a white background when it is replied to or forwarded, and print
// it white. Light is the safer default; dark is one env var away.
//
// Sharp corners are the more faithful choice either way - Outlook's Word
// engine drops border-radius entirely, so a 14px card was already square for
// a large slice of readers while looking soft for everyone else.
const THEME = (process.env.DIGEST_THEME || 'light').toLowerCase() === 'dark' ? 'dark' : 'light';

const THEMES = {
  dark: {
    PAGE: '#0b0d10', CARD: '#111418', PANEL: '#181c22',
    INK: '#ffffff', BODY: '#c3c9d2', MUTED: '#8b93a0',
    LINE: '#262c34', LINE_HI: '#39414d', TRACK: '#22272e',
    // The lime is legible as text on near-black, so it can mark sections.
    ACCENT_TEXT: '#c6ff1c',
    WIN: '#7ddc4e', LOSS: '#ff6b5e',
  },
  light: {
    PAGE: '#f1f2f4', CARD: '#ffffff', PANEL: '#f7f8fa',
    // #6d7480 was 4.43:1 on the panel surface, just under AA. Captions sit on
    // panels as often as on the card, so the darker grey is the one that has
    // to pass: 4.75 on panel, 5.05 on card.
    INK: '#0b0d10', BODY: '#3d444f', MUTED: '#696f7b',
    LINE: '#e4e7ec', LINE_HI: '#c8ced7', TRACK: '#e9edf2',
    // The lime is ~1.4:1 on white, so it cannot carry text here. It stays a
    // FILL (rules, bars, buttons) and a deep green does the talking.
    ACCENT_TEXT: '#1f7a3d',
    WIN: '#157f4c', LOSS: '#c0392b',
  },
};
const T = THEMES[THEME];
const PAGE = T.PAGE, CARD = T.CARD, PANEL = T.PANEL;
const INK = T.INK, BODY = T.BODY, MUTED = T.MUTED;
const LINE = T.LINE, LINE_HI = T.LINE_HI, TRACK = T.TRACK;
const WIN = T.WIN, LOSS = T.LOSS;
// Brand lime. Always safe as a FILL behind dark text; only safe AS text on
// the dark theme, which is what ACCENT_TEXT exists to keep straight.
const LIME = '#c6ff1c';
const ACCENT_TEXT = T.ACCENT_TEXT;
const BTN = LIME;
const BTN_INK = '#0b0d10';
const LINK = ACCENT_TEXT;

// Two stacks. Headlines go condensed to echo Barlow Condensed from the app -
// Arial Narrow ships on Windows and macOS, and the fallbacks degrade to a
// normal-width bold rather than to something wrong. Body stays a plain UI
// sans, which is what actually renders reliably at small sizes in mail.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue Condensed', 'Liberation Sans Narrow', Arial, sans-serif";
// Stat figures. Tabular so columns of numbers line up down the page.
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

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
// Same vig-stripping the Risk Lab uses, so the two never disagree.
function marketProb(p) {
  if (!(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) return null;
  const q1 = 1 / p.lockOdd1, q2 = 1 / p.lockOdd2;
  return (p.favorite === p.p1 ? q1 : q2) / (q1 + q2);
}

// ── Staking maths: the app's own module, via the shared settlement lib ─────
// This block used to carry hand-copied staking formulas, then a local copy of
// the plan settlement. Both now live in one place - lib/planSettle.js wraps
// src/utils/staking.mjs - so the digest and the share-asset generator settle
// plans with the same code the site runs. `staking` is bound at the top of
// main() via planSettle.ready().
const planSettle = require('./lib/planSettle');
const { ledgerGraded, PLAN_BUDGET } = planSettle;
const planReturns = (preds, dayISO) => planSettle.planReturns(preds, dayISO);
let staking = null;

// Tournament crests for the countdown. Same on-demand mirror as the headshots.
const SLAM_LOGOS = {
  'US Open': 'logo_us.png',
  Wimbledon: 'logo_wb.png',
  'French Open': 'logo_rg.png',
};
function mirrorLogo(slamLabel) {
  const file = SLAM_LOGOS[slamLabel];
  if (!file) return null; // no crest bundled for the Australian Open
  const src = path.join(ROOT, 'src', 'assets', file);
  if (!fs.existsSync(src)) return null;
  const dest = path.join(DATA, 'digest', file);
  try {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.join(DATA, 'digest'), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return `${SITE}/data/digest/${file}`;
  } catch { return null; }
}

// ── Email primitives ────────────────────────────────────────────────────────
// Flat bar, square ends. The rounded caps read as a progress widget; a
// scoreboard wants a plain measure.
function bar(percent, color = LIME, height = 6) {
  const w = Math.max(0, Math.min(100, Math.round(percent)));
  const cell = `height:${height}px;font-size:0;line-height:0;mso-line-height-rule:exactly;`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
    <tr>
      ${w > 0 ? `<td width="${w}%" style="${cell}background:${color};">&nbsp;</td>` : ''}
      ${w < 100 ? `<td style="${cell}background:${TRACK};">&nbsp;</td>` : ''}
    </tr>
  </table>`;
}

// Lime block, near-square. The brand colour does the work instead of hiding
// inside a dark chip.
const button = (href, label) =>
  `<a href="${href}" style="display:inline-block;background:${BTN};color:${BTN_INK};font-family:${DISPLAY};font-size:16px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;text-decoration:none;padding:13px 26px;border-radius:2px;">${esc(label)}</a>`;

const textLink = (href, label) =>
  `<a href="${href}" style="color:${LINK};text-decoration:none;font-weight:600;border-bottom:1px solid ${LINE_HI};">${esc(label)}</a>`;

// Section wrapper. The hairline above each one is the only separator, which
// is what gives the page its column-of-a-sports-desk rhythm.
const section = (inner) =>
  `<tr><td style="padding:24px 28px 26px;border-top:1px solid ${LINE};">${inner}</td></tr>`;

// Condensed, uppercase, tight. This is the scoreboard headline.
const h2 = (text) =>
  `<h2 style="margin:0 0 12px;font-family:${DISPLAY};font-size:30px;line-height:1.05;font-weight:700;letter-spacing:0.2px;text-transform:uppercase;color:${INK};">${esc(text)}</h2>`;

const p = (html, extra = '') =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BODY};${extra}">${html}</p>`;

// Kicker with a rule running off to the right, the standard editorial device
// for a section marker.
const kicker = (text) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-bottom:8px;">
    <tr>
      <td style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${ACCENT_TEXT};font-weight:700;white-space:nowrap;padding:0 10px 8px 0;">${esc(text)}</td>
      <td style="width:100%;padding:0 0 12px;"><div style="height:1px;background:${LINE_HI};font-size:0;line-height:0;">&nbsp;</div></td>
    </tr>
  </table>`;

// A number that should read as data: condensed, tabular, oversized.
const stat = (value, label, color = INK) =>
  `<div style="font-family:${MONO};font-size:34px;line-height:1;font-weight:700;color:${color};letter-spacing:-1px;">${esc(value)}</div>
   <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};font-weight:700;padding-top:7px;">${esc(label)}</div>`;

// ── Content builders ────────────────────────────────────────────────────────

// One upcoming match: two headshots, the call, a probability bar, a line of
// read on the market, and the three ways into the app.
// Today's card, grouped. A flat list forces the reader to re-read the event
// and tour on every row; grouping states it once and lets the matches read as
// an order of play. Events are ordered by their first match, ATP before WTA
// inside an event, and matches by start time within that.
// ── The hero match ──────────────────────────────────────────────────────────
// One match gets the full treatment and the rest go in a list, because a page
// of five equal cards has no focal point and reads as a fixture list.
//
// "Biggest" is three things at once, so it is scored rather than guessed:
// how often these two have met (a rivalry), how much of the title race they
// represent (stature), and how close we think it is (a blowout is nobody's
// most anticipated match). Each is normalised to 0-1 so the weights mean
// something, and the winner also reports WHY it won, which is the honest way
// to present a ranked choice.
const h2hKey = (a, b) => [a, b].sort().join('_');

function h2hFor(h2hDoc, tour, p1, p2) {
  const book = (h2hDoc && h2hDoc[tour === 'wta' ? 'wta' : 'atp']) || {};
  const rec = book[h2hKey(p1, p2)];
  if (!rec) return null;
  const firstIsP1 = [p1, p2].sort()[0] === p1;
  return {
    wins1: firstIsP1 ? rec.winsA : rec.winsB,
    wins2: firstIsP1 ? rec.winsB : rec.winsA,
    form1: firstIsP1 ? rec.recentFormA : rec.recentFormB,
    form2: firstIsP1 ? rec.recentFormB : rec.recentFormA,
    meetings: (rec.winsA || 0) + (rec.winsB || 0),
  };
}

// How WE have done calling this exact pairing, from the graded record. Thin
// by nature (two players meet a handful of times a season), so it is only
// shown when it exists and is never dressed up as a trend.
function pairRecord(track, p1, p2) {
  const rows = ((track && track.matches) || []).filter((m) => {
    const c = m.pickCorrect != null ? m.pickCorrect : m.smashCorrect;
    return c != null && h2hKey(m.p1, m.p2) === h2hKey(p1, p2);
  });
  if (!rows.length) return null;
  const w = rows.filter((m) => (m.pickCorrect != null ? m.pickCorrect : m.smashCorrect)).length;
  return { w, l: rows.length - w, n: rows.length };
}

function titleProb(oddsDoc, tour, id) {
  const ev = oddsDoc && oddsDoc.events && oddsDoc.events[tour];
  if (!ev || !Array.isArray(ev.odds)) return 0;
  const hit = ev.odds.find((x) => x.id === id);
  return hit ? (hit.prob || 0) : 0;
}

// funded: Set of prediction ids the recommended plan actually stakes. The
// email features one match and then stakes one match, and when those were
// chosen independently they were usually different matches - the reader was
// shown a tale of the tape for a match the money section never mentioned.
// Preferring a funded match makes the two agree without distorting either:
// the plan is still the optimiser's, the hero is still the best story among
// the matches it backs.
function pickHero(card, h2hDoc, oddsDoc, funded = null) {
  let best = null;
  for (const pr of card) {
    const h = h2hFor(h2hDoc, pr.tour, pr.p1, pr.p2);
    const meetings = h ? h.meetings : 0;
    const stature = titleProb(oddsDoc, pr.tour, pr.p1) + titleProb(oddsDoc, pr.tour, pr.p2);
    const rivalry = Math.min(meetings, 10) / 10;
    const star = Math.min(stature, 0.6) / 0.6;
    const close = 1 - Math.min(1, Math.abs((pr.favProb || 0.5) - 0.5) * 2);
    // ATP breaks a tie, and only a tie. The weight is smaller than the
    // smallest gap the three real signals can produce, so a genuine rivalry
    // or a title-favourite matchup on the WTA side still wins outright -
    // this only decides the days where nothing stands out.
    const atpNudge = (pr.tour || 'atp') !== 'wta' ? 0.02 : 0;
    // Being on the plan outranks all of it: see the note on `funded`.
    const onPlan = funded && funded.has(pr.id) ? 1 : 0;
    const score = onPlan + 0.40 * rivalry + 0.35 * star + 0.25 * close + atpNudge;
    // Why it won, in the reader's terms rather than as a score.
    const why = meetings >= 5 ? `their ${meetings + 1}${[, 'st', 'nd', 'rd'][((meetings + 1) % 100 - (meetings + 1) % 10 !== 10) && (meetings + 1) % 10] || 'th'} meeting`
      : star > 0.5 ? 'two of the title favourites'
        : close > 0.8 ? 'the closest call on the card'
          : 'the pick of the day';
    if (!best || score > best.score) {
      best = { pr, score, h, why, meetings, photo1: mirrorPhoto(pr.tour, pr.p1), photo2: mirrorPhoto(pr.tour, pr.p2) };
    }
  }
  return best;
}

// Tale of the tape: the two of them, compared row by row. Same vocabulary the
// share cards use (recent form, career head to head) plus the two numbers this
// email trades in - our call and the market's.
function taleOfTheTape(hero, mkt, ranks, pairRec) {
  const pr = hero.pr;
  const favIsP1 = pr.favorite === pr.p1;
  const our1 = Math.round((favIsP1 ? pr.favProb : 1 - pr.favProb) * 100);
  const mkt1 = mkt == null ? null : Math.round((favIsP1 ? mkt : 1 - mkt) * 100);
  const h = hero.h;
  const rank1 = ranks.get(pr.p1);
  const rank2 = ranks.get(pr.p2);

  // Name block: given name small above the surname, which is how a tale of
  // the tape has always been set and stops long names wrapping badly.
  const nameBlock = (full, rank, align) => {
    const parts = String(full || '').trim().split(/\s+/);
    const last = parts.length > 1 ? parts.slice(-1)[0] : full;
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
    return `
      <div style="font-size:12px;letter-spacing:0.6px;color:${MUTED};text-align:${align};padding-top:10px;">${esc(first)}</div>
      <div style="font-family:${DISPLAY};font-size:26px;font-weight:700;line-height:1.05;text-transform:uppercase;color:${INK};text-align:${align};">${esc(last)}</div>
      <div style="font-family:${MONO};font-size:11px;letter-spacing:1px;color:${MUTED};text-align:${align};padding-top:5px;">${rank ? `WORLD #${rank}` : 'UNRANKED'}</div>`;
  };

  const face = (url, alt, isFav) => (url
    ? `<img src="${url}" width="84" height="84" alt="${esc(alt)}" style="display:block;width:84px;height:84px;border-radius:2px;border:2px solid ${isFav ? LIME : LINE_HI};" />`
    : `<div style="width:84px;height:84px;border-radius:2px;background:${TRACK};"></div>`);

  // Each row is a duel: the stronger side is inked, the other muted, so the
  // card can be read down the middle without reading the numbers.
  const row = (label, a, b, strongSide) => `
    <tr>
      <td width="34%" align="left" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${MONO};font-size:16px;font-weight:700;color:${strongSide === 1 ? INK : MUTED};">${esc(a)}</td>
      <td width="32%" align="center" style="padding:10px 6px;border-top:1px solid ${LINE};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${MUTED};font-weight:700;">${esc(label)}</td>
      <td width="34%" align="right" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${MONO};font-size:16px;font-weight:700;color:${strongSide === 2 ? INK : MUTED};">${esc(b)}</td>
    </tr>`;

  return `
  <div style="border:1px solid ${LINE_HI};border-top:3px solid ${LIME};background:${PANEL};margin-bottom:18px;">
    <div style="padding:12px 20px;border-bottom:1px solid ${LINE};">
      <span style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${ACCENT_TEXT};font-weight:700;">Tale of the tape</span>
      <span style="font-size:11px;color:${MUTED};"> &nbsp;&middot;&nbsp; ${esc(hero.why)}</span>
    </div>
    <div style="padding:18px 20px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td width="40%" align="left" style="vertical-align:top;">
            ${face(hero.photo1, pr.name1, favIsP1)}
            ${nameBlock(pr.name1, rank1, 'left')}
          </td>
          <td width="20%" align="center" style="vertical-align:middle;font-family:${DISPLAY};font-size:20px;letter-spacing:2px;text-transform:uppercase;color:${MUTED};font-weight:700;">v</td>
          <td width="40%" align="right" style="vertical-align:top;">
            ${face(hero.photo2, pr.name2, !favIsP1)}
            ${nameBlock(pr.name2, rank2, 'right')}
          </td>
        </tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px;">
        ${row('Our call', `${our1}%`, `${100 - our1}%`, our1 >= 50 ? 1 : 2)}
        ${mkt1 != null ? row('The market', `${mkt1}%`, `${100 - mkt1}%`, mkt1 >= 50 ? 1 : 2) : ''}
        ${h ? row('Career h2h', String(h.wins1), String(h.wins2), h.wins1 === h.wins2 ? 0 : (h.wins1 > h.wins2 ? 1 : 2)) : ''}
        ${h && h.form1 && h.form2 ? row('Last 10', h.form1, h.form2, 0) : ''}
      </table>
      ${pairRec ? `<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${LINE};font-size:12px;line-height:1.6;color:${MUTED};">
        Our record calling this pairing: <strong style="color:${INK};">${pairRec.w}-${pairRec.l}</strong> from ${plural(pairRec.n, 'meeting', 'meetings')} we have graded${pairRec.n < 3 ? ', which is far too few to mean anything yet' : ''}.
      </div>` : ''}
    </div>
  </div>`;
}

// A label for the shape of a call, so the list can be scanned. Only one is
// shown, in priority order, because two tags on a row is noise.
//
// "Upset call" is the one that earns its place: it fires when we back the side
// the MARKET prices as the outsider, which is the only situation where our
// number is doing something a fixture list could not.
function matchLabel(pr, ranks) {
  const favIsP1 = pr.favorite === pr.p1;
  const ourOdds = Number(favIsP1 ? pr.lockOdd1 : pr.lockOdd2);
  const theirOdds = Number(favIsP1 ? pr.lockOdd2 : pr.lockOdd1);
  const mkt = marketProb(pr);
  const ourRank = ranks && ranks.get(favIsP1 ? pr.p1 : pr.p2);
  const theirRank = ranks && ranks.get(favIsP1 ? pr.p2 : pr.p1);

  // Backing the underdog, by either measure. The price is the better signal
  // when we have one; ranking still catches it when we do not, which matters
  // because a good share of the card goes unpriced at lock time.
  const priceUpset = ourOdds > 1 && theirOdds > 1 && ourOdds > theirOdds;
  const rankUpset = ourRank && theirRank && ourRank > theirRank + 10;
  if (priceUpset || rankUpset) return { text: 'Upset call', tone: 'up' };

  if (mkt != null && (pr.favProb - mkt) >= 0.10) return { text: 'Value', tone: 'good' };
  // The mirror image, and worth saying out loud: they are keener than we are.
  if (mkt != null && (mkt - pr.favProb) >= 0.10) return { text: 'Market disagrees', tone: 'mute' };
  if ((pr.favProb || 0) <= 0.56) return { text: 'Coin toss', tone: 'mute' };
  if ((pr.favProb || 0) >= 0.85) return { text: 'Heavy favourite', tone: 'mute' };
  if (mkt == null) return { text: 'No price', tone: 'mute' };
  return null;
}

const labelChip = (l) => {
  if (!l) return '';
  const bg = l.tone === 'up' ? LIME : l.tone === 'good' ? WIN : TRACK;
  const fg = l.tone === 'up' ? BTN_INK : l.tone === 'good' ? CARD : MUTED;
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:9px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:3px 7px;border-radius:2px;white-space:nowrap;">${esc(l.text)}</span>`;
};

// Everything that is not the hero: a small card with both faces, full names
// and the price you would actually be offered.
function compactRow(pr, ranks) {
  const favIsP1 = pr.favorite === pr.p1;
  const favName = pr.favName || (favIsP1 ? pr.name1 : pr.name2);
  const dogName = favIsP1 ? pr.name2 : pr.name1;
  const favPhoto = mirrorPhoto(pr.tour, favIsP1 ? pr.p1 : pr.p2);
  const ourOdds = Number(favIsP1 ? pr.lockOdd1 : pr.lockOdd2);
  const when = new Date(pr.date);
  const time = Number.isFinite(when.getTime()) && when.getUTCHours() >= 5
    ? `${when.toISOString().slice(11, 16)} UTC` : 'Time TBC';
  const label = matchLabel(pr, ranks);
  return `
  <tr>
    <td style="padding:0 0 10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};background:${CARD};">
        <tr>
          <td width="52" style="padding:11px 0 11px 12px;vertical-align:middle;">
            ${favPhoto
    ? `<img src="${favPhoto}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:2px;border:2px solid ${LIME};" />`
    : `<div style="width:40px;height:40px;border-radius:2px;background:${TRACK};"></div>`}
          </td>
          <td style="padding:11px 10px;vertical-align:middle;font-size:14px;line-height:1.45;color:${BODY};">
            <a href="${matchUrl(pr)}" style="color:${INK};text-decoration:none;font-weight:700;">${esc(favName)}</a>
            <span style="color:${MUTED};"> over ${esc(dogName)}</span>
            <div style="padding-top:3px;font-size:11px;color:${MUTED};">
              ${esc(time)}${label ? ' &nbsp;' : ''}${labelChip(label)}
            </div>
          </td>
          <td align="right" style="padding:11px 12px 11px 8px;vertical-align:middle;white-space:nowrap;">
            <div style="font-family:${MONO};font-size:17px;font-weight:700;color:${INK};">${Math.round((pr.favProb || 0) * 100)}%</div>
            <div style="font-family:${MONO};font-size:11px;color:${MUTED};padding-top:2px;">${ourOdds > 1 ? `@ ${ourOdds.toFixed(2)}` : 'no price'}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function groupCard(rows) {
  const groups = new Map();
  for (const pr of rows) {
    const key = `${pr.event || 'Other'}|${pr.tour || 'atp'}`;
    if (!groups.has(key)) {
      groups.set(key, { event: pr.event || 'Other', tour: pr.tour || 'atp', surface: pr.surface, rows: [] });
    }
    groups.get(key).rows.push(pr);
  }
  const at = (g) => Math.min(...g.rows.map((r) => new Date(r.date).getTime() || Infinity));
  const out = [...groups.values()];
  for (const g of out) g.rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  // ATP first, then WTA, then by event and start. Ordering groups by whichever
  // happened to be scheduled earliest made the running order flip day to day,
  // so a reader could not learn where to look.
  const tourRank = (t) => ((t || 'atp') === 'wta' ? 1 : 0);
  return out.sort((a, b) => tourRank(a.tour) - tourRank(b.tour)
    || a.event.localeCompare(b.event) || (at(a) - at(b)));
}

// Tour badge: a filled block, because a coloured word is not enough of a
// signal when the two tours sit one above the other.
const tourBadge = (tour) =>
  `<span style="display:inline-block;background:${tour === 'wta' ? INK : LIME};color:${tour === 'wta' ? CARD : BTN_INK};font-family:${DISPLAY};font-size:13px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;padding:3px 8px;border-radius:2px;">${tour === 'wta' ? 'WTA' : 'ATP'}</span>`;

const groupHead = (g) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;padding-bottom:6px;">
    <tr>
      <td width="52" style="padding:0 10px 10px 0;vertical-align:middle;">${tourBadge(g.tour)}</td>
      <td style="padding:0 0 10px;vertical-align:middle;font-family:${DISPLAY};font-size:22px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${INK};">
        ${esc(g.event)}<span style="color:${MUTED};font-size:15px;letter-spacing:1.4px;"> &nbsp;${esc(g.surface || '')}</span>
      </td>
    </tr>
  </table>`;

// The read: what the market thinks, versus us. This is the line that makes a
// match worth reading about rather than a fixture to note down. Extracted from
// the old matchCard, which the hero and the compact list between them replaced.
function matchRead(pr, upset) {
  const favIsP1 = pr.favorite === pr.p1;
  const favName = pr.favName || (favIsP1 ? pr.name1 : pr.name2);
  const prob = Math.round((pr.favProb || 0) * 100);
  const mkt = marketProb(pr);
  let read;
  if (upset) {
    read = `Upset watch: ${esc(upset.reason)}`;
  } else if (mkt != null) {
    const gap = Math.round((pr.favProb - mkt) * 100);
    if (gap >= 10) {
      read = `We have ${esc(lastName(favName))} ${gap} points clear of where the bookmakers do. That gap has been our best zone: 55% winners against a market that gave those calls 44%.`;
    } else if (gap <= -8) {
      read = `The market likes ${esc(lastName(favName))} rather more than we do, at ${Math.round(mkt * 100)}%. Same side, less swagger.`;
    } else if (prob <= 56) {
      read = `About as close to a coin toss as tennis gets. ${prob}% is the honest number, not a headline.`;
    } else {
      read = `The book lands within a couple of points at ${Math.round(mkt * 100)}%. No argument here, just a favourite.`;
    }
  } else {
    read = prob >= 70
      ? `A clear favourite on our numbers, and nobody quoted a price when we locked it. Take it up with the bookmakers.`
      : `Tight on our numbers and unpriced at lock time, so there is no market to argue with. Just the maths.`;
  }
  return read;
}


// A graded result, with the face of whoever we backed.
// Which side the bookmakers made favourite, from the prices we stamped before
// play, and whether it won. Null when the match carried no price.
function marketVerdict(m) {
  const o1 = Number(m.lockOdd1 ?? m.od1), o2 = Number(m.lockOdd2 ?? m.od2);
  if (!(o1 > 1) || !(o2 > 1) || o1 === o2) return null;
  const favId = o1 < o2 ? m.p1 : m.p2;           // shorter price = their favourite
  const favName = o1 < o2 ? m.name1 : m.name2;
  return { favId, favName, right: favId === m.winner, agreed: favId === pickFavorite(m) };
}

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
  const mv = marketVerdict(m);
  // The interesting column. Agreeing with the market and both being right
  // proves nothing; the rows worth reading are the ones where we split.
  // "Market agreed" / "Market split" read two wrong ways at once: agreed with
  // WHAT, and split between whom? The column only ever answers one question -
  // who the bookmakers made favourite, and whether that player won - so it
  // now just says that. Whether they were with us or against us is visible
  // from the name itself, without a word of jargon.
  // "Bookies' pick / Swiatek lost" left the only question unanswered. When
  // the bookmakers backed the same player we did, that cell repeated a name
  // already in the row and never said it was a repeat, so a reader could not
  // tell whether the market had been wrong alongside us or right against us -
  // which is the entire reason the column exists. Say the relationship first,
  // then the name, then the outcome.
  const marketCell = mv
    ? `<div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;white-space:nowrap;">
         ${mv.agreed ? 'Bookies agreed' : 'Bookies disagreed'}
       </div>
       <div style="font-size:13px;line-height:1.5;color:${mv.right ? WIN : LOSS};font-weight:700;padding-top:3px;white-space:nowrap;">
         ${mv.agreed
    ? `${esc(lastName(mv.favName))} too`
    : `they had ${esc(lastName(mv.favName))}`}
       </div>
       <div style="font-size:11px;line-height:1.5;color:${MUTED};font-weight:400;white-space:nowrap;">
         ${mv.agreed
    ? (mv.right ? 'both of us right' : 'both of us wrong')
    : (mv.right ? 'they were right, we were not' : 'we were right, they were not')}
       </div>`
    : `<div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;">No price</div>`;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-bottom:1px solid ${LINE};">
    <tr>
      <td width="40" style="padding:12px 12px 12px 0;">
        ${photo
    ? `<img src="${photo}" width="36" height="36" alt="" style="display:block;width:36px;height:36px;border-radius:2px;border:2px solid ${hit ? WIN : LOSS};" />`
    : `<div style="width:36px;height:36px;border-radius:2px;background:${TRACK};"></div>`}
      </td>
      <td style="padding:12px 0;font-size:14px;line-height:1.5;color:${BODY};">
        <strong style="color:${INK};">${esc(lastName(ourPick))}</strong> over ${esc(lastName(other))} at ${prob}%
        <div style="color:${hit ? WIN : LOSS};font-weight:700;padding-top:2px;">
          ${hit ? 'Landed' : `Missed, ${esc(lastName(winner))} won`}${m.score ? `<span style="color:${MUTED};font-weight:400;"> &nbsp;${esc(m.score)}</span>` : ''}
        </div>
      </td>
      <td align="right" valign="top" style="padding:12px 0 12px 14px;">${marketCell}</td>
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
    const from = process.env.DIGEST_FROM || 'smash@updates.local';
    // Resend's shared sandbox sender. It works, which is the trap: mail to
    // the Resend account's OWN address is delivered normally and everything
    // looks healthy, while every other recipient is rejected 403 with
    // "You can only send testing emails to your own email address". Each
    // rejection is caught per-recipient below, so the run stays green and
    // the owner keeps receiving a digest nobody else gets.
    const sandbox = /@resend\.dev/i.test(from);
    if (sandbox) {
      console.warn(
        `  ! DIGEST_FROM is Resend's sandbox sender (${from}). It can ONLY deliver to`
        + '\n    the address that owns the Resend account - every other subscriber is'
        + '\n    rejected with a 403. Verify a domain in Resend and set DIGEST_FROM to'
        + '\n    an address on it, or configure GMAIL_USER + GMAIL_APP_PASSWORD instead.'
      );
    }
    return {
      label: `Resend API${sandbox ? ' (SANDBOX SENDER)' : ''}`,
      sandbox,
      from,
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



// Which Supabase key is this, and can it read the table?
//
// Supabase has two key systems in play. The legacy pair are JWTs carrying a
// `role` claim (anon / service_role); the current pair are opaque strings
// distinguished by prefix (sb_publishable_* / sb_secret_*). In BOTH systems
// one key is browser-safe and bound by RLS, and the other bypasses it.
//
// Only the browser-safe one is ever the bug here: digest_subscribers allows
// anon INSERT but no anon SELECT, so a browser key reads the list back EMPTY
// with an HTTP 200 - indistinguishable from having no subscribers.
//
// Nothing secret is inspected. A prefix is a public discriminator by design,
// and a JWT's `role` claim is public too (the signature is the secret part).
// The key itself is never logged. An unrecognised format returns null and
// says nothing rather than guessing.
function supabaseKeyKind(key) {
  const k = String(key || '');
  if (k.startsWith('sb_secret_')) return { label: 'secret key', privileged: true };
  if (k.startsWith('sb_publishable_')) return { label: 'publishable key', privileged: false };
  try {
    const parts = k.split('.');
    if (parts.length !== 3) return { label: null, privileged: null };
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const role = JSON.parse(json).role;
    if (role === 'service_role') return { label: 'legacy service_role key', privileged: true };
    if (typeof role === 'string') return { label: `legacy ${role} key`, privileged: false };
  } catch { /* not a JWT we understand */ }
  return { label: null, privileged: null };
}

// ── Did it actually go out? ────────────────────────────────────────────────
//
// Every skip path in this file logs a warning and returns 0, and the workflow
// step runs with continue-on-error, so a digest that silently stopped mailing
// looked exactly like one that mailed fine: a green run and a committed HTML
// file. The file being written proves the digest was BUILT, never that anyone
// received it.
//
// This writes the outcome where CI can read it, so the run summary can say so
// and a real failure can raise an issue. `deliberate` separates the skips we
// choose (stale data, dry run, nothing to say) from the ones that mean
// something is broken (no transport, no recipients, sends failing).
function recordSendStatus(status) {
  try {
    const dir = path.join(__dirname, 'raw');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'digest-status.json'),
      JSON.stringify({ at: new Date().toISOString(), ...status }, null, 2));
  } catch { /* never let bookkeeping break the run */ }
}

async function main() {
  // The staking module the whole plan machinery below runs on. Resolved once;
  // a failure here should kill the build loudly rather than mail a digest
  // with no money sections.
  staking = await planSettle.ready();
  const scorecard = readJson(path.join(DATA, 'daily_scorecard.json'));
  const track = readJson(path.join(DATA, 'track_record.json'));
  const predsDoc = readJson(path.join(DATA, 'predictions.json'));
  // Head-to-head is stored per tour, the same split the app reads. Loading
  // only the ATP file silently gave every WTA match an empty record, which
  // also skewed the hero pick: no meetings meant no rivalry score.
  // World ranking per player, from the roster the pipeline already maintains.
  // Per tour, like everything else here.
  const rankBook = { atp: new Map(), wta: new Map() };
  for (const [tour, file] of [['atp', path.join(DATA, 'smash_us.csv')], ['wta', path.join(DATA, 'women', 'smash_us.csv')]]) {
    try {
      const rows = Papa.parse(fs.readFileSync(file, 'utf8'), { header: true }).data;
      for (const r of rows) if (r.id && Number(r.us_seed) > 0) rankBook[tour].set(r.id, Number(r.us_seed));
    } catch { /* ranks are a nice-to-have, never a blocker */ }
  }

  const h2hDoc = {
    atp: readJson(path.join(DATA, 'h2h.json')) || {},
    wta: readJson(path.join(DATA, 'women', 'h2h.json')) || {},
  };
  const oddsDoc = readJson(path.join(DATA, 'title_odds.json'));

  if (!scorecard && !track && !predsDoc) {
    console.log('No digest inputs found; nothing to build.');
    return;
  }

  // DIGEST_AS_OF pins "today" to a past date, which is how you rehearse an
  // edition or look at one from a busier week. Everything downstream - the
  // seven-day window, the slam countdown, yesterday - keys off this one value.
  const asOf = process.env.DIGEST_AS_OF;
  const now = asOf ? new Date(`${asOf}T12:00:00Z`) : new Date();
  if (asOf && !Number.isFinite(now.getTime())) throw new Error(`DIGEST_AS_OF is not a date: ${asOf}`);
  if (asOf) console.log(`  (building as of ${now.toISOString().slice(0, 10)})`);
  const MODE = (process.env.DIGEST_MODE || (now.getUTCDay() === 1 ? 'weekly' : 'daily')).toLowerCase();
  const isWeekly = MODE === 'weekly';
  const dateLabel = todayEvent(now);
  const prettyDate = fmtEventDate(now.toISOString(), { weekday: 'long', month: 'long', day: 'numeric' });

  const season = scorecard && scorecard.season ? scorecard.season : null;
  const yday = scorecard && scorecard.yesterday ? scorecard.yesterday : null;
  const upsetById = new Map(((scorecard && scorecard.upsetWatch) || []).map((u) => [u.id, u]));
  const matches = (track && track.matches) || [];
  // Retrospective no-call rule (mirrors src/utils/deployedPick.pickNoCall,
  // pinned by noCall.test.js). `graded` = the CALLS every claim grades;
  // gradedAll keeps the full record for anything that audits the policy.
  const gradedAll = matches.filter((m) => m.date && pickCorrect(m) != null);
  const graded = gradedAll.filter((m) => !rowNoCall(m));
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
      .filter((pr) => pr.status === 'pending' && eventDay(pr.date) >= todayISO)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const todays = upcoming.filter((pr) => eventDay(pr.date) === todayISO);
    // `card` is the staking universe (the builder prices no-calls too);
    // `calls` is what we CLAIM, and the passes get named, not hidden.
    const card = todays.length ? todays : upcoming.slice(0, 6);
    const calls = card.filter((pr) => !ledgerNoCall(pr));
    const passes = card.filter((pr) => ledgerNoCall(pr));
    // Only matches carrying a price make the list. An unpriced row has no
    // market to disagree with and cannot be staked, so it is a claim with
    // nothing to check it against - those stay on the site's full card.
    // Falls back to the unpriced calls only if pricing has not landed at all,
    // so a pre-dawn edition is never empty.
    const priced = calls.filter((pr) => marketProb(pr) != null);
    const shown = (priced.length ? priced : calls).slice(0, 5);
    const events = [...new Set(card.map((pr) => pr.event).filter(Boolean))];
    const splits = card.filter((pr) => {
      const mk = marketProb(pr);
      return mk != null && pr.favProb - mk >= 0.10;
    });

    // Subject line. An inbox gives you about forty characters before it
    // truncates, so this leads with the single most interesting thing on the
    // card rather than summarising all of it, and the preheader carries the
    // rest. Priority: a real rivalry beats a bold call, a bold call beats
    // yesterday's score, and yesterday's score beats a bare count.
    subject = (() => {
      const heroPick = pickHero(card.slice(0, 5), h2hDoc, oddsDoc);
      const n1 = heroPick && lastName(heroPick.pr.name1);
      const n2 = heroPick && lastName(heroPick.pr.name2);
      if (heroPick && heroPick.meetings >= 5) return `${n1} v ${n2}, take ${heroPick.meetings + 1}`;

      const upset = card.find((pr) => {
        const favIsP1 = pr.favorite === pr.p1;
        const a = Number(favIsP1 ? pr.lockOdd1 : pr.lockOdd2);
        const b = Number(favIsP1 ? pr.lockOdd2 : pr.lockOdd1);
        return a > 1 && b > 1 && a > b;
      });
      if (upset) return `We are taking ${lastName(upset.favName || upset.name1)} and we know how that looks`;

      if (yday && yday.n) {
        const yp = pct(yday.correct, yday.n);
        if (yday.correct === yday.n) return `${yday.n} from ${yday.n}. Let us enjoy this one`;
        if (yp < 34) return `${yday.correct} from ${yday.n} yesterday. Moving on`;
        if (yp >= 70) return `${yday.correct} from ${yday.n}, and ${card.length} more locked`;
        return `${yday.correct} from ${yday.n} yesterday, ${card.length} locked today`;
      }
      return `${plural(calls.length, 'call', 'calls')} locked before play`;
    })();
    preheader = card.length
      ? `Every pick below was locked before play. ${events.length ? events.join(' and ') + '. ' : ''}Plus what we would stake, and ${slamDays != null ? `${slamDays} days to the ${slam.label}` : 'the road ahead'}.`
      : 'Yesterday graded, and what comes next.';
    ctaHref = `${SITE}/today`;
    ctaText = "See today's full card";

    txtLines.push(`SMASH DAILY - ${prettyDate}`, '');

    // Lede: set the scene in prose before any numbers.
    const ledeBits = [];
    if (yday && yday.n) {
      const yPct = pct(yday.correct, yday.n);
      ledeBits.push(`${yday.correct} from ${yday.n} yesterday.`);
      ledeBits.push(yday.correct === yday.n
        ? ' A clean sweep, and no, that is not the usual.'
        : yPct >= 70 ? ' We will take that.'
          : yPct >= 50 ? ' Half right, which means half wrong, and both halves are below.'
            : ' Not our finest hour. It is all in the record anyway.');
    }
    // Two ledes, because a card of nothing but coin flips is a real state and
    // "0 more are locked for today at Cincinnati" is not a sentence. The
    // count in the first branch is CALLS, so it has to be non-zero to be
    // spoken; when it is zero the passes are the whole story.
    const whereAt = events.length ? ` at ${events.join(' and ')}` : '';
    if (calls.length) {
      ledeBits.push(` ${plural(calls.length, 'more is', 'more are')} locked for today${whereAt}, every one of them public before a ball is struck${passes.length ? `, plus ${plural(passes.length, 'coin flip', 'coin flips')} we are sitting out` : ''}.`);
    } else if (passes.length) {
      ledeBits.push(` Today${whereAt} we are calling nothing: all ${plural(passes.length, 'match', 'matches')} on the card sit inside our coin-flip band. Sitting out is a position.`);
    }
    if (ledeBits.length) {
      blocks.push(section(p(ledeBits.join('').trim())));
      txtLines.push(ledeBits.join('').trim(), '');
    }

    // Yesterday, graded.
    if (yday && yday.n) {
      const ypct = pct(yday.correct, yday.n);
      // yday.date is already a venue day (recapDay picks it), so the match
      // list has to be bucketed the same way or the two disagree.
      const ydayAll = graded.filter((m) => eventDay(m.date) === eventDay(yday.date));
      const ydayRows = ydayAll.slice(0, 6);

      // How the bookmakers' own favourite did on the same matches. Only the
      // priced ones can be compared, and the sample is a single day, so the
      // count is always stated rather than dressed up as a trend.
      const pricedY = ydayAll.filter((m) => m.oddCorrect != null);
      let vsMarket = '';
      let vsMarketTxt = '';
      if (pricedY.length >= 3) {
        const usY = pct(pricedY.filter((m) => pickCorrect(m)).length, pricedY.length);
        const themY = pct(pricedY.filter((m) => m.oddCorrect).length, pricedY.length);
        const verdict = usY > themY
          ? 'We edged them.'
          : usY === themY ? 'Honours even.' : 'They had our number.';
        vsMarket = `
          <div style="margin-top:18px;padding:16px 18px;border:1px solid ${LINE};background:${PANEL};">
            ${kicker('Meanwhile, at the bookmakers')}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td width="50%" style="padding-right:10px;vertical-align:top;">
                  <div style="font-size:22px;font-weight:800;color:${INK};line-height:1.1;">${usY}%</div>
                  <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:${MUTED};font-weight:700;padding:2px 0 7px;">our pick</div>
                  ${bar(usY, LIME, 8)}
                </td>
                <td width="50%" style="padding-left:10px;vertical-align:top;">
                  <div style="font-size:22px;font-weight:800;color:${MUTED};line-height:1.1;">${themY}%</div>
                  <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:${MUTED};font-weight:700;padding:2px 0 7px;">their favourite</div>
                  ${bar(themY, MUTED, 8)}
                </td>
              </tr>
            </table>
            <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
              ${esc(verdict)} That is across the ${pricedY.length} of yesterday's matches that carried a price. One day is a tiny sample, and we print it whichever way it falls.
            </p>
          </div>`;
        vsMarketTxt = `Meanwhile, at the bookmakers - same ${pricedY.length} priced matches: us ${usY}%, them ${themY}%`;
      }

      // What each recommended plan would have returned, settled individually
      // at the odds stamped before play. All of them, not just the winner:
      // yesterday's email recommended one, but a reader who preferred another
      // deserves to see what their choice did too.
      const settled = planReturns(preds, eventDay(yday.date));
      let planBlock = '';
      let planTxt = '';
      if (settled && settled.plans.length) {
        const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
        const plainMoney = (v) => (Math.abs(v % 1) < 0.005 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
        // RETURN PER DOLLAR, not dollars. Each plan stakes a different amount
        // out of the same budget - the recommendation deliberately stakes the
        // least - so ranking them by profit rewarded whichever one put the
        // most money on the table. A percentage is the only figure that
        // compares them, and it is the same axis the Risk Lab ranks on.
        const roi = (pl) => (pl.staked > 0
          ? `${pl.profit >= 0 ? '+' : '-'}${Math.abs((pl.profit / pl.staked) * 100).toFixed(1)}%`
          : 'no stake');
        const best = settled.plans.reduce((a, b) => {
          const r = (x) => (x.staked > 0 ? x.profit / x.staked : -Infinity);
          return r(b) > r(a) ? b : a;
        });
        const rows = settled.plans.map((pl) => {
          const isRec = pl.id === settled.recommendedId;
          const up = pl.profit >= 0;
          return `
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${BODY};">
              <strong style="color:${INK};">${esc(pl.label)}</strong>${isRec ? ` <span style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${LIME};font-weight:700;">&nbsp;recommended</span>` : ''}
              <span style="display:block;font-size:12px;color:${MUTED};">${pl.hits} of ${pl.n} singles landed${pl.parlay ? `, parlay ${pl.parlay.won ? 'hit' : 'missed'}` : ''}</span>
            </td>
            <td align="right" style="padding:9px 0 9px 14px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:15px;font-weight:700;color:${up ? WIN : LOSS};white-space:nowrap;">
              ${roi(pl)}
              <span style="display:block;font-size:11px;font-weight:600;color:${MUTED};">on ${plainMoney(pl.staked)} staked</span>
            </td>
          </tr>`;
        }).join('');
        planBlock = `
          <div style="margin-top:14px;padding:16px 18px;background:${PANEL};border-left:3px solid ${best.profit >= 0 ? WIN : LOSS};">
            ${kicker('If you had actually followed along')}
            <p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:${BODY};">
              Each plan the builder offered yesterday morning, $${settled.budget} available, settled at the odds we stamped before play. Ranked by return on what each actually staked, since they do not all stake the same amount.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
              One good day proves nothing. Neither does one bad one, which is why you get all of them, every day.
            </p>
          </div>`;
        planTxt = 'If you had actually followed along ($' + settled.budget + ' in): '
          + settled.plans.map((pl) => `${pl.label} ${roi(pl)} (${money(pl.profit)} on ${plainMoney(pl.staked)})${pl.id === settled.recommendedId ? ' [recommended]' : ''}`).join('; ');

      }

      // Running total for the tournament in progress, INDEPENDENT of whether
      // yesterday itself was settleable. A single day is noise in both
      // directions, and a reader who only ever sees one day cannot tell a bad
      // Tuesday from a bad strategy - so during a slam or a 1000 the daily
      // mail carries where the recommendation stands across the whole event,
      // win or lose. Yesterday having only one priced match (which is common
      // at the tail of a draw) must not take the running total down with it.
      {
        const { matchEvent } = require('./lib/events');
        const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
        const plain = (v) => (Math.abs(v % 1) < 0.005 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
        // Named through the registry so the heading reads the same whichever
        // file the event name came from ("Cincinnati Open" vs "Cincinnati"),
        // and chosen by MAJORITY of the rows rather than by taking index 0.
        // A day's card routinely mixes a slam or 1000 with smaller stops the
        // registry does not cover, and reading the first row's event meant a
        // WTA 500 sitting at the top of the list ("Abierto GNP Seguros")
        // resolved to nothing and silently suppressed the whole block.
        const tally = new Map();
        for (const r of [...ydayRows, ...card]) {
          const hit = matchEvent(r.event);
          if (hit) tally.set(hit.label, (tally.get(hit.label) || 0) + 1);
        }
        const liveEvent = tally.size
          ? [...tally.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
          : null;
        const days = liveEvent ? planSettle.eventDays(preds, liveEvent) : [];
        const run = days.length >= 2 ? planSettle.planRun(preds, days) : null;
        if (run && run.days >= 2) {
          const pos = run.profit >= 0;
          const roiPct = `${pos ? '+' : '-'}${Math.abs(run.roi * 100).toFixed(1)}%`;
          planBlock += `
            <div style="margin-top:10px;padding:14px 18px;background:${PANEL};border-left:3px solid ${pos ? WIN : LOSS};">
              ${kicker(`${esc(liveEvent)} so far`)}
              <p style="margin:0;font-size:14px;line-height:1.6;color:${BODY};">
                Following the recommendation every day of this tournament:
                <strong style="color:${pos ? WIN : LOSS};">${money(run.profit)}</strong>
                <span style="color:${MUTED};">(${roiPct} on ${plain(run.staked)} staked, ${run.up} of ${run.days} days up)</span>.
              </p>
              <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">
                Rebuilt each morning from what was known that morning, settled at the prices we stamped before play.
              </p>
            </div>`;
          planTxt += `${planTxt ? ' | ' : ''}${liveEvent.toUpperCase()} SO FAR: ${money(run.profit)} (${roiPct} on $${run.staked.toFixed(2)}, ${run.up}/${run.days} days up)`;
        }
      }

      blocks.push(section(`
        ${kicker('Yesterday, graded')}
        ${h2(`${yday.correct} from ${yday.n}`)}
        ${p(`${ypct}% on the day, all of it public before anyone served. ${yday.worstMiss && yday.worstMiss.call ? `The one that stings: we had <strong style="color:${INK};">${esc(yday.worstMiss.call)}</strong>${yday.worstMiss.winner ? `, and ${esc(yday.worstMiss.winner)} had other ideas` : ''}. It counts exactly as much as the ones we got right.` : ''}`)}
        ${bar(ypct, ypct >= 50 ? WIN : LOSS)}
        ${ydayRows.length ? `<div style="padding-top:16px;">${ydayRows.map(resultRow).join('')}</div>` : ''}
        ${vsMarket}
        ${planBlock}
        <div style="padding-top:16px;">${textLink(`${SITE}/track-record`, 'Every call ever made, graded')}</div>
      `));
      txtLines.push(`YESTERDAY, GRADED: ${yday.correct} from ${yday.n} (${ypct}%)`);
      if (yday.worstMiss && yday.worstMiss.call) txtLines.push(`  The one that stings: ${yday.worstMiss.call}${yday.worstMiss.winner ? ` - ${yday.worstMiss.winner} had other ideas` : ''}`);
      if (vsMarketTxt) txtLines.push(`  ${vsMarketTxt}`);
      if (planTxt) txtLines.push(`  ${planTxt}`);
      txtLines.push('');
    }
    // Staking plan: the ACTUAL recommendation for today's card, not a
    // description of the tool that makes it. Same maths the builder runs,
    // mirrored above and pinned by digestStaking.test.js.
    const rel = staking.reliability(ledgerGraded(preds));
    // Built from CALLS, not from the raw card. `card` still carries the
    // no-calls so the section above can name what we are sitting out - and
    // feeding it to the staking plan quietly put money on them, which is the
    // exact contradiction this policy change removed everywhere else. The
    // mail was recommending stakes on a 57% and a 51% on a day the same mail
    // said "no calls - the whole card is inside our coin-flip band".
    const planBets = calls
      .map((pr) => {
        const favIsP1 = pr.favorite === pr.p1;
        const o = Number(favIsP1 ? pr.lockOdd1 : pr.lockOdd2);
        return { pr, key: pr.id, p: pr.favProb, o: o > 1 ? o : 0 };
      })
      .filter((b) => b.o > 1 && b.p > 0);
    const byKey = new Map(planBets.map((b) => [String(b.key), b]));
    const frontier = planBets.length >= 2
      ? staking.planFrontier(planBets.map(({ key, p, o }) => ({ key: String(key), p, o })), PLAN_BUDGET, { lambda: rel.lambda })
      : { plans: [] };
    const todayPlan = frontier.plans.find((pl) => pl.id === frontier.recommendedId) || frontier.plans[0] || null;

  // The ids the plan actually stakes, so the match this email FEATURES and the
  // match it stakes are the same one wherever possible. Computed here rather
  // than in the money section below because the hero is chosen first.
  const fundedIds = new Set(Object.entries((todayPlan && todayPlan.singles) || {})
    .filter(([, v]) => Number(v) > 0).map(([k]) => k));


    // Today's card. This section is ALWAYS emitted, even with nothing to
    // show. It used to be gated on `shown.length`, so on a day with no
    // locked fixtures - between tournaments, or before the schedule lands -
    // it vanished silently and "The money question" answered a question the
    // reader had not been asked yet. A named empty state costs three lines
    // and keeps the running order the same every morning.
    if (!shown.length) {
      const why = !card.length
        ? 'Nothing is locked in. Either the draw has not been published yet or the tour is between events; new calls appear the moment the schedule lands.'
        : `Every one of ${plural(card.length, 'match', 'matches')} on the card sits inside our coin-flip band, so we are not calling any of them. The leans are on the record and graded, they just are not claims. Passing is a position too.`;
      blocks.push(section(`
        ${kicker('On court today')}
        ${h2(card.length ? 'No calls today' : 'Nothing on the card')}
        ${p(why)}
        <div style="padding-top:4px;">${textLink(`${SITE}/today`, card.length ? 'See the leans anyway' : "See what's next")}</div>
      `));
      txtLines.push('ON COURT TODAY', `  ${card.length ? 'No calls - the whole card is inside our coin-flip band.' : 'Nothing locked in yet.'}`, '');
    }
    if (shown.length) {
      // One match carries the section; the rest are a list under it.
      const hero = pickHero(shown, h2hDoc, oddsDoc, fundedIds);
      const rest = hero ? shown.filter((pr) => pr.id !== hero.pr.id) : shown;
      const heroRead = hero ? matchRead(hero.pr, upsetById.get(hero.pr.id)) : '';

      const intro = splits.length
        ? `We are out of step with the bookmakers on ${plural(splits.length, 'of these', 'of these')} by ten points or more. Those are the ones worth your time. Agreeing with the favourite is not a take.`
        : 'We land more or less where the market does today. No arguments, just conviction.';
      blocks.push(section(`
        ${kicker(todays.length ? 'On court today' : 'Next up')}
        ${h2(`${plural(calls.length, 'call', 'calls')}, no takebacks`)}
        ${p(intro + (passes.length ? ` And ${plural(passes.length, 'match', 'matches')} we are NOT calling: too close to claim, so the lean is on the record and the call column stays empty. Passing is a position too.` : ''))}
        ${hero ? taleOfTheTape(hero, marketProb(hero.pr), rankBook[hero.pr.tour === 'wta' ? 'wta' : 'atp'], pairRecord(track, hero.pr.p1, hero.pr.p2)) : ''}
        ${hero ? p(heroRead, `color:${BODY};`) : ''}
        ${rest.length ? `<div style="padding-top:4px;">${groupCard(rest).map((g) => groupHead(g) + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:16px;">${g.rows.map((pr) => compactRow(pr, rankBook[pr.tour === 'wta' ? 'wta' : 'atp'])).join('')}</table>`).join('')}</div>` : ''}
        ${calls.length > shown.length || passes.length ? p(textLink(`${SITE}/today`, `See the full card${passes.length ? ' including the no-calls' : ''}`)) : ''}
      `));
      txtLines.push(todays.length ? 'ON COURT TODAY' : 'NEXT UP');
      const txtRows = groupCard(shown).flatMap((g) => [{ head: `${g.event} - ${g.tour.toUpperCase()}` }, ...g.rows]);
      for (const item of txtRows) {
        if (item.head) { txtLines.push(`  [ ${item.head} ]`); continue; }
        const pr = item;
        const favIsP1 = pr.favorite === pr.p1;
        txtLines.push(`  ${lastName(pr.favName || (favIsP1 ? pr.name1 : pr.name2))} over ${lastName(favIsP1 ? pr.name2 : pr.name1)} - ${Math.round(pr.favProb * 100)}%`);
        txtLines.push(`    Call: ${matchUrl(pr)}`);
        txtLines.push(`    Compare: ${compareUrl(pr)}`);
        txtLines.push(`    Simulate: ${simUrl(pr)}`);
      }
      txtLines.push('');
    }


    if (todayPlan) {
      // Whole amounts read better without the cents in prose ($100, not
      // $100.00); anything with a fraction keeps them.
      const money2 = (v) => (Math.abs(v % 1) < 0.005 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
      const stakes = Object.entries(todayPlan.singles || {})
        .filter(([, v]) => v > 0.005)
        .map(([key, v]) => ({ b: byKey.get(String(key)), stake: v }))
        .filter((r) => r.b)
        .sort((a, b) => b.stake - a.stake);
      const stakeRows = stakes.map(({ b, stake }) => {
        const pr = b.pr;
        const favIsP1 = pr.favorite === pr.p1;
        const favName = pr.favName || (favIsP1 ? pr.name1 : pr.name2);
        const dogName = favIsP1 ? pr.name2 : pr.name1;
        return `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${BODY};">
            <strong style="color:${INK};">${esc(lastName(favName))}</strong>
            <span style="color:${MUTED};"> over ${esc(lastName(dogName))}</span>
            <span style="color:${MUTED};font-size:12px;"> &nbsp;${esc((pr.tour || '').toUpperCase())}</span>
          </td>
          <td align="right" style="padding:9px 0 9px 8px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:13px;color:${MUTED};white-space:nowrap;">
            ${Math.round(pr.favProb * 100)}% @ ${b.o.toFixed(2)}
          </td>
          <td align="right" style="padding:9px 0 9px 14px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:14px;font-weight:700;color:${INK};white-space:nowrap;">
            ${money2(stake)}
          </td>
        </tr>`;
      }).join('');

      // The parlay leg, when the recommended plan carries one: named legs at
      // the combined price, exactly as the builder would fund it.
      let parlayRow = '';
      if (todayPlan.parlayStake > 0.005 && (todayPlan.parlayLegs || []).length >= 2) {
        const legs = todayPlan.parlayLegs.map((k) => byKey.get(String(k))).filter(Boolean);
        const comboOdds = legs.reduce((m, b) => m * b.o, 1);
        const names = legs.map((b) => {
          const favIsP1 = b.pr.favorite === b.pr.p1;
          return lastName(b.pr.favName || (favIsP1 ? b.pr.name1 : b.pr.name2));
        }).join(' + ');
        parlayRow = `
        <tr>
          <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${BODY};">
            <strong style="color:${INK};">Parlay: ${esc(names)}</strong>
            <span style="display:block;font-size:12px;color:${MUTED};">both must land; pays at the combined price</span>
          </td>
          <td align="right" style="padding:9px 0 9px 8px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:13px;color:${MUTED};white-space:nowrap;">
            @ ${comboOdds.toFixed(2)}
          </td>
          <td align="right" style="padding:9px 0 9px 14px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:14px;font-weight:700;color:${INK};white-space:nowrap;">
            ${money2(todayPlan.parlayStake)}
          </td>
        </tr>`;
      }

      const unpriced = calls.length - planBets.length;
      const others = frontier.plans.filter((pl) => pl.id !== todayPlan.id);
      const menuLine = others.length
        ? ` The builder also offers ${others.map((pl) => `${pl.label.toLowerCase()} (${Math.round((pl.metrics.pProfit || 0) * 100)}% to finish ahead, ${pl.metrics.ev >= 0 ? '+' : '-'}$${Math.abs(pl.metrics.ev).toFixed(2)} expected)`).join(' and ')}; this one leads because nothing on the menu beats it on both chance and expectation.`
        : '';

      // The shape of the day, not just its average. A plan can carry positive
      // EV and still lose on MOST days - that is what a long-priced edge looks
      // like - and a section that reports only the expectation reads as a
      // forecast of profit. analyzeSlip already computes these percentiles for
      // the plan being described; they were simply not being printed.
      const pc = todayPlan.metrics.pcts;
      const skewed = pc && pc.p50 < 0 && todayPlan.metrics.ev > 0;
      const spreadBlock = pc ? `
        <div style="padding-top:14px;">
          ${kicker('What that actually looks like')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="33%" style="padding:0 8px 0 0;vertical-align:top;">
                <div style="font-family:${MONO};font-size:18px;font-weight:700;color:${pc.p05 >= 0 ? WIN : LOSS};">${money2(pc.p05)}</div>
                <div style="font-size:12px;color:${MUTED};padding-top:2px;">a bad day (1 in 20)</div>
              </td>
              <td width="33%" style="padding:0 8px;vertical-align:top;">
                <div style="font-family:${MONO};font-size:18px;font-weight:700;color:${pc.p50 >= 0 ? WIN : LOSS};">${money2(pc.p50)}</div>
                <div style="font-size:12px;color:${MUTED};padding-top:2px;">a typical day</div>
              </td>
              <td width="33%" style="padding:0 0 0 8px;vertical-align:top;">
                <div style="font-family:${MONO};font-size:18px;font-weight:700;color:${WIN};">${money2(pc.p95)}</div>
                <div style="font-size:12px;color:${MUTED};padding-top:2px;">a good day (1 in 20)</div>
              </td>
            </tr>
          </table>
          ${skewed ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:${BODY};">Read those together with the expectation above: the plan is worth ${money2(todayPlan.metrics.ev)} on average and still loses on a typical day. That is not a contradiction, it is what backing long prices looks like - most days give a little back, and the ones that land pay for them. It is also why the size you stake matters more than the pick.</p>` : ''}
        </div>` : '';

      blocks.push(section(`
        ${kicker('The money question')}
        ${h2('What we would actually stake')}
        ${p(`Here is the recommended plan for today, on a hypothetical ${money2(PLAN_BUDGET)}: <strong style="color:${INK};">${esc(todayPlan.label.toLowerCase())}</strong>, funding ${plural(stakes.length, 'match', 'matches')}${parlayRow ? ' plus one small parlay' : ''}.${menuLine}`)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 14px;">
          ${stakeRows}
          ${parlayRow}
          <tr>
            <td style="padding:11px 0 0;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;">Total staked</td>
            <td></td>
            <td align="right" style="padding:11px 0 0 14px;font-family:${MONO};font-size:15px;font-weight:700;color:${INK};">${money2(todayPlan.metrics.staked)}</td>
          </tr>
        </table>
        <div style="padding:14px 16px;background:${PANEL};border-left:3px solid ${LIME};">
          <p style="margin:0;font-size:14px;line-height:1.6;color:${BODY};">
            <strong style="color:${INK};">We expect ${todayPlan.expWinners.toFixed(1)} of those to land, returning ${money2(todayPlan.expReturn)} on the ${money2(todayPlan.metrics.staked)} going out.</strong>
            ${todayPlan.metrics.staked < PLAN_BUDGET - 0.5 ? ` The other ${money2(PLAN_BUDGET - todayPlan.metrics.staked)} stays in your pocket - betting less is part of the recommendation.` : ''}
            ${todayPlan.metrics.pProfit != null ? ` Odds of actually finishing ahead: ${Math.round(todayPlan.metrics.pProfit * 100)}%.` : ''}
            Same numbers you will find on the builder itself, because it is the same arithmetic.
          </p>
        </div>
        ${spreadBlock}
        ${p(`${unpriced > 0 ? `${plural(unpriced, 'call on the card had', 'calls on the card had')} no market price when we locked ${unpriced === 1 ? 'it' : 'them'}, so the plan cannot stake ${unpriced === 1 ? 'it' : 'them'}. ` : ''}Fair warning, the builder is a killjoy. Most days it stakes less than you hoped, and some days it stakes nothing at all. That is the feature.`, 'padding-top:14px;')}
        <div style="padding-top:4px;">${button(`${SITE}/risk`, 'Open the Risk Lab')}</div>
        <div style="padding-top:10px;font-size:14px;color:${MUTED};">
          Build your own slip from today's card and see what it does to your budget
        </div>
      `));
      txtLines.push(`THE MONEY QUESTION - the recommended plan (hypothetical $${PLAN_BUDGET}, ${todayPlan.label.toLowerCase()}):`);
      for (const { b, stake } of stakes) {
        const favIsP1 = b.pr.favorite === b.pr.p1;
        const favName = b.pr.favName || (favIsP1 ? b.pr.name1 : b.pr.name2);
        txtLines.push(`  $${stake.toFixed(2)} on ${lastName(favName)} (${Math.round(b.pr.favProb * 100)}% @ ${b.o.toFixed(2)})`);
      }
      if (todayPlan.parlayStake > 0.005) txtLines.push(`  $${todayPlan.parlayStake.toFixed(2)} on the parlay`);
      txtLines.push(`  Total $${todayPlan.metrics.staked.toFixed(2)}; we expect ${todayPlan.expWinners.toFixed(1)} to land, returning $${todayPlan.expReturn.toFixed(2)}${todayPlan.metrics.pProfit != null ? `; ${Math.round(todayPlan.metrics.pProfit * 100)}% chance of finishing ahead` : ''}`);
      if (todayPlan.metrics.pcts) {
        const q = todayPlan.metrics.pcts;
        txtLines.push(`  Bad day $${q.p05.toFixed(2)} | typical $${q.p50.toFixed(2)} | good day $${q.p95.toFixed(2)}`);
      }
      txtLines.push(`  Build your own slip and size it: ${SITE}/risk`, '');
    } else {
      blocks.push(section(`
        ${kicker('The money question')}
        ${h2('What we would actually stake')}
        ${p(`Nothing, today. ${!card.length
    ? 'There is no card to stake yet - see above.'
    : planBets.length
      ? 'Every price on the card is short enough that even spread across all of them, the expected return does not cover the stake.'
      : calls.length
        ? 'Nothing on the card carried a market price when we locked it, so there is no edge to size against.'
        : 'We are not calling anything on today\'s card, and we do not stake what we will not call.'} Some days that is the answer, and pretending otherwise is how people lose money.`)}
        <div style="padding-top:4px;">${button(`${SITE}/risk`, 'Check it against your own book')}</div>
      `));
      txtLines.push(`THE MONEY QUESTION: nothing worth staking today. ${SITE}/risk`, '');
    }

    // Countdown, with the crest and who the simulation currently likes. The
    // favourites are the promo: a number next to a face is an argument you
    // want to check, where a bare date is just a date.
    if (slam && slamDays != null) {
      const logo = mirrorLogo(slam.label);
      const odds = readJson(path.join(DATA, 'title_odds.json'));
      // A slam in progress is not "coming up". When the draw is live the
      // section names the ROUND being played and shows who is still standing;
      // the countdown only makes sense between events.
      const liveEv = ['atp', 'wta']
        .map((t) => odds && odds.events && odds.events[t])
        .find((e) => e && e.status === 'live' && e.fieldSize > 1);
      const isLive = !!liveEv;
      // fieldSize is how many players remain, so it names the round directly.
      const ROUND = { 128: 'First round', 64: 'Round of 64', 32: 'Round of 32', 16: 'Round of 16', 8: 'Quarter-finals', 4: 'Semi-finals', 2: 'Final' };
      const roundName = isLive ? (ROUND[liveEv.fieldSize] || `Last ${liveEv.fieldSize}`) : null;
      const liveLabel = isLive ? (liveEv.event || slam.label) : null;

      const contenders = [];
      for (const t of ['atp', 'wta']) {
        const ev = odds && odds.events && odds.events[t];
        if (!ev || !Array.isArray(ev.odds)) continue;
        const top = ev.odds.filter((x) => x.id).slice(0, 3);
        // Movement against the previous snapshot, the same figure the site's
        // title-odds board shows. Keyed by NAME because that is what the
        // history stores; a player absent from it is new to the top three and
        // gets no arrow rather than a fabricated one.
        const hist = Array.isArray(ev.history) ? ev.history : [];
        const prevOdds = hist.length >= 2 ? hist[hist.length - 2].odds || {} : {};
        const withMove = top.map((x) => {
          const before = prevOdds[x.name];
          const delta = typeof before === 'number' ? (x.prob || 0) - before : null;
          return { ...x, delta };
        });
        if (top.length) contenders.push({ tour: t, top: withMove });
      }

      const contenderTable = contenders.map(({ tour, top }) => `
        <div style="padding-top:16px;">
          <div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:${MUTED};font-weight:700;padding-bottom:10px;">${tour.toUpperCase()} favourites</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${top.map((x) => {
    const ph = mirrorPhoto(tour, x.id);
    const prob = Math.round((x.prob || 0) * 100);
    return `<tr>
                <td width="44" style="padding:6px 10px 6px 0;">
                  ${ph
    ? `<img src="${ph}" width="38" height="38" alt="${esc(x.name)}" style="display:block;width:38px;height:38px;border-radius:2px;border:1px solid ${LINE_HI};" />`
    : `<div style="width:38px;height:38px;border-radius:2px;background:${TRACK};"></div>`}
                </td>
                <td style="padding:6px 0;font-size:14px;font-weight:700;color:${INK};">${esc(x.name)}</td>
                <td width="120" style="padding:6px 0 6px 10px;">${bar(prob, LIME, 8)}</td>
                <td width="42" style="padding:6px 0 6px 8px;text-align:right;font-size:14px;font-weight:800;color:${INK};">${prob < 1 ? '<1' : prob}%</td>
                <td width="52" style="padding:6px 0 6px 6px;text-align:right;font-size:12px;font-weight:700;font-family:${MONO};color:${x.delta == null ? MUTED : (x.delta >= 0 ? WIN : LOSS)};white-space:nowrap;">${x.delta == null ? '' : `${x.delta >= 0 ? '&#9650;' : '&#9660;'}${Math.abs(Math.round(x.delta * 100))}`}</td>
              </tr>`;
  }).join('')}
          </table>
        </div>`).join('');

      blocks.push(section(`
        ${kicker(isLive ? 'Still standing' : 'Coming up')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            ${logo ? `<td width="72" style="padding-right:16px;vertical-align:middle;"><img src="${logo}" width="64" alt="${esc(slam.label)}" style="display:block;width:64px;height:auto;" /></td>` : ''}
            <td style="vertical-align:middle;">
              ${h2(isLive ? `${roundName} at the ${liveLabel}` : (slamDays === 0 ? `The ${slam.label} starts today` : `${plural(slamDays, 'day', 'days')} to the ${slam.label}`))}
              <div style="font-size:14px;color:${MUTED};margin-top:-6px;">On ${esc(isLive ? (liveEv.surface || slam.surface) : slam.surface)}.</div>
            </td>
          </tr>
        </table>
        ${p(isLive
    ? `We play the remaining draw out two thousand times after every refresh. Anyone already beaten is gone from the field, so these are the players still standing, and the arrow is the move since yesterday.`
    : `Until the real draw lands we simulate a seeded field from current rankings, two thousand times over, and re-price it with every refresh. It is the closest thing to a look at the tournament before the tournament exists.`, 'padding-top:14px;')}
        ${contenderTable}
        <div style="padding-top:18px;">${button(`${SITE}/draw`, isLive ? 'See the full draw' : 'See the projected draw')}</div>
      `));
      txtLines.push(isLive
        ? `STILL STANDING: ${roundName} at the ${liveLabel} (${liveEv.surface || slam.surface})`
        : `COMING UP: ${slamDays === 0 ? `the ${slam.label} starts today` : `${slamDays} days to the ${slam.label}`} (${slam.surface})`);
      for (const { tour, top } of contenders) {
        txtLines.push(`  ${tour.toUpperCase()}: ${top.map((x) => `${x.name} ${Math.round(x.prob * 100)}%${x.delta == null ? '' : ` (${x.delta >= 0 ? '+' : '-'}${Math.abs(Math.round(x.delta * 100))})`}`).join(', ')}`);
      }
      txtLines.push(`  ${SITE}/draw`, '');
    }

    if (season && season.n) {
      blocks.push(section(p(
        `<span style="color:${MUTED};">For the record: ${season.acc}% of winners called this season, ${season.correct.toLocaleString()} from ${season.n.toLocaleString()}, with today's engines replayed over every last one of them.</span>`
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

    // Same rule as the daily: lead with the one interesting thing, let the
    // preheader carry the rest. An inbox truncates around forty characters.
    subject = (() => {
      if (!week.length) return `A quiet week, and we will say so`;
      if (weekPct >= 75) return `${weekCorrect} from ${week.length}. A good week, briefly`;
      if (weekPct < 40) return `${weekCorrect} from ${week.length}. A week to file away`;
      if (weekPct >= 60) return `${weekCorrect} from ${week.length} this week`;
      return `${weekCorrect} from ${week.length}, warts and all`;
    })();
    preheader = week.length
      ? `${weekPct}% across every graded match, what following the plan returned, and the ones we got wrong.`
      : 'The week in review.';
    ctaHref = `${SITE}/track-record`;
    ctaText = 'Open the Ledger';

    txtLines.push(`SMASH WEEKLY - ${prettyDate}`, '');

    if (week.length) {
      // Lede stands on its own, as it does in the daily. It used to sit
      // inside the section below, above that section's own kicker and
      // headline, which read as though the page had started twice.
      blocks.push(section(p(
        `Seven days, ${plural(week.length, 'graded match', 'graded matches')}, and a number we cannot go back and edit. Here is the week, warts and all.`
      )));
      blocks.push(section(`
        ${kicker('The week')}
        ${h2(`${weekCorrect} from ${week.length}`)}
        ${p(`${weekPct}% across everything we graded, hits and misses in the same pile. No filtering by confidence, no quietly losing the ones that aged badly.`)}
        ${bar(weekPct, weekPct >= 50 ? WIN : LOSS, 14)}
      `));
      txtLines.push(`THE WEEK: ${weekCorrect} from ${week.length} (${weekPct}%)`, '');

      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = eventDay(d.toISOString());
        const rows = week.filter((m) => eventDay(m.date) === key);
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
          ${p(`${esc(best.label)} was the pick of the week at ${pct(best.correct, best.n)}%. Volume swings hard with the draw, so a thin day shouts louder than it has earned.`)}
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
          ${h2('We split from the book, and won')}
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
          ${h2('Where we were most sure, and most wrong')}
          ${p('Printing these is the whole deal. A model that only shows you its winners is a highlight reel, not a record.')}
          ${misses.map(resultRow).join('')}
        `));
        txtLines.push('THE ONES WE GOT WRONG');
        for (const m of misses) {
          const favIsP1 = pickFavorite(m) === m.p1;
          txtLines.push(`  - ${lastName(favIsP1 ? m.name1 : m.name2)} lost to ${lastName(favIsP1 ? m.name2 : m.name1)} ${m.score || ''}`.trimEnd());
        }
        txtLines.push('');
      }

      // What following each plan would have returned across the whole week,
      // settled the way a reader would actually have done it: $100 into that
      // day's plan each morning, day after day. Not one plan over the week's
      // whole card - nobody could have placed that, because the plans only
      // ever exist one day at a time. The daily prints one day, where it
      // proves nothing; over a week it starts to mean something, which is the
      // whole reason a weekly exists.
      const weekDays = [...new Set(week.map((m) => eventDay(m.date)))].sort();
      // Two different questions, and they need two different day sets.
      //
      // What a FOLLOWER got is the recommendation on every settleable day in
      // the window - that is the money that actually moved.
      //
      // What the alternatives WOULD have got has to be a like-for-like
      // comparison, and it was not: each plan was summed over the days it
      // happened to be offered on, then all four were printed in one table as
      // if comparable. The builder does not always offer a full menu (a
      // whole-card plan needs the spread to cover its own stake), so last
      // week "follow the edge" totalled five days against the others' four -
      // a table where the rows do not describe the same week. The comparison
      // now runs over the days every plan was on the menu, and says so.
      const byDay = [];
      let recTotal = 0, recDays = 0;
      for (const dayISO of weekDays) {
        const settledDay = planReturns(preds, dayISO);
        if (!settledDay) continue;
        byDay.push(settledDay);
        const rec = settledDay.plans.find((pl) => pl.id === settledDay.recommendedId);
        if (rec) { recTotal += rec.profit; recDays++; }
      }
      const everyId = [...new Set(byDay.flatMap((d) => d.plans.map((pl) => pl.id)))];
      const commonDays = byDay.filter((d) => everyId.every((id) => d.plans.some((pl) => pl.id === id)));
      const compareDays = commonDays.length >= 2 ? commonDays : byDay;
      const totals = new Map(); // plan id -> { label, profit, days, hits, n }
      for (const d of compareDays) {
        for (const pl of d.plans) {
          const t = totals.get(pl.id) || { label: pl.label, profit: 0, days: 0, hits: 0, n: 0, staked: 0 };
          t.profit += pl.profit; t.days++; t.hits += pl.hits; t.n += pl.n; t.staked += pl.staked;
          totals.set(pl.id, t);
        }
      }
      const comparableDays = compareDays.length;
      const partial = comparableDays < recDays;
      if (recDays >= 2) {
        const money = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
        const rows = [...totals.entries()].map(([id, t]) => `
          <tr>
            <td style="padding:9px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${BODY};">
              <strong style="color:${INK};">${esc(t.label)}</strong>
              <span style="display:block;font-size:12px;color:${MUTED};">${t.hits} of ${t.n} singles landed · $${t.staked.toFixed(0)} staked · ${t.staked > 0 ? `${t.profit >= 0 ? '+' : '-'}${Math.abs((100 * t.profit) / t.staked).toFixed(1)}%` : '-'} on the money</span>
            </td>
            <td align="right" style="padding:9px 0 9px 14px;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:15px;font-weight:700;color:${t.profit >= 0 ? WIN : LOSS};white-space:nowrap;">
              ${money(t.profit)}
            </td>
          </tr>`).join('');
        blocks.push(section(`
          ${kicker('If you had followed along all week')}
          ${h2(`${money(recTotal)} taking the recommendation every day`)}
          ${p(`$${PLAN_BUDGET} into the recommended plan each morning, ${plural(recDays, 'day', 'days')} this week, every stake settled at the price we stamped before play. And because the builder offers more than one plan, here is what each of them did over the ${plural(comparableDays, 'day', 'days')} all of them were on the menu${partial ? ' - a like-for-like comparison, so it is a shorter window than the total above' : ''}:`)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 10px;">${rows}</table>
          ${p(`${recTotal >= 0 ? 'A good week does not make it a good strategy' : 'A bad week does not make it a bad one'}, and a week is still a small sample. The point is that you get the number either way, computed the same way every time.`, `color:${MUTED};font-size:13px;`)}
          <div style="padding-top:4px;">${button(`${SITE}/risk`, 'Size this week\'s card')}</div>
        `));
        txtLines.push(`IF YOU HAD FOLLOWED ALONG ALL WEEK ($${PLAN_BUDGET} a day, recommended plan): ${money(recTotal)} over ${recDays} days`);
        for (const [, t] of totals) txtLines.push(`  ${t.label}: ${money(t.profit)} (${t.hits}/${t.n} singles, ${t.days} days)`);
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
          ${p(`Measured across the ${priced.length} matches this week that carried a market price, scoring both sides on the same fixtures.`)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td width="50%" style="padding:0 10px 0 0;vertical-align:top;">
                <div style="font-size:26px;font-weight:800;color:${INK};line-height:1.1;">${us}%</div>
                <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;padding:2px 0 8px;">us</div>
                ${bar(us, LIME)}
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

    // Calls only: no-call rows grade for audit but are never claimed.
    const decided = preds.filter((pr) => (pr.status === 'won' || pr.status === 'lost') && !ledgerNoCall(pr));
    const fwdWon = decided.filter((pr) => pr.status === 'won').length;
    const pending = preds.filter((pr) => pr.status === 'pending' && !ledgerNoCall(pr)).length;
    if (decided.length || (season && season.n)) {
      blocks.push(section(`
        ${kicker('The standing record')}
        ${h2('The number that cannot be edited')}
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
    recordSendStatus({ sent: 0, skipped: true, deliberate: true, reason: 'nothing worth mailing' });
    return;
  }

  const editionLabel = isWeekly ? 'Weekly' : 'Daily';
  const stem = isWeekly ? 'digest' : 'digest-daily';

  const txt = [
    ...txtLines,
    `${ctaText}: ${ctaHref}`,
    '',
    'Not betting advice. The season number is a benchmark; only the forward test rows were locked before play.',
    `Instagram: ${INSTAGRAM_URL}`,
    '%%UNSUB_TXT%%',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="${THEME}" />
<meta name="supported-color-schemes" content="${THEME}" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};font-family:${FONT};">
    <tr><td align="center" style="padding:28px 12px 36px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:${CARD};border:1px solid ${LINE};border-radius:2px;overflow:hidden;">
        <tr>
          <td style="padding:22px 28px 0;background:${CARD};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:${DISPLAY};font-size:40px;line-height:1;font-weight:700;color:${INK};letter-spacing:2px;text-transform:uppercase;">
                  Smash<span style="color:${LIME};">.</span>
                </td>
                <td align="right" style="font-family:${DISPLAY};font-size:15px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:${LIME};padding-bottom:4px;">${esc(editionLabel)}</td>
              </tr>
            </table>
            <!-- Masthead rule: heavy line under the wordmark, then the
                 dateline below it. The device that says "publication" rather
                 than "product notification". -->
            <div style="height:3px;background:${LIME};font-size:0;line-height:0;margin-top:10px;">&nbsp;</div>
            <div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};padding:10px 0 20px;">
              ${esc(prettyDate)} &nbsp;&middot;&nbsp; every call locked before play, graded in public
            </div>
          </td>
        </tr>
        ${blocks.join('')}
        <tr>
          <td align="center" style="padding:28px;border-top:1px solid ${LINE};">
            ${button(ctaHref, ctaText)}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 26px;background:${PAGE};border-top:1px solid ${LINE};font-size:12px;line-height:1.7;color:${MUTED};">
            You are getting this because you asked for the Smash digest. Not betting advice, and
            not a tip sheet: the season number is a benchmark (today's engines replayed over the
            whole season) and only the forward-test rows were locked before play.
            <br /><a href="${SITE}" style="color:${MUTED};">${esc(SITE.replace(/^https?:\/\//, ''))}</a>
            &nbsp;&middot;&nbsp; <a href="${INSTAGRAM_URL}" style="color:${MUTED};">Instagram</a>
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

  // ── Freshness gate ────────────────────────────────────────────────────────
  // The cadence is "whenever the refresh actually refreshed something". The
  // workflow runs on a clock, but the data behind it does not: when the
  // RapidAPI budget guard trips, every fetcher serves the cache and the
  // pipeline still completes, cheerfully, with last week's card. Without this
  // check the digest mails the same "2 from 4 yesterday" every morning for as
  // long as the outage lasts, which is worse than sending nothing - it is
  // sending something wrong to people who trusted us to be current.
  //
  // Two independent signals, either of which stops the send:
  //   1. the results feed has not moved (mostRecentMatchDate is stale)
  //   2. a fetcher tripped the spend guard on this run (alert marker present)
  //
  // Files are still written either way, so the site and any preview stay
  // current with whatever we do have. DIGEST_FORCE=1 overrides, for testing.
  const FRESH_DAYS = MODE === 'weekly' ? 4 : 2;
  const staleReasons = [];
  const meta = readJson(path.join(DATA, 'refresh-meta.json'));
  if (meta && meta.mostRecentMatchDate) {
    const ageDays = (Date.now() - new Date(meta.mostRecentMatchDate).getTime()) / 864e5;
    if (ageDays > FRESH_DAYS) {
      staleReasons.push(
        `the newest result we hold is ${ageDays.toFixed(1)} days old `
        + `(${String(meta.mostRecentMatchDate).slice(0, 10)}), past the ${FRESH_DAYS}-day limit for a ${MODE} edition`
      );
    }
  } else {
    staleReasons.push('refresh-meta.json is missing or has no mostRecentMatchDate, so freshness cannot be established');
  }
  try {
    const alertPath = path.join(__dirname, 'raw', 'api-budget-alert.json');
    if (fs.existsSync(alertPath)) {
      const alert = JSON.parse(fs.readFileSync(alertPath, 'utf8'));
      staleReasons.push(`a fetcher hit the API spend guard (${alert.reason || 'no reason recorded'}), so this run served cached data`);
    }
  } catch { /* an unreadable marker is not itself a reason to send */ }

  if (staleReasons.length && process.env.DIGEST_FORCE !== '1') {
    console.warn(
      `  ! NO EMAIL WAS SENT - the data behind this digest is not fresh:\n`
      + staleReasons.map((r) => `      - ${r}`).join('\n')
      + `\n    The files were still written, so the site is current with what we have.`
      + `\n    This is deliberate: mailing a stale card every morning during an API`
      + `\n    outage is worse than skipping a day. Set DIGEST_FORCE=1 to override.`
    );
    recordSendStatus({ sent: 0, skipped: true, deliberate: true, reason: `stale data: ${staleReasons.join('; ')}` });
    return;
  }
  if (staleReasons.length) {
    console.warn(`  ! DIGEST_FORCE=1 set, sending despite: ${staleReasons.join('; ')}`);
  }

  // Build everything, mail nothing. DIGEST_FORCE's opposite, and a different
  // thing from the staleness gate above: that one decides whether the data
  // DESERVES to be sent, this one is a human saying "not this run".
  //
  // For runs where the data is about to change shape and someone wants to
  // read the result before subscribers do - the numbers behind a digest can
  // move for reasons the freshness gate cannot see, and the build and the
  // send live in the same workflow step, so without this there is no moment
  // between "files written" and "mail delivered" to look at anything.
  if (process.env.DIGEST_DRY_RUN === '1') {
    console.warn(
      '  ! DRY RUN - files written, NO EMAIL SENT.\n'
      + '    Everything above was built and saved; the send was skipped on purpose.\n'
      + '    Unset DIGEST_DRY_RUN to mail normally.'
    );
    recordSendStatus({ sent: 0, skipped: true, deliberate: true, reason: 'DIGEST_DRY_RUN=1' });
    return;
  }

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
  // How the subscriber list went, recorded separately from the mail count.
  // "Sent to 1 recipient" is indistinguishable between a healthy list of one
  // and a list that was never read - and the second is the failure that
  // matters, because the owner keeps receiving the mail either way and
  // nothing looks wrong.
  const listState = { configured: false, read: false, subscribers: 0, problem: null };
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    listState.configured = true;
    // Checked BEFORE the request, because the wrong key does not error - it
    // returns an empty list with a 200 and looks like a quiet day.
    const key = supabaseKeyKind(SUPABASE_SERVICE_KEY);
    listState.keyKind = key.label;
    listState.keyPrivileged = key.privileged;
    if (key.privileged === false) {
      listState.problem = `SUPABASE_SERVICE_KEY is a ${key.label}, which cannot read this table`;
      console.warn(
        `  ! SUPABASE_SERVICE_KEY is a ${key.label} - a browser key, bound by RLS.`
        + '\n    digest_subscribers allows anon INSERT but no anon SELECT, so this key'
        + '\n    reads the list back EMPTY with an HTTP 200 - indistinguishable from'
        + '\n    having no subscribers. Use the SECRET key (sb_secret_*), or the legacy'
        + '\n    service_role key if this project has not migrated.'
      );
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/digest_subscribers?select=email,unsubscribe_token`, {
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
      });
      if (res.ok) {
        const rows = await res.json();
        for (const r of rows) recipients.set(r.email, r.unsubscribe_token || null);
        const tokenless = rows.filter((r) => !r.unsubscribe_token).length;
        listState.read = true;
        listState.subscribers = rows.length;
        console.log(`Subscribers: ${rows.length} from digest_subscribers, ${owners.size} from DIGEST_TO, ${recipients.size} unique.`);
        // An EMPTY list on a 200 is the quietest failure of the lot: the anon
        // key can SELECT nothing (the table allows anon INSERT only), so a
        // wrong key reads back zero rows and reports success. A live signup
        // form with nobody behind it is worth a shout either way.
        if (rows.length === 0) {
          listState.problem = key.privileged === false
            ? `digest_subscribers returned 0 rows, and the key is a ${key.label}`
            : 'digest_subscribers returned 0 rows (the key can read, so the table may genuinely be empty)';
          console.warn(
            '  ! digest_subscribers returned ZERO rows, so only DIGEST_TO is being mailed.\n'
            + '    If anyone has signed up, this is the symptom of using the ANON key:\n'
            + '    the table allows anon INSERT but no anon SELECT, so it reads back\n'
            + '    empty with an HTTP 200. SUPABASE_SERVICE_KEY must be service-role.'
          );
        }
        if (tokenless) {
          console.warn(
            `  ! ${tokenless} subscriber(s) have no unsubscribe_token, so they get the\n`
            + '    reply-to-unsubscribe fallback. Run supabase/digest_unsubscribe.sql.'
          );
        }
      } else {
        listState.problem = `digest_subscribers read failed (HTTP ${res.status})`;
        console.warn(
          `  ! Could not read digest_subscribers (HTTP ${res.status}), so ONLY DIGEST_TO is being mailed.\n`
          + '    SUPABASE_SERVICE_KEY must be the service-role key: the table allows anon\n'
          + '    INSERT but no anon SELECT, so the anon key reads back an empty list.'
        );
      }
    } catch (err) {
      listState.problem = `subscriber fetch threw: ${err.message}`;
      console.warn(`  ! Subscriber fetch failed, mailing DIGEST_TO only (non-fatal): ${err.message}`);
    }
  } else {
    listState.problem = 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set';
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
  // Zero delivered when we meant to deliver is a failure, not a skip.
  recordSendStatus({
    sent, failed, recipients: recipients.size, skipped: false, deliberate: false, list: listState,
    transport: transport.label,
    // A sandbox sender delivers to exactly one address no matter how healthy
    // everything else looks, so it is recorded as a delivery fault in its own
    // right rather than left to be inferred from a pile of 403s.
    sandboxSender: !!transport.sandbox,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
