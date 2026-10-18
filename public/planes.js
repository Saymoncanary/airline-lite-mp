'use strict';
// Rysunki samolotów z boku (SVG). Każdy typ jest rysowany z prawdziwych wymiarów:
// długości i wysokości kadłuba, rozpiętości i skosu skrzydeł, wielkości silników,
// wysokości statecznika i podwozia. Jednostką rysunku jest metr.

// Kształty nosa: [długość w średnicach kadłuba, wysokość czubka (+ = poniżej osi),
// tępość góry, jak daleko sięga krzywizna góry]
const NOSES = {
  airbus: [1.7, 0.05, 0.42, 0.35], a220: [1.85, 0.1, 0.3, 0.42], b737: [2.1, 0.2, 0.22, 0.45],
  b757: [2.25, 0.22, 0.2, 0.5], b777: [1.9, 0.12, 0.3, 0.45], b787: [2.05, 0.06, 0.24, 0.62],
  a350: [1.9, 0.06, 0.3, 0.52], a380: [1.25, 0.12, 0.5, 0.3], b747: [1.6, 0.15, 0.3, 0.4],
  ejet: [2.0, 0.12, 0.25, 0.45], crj: [2.4, 0.18, 0.18, 0.5], atr: [1.6, 0.15, 0.32, 0.4], dash: [1.85, 0.16, 0.25, 0.45],
};

// Rodziny samolotów: wspólne proporcje (gear = wysokość podwozia pod kadłubem, rootX = gdzie
// zaczyna się skrzydło jako część długości, sweep/dih = skos i wznios skrzydła w stopniach).
const FAMILIES = {
  atr: { nose: 'atr', D: 2.6, gear: 0.55, sweep: 3, dih: 0, rootX: 0.41, root: 0.095, tip: 0.6, tail: 'T', tailLen: 3.0, finSweep: 38, wing: 'high', prop: 3.93, wheel: 0.33 },
  dash: { nose: 'dash', D: 2.7, gear: 1.0, sweep: 3, dih: 2.5, rootX: 0.37, root: 0.095, tip: 0.55, tail: 'T', tailLen: 2.9, finSweep: 32, wing: 'high', prop: 4.1, wheel: 0.4 },
  crj: { nose: 'crj', D: 2.7, gear: 0.7, sweep: 26, dih: 3, rootX: 0.43, root: 0.17, tip: 0.3, tail: 'T', tailLen: 2.9, finSweep: 40, rear: true, wl: [1.1, 0], wheel: 0.36 },
  ejet: { nose: 'ejet', D: 3.0, gear: 1.0, sweep: 25, dih: 5, rootX: 0.37, root: 0.19, tip: 0.27, tailLen: 2.8, finSweep: 42, wl: [1.4, 0], wheel: 0.42 },
  a220: { nose: 'a220', D: 3.5, gear: 1.1, sweep: 26, dih: 5, rootX: 0.37, root: 0.18, tip: 0.27, tailLen: 2.7, finSweep: 40, wl: [0.6, 0], wheel: 0.5 },
  a320: { nose: 'airbus', D: 4.0, gear: 1.3, sweep: 27, dih: 5, rootX: 0.37, root: 0.19, tip: 0.25, tailLen: 2.6, finSweep: 40, wl: [2.4, 0.2], wheel: 0.56 },
  b737: { nose: 'b737', D: 3.8, gear: 0.85, sweep: 27, dih: 6, rootX: 0.38, root: 0.18, tip: 0.25, tailLen: 2.6, finSweep: 40, wl: [2.5, 0], wheel: 0.55 },
  b757: { nose: 'b757', D: 3.8, gear: 1.5, sweep: 27, dih: 6, rootX: 0.35, root: 0.2, tip: 0.25, tailLen: 2.7, finSweep: 40, wheel: 0.56 },
  wide: { nose: 'b777', D: 5.6, gear: 2.1, sweep: 32, dih: 5, rootX: 0.36, root: 0.21, tip: 0.24, tailLen: 2.3, finSweep: 42, wheel: 0.62 },
};

// Typy: rodzina + różnice. L = długość, H = wysokość całkowita, span = rozpiętość,
// eng = [długość gondoli, średnica], wl = [winglet w górę, w dół] (brak = końcówka skośna).
const PLANE_SPECS = {
  ATR42: { f: 'atr', L: 22.7, H: 7.6, span: 24.6, eng: [3.9, 1.1] },
  ATR72: { f: 'atr', L: 27.2, H: 7.65, span: 27.1, eng: [3.9, 1.1] },
  DH8D: { f: 'dash', L: 32.8, H: 8.3, span: 28.4, eng: [5.6, 1.25] },
  CRJ7: { f: 'crj', L: 32.3, H: 7.6, span: 23.2, eng: [3.3, 1.35] },
  CRJ9: { f: 'crj', L: 36.2, H: 7.5, span: 24.9, eng: [3.3, 1.35] },
  E175: { f: 'ejet', L: 31.7, H: 9.7, span: 26.0, eng: [3.3, 1.6] },
  E190: { f: 'ejet', L: 36.2, H: 10.6, span: 28.7, eng: [3.4, 1.7] },
  E290: { f: 'ejet', L: 36.2, H: 11.0, span: 33.7, eng: [3.8, 1.95], wl: [2.0, 0] },
  E195: { f: 'ejet', L: 41.5, H: 10.9, span: 35.1, eng: [3.8, 1.95], wl: [2.0, 0] },
  SU95: { f: 'ejet', L: 29.9, H: 10.3, span: 27.8, D: 3.2, eng: [3.6, 1.75], wl: [0.8, 0] },
  BCS1: { f: 'a220', L: 35.0, H: 11.5, span: 35.1, eng: [3.8, 2.0] },
  BCS3: { f: 'a220', L: 38.7, H: 11.5, span: 35.1, eng: [3.8, 2.0] },
  A319: { f: 'a320', L: 33.8, H: 11.8, span: 35.8, eng: [4.4, 2.35] },
  A320C: { f: 'a320', L: 37.6, H: 11.8, span: 35.8, eng: [4.0, 2.0] },
  A320: { f: 'a320', L: 37.6, H: 11.8, span: 35.8, eng: [4.4, 2.35] },
  A321: { f: 'a320', L: 44.5, H: 11.8, span: 35.8, eng: [4.4, 2.35] },
  A21X: { f: 'a320', L: 44.5, H: 11.8, span: 35.8, eng: [4.4, 2.35] },
  B737: { f: 'b737', L: 33.6, H: 12.5, span: 35.8, eng: [4.0, 1.95] },
  B738: { f: 'b737', L: 39.5, H: 12.5, span: 35.8, eng: [4.0, 1.95] },
  B38M: { f: 'b737', L: 39.5, H: 12.3, span: 35.9, eng: [4.3, 2.15], wl: [2.4, 0.9] },
  B3XM: { f: 'b737', L: 43.8, H: 12.3, span: 35.9, eng: [4.3, 2.15], wl: [2.4, 0.9], gear: 1.0 },
  B752: { f: 'b757', L: 47.3, H: 13.6, span: 38.0, eng: [5.0, 2.4], wl: [2.5, 0] },
  C919: { f: 'a320', L: 38.9, H: 11.95, span: 35.8, eng: [4.5, 2.35], wl: [2.0, 0] },
  B763: { f: 'wide', nose: 'b757', L: 54.9, H: 15.8, span: 47.6, D: 5.4, eng: [5.8, 2.75], sweep: 31, gear: 1.8 },
  A333: { f: 'wide', nose: 'airbus', L: 63.7, H: 16.8, span: 60.3, eng: [5.6, 3.0], wl: [2.7, 0] },
  A339: { f: 'wide', nose: 'airbus', L: 63.7, H: 16.8, span: 64.0, eng: [5.8, 3.25], wl: [3.0, 0] },
  B788: { f: 'wide', nose: 'b787', L: 56.7, H: 16.9, span: 60.1, D: 5.9, eng: [6.0, 3.2], gear: 1.9 },
  B789: { f: 'wide', nose: 'b787', L: 62.8, H: 17.0, span: 60.1, D: 5.9, eng: [6.0, 3.2], gear: 1.9 },
  B78X: { f: 'wide', nose: 'b787', L: 68.3, H: 17.0, span: 60.1, D: 5.9, eng: [6.0, 3.2], gear: 1.9 },
  A359: { f: 'wide', nose: 'a350', L: 66.8, H: 17.05, span: 64.75, D: 6.1, eng: [6.4, 3.3], wl: [2.6, 0], curved: true },
  A35K: { f: 'wide', nose: 'a350', L: 73.8, H: 17.08, span: 64.75, D: 6.1, eng: [6.6, 3.4], wl: [2.6, 0], curved: true, bogie: 3 },
  B772: { f: 'wide', nose: 'b777', L: 63.7, H: 18.5, span: 60.9, D: 6.2, eng: [7.3, 3.7], gear: 2.3, bogie: 3 },
  B77W: { f: 'wide', nose: 'b777', L: 73.9, H: 18.5, span: 64.8, D: 6.2, eng: [7.3, 3.7], gear: 2.3, bogie: 3 },
  B779: { f: 'wide', nose: 'b777', L: 76.7, H: 19.5, span: 71.8, D: 6.2, eng: [7.1, 3.9], gear: 2.4, bogie: 3 },
  B748: { f: 'wide', nose: 'b747', L: 76.3, H: 19.4, span: 68.4, D: 6.5, eng: [5.9, 3.0], sweep: 37, rootX: 0.3, gear: 2.4, quad: true, hump: true },
  A388: { f: 'wide', nose: 'a380', L: 72.7, H: 24.1, span: 79.8, D: 8.4, eng: [5.8, 3.3], sweep: 33, rootX: 0.33, gear: 2.6, quad: true, deck2: true, wl: [1.6, 0.9], wheel: 0.7, bogie: 3 },
};
const MAKER_COLORS = {
  Airbus: '#2563eb', Boeing: '#0e7490', Embraer: '#16a34a', Bombardier: '#dc2626', ATR: '#f59e0b',
  'De Havilland': '#7c3aed', Sukhoi: '#be123c', COMAC: '#e11d48',
};

function planeSvg(t) {
  const spec = PLANE_SPECS[t.id] || { f: 'a320', L: 38, H: 12, span: 35, eng: [4.4, 2.3] };
  const p = { ...FAMILIES[spec.f], ...spec };
  const { L, D, gear } = p;
  const color = MAKER_COLORS[t.maker] || '#64748b';
  const W = 220, VH = 76;
  const k = Math.min((125 + 1.25 * L) / L, (VH - 5) / p.H); // większe są dłuższe, ale wszystkie czytelne
  const x0 = (W - L * k) / 2, y0 = VH - 2.5 - (D / 2 + gear) * k;
  const n = (v) => +v.toFixed(2);
  const P = (pts) => pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
  const line = 'stroke="#475569" stroke-width="0.7" vector-effect="non-scaling-stroke" stroke-linejoin="round"';
  const top = -D / 2, bot = D / 2, ground = bot + gear;
  const out = [];

  // --- Kadłub ---------------------------------------------------------------
  const [nlD, tipY, blunt, reach] = NOSES[p.nose];
  const nl = nlD * Math.min(D, 6.2), yt = tipY * D;
  const tl = p.tailLen * Math.min(D, 6.2), xt = L - tl; // początek stożka ogonowego
  const tailTop = top + 0.2 * D, tailBot = top + 0.42 * D;
  // Krzywe nosa i ogona jako tablice punktów (potrzebne też do okien kokpitu).
  const bez = (a, b, c, d, steps = 16) => Array.from({ length: steps + 1 }, (_, i) => {
    const s = i / steps, u = 1 - s;
    return [u ** 3 * a[0] + 3 * u * u * s * b[0] + 3 * u * s * s * c[0] + s ** 3 * d[0], u ** 3 * a[1] + 3 * u * u * s * b[1] + 3 * u * s * s * c[1] + s ** 3 * d[1]];
  });
  let noseTop;
  if (p.hump) {
    const hy = top - 0.3 * D; // górny pokład Boeinga 747
    noseTop = [...bez([0, yt], [0, yt - 0.5 * D], [0.05 * L, hy], [0.15 * L, hy]),
      ...bez([0.29 * L, hy], [0.34 * L, hy], [0.36 * L, top], [0.42 * L, top])];
  } else {
    noseTop = bez([0, yt], [0, yt - blunt * D], [nl * reach, top], [nl, top]);
  }
  const noseBot = bez([nl * 0.9, bot], [nl * 0.3, bot], [0, yt + 0.28 * D], [0, yt]);
  const tailTopC = bez([xt + tl * 0.25, top], [xt + tl * 0.7, top], [L - 0.3, tailTop - 0.05 * D], [L, tailTop], 10);
  const tailBotC = bez([L, tailBot], [L - tl * 0.4, tailBot + 0.08 * D], [xt + tl * 0.3, bot], [xt, bot], 10);
  const hull = [...noseTop, ...tailTopC, [L, tailBot], ...tailBotC, ...noseBot];
  const yTopAt = (x) => { // wysokość górnej krawędzi nosa w punkcie x
    for (let i = 1; i < noseTop.length; i++) {
      const [ax, ay] = noseTop[i - 1], [bx, by] = noseTop[i];
      if (x >= ax && x <= bx) return ay + ((by - ay) * (x - ax)) / (bx - ax || 1);
    }
    return top;
  };

  // --- Statecznik pionowy (rysowany pod kadłubem) -----------------------------
  const hf = p.H - gear - D, crf = tl * (p.tail === 'T' ? 0.8 : 0.95);
  const fx = L - crf - tl * 0.12, tanF = Math.tan((p.finSweep * Math.PI) / 180);
  const finTipLE = fx + hf * tanF, finTip = top - hf, finTipC = crf * (p.tail === 'T' ? 0.62 : 0.38);
  out.push(`<path d="M${n(fx - crf * 0.45)},${n(top + 0.03 * D)} Q${n(fx - 0.05 * crf)},${n(top - 0.02 * D)} ${n(fx + 0.2 * hf * tanF)},${n(top - 0.2 * hf)} L${n(finTipLE)},${n(finTip)} L${n(finTipLE + finTipC)},${n(finTip)} L${n(fx + crf)},${n(tailTop + 0.1 * D)} Z" fill="${color}" ${line}/>`);
  out.push(`<line x1="${n(finTipLE + finTipC * 0.72)}" y1="${n(finTip + 0.3)}" x2="${n(fx + crf * 0.86)}" y2="${n(top - 0.05 * D)}" stroke="#0f172a" stroke-opacity=".25" stroke-width="0.6" vector-effect="non-scaling-stroke"/>`); // ster kierunku

  // Owiewka skrzydło-kadłub (pod kadłubem, wystaje tylko jej dół).
  const xr = p.rootX * L, cr = p.root * p.span;
  if (p.wing !== 'high') {
    out.push(`<path d="M${n(xr - 0.05 * L)},${n(bot - 0.1)} C${n(xr)},${n(bot + 0.11 * D)} ${n(xr + cr)},${n(bot + 0.11 * D)} ${n(xr + cr * 1.2)},${n(bot - 0.1)} Z" fill="#dde3ea" ${line}/>`);
  } else if (p.f === 'atr') {
    out.push(`<path d="M${n(xr - 0.4)},${n(bot - 0.1)} C${n(xr + 0.5)},${n(bot + 0.55)} ${n(xr + cr + 1.4)},${n(bot + 0.55)} ${n(xr + cr + 2.2)},${n(bot - 0.1)} Z" fill="#dde3ea" ${line}/>`); // gondole podwozia ATR
  }

  // Kadłub z malowaniem: szary spód, pasek w kolorze producenta.
  const id = `fus-${t.id}`;
  out.push(`<clipPath id="${id}"><polygon points="${P(hull)}"/></clipPath>`);
  out.push(`<polygon points="${P(hull)}" fill="#f4f7fa"/>`);
  out.push(`<g clip-path="url(#${id})"><rect x="0" y="${n(0.2 * D)}" width="${n(L)}" height="${n(D)}" fill="#d5dce4"/>`
    + `<path d="M0,${n(0.12 * D)} L${n(xt)},${n(0.12 * D)} L${n(L)},${n(tailTop)} L${n(L)},${n(tailTop + 0.06 * D)} L${n(xt)},${n(0.19 * D)} L0,${n(0.19 * D)} Z" fill="${color}"/></g>`);
  out.push(`<polygon points="${P(hull)}" fill="none" ${line}/>`);
  if (p.hump) out.push(`<line x1="${n(0.15 * L)}" y1="${n(top)}" x2="${n(0.3 * L)}" y2="${n(top)}" stroke="#f4f7fa" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);

  // Okna pasażerskie i drzwi.
  const win = (y, x1, x2) => out.push(`<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" stroke="#1e3a5f" stroke-width="${n(Math.min(0.36, 0.1 * D))}" stroke-dasharray="0.26 0.28"/>`);
  const winStart = (p.hump ? nl * 0.95 : nl) + 0.9, winEnd = xt + tl * 0.15;
  if (p.deck2) { win(-0.24 * D, winStart - 1, winEnd - 2); win(0.08 * D, winStart, winEnd); }
  else win(-0.12 * D, winStart, winEnd);
  if (p.hump) win(top - 0.15 * D, 0.13 * L, 0.29 * L);
  const dh = Math.min(1.9, 0.55 * D), dw = t.cat === 'wide' ? 1.07 : 0.82, dy = (p.deck2 ? 0.08 : -0.1) * D - dh * 0.45;
  const doors = t.cat === 'wide' ? [nl + 0.6, 0.31 * L, xr + cr * 1.15, xt - 1.4] : p.wing === 'high' ? [xt - 2.5] : [nl + 0.5, xt - 1.1];
  for (const dx of doors) out.push(`<rect x="${n(dx)}" y="${n(dy)}" width="${dw}" height="${n(dh)}" rx="0.15" fill="none" stroke="#7c8aa0" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`);
  if (p.deck2) for (const dx of [nl + 1, 0.33 * L, xt - 2]) out.push(`<rect x="${n(dx)}" y="${n(-0.24 * D - dh * 0.5)}" width="${dw}" height="${n(dh)}" rx="0.15" fill="none" stroke="#7c8aa0" stroke-width="0.5" vector-effect="non-scaling-stroke"/>`);

  // Okna kokpitu dopasowane do krzywizny nosa.
  const cx = p.hump ? [0.042 * L, 0.075 * L] : p.deck2 ? [0.25 * nl, 0.62 * nl] : [0.5 * nl, 0.86 * nl];
  const cBot = (x) => p.deck2 ? -0.08 * D : Math.max(yTopAt(x) + 0.17 * D, top + 0.3 * D);
  const cTop = (x) => p.deck2 ? -0.2 * D : yTopAt(x) + 0.05 * D;
  if (p.deck2) out.push(`<polygon points="${P([[cx[0], cTop(0) + 0.05 * D], [cx[1], cTop(0)], [cx[1] + 0.2, cBot(0)], [cx[0] - 0.1, cBot(0) + 0.02 * D]])}" fill="#1e293b"/>`);
  else out.push(`<polygon points="${P([[cx[0], cTop(cx[0]) + 0.02 * D], [cx[1], cTop(cx[1])], [cx[1] + 0.1, cBot(cx[1])], [cx[0] + 0.25, cBot(cx[0])]])}" fill="#1e293b"/>`);
  out.push(`<rect x="${n(L - 0.25)}" y="${n(tailTop + 0.02 * D)}" width="0.25" height="${n(tailBot - tailTop - 0.04 * D)}" fill="#334155"/>`); // wylot APU

  // --- Statecznik poziomy ------------------------------------------------------
  if (p.tail === 'T') {
    const sx = finTipLE - 0.35, sc = finTipC + 1.4;
    out.push(`<polygon points="${P([[sx, finTip + 0.15], [sx + sc * 0.35, finTip - 0.12], [sx + sc, finTip - 0.05], [sx + sc, finTip + 0.2], [sx + 0.3, finTip + 0.35]])}" fill="#cbd5e1" ${line}/>`);
  } else {
    const sx = L - tl * 0.86, ss = Math.min(D * 1.7, 15), sc = tl * 0.42;
    const tipX = sx + ss * Math.tan((33 * Math.PI) / 180), tipY = -0.06 * D - ss * 0.12;
    out.push(`<polygon points="${P([[sx, -0.05 * D], [tipX, tipY], [tipX + sc * 0.35, tipY], [sx + sc, 0.02 * D], [sx + sc * 0.4, 0.06 * D]])}" fill="#cbd5e1" ${line}/>`);
  }

  // --- Skrzydło, silniki i podwozie -------------------------------------------
  const semi = p.span / 2 - D / 2, tanS = Math.tan((p.sweep * Math.PI) / 180), tanD = Math.tan((p.dih * Math.PI) / 180);
  const ct = cr * p.tip;
  const wheels = (x, count, r, strutTop) => {
    const xs = Array.from({ length: count }, (_, i) => x + (i - (count - 1) / 2) * r * 2.3);
    const cy = ground - r;
    out.push(`<line x1="${n(x)}" y1="${n(strutTop)}" x2="${n(x)}" y2="${n(cy)}" stroke="#64748b" stroke-width="${n(Math.max(0.22, r * 0.4))}"/>`);
    if (count > 1) out.push(`<line x1="${n(xs[0])}" y1="${n(cy)}" x2="${n(xs[count - 1])}" y2="${n(cy)}" stroke="#64748b" stroke-width="${n(r * 0.35)}"/>`);
    for (const wx of xs) out.push(`<circle cx="${n(wx)}" cy="${n(cy)}" r="${n(r)}" fill="#1e293b" stroke="#94a3b8" stroke-width="0.6" vector-effect="non-scaling-stroke"/><circle cx="${n(wx)}" cy="${n(cy)}" r="${n(r * 0.4)}" fill="#94a3b8"/>`);
  };
  const r = p.wheel;
  // Podwozie przednie.
  wheels(nl * 0.85, 1, r * 0.75, bot - 0.1);

  // Gondola silnika odrzutowego: wlot, osłona wentylatora, rdzeń i stożek wylotowy.
  const jet = (x, yc, le, de, pylonTo) => {
    if (pylonTo) out.push(`<polygon points="${P([[x + le * 0.3, yc - de * 0.45], [pylonTo[0], pylonTo[1]], [pylonTo[0] + le * 0.5, pylonTo[1] + 0.1], [x + le * 0.95, yc - de * 0.2]])}" fill="#cbd5e1" ${line}/>`);
    out.push(`<path d="M${n(x + le * 0.62)},${n(yc - de * 0.3)} L${n(x + le * 0.92)},${n(yc - de * 0.17)} L${n(x + le)},${n(yc)} L${n(x + le * 0.92)},${n(yc + de * 0.17)} L${n(x + le * 0.62)},${n(yc + de * 0.3)} Z" fill="#94a3b8" ${line}/>`);
    out.push(`<path d="M${n(x)},${n(yc - de * 0.47)} C${n(x + 0.1 * le)},${n(yc - de * 0.52)} ${n(x + 0.45 * le)},${n(yc - de * 0.5)} ${n(x + 0.66 * le)},${n(yc - de * 0.38)} L${n(x + 0.66 * le)},${n(yc + de * 0.38)} C${n(x + 0.45 * le)},${n(yc + de * 0.5)} ${n(x + 0.1 * le)},${n(yc + de * 0.52)} ${n(x)},${n(yc + de * 0.47)} Z" fill="#e2e8f0" ${line}/>`);
    out.push(`<ellipse cx="${n(x + 0.03 * le)}" cy="${n(yc)}" rx="${n(de * 0.09)}" ry="${n(de * 0.45)}" fill="#334155"/>`);
  };

  if (p.wing === 'high') {
    // Górnopłat turbośmigłowca z owiewką na grzbiecie.
    const wy = top - 0.12;
    out.push(`<path d="M${n(xr - 1.2)},${n(top + 0.05)} C${n(xr - 0.3)},${n(wy - 0.45)} ${n(xr + cr + 0.5)},${n(wy - 0.45)} ${n(xr + cr + 2.4)},${n(top + 0.05)} Z" fill="#f4f7fa" ${line}/>`);
    const tipY = wy - semi * tanD;
    out.push(`<polygon points="${P([[xr, wy], [xr + semi * tanS, tipY - 0.15], [xr + semi * tanS + ct, tipY - 0.05], [xr + cr, wy + 0.12], [xr + 0.2 * cr, wy + 0.22]])}" fill="#cbd5e1" ${line}/>`);
    // Gondola silnika pod skrzydłem i śmigło.
    const [le, de] = p.eng, ex = xr - 1.0, ey = wy + de * 0.42;
    const nacEnd = p.f === 'dash' ? xr + cr + 2.2 : xr + cr + 0.6;
    out.push(`<path d="M${n(ex)},${n(ey - de * 0.35)} C${n(ex + 0.5)},${n(ey - de * 0.62)} ${n(ex + le * 0.4)},${n(wy - 0.05)} ${n(ex + le * 0.6)},${n(wy - 0.05)} L${n(nacEnd)},${n(wy + 0.05)} C${n(nacEnd - 0.6)},${n(ey + de * 0.5)} ${n(ex + le * 0.5)},${n(ey + de * 0.6)} ${n(ex + 0.4)},${n(ey + de * 0.45)} C${n(ex)},${n(ey + de * 0.3)} ${n(ex - 0.05)},${n(ey)} ${n(ex)},${n(ey - de * 0.35)} Z" fill="#e2e8f0" ${line}/>`);
    if (p.f === 'dash') wheels(nacEnd - 1.4, 1, r, ey + de * 0.4);
    else wheels(xr + cr * 0.55, 1, r, bot + 0.2);
    const pr = p.prop / 2, px = ex - 0.35;
    out.push(`<ellipse cx="${n(px)}" cy="${n(ey)}" rx="0.22" ry="${n(pr)}" fill="#64748b" fill-opacity=".28"/>`);
    out.push(`<path d="M${n(px)},${n(ey)} L${n(px - 0.12)},${n(ey - pr)} L${n(px + 0.12)},${n(ey - pr + 0.05)} Z M${n(px)},${n(ey)} L${n(px + 0.1)},${n(ey + pr)} L${n(px - 0.12)},${n(ey + pr - 0.05)} Z" fill="#334155"/>`);
    out.push(`<path d="M${n(ex)},${n(ey - 0.32)} Q${n(ex - 0.8)},${n(ey)} ${n(ex)},${n(ey + 0.32)} Z" fill="#475569"/>`);
  } else {
    // Dolnopłat: widoczne bliższe skrzydło, wznios unosi końcówkę.
    const yr = bot - 0.12 * D, tipX = xr + semi * tanS, tipY = yr - semi * tanD;
    out.push(`<polygon points="${P([[xr, yr], [tipX, tipY], [tipX + ct, tipY + 0.08], [xr + cr, yr + 0.25], [xr + cr * 0.3, yr + 0.12 * D]])}" fill="#cbd5e1" ${line}/>`);
    if (p.wl) {
      const [up, down] = p.wl, wx = tipX + ct * 0.15;
      const c = p.curved ? `C${n(wx + ct * 0.5)},${n(tipY - 0.2)} ${n(wx + ct * 0.7)},${n(tipY - up * 0.6)} ${n(wx + ct * 1.05)},${n(tipY - up)}` : `L${n(wx + ct * 0.75 + up * 0.35)},${n(tipY - up)}`;
      out.push(`<path d="M${n(wx)},${n(tipY + 0.05)} ${c} L${n(wx + ct * 1.15 + up * 0.38)},${n(tipY - up)} L${n(tipX + ct)},${n(tipY + 0.05)} Z" fill="${color}" ${line}/>`);
      if (down) out.push(`<polygon points="${P([[wx + ct * 0.3, tipY + 0.05], [wx + ct * 0.6 + down * 0.4, tipY + down], [wx + ct * 0.85 + down * 0.45, tipY + down], [tipX + ct * 0.9, tipY + 0.05]])}" fill="${color}" ${line}/>`);
    }
    // Podwozie główne za skrzydłem.
    const mx = xr + cr * 0.78;
    if (p.quad) { wheels(mx - 1.2, 2, r, bot); wheels(mx + 2.4, p.deck2 ? 3 : 2, r, bot); }
    else wheels(mx, p.bogie || (t.cat === 'wide' ? 2 : 1), r, bot);
    // Silniki.
    if (p.rear) {
      const [le, de] = p.eng;
      jet(L - tl - le * 0.75, -0.22 * D, le, de);
    } else {
      const [le, de] = p.eng;
      for (const eta of p.quad ? [0.64, 0.33] : [0.32]) {
        const wx = xr + eta * semi * tanS, wy = yr - eta * semi * tanD;
        const gap = t.cat === 'wide' ? 0.35 : p.f === 'b737' ? 0.02 : 0.2;
        const yc = wy + 0.2 + gap + de / 2;
        jet(wx - le * 0.62, yc, le, de, [wx - 0.1, wy + 0.05]);
      }
    }
  }

  return `<svg class="plane" viewBox="0 0 ${W} ${VH}" role="img" aria-label="${t.name}"><g transform="translate(${n(x0)},${n(y0)}) scale(${n(k)})">${out.join('')}</g></svg>`;
}
