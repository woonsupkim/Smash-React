// src/components/EloChart.js
//
// The Elo form curve, shared by the player page (one series) and the H2H
// why-panel (two players overlaid - "their form lines crossed" is the
// visual argument for every Form-engine pick). Hand-rolled SVG in the same
// family as the app's sparklines; grand slam starts are marked with dashed
// lines (AO, RG, W, UO).
import React from 'react';

// Grand slam start dates (same calendar rules as Home and the pipeline).
export function slamMarks(fromMs, toMs) {
  const nthMonday = (y, mo, n) => {
    const d = new Date(Date.UTC(y, mo, 1));
    return Date.UTC(y, mo, 1 + ((8 - d.getUTCDay()) % 7) + (n - 1) * 7);
  };
  const lastWeekday = (y, mo, wd) => {
    const d = new Date(Date.UTC(y, mo + 1, 0));
    return Date.UTC(y, mo, d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7));
  };
  const out = [];
  for (let y = new Date(fromMs).getUTCFullYear(); y <= new Date(toMs).getUTCFullYear(); y++) {
    out.push(
      { t: nthMonday(y, 0, 3), label: 'AO' },
      { t: lastWeekday(y, 4, 0), label: 'RG' },
      { t: lastWeekday(y, 5, 1), label: 'W' },
      { t: lastWeekday(y, 7, 1), label: 'UO' },
    );
  }
  return out.filter((s) => s.t >= fromMs && s.t <= toMs);
}

// series: [{ points: [[dateStr, rating], ...], color, label }]
export default function EloChart({ series, height = 190, ariaLabel }) {
  const usable = (series || []).filter((s) => s.points && s.points.length >= 4);
  if (!usable.length) return null;
  const W = 640, H = height, PAD = { l: 46, r: 58, t: 14, b: 26 };
  const parsed = usable.map((s) => ({
    ...s,
    pts: s.points.map(([d, r]) => ({ t: new Date(d + 'T00:00:00Z').getTime(), r })),
  }));
  const allPts = parsed.flatMap((s) => s.pts);
  const t0 = Math.min(...allPts.map((p) => p.t));
  const t1 = Math.max(...allPts.map((p) => p.t));
  const rMin = Math.min(...allPts.map((p) => p.r));
  const rMax = Math.max(...allPts.map((p) => p.r));
  const span = Math.max(rMax - rMin, 40);
  const lo = rMin - span * 0.12, hi = rMax + span * 0.12;
  const x = (t) => PAD.l + ((t - t0) / Math.max(t1 - t0, 1)) * (W - PAD.l - PAD.r);
  const y = (r) => H - PAD.b - ((r - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const marks = slamMarks(t0, t1);
  const grid = [Math.round(rMin / 50) * 50, Math.round(((rMin + rMax) / 2) / 50) * 50, Math.round(rMax / 50) * 50];
  const label = ariaLabel
    || `Form rating over time for ${usable.map((s) => s.label).join(' and ')}, grand slam starts marked`;
  return (
    <svg className="elo-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {grid.map((g) => (
        <g key={g}>
          <line x1={PAD.l} y1={y(g)} x2={W - PAD.r} y2={y(g)} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <text x={PAD.l - 6} y={y(g) + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">{g}</text>
        </g>
      ))}
      {marks.map((s) => (
        <g key={s.t}>
          <line x1={x(s.t)} y1={PAD.t} x2={x(s.t)} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="3 4" />
          <text x={x(s.t)} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill="var(--text-3)">{s.label}</text>
        </g>
      ))}
      {parsed.map((s) => {
        const pts = s.pts.map((p) => `${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
        const last = s.pts[s.pts.length - 1];
        return (
          <g key={s.label}>
            <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />
            <circle cx={x(last.t)} cy={y(last.r)} r="3.5" fill={s.color} />
            <text x={Math.min(x(last.t) + 8, W - 4)} y={y(last.r) + 4} fontSize="12" fontWeight="700" fill={s.color}>{last.r}</text>
          </g>
        );
      })}
    </svg>
  );
}
