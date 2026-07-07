// Clip image to a circle using the same crop as the app's player photos:
// CSS object-fit: cover with object-position: top center — scale to cover the
// square, center horizontally, align the image's TOP edge with the circle top.
function drawCircularPhoto(ctx, img, cx, cy, radius, dimmed = false) {
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const box = radius * 2;
  const scale = Math.max(box / img.width, box / img.height);
  const sw = img.width * scale, sh = img.height * scale;
  ctx.drawImage(img, cx - sw / 2, cy - radius, sw, sh);
  ctx.restore();
}

async function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [255, 255, 255];
}

function truncate(str, max = 20) {
  return str && str.length > max ? str.slice(0, max - 1) + '…' : (str || '');
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawFlag(ctx, flagImg, x, y, w, h) {
  if (!flagImg) return;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 3);
  ctx.clip();
  ctx.drawImage(flagImg, x, y, w, h);
  ctx.restore();
}

// Court-inspired palettes per surface — instantly recognizable per Slam.
const SURFACE_THEMES = {
  clay:  { bgTop: '#54200f', bgBottom: '#2e0f06', court: '#8a3c22' },
  grass: { bgTop: '#14351f', bgBottom: '#091d10', court: '#26543a' },
  hard:  { bgTop: '#0e2856', bgBottom: '#071531', court: '#1a447e' },
};

// Auto headline + tagline — the hook that makes the card feel like a hot take.
function pickVerdict({ favShare, straightSets, binom10 }) {
  if (favShare < 0.55) return { headline: 'COIN-FLIP CLASSIC', tagline: 'Flip a coin. Seriously. 🪙' };
  if (favShare < 0.60) return { headline: 'TOO CLOSE TO CALL', tagline: 'Somebody\'s leaving heartbroken. 💔' };
  if (binom10 >= 0.25) return { headline: 'UPSET BREWING 🚨', tagline: 'Don\'t blink.' };
  if (favShare >= 0.85) return { headline: 'TOTAL DOMINATION', tagline: 'It\'s not even close. 😤' };
  if (straightSets) return { headline: 'STRAIGHT-SETS STATEMENT', tagline: 'No sets dropped. No mercy. 🧹' };
  return { headline: 'CLEAR FAVORITE', tagline: 'The computer has spoken. 🎾' };
}

// Confetti burst on the winner's half — celebratory, cheap to draw.
// Simple LCG so the same matchup renders the same card every time.
function drawConfetti(ctx, side, color, seedStr, W, H) {
  let seed = 7;
  for (const ch of seedStr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const [r, g, b] = hexToRgb(color);
  const palette = [
    `rgba(${r},${g},${b},0.9)`,
    'rgba(255,255,255,0.85)',
    'rgba(255,215,0,0.85)',
    `rgba(${r},${g},${b},0.55)`,
  ];
  const x0 = side === 'left' ? 40 : W / 2 + 60;
  ctx.save();
  for (let i = 0; i < 46; i++) {
    const x = x0 + rand() * (W / 2 - 100);
    const y = 130 + rand() * 300;
    const s = 4 + rand() * 7;
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)];
    ctx.translate(x, y);
    ctx.rotate(rand() * Math.PI);
    if (rand() > 0.5) ctx.fillRect(-s / 2, -s / 4, s, s / 2);
    else { ctx.beginPath(); ctx.arc(0, 0, s / 2.4, 0, Math.PI * 2); ctx.fill(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.restore();
}

/**
 * Generates a 1200×630 share card and returns the canvas element.
 *
 * @param {object} opts
 * @param {object}  opts.playerA          — full roster row (name, last, us_seed, year_w, year_l)
 * @param {object}  opts.playerB
 * @param {string}  opts.winnerName
 * @param {number}  opts.favShare         — winner's share of sims, 0.5–1
 * @param {string}  [opts.scoreline]      — most likely scoreline, e.g. "3–1"
 * @param {{winsA:number,winsB:number}} [opts.h2hRecord] — career head-to-head (A first)
 * @param {number}  opts.binom10          — P(underdog wins >5 of 10)
 * @param {string}  opts.colorA
 * @param {string}  opts.colorB
 * @param {string}  [opts.imageSrcA]
 * @param {string}  [opts.imageSrcB]
 * @param {string}  [opts.flagSrcA]
 * @param {string}  [opts.flagSrcB]
 * @param {string}  [opts.surfaceKey]     — 'hard' | 'clay' | 'grass'
 * @param {string}  opts.tournamentLabel
 * @param {string}  opts.surfaceLabel
 * @param {number}  opts.simCount
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateShareCard({
  playerA, playerB,
  winnerName,
  favShare = 0.5,
  scoreline = null,
  h2hRecord = null,
  binom10 = 0,
  colorA = '#0033A0',
  colorB = '#FFD700',
  imageSrcA, imageSrcB,
  flagSrcA, flagSrcB,
  surfaceKey = 'hard',
  tournamentLabel = '',
  surfaceLabel = '',
  simCount = 1000,
}) {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const theme = SURFACE_THEMES[surfaceKey] || SURFACE_THEMES.hard;
  const isWinnerA = winnerName === playerA.name;
  const winnerColor = isWinnerA ? colorA : colorB;

  // ── Background: surface-colored court ────────────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.bgTop);
  bg.addColorStop(1, theme.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Stylized court markings, subtle, behind everything
  ctx.save();
  ctx.globalAlpha = 0.22;
  const courtX = 150, courtY = 140, courtW = W - 300, courtH = 420;
  ctx.fillStyle = theme.court;
  ctx.fillRect(courtX, courtY, courtW, courtH);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(courtX, courtY, courtW, courtH);
  // singles sidelines
  ctx.strokeRect(courtX + 70, courtY, courtW - 140, courtH);
  // net (center vertical) + service lines + center service line
  ctx.beginPath();
  ctx.moveTo(W / 2, courtY); ctx.lineTo(W / 2, courtY + courtH);
  ctx.moveTo(W / 2 - 190, courtY); ctx.lineTo(W / 2 - 190, courtY + courtH);
  ctx.moveTo(W / 2 + 190, courtY); ctx.lineTo(W / 2 + 190, courtY + courtH);
  ctx.moveTo(W / 2 - 190, courtY + courtH / 2); ctx.lineTo(W / 2 + 190, courtY + courtH / 2);
  ctx.stroke();
  ctx.restore();

  // Winner-side glow wash
  const [wr, wg, wb] = hexToRgb(winnerColor);
  const glow = ctx.createLinearGradient(isWinnerA ? 0 : W, 0, isWinnerA ? W / 2 : W / 2, 0);
  glow.addColorStop(0, `rgba(${wr},${wg},${wb},0.28)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(isWinnerA ? 0 : W / 2, 0, W / 2, H);

  // Dark scrim so text pops over court lines
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, 0, W, H);

  // ── Load images ───────────────────────────────────────────────────────────
  const [imgA, imgB, flagA, flagB] = await Promise.all([
    imageSrcA ? loadImg(imageSrcA) : Promise.resolve(null),
    imageSrcB ? loadImg(imageSrcB) : Promise.resolve(null),
    flagSrcA ? loadImg(flagSrcA) : Promise.resolve(null),
    flagSrcB ? loadImg(flagSrcB) : Promise.resolve(null),
  ]);

  // ── Top: tournament label + verdict headline ─────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(
    [tournamentLabel, surfaceLabel].filter(Boolean).join(' · ').toUpperCase(),
    W / 2, 46
  );

  const straightSets = !!scoreline && /–0$/.test(scoreline);
  const verdict = pickVerdict({ favShare, straightSets, binom10 });
  ctx.font = 'bold 58px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 12;
  ctx.fillText(verdict.headline, W / 2, 108);
  ctx.shadowBlur = 0;

  ctx.font = 'italic 600 23px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(verdict.tagline, W / 2, 142);

  // Confetti behind the winner's photo
  drawConfetti(ctx, isWinnerA ? 'left' : 'right', winnerColor, winnerName, W, H);

  // ── Photos ────────────────────────────────────────────────────────────────
  const photoR = 100;
  const photoY = 268;
  const photoXA = 220;
  const photoXB = W - 220;

  const drawSide = (img, cx, color, isWinner, fallbackColor) => {
    // ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, photoY, photoR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isWinner ? 6 : 2;
    ctx.globalAlpha = isWinner ? 1 : 0.35;
    ctx.stroke();
    ctx.restore();
    if (img) {
      drawCircularPhoto(ctx, img, cx, photoY, photoR, !isWinner);
    } else {
      const [r, g, b] = hexToRgb(fallbackColor);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, photoY, photoR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.25)`;
      ctx.fill();
      ctx.restore();
    }
  };

  drawSide(imgA, photoXA, colorA, isWinnerA, colorA);
  drawSide(imgB, photoXB, colorB, !isWinnerA, colorB);

  // WINS ribbon overlapping the winner's photo bottom
  const ribbonCx = isWinnerA ? photoXA : photoXB;
  const ribbonColor = winnerColor === '#fff200' || winnerColor === '#FFD700' ? '#c8a800' : winnerColor;
  ctx.save();
  roundRectPath(ctx, ribbonCx - 55, photoY + photoR - 18, 110, 34, 17);
  ctx.fillStyle = ribbonColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText('WINS', ribbonCx, photoY + photoR);
  ctx.restore();

  // Center stage: the predicted scoreline, big — the "final score" of the sim
  ctx.textBaseline = 'middle';
  if (scoreline) {
    ctx.font = '600 17px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('PREDICTED SCORE', W / 2, photoY - 62);
    ctx.font = 'bold 88px Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = winnerColor;
    ctx.shadowBlur = 26;
    ctx.fillText(scoreline, W / 2, photoY + 4);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('IN SETS', W / 2, photoY + 62);
  } else {
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillText('VS', W / 2, photoY);
  }
  ctx.textBaseline = 'alphabetic';

  // ── Names + flags + world rank ────────────────────────────────────────────
  const nameY = photoY + photoR + 52;

  const drawNameBlock = (cx, player, flagImg, isWinner) => {
    const name = truncate(player.name);
    ctx.font = `${isWinner ? 'bold 30px' : '600 26px'} Arial, sans-serif`;
    const nameW = ctx.measureText(name).width;
    const flagW = 33, flagH = 23, gap = 10;
    const totalW = (flagImg ? flagW + gap : 0) + nameW;
    let startX = cx - totalW / 2;

    ctx.globalAlpha = isWinner ? 1 : 0.5;
    if (flagImg) {
      drawFlag(ctx, flagImg, startX, nameY - flagH / 2 - 3, flagW, flagH);
      startX += flagW + gap;
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(name, startX, nameY + 6);
    ctx.textAlign = 'center';

    const rank = player.us_seed;
    if (rank != null && rank !== '') {
      ctx.font = '600 17px Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`World No. ${rank}`, cx, nameY + 34);
    }
    ctx.globalAlpha = 1;
  };

  drawNameBlock(photoXA, playerA, flagA, isWinnerA);
  drawNameBlock(photoXB, playerB, flagB, !isWinnerA);

  // ── Dominance bar (no numbers — the lean says it all) ────────────────────
  const barY = 462, barH = 16, barX = 240, barW = W - 480, barR = barH / 2;
  const split = barX + barW * (isWinnerA ? favShare : 1 - favShare);

  ctx.save();
  roundRectPath(ctx, barX, barY, barW, barH, barR);
  ctx.clip();
  // left segment = player A, right = player B; winner side vivid, loser muted
  const [ra, ga, ba] = hexToRgb(colorA);
  const [rb, gb, bb] = hexToRgb(colorB);
  ctx.fillStyle = isWinnerA ? `rgb(${ra},${ga},${ba})` : `rgba(${ra},${ga},${ba},0.30)`;
  ctx.fillRect(barX, barY, split - barX, barH);
  ctx.fillStyle = isWinnerA ? `rgba(${rb},${gb},${bb},0.30)` : `rgb(${rb},${gb},${bb})`;
  ctx.fillRect(split, barY, barX + barW - split, barH);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, barX, barY, barW, barH, barR);
  ctx.stroke();
  // split notch
  ctx.fillStyle = '#fff';
  ctx.fillRect(split - 1.5, barY - 4, 3, barH + 8);

  // ── Chips row — just the confidence call, colored ─────────────────────────
  const chips = [];
  if (favShare < 0.60) {
    chips.push({ text: '⚠ Low confidence', bg: 'rgba(255,160,0,0.20)', border: 'rgba(255,160,0,0.55)', color: '#ffb74d' });
  } else if (binom10 >= 0.10) {
    const loserObj = isWinnerA ? playerB : playerA;
    const loserLast = loserObj.last || loserObj.name.split(' ').pop();
    chips.push({ text: `⚡ ${loserLast} steals a short series ${Math.round(binom10 * 100)}% of the time`, bg: 'rgba(100,160,255,0.18)', border: 'rgba(100,160,255,0.5)', color: '#8ecfff' });
  } else if (favShare >= 0.70) {
    chips.push({ text: '✓ High confidence', bg: 'rgba(76,175,80,0.20)', border: 'rgba(76,175,80,0.55)', color: '#81c784' });
  }

  const chipY = 512, chipH = 40, chipPad = 16, chipGap = 12;
  ctx.font = '600 17px Arial, sans-serif';
  const widths = chips.map(c => ctx.measureText(c.text).width + chipPad * 2);
  const rowW = widths.reduce((a, b) => a + b, 0) + chipGap * (chips.length - 1);
  let cxPos = W / 2 - rowW / 2;
  for (let i = 0; i < chips.length; i++) {
    const c = chips[i], cw = widths[i];
    roundRectPath(ctx, cxPos, chipY, cw, chipH, chipH / 2);
    ctx.fillStyle = c.bg || 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = c.border || 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = c.color || 'rgba(255,255,255,0.88)';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.text, cxPos + cw / 2, chipY + chipH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    cxPos += cw + chipGap;
  }

  // ── Footer: sims + branding + link ────────────────────────────────────────
  const host = (typeof window !== 'undefined' && window.location?.host) || '';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(`Based on ${simCount.toLocaleString()} simulated matches`, W / 2, 588);

  ctx.font = 'bold 17px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`⚡ SMASH! Simulator${host ? ` · ${host}` : ''} — run your own sim`, W / 2, 614);

  return canvas;
}
