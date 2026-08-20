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
// Same vig-stripping the Parlay builder uses, so the two never disagree.
function marketProb(p) {
  if (!(p.lockOdd1 > 1) || !(p.lockOdd2 > 1)) return null;
  const q1 = 1 / p.lockOdd1, q2 = 1 / p.lockOdd2;
  return (p.favorite === p.p1 ? q1 : q2) / (q1 + q2);
}

// ── Staking maths, mirrored from src/utils/staking.js ───────────────────────
// The app's copy is ES module and this pipeline is CommonJS, so it cannot be
// imported here. These are the same two formulas, and digestStaking.test.js
// asserts the two copies agree (same pattern as modelParity.test.js).
const edgePerDollar = (p, o) => (o > 1 && p > 0 ? p * o - 1 : null);
const kellyFraction = (p, o) => {
  if (!(o > 1) || !(p > 0)) return 0;
  const f = (p * o - 1) / (o - 1);
  return f > 0 ? f : 0;
};
const clampP = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// The model's stated probability re-expressed at its measured reliability.
const adjustProb = (p, lambda = 1) =>
  (lambda === 1 ? p : clampP(0.5 + lambda * (p - 0.5), 0.001, 0.999));

// How far the stated confidence is borne out, measured on the graded forward
// record and shrunk toward 1 by sample size.
function reliability(graded, minSample = 60) {
  const rows = (graded || []).filter(
    (r) => typeof r.favProb === 'number' && (r.status === 'won' || r.status === 'lost')
  );
  const n = rows.length;
  if (!n) return { n: 0, lambda: 1, accuracy: null, stated: null, trusted: false };
  const accuracy = rows.filter((r) => r.correct).length / n;
  const stated = rows.reduce((t, r) => t + r.favProb, 0) / n;
  const raw = stated > 0.5 + 1e-6 ? (accuracy - 0.5) / (stated - 0.5) : 1;
  const w = n / (n + minSample);
  return { n, accuracy, stated, lambda: clampP(1 + w * (raw - 1), 0.5, 1.5), trusted: n >= minSample };
}

// The flat-stake spread the builder recommends: an equal stake on as much of
// the card as can still cover itself. Taken best-price-first and kept while
// the portfolio's expected return covers the whole stake, which with equal
// stakes is a test on the AVERAGE - so a short price rides along when the
// rest of the card carries it.
function spreadPlan(bets, budget, lambda = 1) {
  const adj = (bets || [])
    .map((b) => ({ ...b, p: adjustProb(b.p, lambda) }))
    .filter((b) => b.o > 1 && b.p > 0);
  const ranked = [...adj].sort((a, b) => (b.p * b.o) - (a.p * a.o));
  let take = 0, sum = 0;
  for (let i = 0; i < ranked.length; i++) {
    const next = sum + ranked[i].p * ranked[i].o;
    if (next < i + 1 - 1e-12) break;
    sum = next;
    take = i + 1;
  }
  const chosen = ranked.slice(0, take);
  const perMatch = take > 0 ? (Number(budget) || 0) / take : 0;
  const staked = perMatch * take;
  const expWinners = chosen.reduce((t, b) => t + b.p, 0);
  const expReturn = chosen.reduce((t, b) => t + perMatch * b.p * b.o, 0);

  // Chance of finishing ahead, by enumerating every outcome. The card is
  // small enough that exact beats approximate.
  let pAhead = null;
  if (take > 0 && take <= 16) {
    let acc = 0;
    for (let mask = 0; mask < (1 << take); mask++) {
      let prob = 1, pl = 0;
      for (let i = 0; i < take; i++) {
        const win = (mask >> i) & 1;
        prob *= win ? chosen[i].p : 1 - chosen[i].p;
        pl += win ? perMatch * (chosen[i].o - 1) : -perMatch;
      }
      if (pl > 1e-9) acc += prob;
    }
    pAhead = acc;
  }
  return {
    rows: chosen, count: take, perMatch, staked, expWinners, expReturn, pAhead,
    coversStake: take > 0 && expReturn >= staked - 1e-9,
  };
}

// What yesterday's suggested plan would actually have returned. Runs the
// recommender over the calls that carried a price, then settles every stake at
// the real result. This is a backtest of one day, not a promise: it is stated
// as such in the copy, and a losing day is printed exactly as loudly.
const PLAN_BUDGET = 100;
function planReturn(rows) {
  const bets = [];
  for (const m of rows) {
    const fav = pickFavorite(m);
    if (!fav || !(m.od1 > 1) || !(m.od2 > 1)) continue;
    const raw = m.pickProbP1 != null ? m.pickProbP1 : m.smashProbP1;
    if (raw == null) continue;
    const p = fav === m.p1 ? raw : 1 - raw;
    const o = fav === m.p1 ? m.od1 : m.od2;
    // Only calls that beat the price they were offered at get money. This is
    // the whole rule: a winner priced badly is still a bet we would not place.
    if (edgePerDollar(p, o) > 0) bets.push({ p, o, won: !!pickCorrect(m) });
  }
  if (!bets.length) return null;
  const total = bets.reduce((s, b) => s + kellyFraction(b.p, b.o), 0);
  let staked = 0, profit = 0, hits = 0;
  for (const b of bets) {
    const stake = (PLAN_BUDGET * kellyFraction(b.p, b.o)) / total;
    staked += stake;
    if (b.won) { profit += stake * (b.o - 1); hits++; } else { profit -= stake; }
  }
  return { n: bets.length, hits, staked, profit, budget: PLAN_BUDGET };
}

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
  return out.sort((a, b) => (at(a) - at(b)) || a.event.localeCompare(b.event) || a.tour.localeCompare(b.tour));
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

  const face = (url, alt, dim) => (url
    ? `<img src="${url}" width="54" height="54" alt="${esc(alt)}" style="display:block;width:54px;height:54px;border-radius:2px;border:2px solid ${dim ? LINE : LIME};" />`
    : `<div style="width:54px;height:54px;border-radius:2px;background:${TRACK};"></div>`);

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};border-left:3px solid ${LIME};background:${PANEL};margin-bottom:14px;">
    <tr><td style="padding:18px 20px;">
      <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${MUTED};font-weight:700;padding-bottom:12px;">
        ${esc(timeLabel)}
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
  const marketCell = mv
    ? `<div style="font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;">${mv.agreed ? 'Market agreed' : 'Market split'}</div>
       <div style="font-size:13px;line-height:1.5;color:${mv.right ? WIN : LOSS};font-weight:700;padding-top:3px;white-space:nowrap;">
         ${esc(lastName(mv.favName))} ${mv.right ? 'won' : 'lost'}
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
      const yPct = pct(yday.correct, yday.n);
      ledeBits.push(`${yday.correct} from ${yday.n} yesterday.`);
      ledeBits.push(yday.correct === yday.n
        ? ' A clean sweep, and no, that is not the usual.'
        : yPct >= 70 ? ' We will take that.'
          : yPct >= 50 ? ' Half right, which means half wrong, and both halves are below.'
            : ' Not our finest hour. It is all in the record anyway.');
    }
    if (card.length) {
      ledeBits.push(` ${plural(card.length, 'more is', 'more are')} locked for today${events.length ? ` at ${events.join(' and ')}` : ''}, every one of them public before a ball is struck.`);
    }
    if (ledeBits.length) {
      blocks.push(section(p(ledeBits.join('').trim())));
      txtLines.push(ledeBits.join('').trim(), '');
    }

    // Yesterday, graded.
    if (yday && yday.n) {
      const ypct = pct(yday.correct, yday.n);
      const ydayAll = graded.filter((m) => String(m.date).slice(0, 10) === String(yday.date).slice(0, 10));
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

      // What the suggested plan would have returned, settled at real results.
      const plan = planReturn(ydayAll);
      let planBlock = '';
      let planTxt = '';
      if (plan) {
        const up = plan.profit >= 0;
        const money = `${up ? '+' : '-'}$${Math.abs(plan.profit).toFixed(2)}`;
        planBlock = `
          <div style="margin-top:14px;padding:16px 18px;background:${PANEL};border-left:3px solid ${up ? WIN : LOSS};">
            ${kicker('If you had actually followed along')}
            <div style="font-size:28px;font-weight:800;color:${up ? WIN : LOSS};line-height:1.1;">${money}</div>
            <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:${BODY};">
              A $${plan.budget} bankroll spread over the ${plural(plan.n, 'call', 'calls')} worth backing, ${plan.hits} of which landed, settled at the odds we stamped before play.
              One good day proves nothing. Neither does one bad one, which is why you get all of them.
            </p>
          </div>`;
        planTxt = `If you had actually followed along: ${money} on a $${plan.budget} bankroll (${plan.hits}/${plan.n} landed)`;
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

    // Today's card.
    if (shown.length) {
      const intro = splits.length
        ? `We are out of step with the bookmakers on ${plural(splits.length, 'of these', 'of these')} by ten points or more. Those are the ones worth your time. Agreeing with the favourite is not a take.`
        : 'We land more or less where the market does today. No arguments, just conviction.';
      blocks.push(section(`
        ${kicker(todays.length ? 'On court today' : 'Next up')}
        ${h2(`${plural(card.length, 'call', 'calls')}, no takebacks`)}
        ${p(intro)}
        ${groupCard(shown).map((g) => groupHead(g) + g.rows.map((pr) => matchCard(pr, upsetById.get(pr.id))).join('')).join('')}
        ${card.length > shown.length ? p(textLink(`${SITE}/today`, `See the other ${plural(card.length - shown.length, 'match', 'matches')}`)) : ''}
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

    // Staking plan: the ACTUAL recommendation for today's card, not a
    // description of the tool that makes it. Same maths the builder runs,
    // mirrored above and pinned by digestStaking.test.js.
    const PLAN_BUDGET = 100;
    const rel = reliability(graded);
    const planBets = card
      .map((pr) => {
        const favIsP1 = pr.favorite === pr.p1;
        const o = Number(favIsP1 ? pr.lockOdd1 : pr.lockOdd2);
        return { pr, key: pr.id, p: pr.favProb, o: o > 1 ? o : 0 };
      })
      .filter((b) => b.o > 1 && b.p > 0);
    const todayPlan = planBets.length ? spreadPlan(planBets, PLAN_BUDGET, rel.lambda) : null;

    if (todayPlan && todayPlan.count > 0) {
      // Whole amounts read better without the cents in prose ($100, not
      // $100.00); anything with a fraction keeps them.
      const money2 = (v) => (Math.abs(v % 1) < 0.005 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`);
      const stakeRows = todayPlan.rows.map((b) => {
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
            ${money2(todayPlan.perMatch)}
          </td>
        </tr>`;
      }).join('');

      const skipped = planBets.length - todayPlan.count;
      const unpriced = card.length - planBets.length;

      blocks.push(section(`
        ${kicker('The money question')}
        ${h2('What we would actually stake')}
        ${p(`Here is the whole plan for today, on a hypothetical ${money2(PLAN_BUDGET)}. Equal money on ${plural(todayPlan.count, 'match', 'matches')}, because spreading is how a ${rel.accuracy != null ? Math.round(rel.accuracy * 100) : 69}% hit rate actually shows up instead of riding on one result.`)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 14px;">
          ${stakeRows}
          <tr>
            <td style="padding:11px 0 0;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};font-weight:700;">Total staked</td>
            <td></td>
            <td align="right" style="padding:11px 0 0 14px;font-family:${MONO};font-size:15px;font-weight:700;color:${INK};">${money2(todayPlan.staked)}</td>
          </tr>
        </table>
        <div style="padding:14px 16px;background:${PANEL};border-left:3px solid ${LIME};">
          <p style="margin:0;font-size:14px;line-height:1.6;color:${BODY};">
            <strong style="color:${INK};">We expect ${todayPlan.expWinners.toFixed(1)} of those ${plural(todayPlan.count, 'call', 'calls')} to land, returning ${money2(todayPlan.expReturn)}.</strong>
            ${todayPlan.coversStake
    ? `That covers the ${money2(todayPlan.staked)} going out, which is the whole test a plan has to pass here.`
    : `That is short of the ${money2(todayPlan.staked)} going out, so today the honest answer is to sit it out.`}
            ${todayPlan.pAhead != null ? ` Odds of actually finishing ahead: ${Math.round(todayPlan.pAhead * 100)}%.` : ''}
          </p>
        </div>
        ${p(`${skipped > 0 ? `${plural(skipped, 'call', 'calls')} on the card got nothing: the price was too short to carry ${skipped === 1 ? 'it' : 'them'}. ` : ''}${unpriced > 0 ? `${plural(unpriced, 'more had', 'more had')} no market price when we locked ${unpriced === 1 ? 'it' : 'them'}. ` : ''}Fair warning, the builder is a killjoy. Most days it stakes less than you hoped, and some days it stakes nothing at all. That is the feature.`, 'padding-top:14px;')}
        <div style="padding-top:4px;">${button(`${SITE}/parlay`, 'Build your own slip')}</div>
      `));
      txtLines.push(`THE MONEY QUESTION - what we would actually stake (hypothetical $${PLAN_BUDGET}):`);
      for (const b of todayPlan.rows) {
        const favIsP1 = b.pr.favorite === b.pr.p1;
        const favName = b.pr.favName || (favIsP1 ? b.pr.name1 : b.pr.name2);
        txtLines.push(`  ${money2(todayPlan.perMatch)} on ${lastName(favName)} (${Math.round(b.pr.favProb * 100)}% @ ${b.o.toFixed(2)})`);
      }
      txtLines.push(`  Total ${money2(todayPlan.staked)}; we expect ${todayPlan.expWinners.toFixed(1)} to land, returning ${money2(todayPlan.expReturn)}${todayPlan.pAhead != null ? `; ${Math.round(todayPlan.pAhead * 100)}% chance of finishing ahead` : ''}`);
      txtLines.push(`  ${SITE}/parlay`, '');
    } else {
      blocks.push(section(`
        ${kicker('The money question')}
        ${h2('What we would actually stake')}
        ${p(`Nothing, today. ${planBets.length ? 'Every price on the card is short enough that even spread across all of them, the expected return does not cover the stake.' : 'Nothing on the card carried a market price when we locked it, so there is no edge to size against.'} Some days that is the answer, and pretending otherwise is how people lose money.`)}
        <div style="padding-top:4px;">${button(`${SITE}/parlay`, 'Check it against your own book')}</div>
      `));
      txtLines.push(`THE MONEY QUESTION: nothing worth staking today. ${SITE}/parlay`, '');
    }

    // Countdown, with the crest and who the simulation currently likes. The
    // favourites are the promo: a number next to a face is an argument you
    // want to check, where a bare date is just a date.
    if (slam && slamDays != null) {
      const logo = mirrorLogo(slam.label);
      const odds = readJson(path.join(DATA, 'title_odds.json'));
      const contenders = [];
      for (const t of ['atp', 'wta']) {
        const ev = odds && odds.events && odds.events[t];
        if (!ev || !Array.isArray(ev.odds)) continue;
        const top = ev.odds.filter((x) => x.id).slice(0, 3);
        if (top.length) contenders.push({ tour: t, top });
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
              </tr>`;
  }).join('')}
          </table>
        </div>`).join('');

      blocks.push(section(`
        ${kicker('Coming up')}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            ${logo ? `<td width="72" style="padding-right:16px;vertical-align:middle;"><img src="${logo}" width="64" alt="${esc(slam.label)}" style="display:block;width:64px;height:auto;" /></td>` : ''}
            <td style="vertical-align:middle;">
              ${h2(slamDays === 0 ? `The ${slam.label} starts today` : `${plural(slamDays, 'day', 'days')} to the ${slam.label}`)}
              <div style="font-size:14px;color:${MUTED};margin-top:-6px;">On ${esc(slam.surface)}.</div>
            </td>
          </tr>
        </table>
        ${p(`Until the real draw lands we simulate a seeded field from current rankings, two thousand times over, and re-price it with every refresh. It is the closest thing to a look at the tournament before the tournament exists.`, 'padding-top:14px;')}
        ${contenderTable}
        <div style="padding-top:18px;">${button(`${SITE}/draw`, 'See the projected draw')}</div>
      `));
      txtLines.push(`COMING UP: ${slamDays === 0 ? `the ${slam.label} starts today` : `${slamDays} days to the ${slam.label}`} (${slam.surface})`);
      for (const { tour, top } of contenders) {
        txtLines.push(`  ${tour.toUpperCase()}: ${top.map((x) => `${x.name} ${Math.round(x.prob * 100)}%`).join(', ')}`);
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
