// Clip image to a circle, biased toward the upper portion so faces show.
function drawCircularPhoto(ctx, img, cx, cy, radius, dimmed = false) {
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  const aspect = img.width / img.height;
  let sw = radius * 2, sh = radius * 2;
  if (aspect > 1) sw = sh * aspect;
  else sh = sw / aspect;
  // Shift image down so the face (upper ~25% of portrait) lands near circle center
  const faceShift = sh * 0.25;
  ctx.drawImage(img, cx - sw / 2, cy - sh / 2 + faceShift, sw, sh);
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

// Draw a flag image as a small rounded rectangle.
function drawFlag(ctx, flagImg, x, y, w, h) {
  if (!flagImg) return;
  ctx.save();
  const r = 3;
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
  ctx.clip();
  ctx.drawImage(flagImg, x, y, w, h);
  ctx.restore();
}

/**
 * Generates a 1200×630 share card.
 *
 * @param {object} opts
 * @param {{ name: string }}  opts.playerA
 * @param {{ name: string }}  opts.playerB
 * @param {string}  opts.winnerName       — playerA.name or playerB.name
 * @param {string}  opts.colorA
 * @param {string}  opts.colorB
 * @param {string}  [opts.imageSrcA]
 * @param {string}  [opts.imageSrcB]
 * @param {string}  [opts.flagSrcA]       — URL of player A country flag
 * @param {string}  [opts.flagSrcB]
 * @param {object}  [opts.confidence]     — { type: 'high'|'low'|null, underdog: bool, underdogName: string, underdogPct: number }
 * @param {string}  opts.tournamentLabel
 * @param {string}  opts.surfaceLabel
 * @param {number}  opts.simCount
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generateShareCard({
  playerA, playerB,
  winnerName,
  colorA = '#0033A0',
  colorB = '#FFD700',
  imageSrcA, imageSrcB,
  flagSrcA, flagSrcB,
  confidence = null,
  tournamentLabel = '',
  surfaceLabel = '',
  simCount = 1000,
}) {
  const W = 1200, H = 630;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const isWinnerA = winnerName === playerA.name;
  const [rA, gA, bA] = hexToRgb(colorA);
  const [rB, gB, bB] = hexToRgb(colorB);

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, W, H);

  // Winner side gets a stronger color wash; loser side is muted
  const winnerAlpha = 0.38;
  const loserAlpha = 0.10;

  const gradL = ctx.createLinearGradient(0, 0, W / 2, 0);
  gradL.addColorStop(0, `rgba(${rA},${gA},${bA},${isWinnerA ? winnerAlpha : loserAlpha})`);
  gradL.addColorStop(1, `rgba(${rA},${gA},${bA},0.03)`);
  ctx.fillStyle = gradL;
  ctx.fillRect(0, 0, W / 2, H);

  const gradR = ctx.createLinearGradient(W / 2, 0, W, 0);
  gradR.addColorStop(0, `rgba(${rB},${gB},${bB},0.03)`);
  gradR.addColorStop(1, `rgba(${rB},${gB},${bB},${isWinnerA ? loserAlpha : winnerAlpha})`);
  ctx.fillStyle = gradR;
  ctx.fillRect(W / 2, 0, W / 2, H);

  // Center vignette
  const vig = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(0.5, 'rgba(0,0,0,0.30)');
  vig.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vig;
  ctx.fillRect(W / 2 - 60, 0, 120, H);

  // ── Load images in parallel ───────────────────────────────────────────────
  const [imgA, imgB, flagA, flagB] = await Promise.all([
    imageSrcA ? loadImg(imageSrcA) : Promise.resolve(null),
    imageSrcB ? loadImg(imageSrcB) : Promise.resolve(null),
    flagSrcA ? loadImg(flagSrcA) : Promise.resolve(null),
    flagSrcB ? loadImg(flagSrcB) : Promise.resolve(null),
  ]);

  const photoR = 112;
  const photoY = 255;
  const photoXA = 210;
  const photoXB = W - 210;

  // ── Photo rings + photos ──────────────────────────────────────────────────
  const drawPhotoRing = (cx, color, isWinner) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, photoY, photoR + 6, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = isWinner ? 5 : 2;
    ctx.globalAlpha = isWinner ? 1 : 0.35;
    ctx.stroke();
    ctx.restore();
  };

  if (imgA) {
    drawPhotoRing(photoXA, colorA, isWinnerA);
    drawCircularPhoto(ctx, imgA, photoXA, photoY, photoR, !isWinnerA);
  } else {
    // Placeholder circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(photoXA, photoY, photoR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rA},${gA},${bA},0.25)`;
    ctx.fill();
    ctx.restore();
  }

  if (imgB) {
    drawPhotoRing(photoXB, colorB, !isWinnerA);
    drawCircularPhoto(ctx, imgB, photoXB, photoY, photoR, isWinnerA);
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(photoXB, photoY, photoR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${rB},${gB},${bB},0.25)`;
    ctx.fill();
    ctx.restore();
  }

  // ── VS / center divider ───────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2, 130);
  ctx.lineTo(W / 2, 430);
  ctx.stroke();

  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VS', W / 2, photoY);

  // ── Player names + flags ──────────────────────────────────────────────────
  const nameY = photoY + photoR + 44;

  const drawNameRow = (cx, playerName, flagImg, isWinner) => {
    const name = truncate(playerName);
    ctx.font = `${isWinner ? 'bold' : '600'} 28px Arial, sans-serif`;
    const nameW = ctx.measureText(name).width;
    const flagW = 34, flagH = 24, gap = 10;
    const totalW = (flagImg ? flagW + gap : 0) + nameW;
    let startX = cx - totalW / 2;

    ctx.globalAlpha = isWinner ? 1 : 0.45;
    if (flagImg) {
      drawFlag(ctx, flagImg, startX, nameY - flagH / 2 - 2, flagW, flagH);
      startX += flagW + gap;
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, startX, nameY);
    ctx.globalAlpha = 1;
  };

  drawNameRow(photoXA, playerA.name, flagA, isWinnerA);
  drawNameRow(photoXB, playerB.name, flagB, !isWinnerA);

  // ── WINS badge under winner ───────────────────────────────────────────────
  const winsY = nameY + 38;
  const drawWinsBadge = (cx, color) => {
    const bw = 120, bh = 36, br = 18;
    const bx = cx - bw / 2, by = winsY;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx + br, by);
    ctx.lineTo(bx + bw - br, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + br, br);
    ctx.lineTo(bx + bw, by + bh - br);
    ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
    ctx.lineTo(bx + br, by + bh);
    ctx.arcTo(bx, by + bh, bx, by + bh - br, br);
    ctx.lineTo(bx, by + br);
    ctx.arcTo(bx, by, bx + br, by, br);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = 'bold 15px Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WINS', cx, by + bh / 2);
    ctx.restore();
  };

  if (isWinnerA) {
    drawWinsBadge(photoXA, colorA === '#fff200' || colorA === '#FFD700' ? '#c8a800' : colorA);
  } else {
    drawWinsBadge(photoXB, colorB === '#fff200' || colorB === '#FFD700' ? '#c8a800' : colorB);
  }

  // ── Confidence tag ────────────────────────────────────────────────────────
  const confY = 510;
  if (confidence) {
    let tagText = '', tagBg = '', tagBorder = '', tagColor = '';

    if (confidence.underdog) {
      tagText = `⚡ Underdog Alert — ${confidence.underdogName} wins series ${confidence.underdogPct}% of the time`;
      tagBg = 'rgba(100,160,255,0.18)';
      tagBorder = 'rgba(100,160,255,0.5)';
      tagColor = '#8ecfff';
    } else if (confidence.type === 'high') {
      tagText = '✓ High Confidence';
      tagBg = 'rgba(76,175,80,0.18)';
      tagBorder = 'rgba(76,175,80,0.5)';
      tagColor = '#81c784';
    } else if (confidence.type === 'low') {
      tagText = '⚠ Low Confidence — toss-up matchup';
      tagBg = 'rgba(255,160,0,0.18)';
      tagBorder = 'rgba(255,160,0,0.5)';
      tagColor = '#ffb74d';
    }

    if (tagText) {
      ctx.font = '600 18px Arial, sans-serif';
      const tw = ctx.measureText(tagText).width;
      const ph = 14, pv = 10;
      const bw = tw + ph * 2, bh = 36 + pv;
      const bx = W / 2 - bw / 2, by = confY;
      const br = bh / 2;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(bx + br, by);
      ctx.lineTo(bx + bw - br, by);
      ctx.arcTo(bx + bw, by, bx + bw, by + br, br);
      ctx.lineTo(bx + bw, by + bh - br);
      ctx.arcTo(bx + bw, by + bh, bx + bw - br, by + bh, br);
      ctx.lineTo(bx + br, by + bh);
      ctx.arcTo(bx, by + bh, bx, by + bh - br, br);
      ctx.lineTo(bx, by + br);
      ctx.arcTo(bx, by, bx + br, by, br);
      ctx.closePath();
      ctx.fillStyle = tagBg;
      ctx.fill();
      ctx.strokeStyle = tagBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = tagColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tagText, W / 2, by + bh / 2);
      ctx.restore();
    }
  }

  // ── Tournament info + branding ────────────────────────────────────────────
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const infoLine = [tournamentLabel, surfaceLabel].filter(Boolean).join(' · ');
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.40)';
  ctx.fillText(infoLine, W / 2, 575);

  ctx.font = '16px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText(`Based on ${simCount.toLocaleString()} simulated matches`, W / 2, 600);

  ctx.font = 'bold 16px Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillText('⚡ SMASH! Simulator', W / 2, 622);

  return canvas;
}
