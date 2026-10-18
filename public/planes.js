'use strict';
// Rysunki samolotów z boku (SVG), generowane z wymiarów każdego typu.

// [długość kadłuba m, średnica kadłuba m, silniki, usterzenie, dodatek]
// silniki: prop2 (turbośmigłowe na skrzydle), rear2 (z tyłu kadłuba), wing2, wing4
// usterzenie: T (na szczycie statecznika) lub low; dodatek: hump (747), double (A380)
const PLANE_SHAPES = {
  ATR42: [22.7, 2.6, 'prop2', 'T'], ATR72: [27.2, 2.6, 'prop2', 'T'], DH8D: [32.8, 2.7, 'prop2', 'T'],
  CRJ7: [32.3, 2.7, 'rear2', 'T'], CRJ9: [36.2, 2.7, 'rear2', 'T'],
  E175: [31.7, 3.0, 'wing2', 'low'], E190: [36.2, 3.0, 'wing2', 'low'], E290: [36.2, 3.0, 'wing2', 'low'],
  E195: [41.5, 3.0, 'wing2', 'low'], SU95: [29.9, 3.2, 'wing2', 'low'],
  BCS1: [35.0, 3.5, 'wing2', 'low'], BCS3: [38.7, 3.5, 'wing2', 'low'],
  A319: [33.8, 4.0, 'wing2', 'low'], A320C: [37.6, 4.0, 'wing2', 'low'], A320: [37.6, 4.0, 'wing2', 'low'],
  A321: [44.5, 4.0, 'wing2', 'low'], A21X: [44.5, 4.0, 'wing2', 'low'],
  B737: [33.6, 3.8, 'wing2', 'low'], B738: [39.5, 3.8, 'wing2', 'low'], B38M: [39.5, 3.8, 'wing2', 'low'],
  B3XM: [43.8, 3.8, 'wing2', 'low'], B752: [47.3, 3.8, 'wing2', 'low'], C919: [38.9, 4.0, 'wing2', 'low'],
  B763: [54.9, 5.0, 'wing2', 'low'], A333: [63.7, 5.6, 'wing2', 'low'], A339: [63.7, 5.6, 'wing2', 'low'],
  B788: [56.7, 5.8, 'wing2', 'low'], B789: [62.8, 5.8, 'wing2', 'low'], B78X: [68.3, 5.8, 'wing2', 'low'],
  A359: [66.8, 6.0, 'wing2', 'low'], A35K: [73.8, 6.0, 'wing2', 'low'],
  B772: [63.7, 6.2, 'wing2', 'low'], B77W: [73.9, 6.2, 'wing2', 'low'], B779: [76.7, 6.2, 'wing2', 'low'],
  B748: [76.3, 6.5, 'wing4', 'low', 'hump'], A388: [72.7, 8.4, 'wing4', 'low', 'double'],
};
const MAKER_COLORS = {
  Airbus: '#2563eb', Boeing: '#0e7490', Embraer: '#16a34a', Bombardier: '#dc2626', ATR: '#f59e0b',
  'De Havilland': '#7c3aed', Sukhoi: '#be123c', COMAC: '#e11d48',
};

function planeSvg(t) {
  const [L, realD, engines, tail, extra] = PLANE_SHAPES[t.id] || [40, 4, 'wing2', 'low'];
  const D = realD * 1.5; // kadłub trochę pogrubiony, żeby rysunek był czytelny w małym rozmiarze
  const W = 220, H = 76;
    const ht = realD * (extra === 'double' ? 1.2 : t.cat === 'wide' ? 1.35 : tail === 'T' ? 1.9 : 1.7); // wysokość statecznika
  // Większe samoloty są dłuższe, ale wszystkie dobrze widać; wysokie przeskalowujemy, by się zmieściły.
  const k = Math.min((70 + 1.9 * L) / L, (H - 6) / (1.28 * D + ht)), px = L * k;
  const x0 = (W - px) / 2, y0 = H - 4 - 0.78 * D * k;
  const color = MAKER_COLORS[t.maker] || '#64748b';
  const n = (v) => +v.toFixed(2);
  const pts = (arr) => arr.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  const s = 'vector-effect="non-scaling-stroke"';
  const top = -D / 2, bot = D / 2;
  const parts = [];

  // Silnik: gondola o długości le i średnicy de, środek przodu w (x, y).
  const nacelle = (x, y, le, de, far) => parts.push(
    `<path d="M${n(x)},${n(y - de / 2)} L${n(x + le * 0.8)},${n(y - de * 0.42)} L${n(x + le)},${n(y - de * 0.1)} L${n(x + le)},${n(y + de * 0.1)} L${n(x + le * 0.8)},${n(y + de * 0.42)} L${n(x)},${n(y + de / 2)} Z" fill="${far ? '#94a3b8' : '#cbd5e1'}" stroke="#475569" ${s}/>`,
    `<rect x="${n(x)}" y="${n(y - de / 2)}" width="${n(le * 0.12)}" height="${n(de)}" fill="#334155"/>`,
  );

  // Daleki statecznik poziomy i daleki silnik (rysowane pod kadłubem).
  if (engines === 'wing4') {
    const le = 7.5, de = 4;
    nacelle(0.36 * L, bot + de * 0.25, le, de, true);
  }

  // Kadłub: zaokrąglony nos, prosta część, ogon podniesiony do góry.
  parts.push(`<path d="M0,${n(0.15 * D)} C0,${n(-0.35 * D)} ${n(0.5 * D)},${n(top)} ${n(1.8 * D)},${n(top)} L${n(0.8 * L)},${n(top)} L${n(L)},${n(-0.42 * D)} L${n(L)},${n(-0.22 * D)} L${n(0.7 * L)},${n(bot)} L${n(1.2 * D)},${n(bot)} C${n(0.4 * D)},${n(bot)} 0,${n(0.45 * D)} 0,${n(0.15 * D)} Z" fill="#f1f5f9" stroke="#64748b" ${s}/>`);
  if (extra === 'hump') {
    const hy = top - 0.32 * D; // górny pokład 747
    parts.push(`<path d="M${n(0.03 * L)},${n(top + 0.03 * D)} C${n(0.07 * L)},${n(hy)} ${n(0.1 * L)},${n(hy)} ${n(0.14 * L)},${n(hy)} L${n(0.26 * L)},${n(hy)} C${n(0.3 * L)},${n(hy)} ${n(0.31 * L)},${n(top)} ${n(0.34 * L)},${n(top)} Z" fill="#f1f5f9" stroke="#64748b" ${s}/>`);
    parts.push(`<rect x="${n(0.04 * L)}" y="${n(top - 0.03 * D)}" width="${n(0.29 * L)}" height="${n(0.08 * D)}" fill="#f1f5f9"/>`);
    parts.push(`<line x1="${n(0.12 * L)}" y1="${n(top - 0.14 * D)}" x2="${n(0.27 * L)}" y2="${n(top - 0.14 * D)}" stroke="#1e3a5f" stroke-width="0.35" stroke-dasharray="0.45 0.55"/>`);
  }
  // Pasek w kolorze producenta, okna pasażerskie i okna kokpitu.
  parts.push(`<path d="M${n(0.3 * D)},${n(0.12 * D)} L${n(0.72 * L)},${n(0.12 * D)} L${n(0.7 * L)},${n(0.2 * D)} L${n(0.4 * D)},${n(0.2 * D)} Z" fill="${color}"/>`);
  const rows = extra === 'double' ? [-0.28 * D, -0.02 * D] : [-0.12 * D];
  for (const y of rows) {
    parts.push(`<line x1="${n(1.3 * D + 0.04 * L)}" y1="${n(y)}" x2="${n(0.76 * L)}" y2="${n(y)}" stroke="#1e3a5f" stroke-width="${n(Math.min(0.09 * D, 0.38))}" stroke-dasharray="${n(Math.min(0.12 * D, 0.45))} ${n(Math.min(0.14 * D, 0.55))}"/>`);
  }
  parts.push(`<path d="M${n(0.35 * D)},${n(-0.12 * D)} L${n(0.55 * D)},${n(-0.33 * D)} L${n(1.05 * D)},${n(-0.37 * D)} L${n(1.0 * D)},${n(-0.12 * D)} Z" fill="#1e293b"/>`);

  // Statecznik pionowy w kolorze producenta i statecznik poziomy.
  const finTop = top - ht;
  parts.push(`<path d="M${n(0.78 * L)},${n(top)} L${n(0.9 * L)},${n(finTop)} L${n(0.97 * L)},${n(finTop)} L${n(L)},${n(-0.42 * D)} Z" fill="${color}" stroke="#334155" ${s}/>`);
  if (tail === 'T') {
    parts.push(`<path d="M${n(0.87 * L)},${n(finTop + 0.05 * D)} L${n(0.99 * L)},${n(finTop - 0.06 * D)} L${n(0.99 * L)},${n(finTop + 0.1 * D)} L${n(0.89 * L)},${n(finTop + 0.18 * D)} Z" fill="#475569"/>`);
  } else {
    parts.push(`<path d="M${n(0.84 * L)},${n(-0.12 * D)} L${n(0.99 * L)},${n(-0.3 * D)} L${n(0.995 * L)},${n(-0.18 * D)} L${n(0.87 * L)},${n(0.02 * D)} Z" fill="#94a3b8" stroke="#475569" ${s}/>`);
  }

  // Skrzydło: górnopłat dla turbośmigłowych, dolnopłat dla odrzutowców.
  if (engines === 'prop2') {
    parts.push(`<path d="M${n(0.37 * L)},${n(top - 0.18 * D)} L${n(0.55 * L)},${n(top - 0.18 * D)} L${n(0.56 * L)},${n(top + 0.02 * D)} L${n(0.38 * L)},${n(top + 0.02 * D)} Z" fill="#cbd5e1" stroke="#475569" ${s}/>`);
    const y = top + 0.1 * D, x = 0.33 * L;
    parts.push(`<path d="M${n(x)},${n(y - 0.8)} L${n(x + 0.22 * L)},${n(y - 0.6)} L${n(x + 0.22 * L)},${n(y + 0.4)} L${n(x + 0.03 * L)},${n(y + 1.1)} L${n(x)},${n(y + 0.8)} Z" fill="#e2e8f0" stroke="#475569" ${s}/>`);
    parts.push(`<ellipse cx="${n(x - 0.3)}" cy="${n(y)}" rx="0.3" ry="2.6" fill="#64748b" opacity=".8"/>`);
    parts.push(`<circle cx="${n(x - 0.3)}" cy="${n(y)}" r="0.5" fill="#334155"/>`);
  } else {
    parts.push(`<path d="M${n(0.34 * L)},${n(0.28 * D)} L${n(0.5 * L)},${n(0.3 * D)} L${n(0.6 * L)},${n(0.42 * D)} L${n(0.37 * L)},${n(0.46 * D)} Z" fill="#cbd5e1" stroke="#475569" ${s}/>`);
  }
  if (engines === 'rear2') {
    const le = 4.8, de = 1.9;
    parts.push(`<rect x="${n(0.7 * L + 0.8)}" y="${n(top - 0.1 * D)}" width="1.4" height="${n(0.3 * D)}" fill="#94a3b8"/>`);
    nacelle(0.66 * L, top - 0.12 * D, le, de);
  } else if (engines !== 'prop2') {
    const big = t.cat === 'wide', le = 1.4 * (big ? (L > 70 ? 7 : 6) : t.cat === 'regional' ? 3.4 : 4.4);
    const de = 1.4 * (big ? (t.id.startsWith('B77') ? 3.8 : 3.2) : t.cat === 'regional' ? 1.6 : 2.1);
    const x = (engines === 'wing4' ? 0.26 : 0.31) * L - le * 0.4;
    nacelle(x, bot + de * 0.3, le, de);
  }

  // Podwozie.
  const wheel = Math.max(0.45, 0.13 * D);
  for (const gx of [0.12 * L, 0.5 * L]) {
    parts.push(`<line x1="${n(gx)}" y1="${n(bot - 0.05)}" x2="${n(gx)}" y2="${n(bot + 0.2 * D)}" stroke="#94a3b8" stroke-width="${n(Math.max(0.25, 0.05 * D))}"/>`);
    parts.push(`<circle cx="${n(gx)}" cy="${n(bot + 0.2 * D)}" r="${n(wheel)}" fill="#475569" stroke="#94a3b8" ${s}/>`);
  }

  return `<svg class="plane" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t.name}"><g transform="translate(${n(x0)},${n(y0)}) scale(${n(k)})">${parts.join('')}</g></svg>`;
}
