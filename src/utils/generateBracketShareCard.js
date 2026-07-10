import {
  drawCircularPhoto,
  loadImg,
  hexToRgb,
  roundRectPath,
  drawFlag,
  truncate,
  drawConfetti,
  SURFACE_THEMES,
} from './generateShareCard';

const GOLD = '#f5c542';

/**
 * Generates a 1200×630 share card for a completed Dream Bracket - the
 * simulated champion front and center, with the beaten finalist and the
 * bracket's shape as supporting detail.
 *
 * @param {object} opts
 * @param {object}  opts.champion        - roster row (name, last, country, us_seed)
 * @param {object}  [opts.runnerUp]      - the player beaten in the final
 * @param {string}  [opts.imageSrc]      - champion photo URL
 * @param {string}  [opts.runnerUpImageSrc]
 * @param {string}  [opts.flagSrc]       - champion country flag URL
 * @param {string}  [opts.runnerUpFlagSrc]
 * @param {string}  opts.surfaceKey      - 'hard' | 'clay' | 'grass'
 * @param {string}  opts.tournamentLabel - 'Wimbledon'
 * @param {string}  opts.stageLabel      - 'Round of 16'
 * @param {number}  opts.slotCount       - 16 | 8 | 4 | 2
 * @param {number}  opts.simsPerMatch
 * @param {boolean} [opts.upsetMode]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateBracketShareCard({
  champion,
  runnerUp = null,
  imageSrc,
  runnerUpImageSrc,
  flagSrc,
  runnerUpFlagSrc,
  surfaceKey = 'hard',
  tournamentLabel = '',
  stageLabel = '',
  slotCount = 8,
  simsPerMatch = 1000,
  upsetMode = false,
}) {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const theme = SURFACE_THEMES[surfaceKey] || SURFACE_THEMES.hard;

  // ── Background: surface gradient + faint bracket-tree motif ──────────────
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.bgTop);
  bg.addColorStop(1, theme.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faint bracket elbows on both sides converging toward the middle
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 3;
  const drawTree = (xEdge, dir) => {
    // dir: +1 grows from left edge, -1 from right edge
    const seedYs = [150, 250, 350, 450];
    const midYs = [200, 400];
    const x1 = xEdge, x2 = xEdge + dir * 90, x3 = xEdge + dir * 180;
    for (let i = 0; i < 4; i += 2) {
      const yA = seedYs[i], yB = seedYs[i + 1], yMid = (yA + yB) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, yA); ctx.lineTo(x2, yA); ctx.lineTo(x2, yB);
      ctx.moveTo(x1, yB); ctx.lineTo(x2, yB);
      ctx.moveTo(x2, yMid); ctx.lineTo(x3, yMid);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x3, midYs[0]); ctx.lineTo(x3 + dir * 60, midYs[0]);
    ctx.lineTo(x3 + dir * 60, midYs[1]); ctx.lineTo(x3, midYs[1]);
    ctx.moveTo(x3 + dir * 60, 300); ctx.lineTo(x3 + dir * 120, 300);
    ctx.stroke();
  };
  drawTree(0, 1);
  drawTree(W, -1);
  ctx.restore();

  // Golden center glow behind the champion
  const [gr, gg, gb] = hexToRgb(GOLD);
  const glow = ctx.createRadialGradient(W / 2, 270, 40, W / 2, 270, 380);
  glow.addColorStop(0, `rgba(${gr},${gg},${gb},0.22)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // ── Load images ───────────────────────────────────────────────────────────
  const [img, flag, ruImg, ruFlag] = await Promise.all([
    imageSrc ? loadImg(imageSrc) : Promise.resolve(null),
    flagSrc ? loadImg(flagSrc) : Promise.resolve(null),
    runnerUpImageSrc ? loadImg(runnerUpImageSrc) : Promise.resolve(null),
    runnerUpFlagSrc ? loadImg(runnerUpFlagSrc) : Promise.resolve(null),
  ]);

  // Confetti on both halves, gold-seeded
  drawConfetti(ctx, 'left', GOLD, champion.name, W, H);
  drawConfetti(ctx, 'right', GOLD, champion.name.split('').reverse().join(''), W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // ── Top: tournament + headline ────────────────────────────────────────────
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`${tournamentLabel.toUpperCase()} · DREAM BRACKET`, W / 2, 46);

  ctx.font = 'bold 54px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 12;
  ctx.fillText('🏆 SIMULATED CHAMPION', W / 2, 110);
  ctx.shadowBlur = 0;

  // ── Champion photo, gold ring ─────────────────────────────────────────────
  const photoR = 118;
  const photoY = 282;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, photoY, photoR + 8, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();
  if (img) {
    drawCircularPhoto(ctx, img, W / 2, photoY, photoR);
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, photoY, photoR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${gr},${gg},${gb},0.20)`;
    ctx.fill();
    ctx.restore();
  }

  // CHAMPION ribbon over photo bottom
  ctx.save();
  roundRectPath(ctx, W / 2 - 82, photoY + photoR - 18, 164, 36, 18);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.fillStyle = '#231a02';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHAMPION', W / 2, photoY + photoR + 1);
  ctx.restore();

  // ── Champion name + flag + rank ───────────────────────────────────────────
  const nameY = photoY + photoR + 58;
  const name = truncate(champion.name, 24);
  ctx.font = 'bold 36px Arial, sans-serif';
  const nameW = ctx.measureText(name).width;
  const flagW = 40, flagH = 28, gap = 12;
  const totalW = (flag ? flagW + gap : 0) + nameW;
  let startX = W / 2 - totalW / 2;
  if (flag) {
    drawFlag(ctx, flag, startX, nameY - flagH / 2 - 6, flagW, flagH);
    startX += flagW + gap;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, startX, nameY + 6);
  ctx.textAlign = 'center';

  if (champion.us_seed != null && champion.us_seed !== '') {
    ctx.font = '600 18px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`World No. ${champion.us_seed}`, W / 2, nameY + 36);
  }

  // ── Beaten finalist ───────────────────────────────────────────────────────
  if (runnerUp) {
    const ruX = W - 190, ruY = 262, ruR = 62;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(ruX, ruY, ruR + 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (ruImg) drawCircularPhoto(ctx, ruImg, ruX, ruY, ruR, true);
    ctx.restore();

    ctx.font = '600 15px Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('DEFEATED IN THE FINAL', ruX, ruY + ruR + 24);

    const ruName = truncate(runnerUp.name, 22);
    ctx.font = '600 19px Arial, sans-serif';
    const ruNameW = ctx.measureText(ruName).width;
    const ruFlagW = 24, ruFlagH = 17, ruGap = 8;
    const ruTotal = (ruFlag ? ruFlagW + ruGap : 0) + ruNameW;
    let ruStart = ruX - ruTotal / 2;
    ctx.save();
    ctx.globalAlpha = 0.8;
    if (ruFlag) {
      drawFlag(ctx, ruFlag, ruStart, ruY + ruR + 34, ruFlagW, ruFlagH);
      ruStart += ruFlagW + ruGap;
    }
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(ruName, ruStart, ruY + ruR + 48);
    ctx.restore();
    ctx.textAlign = 'center';
  }

  // ── Chips: bracket shape + sims + upset mode ─────────────────────────────
  const chips = [
    { text: `${stageLabel} bracket · ${slotCount} players` },
    { text: `${simsPerMatch.toLocaleString()} sims per match` },
  ];
  if (upsetMode) {
    chips.push({ text: '⚡ Upset scenario stats', bg: 'rgba(100,160,255,0.18)', border: 'rgba(100,160,255,0.5)', color: '#8ecfff' });
  }

  const chipY = 520, chipH = 40, chipPad = 16, chipGap = 12;
  ctx.font = '600 17px Arial, sans-serif';
  const widths = chips.map(c => ctx.measureText(c.text).width + chipPad * 2);
  const rowW = widths.reduce((a, b) => a + b, 0) + chipGap * (chips.length - 1);
  let cx = W / 2 - rowW / 2;
  for (let i = 0; i < chips.length; i++) {
    const c = chips[i], cw = widths[i];
    roundRectPath(ctx, cx, chipY, cw, chipH, chipH / 2);
    ctx.fillStyle = c.bg || 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = c.border || 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = c.color || 'rgba(255,255,255,0.88)';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.text, cx + cw / 2, chipY + chipH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    cx += cw + chipGap;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const host = (typeof window !== 'undefined' && window.location?.host) || '';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('Every round decided by Monte Carlo simulation', W / 2, 588);

  ctx.font = 'bold 17px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(`⚡ SMASH! Simulator${host ? ` · ${host}` : ''} · build your own bracket`, W / 2, 614);

  return canvas;
}
